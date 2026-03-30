#!/usr/bin/env node

/**
 * Daemon entry point — spawned as a detached child process by `loomflo start`.
 *
 * Reads configuration from environment variables and starts the Loomflo
 * daemon (Fastify server + WebSocket). Handles SIGTERM and SIGINT for
 * graceful shutdown.
 *
 * Environment variables:
 * - LOOMFLO_PORT — TCP port to listen on (default: 3000).
 * - LOOMFLO_HOST — Host address to bind to (default: 127.0.0.1).
 *   Set to 0.0.0.0 inside Docker containers.
 * - LOOMFLO_PROJECT_PATH — Absolute path to the project workspace.
 */

import { Daemon } from "./daemon.js";

// ============================================================================
// Constants
// ============================================================================

/** Default TCP port when LOOMFLO_PORT is not set. */
const DEFAULT_PORT = 3000;

// ============================================================================
// Configuration
// ============================================================================

const port = process.env["LOOMFLO_PORT"] ? Number(process.env["LOOMFLO_PORT"]) : DEFAULT_PORT;

const host = process.env["LOOMFLO_HOST"] ?? "127.0.0.1";
const projectPath = process.env["LOOMFLO_PROJECT_PATH"] ?? process.cwd();

// ============================================================================
// Startup
// ============================================================================

const daemon = new Daemon({ port, host, projectPath });

/**
 * Gracefully shut down the daemon on process signals.
 *
 * Stops accepting new requests, waits for active operations to complete,
 * removes daemon.json, and exits.
 */
async function shutdown(): Promise<void> {
  try {
    await daemon.stop();
  } catch {
    /* Best-effort shutdown — errors are not propagated. */
  }
  process.exit(0);
}

process.on("SIGTERM", (): void => {
  void shutdown();
});

process.on("SIGINT", (): void => {
  void shutdown();
});

try {
  const info = await daemon.start();
  /* Write to stderr so it doesn't interfere with any stdout piping.
   * In detached mode this goes to /dev/null anyway, but is useful for
   * manual debugging with stdio: 'inherit'. */
  process.stderr.write(
    `Loomflo daemon started on port ${String(info.port)} (PID ${String(info.pid)})\n`,
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start daemon: ${message}\n`);
  process.exit(1);
}
