// packages/cli/src/commands/daemon.ts
import { Command } from "commander";
import { ensureDaemonRunning, getRunningDaemon } from "../daemon-control.js";

export function createDaemonCommand(): Command {
  const root = new Command("daemon").description("Manage the Loomflo daemon");

  root
    .command("start")
    .description("Start the Loomflo daemon (no project)")
    .action(async () => {
      const info = await ensureDaemonRunning();
      console.log(`Daemon v${info.version ?? "?"} running on port ${String(info.port)} (pid ${String(info.pid)})`);
    });

  root
    .command("stop")
    .description("Stop the Loomflo daemon gracefully")
    .option("--force", "Skip confirmation and use SIGKILL")
    .action(async (opts: { force?: boolean }) => {
      const info = await getRunningDaemon();
      if (!info) {
        console.log("Daemon is not running.");
        return;
      }
      const running = await fetchActiveProjects(info);
      if (running.length > 0 && !opts.force) {
        console.error(
          `${String(running.length)} project(s) active: ${running.join(", ")}. ` +
            `Re-run with --force to stop anyway.`,
        );
        process.exit(2);
      }
      const signal = opts.force ? "SIGKILL" : "SIGTERM";
      process.kill(info.pid, signal);
      console.log(`Sent ${signal} to daemon (pid ${String(info.pid)}).`);
    });

  root
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const info = await getRunningDaemon();
      if (!info) {
        console.log("Daemon is not running.");
        return;
      }
      const res = await fetchJson(`http://127.0.0.1:${String(info.port)}/daemon/status`, info.token);
      console.log(JSON.stringify(res, null, 2));
    });

  root
    .command("restart")
    .description("Stop then start the daemon")
    .option("--force", "Force stop")
    .action(async (opts: { force?: boolean }) => {
      const info = await getRunningDaemon();
      if (info) {
        process.kill(info.pid, opts.force ? "SIGKILL" : "SIGTERM");
        await waitUntilStopped(info.pid, 15_000);
      }
      const started = await ensureDaemonRunning();
      console.log(`Daemon restarted: v${started.version ?? "?"} pid ${String(started.pid)}`);
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
