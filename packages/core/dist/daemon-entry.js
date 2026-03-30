#!/usr/bin/env node
import {
  Daemon
} from "./chunk-7M4TNMD3.js";

// src/daemon-entry.ts
var DEFAULT_PORT = 3e3;
var port = process.env["LOOMFLO_PORT"] ? Number(process.env["LOOMFLO_PORT"]) : DEFAULT_PORT;
var host = process.env["LOOMFLO_HOST"] ?? "127.0.0.1";
var projectPath = process.env["LOOMFLO_PROJECT_PATH"] ?? process.cwd();
var daemon = new Daemon({ port, host, projectPath });
async function shutdown() {
  try {
    await daemon.stop();
  } catch {
  }
  process.exit(0);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
try {
  const info = await daemon.start();
  process.stderr.write(
    `Loomflo daemon started on port ${String(info.port)} (PID ${String(info.pid)})
`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start daemon: ${message}
`);
  process.exit(1);
}
