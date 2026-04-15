// packages/cli/src/commands/daemon.ts
import { Command } from "commander";
import { ensureDaemonRunning, getRunningDaemon } from "../daemon-control.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

export function createDaemonCommand(): Command {
  const root = new Command("daemon").description("Manage the Loomflo daemon");

  const startCmd = root
    .command("start")
    .description("Start the Loomflo daemon (no project)");
  withJsonSupport(startCmd);
  startCmd.action(async (options: { json?: boolean }) => {
    const info = await ensureDaemonRunning();
    const port = String(info.port);
    const pid = String(info.pid);
    const version = info.version ?? "?";
    if (isJsonMode(options)) {
      writeJson({ action: "start", port: info.port, pid: info.pid, version });
    } else {
      process.stdout.write(
        theme.line(theme.glyph.check, "accent", `daemon v${version} running`, `port ${port}, pid ${pid}`) + "\n",
      );
    }
  });

  const stopCmd = root
    .command("stop")
    .description("Stop the Loomflo daemon gracefully")
    .option("--force", "Skip confirmation and use SIGKILL");
  withJsonSupport(stopCmd);
  stopCmd.action(async (opts: { force?: boolean; json?: boolean }) => {
    const info = await getRunningDaemon();
    if (!info) {
      if (isJsonMode(opts)) {
        writeJson({ action: "stop", status: "not_running" });
      } else {
        process.stdout.write(
          theme.line(theme.glyph.dot, "dim", "daemon is not running") + "\n",
        );
      }
      return;
    }
    const running = await fetchActiveProjects(info);
    if (running.length > 0 && !opts.force) {
      writeError(
        opts,
        `${String(running.length)} project(s) active: ${running.join(", ")}. Re-run with --force to stop anyway.`,
      );
      process.exitCode = 1;
      return;
    }
    const signal = opts.force ? "SIGKILL" : "SIGTERM";
    process.kill(info.pid, signal);
    if (isJsonMode(opts)) {
      writeJson({ action: "stop", pid: info.pid, signal });
    } else {
      process.stdout.write(
        theme.line(theme.glyph.check, "accent", `sent ${signal} to daemon`, `pid ${String(info.pid)}`) + "\n",
      );
    }
  });

  const statusCmd = root
    .command("status")
    .description("Show daemon status");
  withJsonSupport(statusCmd);
  statusCmd.action(async (options: { json?: boolean }) => {
    const info = await getRunningDaemon();
    if (!info) {
      if (isJsonMode(options)) {
        writeJson({ status: "not_running" });
      } else {
        process.stdout.write(
          theme.line(theme.glyph.dot, "dim", "daemon is not running") + "\n",
        );
      }
      return;
    }
    const res = await fetchJson<Record<string, unknown>>(
      `http://127.0.0.1:${String(info.port)}/daemon/status`,
      info.token,
    );
    if (isJsonMode(options)) {
      writeJson(res);
    } else {
      process.stdout.write(theme.heading("Daemon Status") + "\n");
      for (const [key, value] of Object.entries(res)) {
        process.stdout.write(theme.kv(key, String(value)) + "\n");
      }
    }
  });

  const restartCmd = root
    .command("restart")
    .description("Stop then start the daemon")
    .option("--force", "Force stop");
  withJsonSupport(restartCmd);
  restartCmd.action(async (opts: { force?: boolean; json?: boolean }) => {
    const info = await getRunningDaemon();
    if (info) {
      process.kill(info.pid, opts.force ? "SIGKILL" : "SIGTERM");
      await waitUntilStopped(info.pid, 15_000);
    }
    const started = await ensureDaemonRunning();
    if (isJsonMode(opts)) {
      writeJson({ action: "restart", pid: started.pid, version: started.version ?? "?" });
    } else {
      process.stdout.write(
        theme.line(
          theme.glyph.check,
          "accent",
          `daemon restarted`,
          `v${started.version ?? "?"} pid ${String(started.pid)}`,
        ) + "\n",
      );
    }
  });

  return root;
}

async function fetchActiveProjects(info: { port: number; token: string }): Promise<string[]> {
  try {
    const res = await fetchJson<Array<{ id: string; status: string }>>(
      `http://127.0.0.1:${String(info.port)}/projects`,
      info.token,
    );
    return res.filter((p) => p.status !== "idle").map((p) => p.id);
  } catch {
    return [];
  }
}

async function fetchJson<T = unknown>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

async function waitUntilStopped(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`Daemon (pid ${String(pid)}) did not stop within ${String(timeoutMs)}ms`);
}
