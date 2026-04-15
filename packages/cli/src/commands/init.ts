// packages/cli/src/commands/init.ts
import { Command } from "commander";
import { resolve } from "node:path";
import { resolveProject } from "../project-resolver.js";
import { ensureDaemonRunning, type DaemonInfo } from "../daemon-control.js";
import type { ProjectIdentity } from "@loomflo/core";

// ============================================================================
// Types
// ============================================================================

interface InitDeps {
  ensureDaemon: () => Promise<DaemonInfo>;
  fetchProject: (info: DaemonInfo, id: string) => Promise<{ id: string; status: string } | null>;
  postProject: (
    info: DaemonInfo,
    body: { id: string; name: string; projectPath: string; providerProfileId: string },
  ) => Promise<{ id: string; status: string }>;
  initWorkflow: (
    info: DaemonInfo,
    projectId: string,
    body: { description: string; projectPath: string; config?: Record<string, unknown> },
  ) => Promise<{ id: string; status: string }>;
}

export interface RunInitOptions {
  cwd: string;
  description: string;
  providerProfileId: string;
  projectName?: string;
  config?: Record<string, unknown>;
  deps?: InitDeps;
}

export interface RunInitResult {
  identity: ProjectIdentity;
  workflow: { id: string; status: string };
}

// ============================================================================
// Core logic (injectable deps for testing)
// ============================================================================

export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const deps = opts.deps ?? defaultDeps();
  const { identity } = await resolveProject({
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
  const workflow = await deps.initWorkflow(info, identity.id, {
    description: opts.description,
    projectPath: opts.cwd,
    ...(opts.config !== undefined && { config: opts.config }),
  });
  return { identity, workflow };
}

// ============================================================================
// Default production deps
// ============================================================================

function defaultDeps(): InitDeps {
  return {
    ensureDaemon: ensureDaemonRunning,
    fetchProject: async (info, id) => {
      const res = await fetch(`http://127.0.0.1:${info.port}/projects/${id}`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { id: string; status: string };
    },
    postProject: async (info, body) => {
      const res = await fetch(`http://127.0.0.1:${info.port}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${info.token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`register failed: HTTP ${res.status}`);
      return (await res.json()) as { id: string; status: string };
    },
    initWorkflow: async (info, projectId, body) => {
      const res = await fetch(
        `http://127.0.0.1:${info.port}/projects/${projectId}/workflow/init`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${info.token}` },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "unknown" }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string; status: string };
    },
  };
}

// ============================================================================
// Commander wrapper
// ============================================================================

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize a new workflow from a project description")
    .argument("<description>", "Natural language description of the project")
    .option("--project-path <path>", "Project directory path")
    .option("--provider <id>", "Provider profile id", "default")
    .option("--name <name>", "Project name (first run only)")
    .option("--budget <number>", "Budget limit in dollars")
    .option("--reviewer", "Enable the reviewer agent")
    .option("--delay <duration>", "Delay between node activations (e.g. 10m, 1h, 1d)")
    .action(
      async (
        description: string,
        options: {
          projectPath?: string;
          provider?: string;
          name?: string;
          budget?: string;
          reviewer?: boolean;
          delay?: string;
        },
      ) => {
        // Validate description length
        const trimmed = description.trim();
        if (trimmed.length < 10 || trimmed.length > 2000) {
          console.error("Error: Description must be between 10 and 2000 characters.");
          process.exit(1);
        }

        // Build config from flags
        const config: Record<string, unknown> = {};
        if (options.budget !== undefined) {
          const budgetLimit = Number(options.budget);
          if (Number.isNaN(budgetLimit) || budgetLimit <= 0) {
            console.error("Error: --budget must be a positive number");
            process.exit(1);
          }
          config["budgetLimit"] = budgetLimit;
        }
        if (options.reviewer === true) config["reviewerEnabled"] = true;
        if (options.delay !== undefined) {
          if (!/^(0|\d+[mhd])$/.test(options.delay)) {
            console.error('Error: --delay must be "0" or a duration like "10m", "1h", "1d"');
            process.exit(1);
          }
          config["defaultDelay"] = options.delay;
        }

        const cwd = options.projectPath ? resolve(options.projectPath) : process.cwd();

        try {
          const result = await runInit({
            cwd,
            description,
            providerProfileId: options.provider ?? "default",
            ...(options.name !== undefined && { projectName: options.name }),
            ...(Object.keys(config).length > 0 && { config }),
          });
          console.log("Workflow initialized successfully.");
          console.log(`  Project: ${result.identity.name} (${result.identity.id})`);
          console.log(`  Workflow: ${result.workflow.id}`);
          console.log(`  Status:   ${result.workflow.status}`);
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );
}
