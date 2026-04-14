import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";

// ============================================================================
// Constants
// ============================================================================

/** Path to daemon.json in the user's home directory. */
const DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");

/** Maximum time to wait for daemon.json to appear (in milliseconds). */
const STARTUP_TIMEOUT_MS = 15_000;

/** Interval between daemon.json polls during startup (in milliseconds). */
const POLL_INTERVAL_MS = 250;

/** Default TCP port for the daemon. */
const DEFAULT_PORT = 3000;

// ============================================================================
// Types
// ============================================================================

/** Parsed CLI options for the start command. */
interface StartOptions {
  port?: string;
  projectPath?: string;
}

/** Shape of the daemon.json file. */
interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  version?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Wait until ~/.loomflo/daemon.json exists and contains valid JSON.
 *
 * Polls the filesystem at regular intervals until the file appears
 * or the timeout is exceeded. This is used to confirm that the
 * detached daemon process has started successfully.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds.
 * @returns The parsed daemon info.
 * @throws {Error} If the timeout is exceeded before daemon.json appears.
 */
async function waitForDaemonFile(timeoutMs: number): Promise<DaemonInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(DAEMON_JSON_PATH, "utf-8");
      const parsed = JSON.parse(raw) as unknown;

      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as DaemonInfo).port === "number" &&
        typeof (parsed as DaemonInfo).token === "string" &&
        typeof (parsed as DaemonInfo).pid === "number"
      ) {
        return parsed as DaemonInfo;
      }
    } catch {
      /* File does not exist yet or is incomplete — keep polling. */
    }

    await new Promise<void>((resolve): void => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  throw new Error(`Daemon did not start within ${String(timeoutMs / 1000)} seconds`);
}

/**
 * Check whether a process with the given PID is alive.
 *
 * Uses `process.kill(pid, 0)` which sends no signal but throws
 * if the process does not exist.
 *
 * @param pid - The process ID to check.
 * @returns True if the process is running.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the daemon is already running by reading daemon.json
 * and verifying the process is alive.
 *
 * @returns The daemon info if running, or null if not.
 */
async function getRunningDaemon(): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(DAEMON_JSON_PATH, "utf-8");
    const info = JSON.parse(raw) as DaemonInfo;

    if (typeof info.pid === "number" && isProcessAlive(info.pid)) {
      return info;
    }
  } catch {
    /* daemon.json missing or invalid — daemon is not running. */
  }

  return null;
}

/**
 * Resolve the path to the daemon entry point script.
 *
 * Looks for the daemon entry script in the @loomflo/core package,
 * which should be located relative to the CLI package.
 *
 * @returns Absolute path to the daemon entry script.
 */
function resolveDaemonScript(): string {
  /* The daemon script is in @loomflo/core dist directory.
   * From packages/cli/dist/commands/start.js, the core package is at:
   *   ../../core/dist/daemon-entry.js (within the monorepo)
   *
   * We resolve from the CLI package root using import.meta for portability. */
  const cliDir = new URL("..", import.meta.url).pathname;

  /* Try monorepo-relative path first: packages/cli -> packages/core */
  const monorepoPath = resolve(cliDir, "..", "core", "dist", "daemon-entry.js");

  return monorepoPath;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `start` command for the loomflo CLI.
 *
 * Usage: `loomflo start [--port <number>] [--project-path <path>]`
 *
 * Spawns the Loomflo daemon as a detached child process. The daemon
 * writes its connection details to ~/.loomflo/daemon.json, which
 * this command polls to confirm successful startup.
 *
 * If the daemon is already running (daemon.json exists and the PID
 * is alive), the command exits with an informational message.
 *
 * @returns A configured commander Command instance.
 */
export function createStartCommand(): Command {
  const cmd = new Command("start")
    .description("Start the Loomflo daemon")
    .option("--port <number>", "TCP port to listen on", String(DEFAULT_PORT))
    .option("--project-path <path>", "Project directory path")
    .action(async (options: StartOptions): Promise<void> => {
      /* ------------------------------------------------------------------ */
      /* Check for already-running daemon                                   */
      /* ------------------------------------------------------------------ */

      const existing = await getRunningDaemon();
      if (existing) {
        console.log(
          `Daemon already running on port ${String(existing.port)} (PID ${String(existing.pid)})`,
        );
        return;
      }

      /* ------------------------------------------------------------------ */
      /* Parse options                                                      */
      /* ------------------------------------------------------------------ */

      const port = options.port !== undefined ? Number(options.port) : DEFAULT_PORT;
      if (Number.isNaN(port) || port < 1 || port > 65_535) {
        console.error("Error: --port must be a valid port number (1–65535)");
        process.exit(1);
      }

      const projectPath = options.projectPath ? resolve(options.projectPath) : process.cwd();

      /* ------------------------------------------------------------------ */
      /* Spawn daemon as detached child process                             */
      /* ------------------------------------------------------------------ */

      const daemonScript = resolveDaemonScript();

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        LOOMFLO_PORT: String(port),
        LOOMFLO_PROJECT_PATH: projectPath,
      };

      const child = spawn("node", [daemonScript], {
        detached: true,
        stdio: "ignore",
        env,
      });

      /* Let the child process run independently of the CLI process. */
      child.unref();

      /* ------------------------------------------------------------------ */
      /* Wait for daemon to write daemon.json                               */
      /* ------------------------------------------------------------------ */

      console.log("Starting Loomflo daemon...");

      try {
        const info = await waitForDaemonFile(STARTUP_TIMEOUT_MS);

        console.log(`Daemon started successfully.`);
        console.log(`  Port: ${String(info.port)}`);
        console.log(`  PID:  ${String(info.pid)}`);
        console.log(`  URL:  http://127.0.0.1:${String(info.port)}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start daemon: ${message}`);
        process.exit(1);
      }
    });

  return cmd;
}
