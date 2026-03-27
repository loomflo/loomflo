import { Command } from 'commander';

import { DaemonClient, readDaemonConfig } from '../client.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum time to wait for the daemon to shut down (in milliseconds). */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/** Interval between process-alive polls during shutdown (in milliseconds). */
const POLL_INTERVAL_MS = 500;

// ============================================================================
// Helpers
// ============================================================================

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
 * Wait for a process to exit within the given timeout.
 *
 * Polls `process.kill(pid, 0)` at regular intervals until the process
 * is no longer running or the timeout is exceeded.
 *
 * @param pid - The process ID to wait for.
 * @param timeoutMs - Maximum time to wait in milliseconds.
 * @returns True if the process exited, false if the timeout was exceeded.
 */
async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await new Promise<void>((resolve): void => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }

  return false;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `stop` command for the loomflo CLI.
 *
 * Usage: `loomflo stop [--force]`
 *
 * Sends a shutdown request to the running daemon via the REST API.
 * The daemon finishes any active agent calls (no new calls dispatched),
 * persists state, and exits gracefully.
 *
 * With `--force`, the command sends SIGTERM directly to the daemon
 * process if the graceful shutdown request fails or takes too long.
 *
 * @returns A configured commander Command instance.
 */
export function createStopCommand(): Command {
  const cmd = new Command('stop')
    .description('Stop the Loomflo daemon')
    .option('--force', 'Force stop with SIGTERM if graceful shutdown fails')
    .action(async (options: { force?: boolean }): Promise<void> => {
      /* ------------------------------------------------------------------ */
      /* Read daemon connection info                                        */
      /* ------------------------------------------------------------------ */

      let config;
      try {
        config = await readDaemonConfig();
      } catch {
        console.log('Daemon is not running.');
        return;
      }

      /* ------------------------------------------------------------------ */
      /* Send graceful shutdown request                                     */
      /* ------------------------------------------------------------------ */

      const client = new DaemonClient(config.port, config.token);

      console.log('Stopping Loomflo daemon...');

      try {
        const response = await client.post('/shutdown');

        if (response.ok) {
          console.log('Shutdown signal sent. Waiting for active calls to finish...');
        } else {
          /* The daemon might not have a /shutdown route yet (depends on
           * implementation state). Fall through to PID-based shutdown. */
          if (options.force === true && config.pid > 0) {
            console.log('Graceful shutdown not available. Sending SIGTERM...');
            process.kill(config.pid, 'SIGTERM');
          } else {
            console.error(
              'Daemon did not accept shutdown request. Use --force to send SIGTERM.',
            );
            process.exit(1);
          }
        }
      } catch {
        /* Network error — daemon may already be shutting down or the API
         * endpoint does not exist. Fall back to PID-based shutdown. */
        if (config.pid > 0 && isProcessAlive(config.pid)) {
          console.log('Cannot reach daemon API. Sending SIGTERM to process...');
          try {
            process.kill(config.pid, 'SIGTERM');
          } catch {
            console.log('Daemon process is no longer running.');
            return;
          }
        } else {
          console.log('Daemon process is no longer running.');
          return;
        }
      }

      /* ------------------------------------------------------------------ */
      /* Wait for the daemon process to exit                                */
      /* ------------------------------------------------------------------ */

      if (config.pid > 0) {
        const exited = await waitForProcessExit(config.pid, SHUTDOWN_TIMEOUT_MS);

        if (exited) {
          console.log('Daemon stopped.');
        } else if (options.force === true) {
          console.log('Timeout exceeded. Sending SIGKILL...');
          try {
            process.kill(config.pid, 'SIGKILL');
          } catch {
            /* Process may have exited between the check and the kill. */
          }
          console.log('Daemon killed.');
        } else {
          console.error(
            'Daemon did not stop within timeout. Use --force to terminate.',
          );
          process.exit(1);
        }
      } else {
        console.log('Daemon stopped.');
      }
    });

  return cmd;
}
