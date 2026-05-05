/**
 * Lightweight detection of agent CLI binaries on the local machine.
 *
 * Used by GET /runtimes/:name/availability so the dashboard wizard can show
 * whether the user has the relevant CLI installed + authenticated.
 *
 * Detection is best-effort:
 *  - We probe `--version` with a short timeout; success = installed.
 *  - For Copilot we look at `~/.config/github-copilot/hosts.json` to infer
 *    "authenticated" (mirrors what the SDK / VS Code extension do).
 *  - For Claude Code we look at `~/.claude/.credentials.json`.
 *  - For Codex we just probe `--version` (the CLI is too young to have a
 *    stable auth marker).
 *
 * @module api/cli-detection
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentCliName = "claude-code" | "copilot" | "codex";

export interface CliAvailability {
  /** Whether the CLI binary was found and `--version` returned 0. */
  installed: boolean;
  /** Whether we detected a credentials artifact suggesting the user is logged in. */
  authenticated: boolean;
  /** Version string from `--version` output, or undefined if not installed. */
  version?: string;
  /** Override path being used (or default binary name). */
  path: string;
}

/** Default lookup names. Can be overridden via env vars per CLI. */
const DEFAULT_BINARY: Record<AgentCliName, string> = {
  "claude-code": "claude",
  copilot: "copilot",
  codex: "codex",
};

/** Env vars that override the binary path per CLI. */
const PATH_ENV_VAR: Record<AgentCliName, string[]> = {
  "claude-code": ["LOOMFLO_CLAUDE_CODE_PATH", "CLAUDE_CODE_PATH"],
  copilot: ["LOOMFLO_COPILOT_CLI_PATH", "COPILOT_CLI_PATH"],
  codex: ["LOOMFLO_CODEX_CLI_PATH", "CODEX_CLI_PATH"],
};

function resolvedBinary(cli: AgentCliName, env: NodeJS.ProcessEnv): string {
  for (const k of PATH_ENV_VAR[cli]) {
    const v = env[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return DEFAULT_BINARY[cli];
}

/**
 * Run `<binary> --version` with a short timeout and return its trimmed stdout
 * on success, or null if the spawn fails (binary not in PATH, exit != 0,
 * timeout).
 */
function probeVersion(binary: string, timeoutMs = 1500): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(binary, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      // No shell: avoid PATH ambiguity / quoting issues.
    });
    let out = "";
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill();
      } catch {
        /* swallow */
      }
      resolve(null);
    }, timeoutMs);

    child.stdout.on("data", (buf: Buffer) => {
      out += buf.toString("utf8");
    });
    child.on("error", () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : null);
    });
  });
}

/**
 * Detect whether the user has a credentials artifact suggesting they're
 * logged in to the given CLI. Cheap filesystem checks, no network calls.
 */
function isAuthenticated(cli: AgentCliName, home: string): boolean {
  switch (cli) {
    case "claude-code":
      return existsSync(join(home, ".claude", ".credentials.json"));
    case "copilot":
      return existsSync(join(home, ".config", "github-copilot", "hosts.json"));
    case "codex":
      // No widely-published auth marker yet — fall back to "we can't tell".
      return false;
  }
}

/**
 * Probe a single CLI's availability. Safe to call repeatedly; not cached
 * (callers can wrap with a TTL cache if a tight loop becomes expensive —
 * the dashboard wizard only needs one check per page load).
 */
export async function detectAgentCli(
  cli: AgentCliName,
  opts?: { env?: NodeJS.ProcessEnv; homeDir?: string; timeoutMs?: number },
): Promise<CliAvailability> {
  const env = opts?.env ?? process.env;
  const home = opts?.homeDir ?? homedir();
  const path = resolvedBinary(cli, env);
  const versionRaw = await probeVersion(path, opts?.timeoutMs);
  const installed = versionRaw !== null;
  const authenticated = installed && isAuthenticated(cli, home);
  return {
    installed,
    authenticated,
    ...(versionRaw ? { version: versionRaw } : {}),
    path,
  };
}

/** Detect all known agent CLIs in parallel. */
export async function detectAllAgentClis(
  opts?: { env?: NodeJS.ProcessEnv; homeDir?: string; timeoutMs?: number },
): Promise<Record<AgentCliName, CliAvailability>> {
  const [claude, copilot, codex] = await Promise.all([
    detectAgentCli("claude-code", opts),
    detectAgentCli("copilot", opts),
    detectAgentCli("codex", opts),
  ]);
  return { "claude-code": claude, copilot, codex };
}
