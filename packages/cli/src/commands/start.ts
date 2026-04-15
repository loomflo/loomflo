// packages/cli/src/commands/start.ts
import { Command } from "commander";
import { resolve } from "node:path";
import { resolveProject } from "../project-resolver.js";
import { ensureDaemonRunning, type DaemonInfo } from "../daemon-control.js";
import type { ProjectIdentity } from "@loomflo/core";

interface StartDeps {
  ensureDaemon: () => Promise<DaemonInfo>;
  fetchProject: (
    info: DaemonInfo,
    id: string,
  ) => Promise<{ id: string; status: string } | null>;
  postProject: (
    info: DaemonInfo,
    body: {
      id: string;
      name: string;
      projectPath: string;
      providerProfileId: string;
    },
  ) => Promise<{ id: string; status: string }>;
  streamEvents: (info: DaemonInfo, projectId: string) => Promise<void>;
}

export interface RunStartOptions {
  cwd: string;
  providerProfileId: string;
  projectName?: string;
  deps?: StartDeps;
}

export interface RunStartResult {
  identity: ProjectIdentity;
  created: boolean;
}

export async function runStart(opts: RunStartOptions): Promise<RunStartResult> {
  const deps = opts.deps ?? defaultDeps();
  const { identity, created } = await resolveProject({
    cwd: opts.cwd,
    createIfMissing: true,
    name: opts.projectName,
  });
  const info = await deps.ensureDaemon();
  const current = await deps.fetchProject(info, identity.id);
  if (!current) {
    await deps.postProject(info, {
      id: identity.id,
      name: identity.name,
      projectPath: opts.cwd,
      providerProfileId: opts.providerProfileId,
    });
  }
  await deps.streamEvents(info, identity.id);
  return { identity, created };
}

function defaultDeps(): StartDeps {
  return {
    ensureDaemon: ensureDaemonRunning,
    fetchProject: async (info, id) => {
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects/${id}`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      return (await res.json()) as { id: string; status: string };
    },
    postProject: async (info, body) => {
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${info.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`register failed: HTTP ${String(res.status)}`);
      return (await res.json()) as { id: string; status: string };
    },
    streamEvents: async (info, projectId) => {
      // Minimal streaming via polling /projects/:id/events until SIGINT.
      // A proper WebSocket stream is wired up in S3/S4.
      process.once("SIGINT", () => process.exit(0));
      for (;;) {
        const res = await fetch(
          `http://127.0.0.1:${String(info.port)}/projects/${projectId}/events`,
          { headers: { authorization: `Bearer ${info.token}` } },
        );
        if (!res.ok) break;
        const events = (await res.json()) as unknown[];
        for (const ev of events) console.log(JSON.stringify(ev));
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    },
  };
}

export function createStartCommand(): Command {
  return new Command("start")
    .description("Start this project's workflow (auto-starts the daemon)")
    .option("--project-path <path>", "Project directory path")
    .option("--provider <id>", "Provider profile id", "default")
    .option("--name <name>", "Project name (first run only)")
    .action(async (options: { projectPath?: string; provider?: string; name?: string }) => {
      const cwd = options.projectPath ? resolve(options.projectPath) : process.cwd();
      try {
        await runStart({
          cwd,
          providerProfileId: options.provider ?? "default",
          projectName: options.name,
        });
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
