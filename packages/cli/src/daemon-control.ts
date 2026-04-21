import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname } from "node:path";
import { join, resolve } from "node:path";
import { withFileLock } from "@loomflo/core";

export const MIN_DAEMON_VERSION = "0.3.0";
const DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");
const DAEMON_LOCK_PATH = join(homedir(), ".loomflo", "daemon.lock");
const DAEMON_LOG_PATH = join(homedir(), ".loomflo", "daemon.log");
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;
const LOCK_TIMEOUT_MS = 10_000;

export interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  version?: string;
}

export function isCompatibleVersion(version: string | undefined): boolean {
  if (!version) return false;
  const [major, minor] = version.split(".").map((n) => Number(n));
  const [reqMajor, reqMinor] = MIN_DAEMON_VERSION.split(".").map((n) => Number(n));
  if (
    major === undefined ||
    minor === undefined ||
    reqMajor === undefined ||
    reqMinor === undefined
  )
    return false;
  if (Number.isNaN(major) || Number.isNaN(minor)) return false;
  if (major !== reqMajor) return false;
  return minor >= reqMinor;
}

export async function getRunningDaemon(): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(DAEMON_JSON_PATH, "utf-8");
    const info = JSON.parse(raw) as DaemonInfo;
    if (typeof info.pid === "number" && isProcessAlive(info.pid)) return info;
  } catch {
    /* missing or invalid */
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Start the daemon if it's not running. Returns the daemon info. */
export async function ensureDaemonRunning(): Promise<DaemonInfo> {
  const existing = await getRunningDaemon();
  if (existing) return assertCompatible(existing);

  // Guard against an orphaned daemon process whose daemon.json was lost
  // (e.g. unclean shutdown, SIGKILL between listen() and writeDaemonFile()).
  // We can't reclaim the orphan — its auth token died with daemon.json — but
  // we can refuse fast with a clear error instead of spawning a new daemon
  // that will fail to bind the port and produce a confusing 15s timeout.
  const orphan = await findOrphanDaemonPid();
  if (orphan !== null) {
    throw new Error(
      `An orphaned daemon process (pid ${String(orphan)}) is still running but ~/.loomflo/daemon.json is missing. ` +
        `Run 'loomflo daemon stop --force' to terminate it, then retry.`,
    );
  }

  // proper-lockfile requires the target file to exist before locking.
  await mkdir(dirname(DAEMON_LOCK_PATH), { recursive: true });
  await writeFile(DAEMON_LOCK_PATH, "", { flag: "a" }); // create if absent

  await withFileLock(
    DAEMON_LOCK_PATH,
    async () => {
      const again = await getRunningDaemon();
      if (again) return;
      spawnDaemonDetached();
      await waitForDaemonFile(STARTUP_TIMEOUT_MS);
    },
    { timeoutMs: LOCK_TIMEOUT_MS },
  );

  const after = await getRunningDaemon();
  if (!after) throw new Error("Daemon spawn succeeded but daemon.json never appeared");
  return assertCompatible(after);
}

/**
 * Scan the process table for a running `daemon-entry.js` whose daemon.json
 * has gone missing. Returns the PID if exactly one such orphan is found,
 * otherwise null. Linux-only: reads /proc/<pid>/cmdline directly so we
 * don't shell out to `ss`/`lsof`. Returns null on non-Linux platforms.
 *
 * @param options.procRoot - Filesystem root to scan (default: "/proc").
 *   Tests override this to point at a fixture directory.
 * @param options.isAlive - Liveness check (default: `process.kill(pid, 0)`).
 *   Tests override this to avoid actually signaling real processes.
 */
export async function findOrphanDaemonPid(
  options: { procRoot?: string; isAlive?: (pid: number) => boolean } = {},
): Promise<number | null> {
  if (platform() !== "linux") return null;
  const procRoot = options.procRoot ?? "/proc";
  const isAlive = options.isAlive ?? isProcessAlive;
  let entries: string[];
  try {
    entries = await readdir(procRoot);
  } catch {
    return null;
  }
  const self = process.pid;
  const matches: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === self) continue;
    let cmdline: string;
    try {
      cmdline = await readFile(join(procRoot, entry, "cmdline"), "utf-8");
    } catch {
      continue;
    }
    // cmdline is NUL-separated argv; the daemon script path includes
    // `core/dist/daemon-entry.js`.
    if (cmdline.includes("core/dist/daemon-entry.js") && isAlive(pid)) {
      matches.push(pid);
    }
  }
  if (matches.length === 1) return matches[0] ?? null;
  return null;
}

function assertCompatible(info: DaemonInfo): DaemonInfo {
  if (!isCompatibleVersion(info.version)) {
    throw new Error(
      `Incompatible daemon version (${info.version ?? "unknown"}). ` +
        `Run 'loomflo daemon stop --force' and retry.`,
    );
  }
  return info;
}

function spawnDaemonDetached(): void {
  const cliDir = new URL("..", import.meta.url).pathname;
  const daemonScript = resolve(cliDir, "..", "core", "dist", "daemon-entry.js");

  // Append the daemon's stdout/stderr to ~/.loomflo/daemon.log so that
  // crashes at startup (bad config, port in use, etc.) are inspectable
  // after the fact. Falls back to "ignore" if the log file can't be opened.
  let stdio: "ignore" | ["ignore", number, number] = "ignore";
  try {
    const out = openSync(DAEMON_LOG_PATH, "a");
    stdio = ["ignore", out, out];
  } catch {
    /* log file unavailable; swallow stdio */
  }

  const child = spawn("node", [daemonScript], {
    detached: true,
    stdio,
    env: { ...process.env },
  });
  child.unref();
}

async function waitForDaemonFile(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(DAEMON_JSON_PATH, "utf-8");
      return;
    } catch {
      /* not yet */
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Daemon did not start within ${String(timeoutMs)}ms`);
}
