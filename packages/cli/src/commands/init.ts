// packages/cli/src/commands/init.ts
import { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { ensureDaemonRunning, type DaemonInfo } from "../daemon-control.js";
import { inquirerBackend } from "../onboarding/prompts.inquirer.js";
import { runWizard } from "../onboarding/index.js";
import { WizardFlagsSchema } from "../onboarding/types.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { resolveProject } from "../project-resolver.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

interface InitDeps {
  ensureDaemon: () => Promise<DaemonInfo>;
  fetchProject: (info: DaemonInfo, id: string) => Promise<{ id: string; name: string } | null>;
  postProject: (
    info: DaemonInfo,
    body: { id: string; name: string; projectPath: string; providerProfileId: string },
  ) => Promise<{ id: string; name: string }>;
  initWorkflow: (
    info: DaemonInfo,
    projectId: string,
    body: { projectPath: string; config?: Record<string, unknown> },
  ) => Promise<{ id: string; status: string }>;
}

interface InitFlags {
  projectPath?: string;
  provider?: string;
  profile?: string;
  level?: string;
  budget?: string;
  defaultDelay?: string;
  retryDelay?: string;
  advanced?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
}

// ============================================================================
// Default production deps
// ============================================================================

function defaultDeps(): InitDeps {
  return {
    ensureDaemon: ensureDaemonRunning,
    fetchProject: async (info, id) => {
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects/${id}`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      return (await res.json()) as { id: string; name: string };
    },
    postProject: async (info, body) => {
      const res = await fetch(`http://127.0.0.1:${String(info.port)}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${info.token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`register failed: HTTP ${String(res.status)}`);
      return (await res.json()) as { id: string; name: string };
    },
    initWorkflow: async (info, projectId, body) => {
      const res = await fetch(
        `http://127.0.0.1:${String(info.port)}/projects/${projectId}/workflow/init`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${info.token}` },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "unknown" }))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${String(res.status)}`);
      }
      return (await res.json()) as { id: string; status: string };
    },
  };
}

// ============================================================================
// Commander wrapper
// ============================================================================

export function createInitCommand(): Command {
  const cmd = new Command("init")
    .description("Initialise a loomflo project (interactive onboarding wizard)")
    .option("--project-path <path>", "Project directory path")
    .option("--provider <type>", "anthropic-oauth | anthropic | openai | moonshot | nvidia")
    .option("--profile <name>", "Provider profile name")
    .option("--level <level>", "Workflow preset: 1 | 2 | 3 | custom")
    .option("--budget <usd>", "Budget limit (0 = unlimited)")
    .option("--default-delay <ms>", "Delay between nodes in ms")
    .option("--retry-delay <ms>", "Delay between retries in ms")
    .option("--advanced", "Prompt for advanced settings", false)
    .option("--yes", "Skip the final confirmation", false)
    .option("--non-interactive", "Fail instead of prompting when values are missing", false)
    .action(async (opts: InitFlags): Promise<void> => {
      const json = isJsonMode(opts);
      const flags = WizardFlagsSchema.parse({
        provider: opts.provider,
        profile: opts.profile,
        level: opts.level,
        budget: opts.budget,
        defaultDelay: opts.defaultDelay,
        retryDelay: opts.retryDelay,
        advanced: opts.advanced,
        yes: opts.yes,
        nonInteractive: opts.nonInteractive,
      });

      try {
        const cwd = opts.projectPath ? join(process.cwd(), opts.projectPath) : process.cwd();
        const { identity } = await resolveProject({ cwd, createIfMissing: true });

        const result = await runWizard({
          prompt: inquirerBackend,
          flags,
          projectName: identity.name,
        });

        if (!result.confirmed) {
          writeError(opts, "Wizard cancelled", "E_CANCEL");
          process.exitCode = 1;
          return;
        }

        // Persist project.json with the provider profile id.
        const projectFile = join(cwd, ".loomflo", "project.json");
        const projectData = { ...identity, providerProfileId: result.providerProfileId };
        await mkdir(join(cwd, ".loomflo"), { recursive: true });
        await writeFile(projectFile, `${JSON.stringify(projectData, null, 2)}\n`, { encoding: "utf-8" });

        // Persist config.
        const configFile = join(cwd, ".loomflo", "config.json");
        await writeFile(
          configFile,
          `${JSON.stringify(
            {
              budgetLimit: result.answers.budgetLimit,
              defaultDelay: result.answers.defaultDelay,
              retryDelay: result.answers.retryDelay,
              level: result.answers.level,
              ...result.answers.advanced,
            },
            null,
            2,
          )}\n`,
          { encoding: "utf-8" },
        );

        // Register + init workflow.
        const deps = defaultDeps();
        const info = await deps.ensureDaemon();
        const summary = (await deps.fetchProject(info, identity.id)) ?? (await deps.postProject(info, {
          id: identity.id,
          name: identity.name,
          projectPath: cwd,
          providerProfileId: result.providerProfileId,
        }));
        await deps.initWorkflow(info, identity.id, { projectPath: cwd, config: result.answers.advanced as unknown as Record<string, unknown> });

        if (json) {
          writeJson({
            project: { id: identity.id, name: summary.name },
            providerProfileId: result.providerProfileId,
            config: result.answers,
          });
          return;
        }

        process.stdout.write(
          `${theme.line(theme.glyph.check, "accent", `project ${theme.muted(summary.name)} ready`, identity.id)}\n`,
        );
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_INIT");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
