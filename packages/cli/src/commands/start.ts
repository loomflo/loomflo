// packages/cli/src/commands/start.ts
import { Command } from "commander";
import { resolve } from "node:path";
import { resolveProject } from "../project-resolver.js";
import { ensureDaemonRunning, type DaemonInfo } from "../daemon-control.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";
import type { ProjectIdentity } from "@loomflo/core";

export interface StartDeps {
  ensureDaemon: () => Promise<DaemonInfo>;
  fetchProject: (info: DaemonInfo, id: string) => Promise<{ id: string; status: string } | null>;
  postProject: (
    info: DaemonInfo,
    body: {
      id: string;
      name: string;
      projectPath: string;
      providerProfileId: string;
    },
  ) => Promise<{ id: string; status: string }>;
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
  daemonInfo: DaemonInfo;
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
  return { identity, created, daemonInfo: info };
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
  };
}

export function createStartCommand(): Command {
  const cmd = new Command("start")
    .description("Start this project's workflow (auto-starts the daemon)")
    .option("--project-path <path>", "Project directory path")
    .option("--provider <id>", "Provider profile id", "default")
    .option("--name <name>", "Project name (first run only)")
    .action(async (options: { projectPath?: string; provider?: string; name?: string; json?: boolean }) => {
      const cwd = options.projectPath ? resolve(options.projectPath) : process.cwd();
      const json = isJsonMode(options);
      const sp = json ? null : theme.spinner("starting\u2026");
      sp?.start();

      try {
        const result = await runStart({
          cwd,
          providerProfileId: options.provider ?? "default",
          projectName: options.name,
        });
        sp?.succeed();

        if (json) {
          writeJson({
            daemon: { port: result.daemonInfo.port, up: true },
            project: { id: result.identity.id, name: result.identity.name },
          });
          return;
        }

        process.stdout.write(
          `${theme.line(theme.glyph.check, "accent", "daemon running", `port ${String(result.daemonInfo.port)}`)}\n`,
        );
        process.stdout.write(
          `${theme.line(theme.glyph.check, "accent", `project ${result.identity.name} registered`, result.identity.id)}\n`,
        );
      } catch (err) {
        sp?.fail();
        writeError(options, err instanceof Error ? err.message : String(err), "E_START");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
