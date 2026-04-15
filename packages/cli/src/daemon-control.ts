import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { withFileLock } from "@loomflo/core";

export const MIN_DAEMON_VERSION = "0.2.0";
const DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");
const DAEMON_LOCK_PATH = join(homedir(), ".loomflo", "daemon.lock");
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
  const child = spawn("node", [daemonScript], {
    detached: true,
    stdio: "ignore",
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
  throw new Error(`Daemon did not start within ${timeoutMs}ms`);
}
