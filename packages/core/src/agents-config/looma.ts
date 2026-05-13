/**
 * Looma (Worker) AgentDefinition factory.
 *
 * Looma writes code, creates files, runs commands, and communicates with
 * teammates. Each Looma is constrained by its file scope (enforced server-side
 * by the loomflo MCP server).
 *
 * Reuses `buildLoomaPrompt(params)` from agents/prompts.ts.
 *
 * @module agents-config/looma
 */

import { buildLoomaPrompt, type LoomaPromptParams } from "../agents/prompts.js";
import { MCP_TOOL_PREFIX } from "../mcp/index.js";
import type { LoomfloAgentDefinition } from "./index.js";

const t = (name: string): string => `${MCP_TOOL_PREFIX}${name}`;

/** MCP tool names available to Looma. */
export const LOOMA_ALLOWED_TOOLS: readonly string[] = [
  t("read_file"),
  t("write_file"),
  t("edit_file"),
  t("list_files"),
  t("search_files"),
  t("exec_command"),
  t("read_memory"),
  t("write_memory"),
  t("send_message"),
  t("report_complete"),
];

/**
 * Build the Looma AgentDefinition for a single worker task.
 *
 * The worker's `fileScope` is enforced inside the MCP server (write_file /
 * edit_file refuse paths outside the allowed globs). This is enforced regardless
 * of what the agent attempts.
 *
 * @param params - Runtime context (task description, file scope, team context).
 * @returns AgentDefinition consumable by ClaudeAgentRuntime.
 */
export function createLoomaAgentDefinition(params: LoomaPromptParams): LoomfloAgentDefinition {
  return {
    role: "looma",
    description:
      "Worker loomflo. Exécute une tâche atomique (lecture/écriture de fichiers, commandes shell, tests). Périmètre d'écriture restreint à fileScope.",
    prompt: buildLoomaPrompt(params),
    defaultModel: "claude-sonnet-4-6",
    allowedTools: [...LOOMA_ALLOWED_TOOLS],
  };
}

/**
 * Build a Looma `AgentDefinition` for SDK subagent registration.
 *
 * Used when populating `Options.agents` so the main loop (Loomi) can spawn a
 * subagent of type `looma` via the SDK's built-in `Agent` tool. The actual
 * task description and team context are supplied by Loomi at dispatch time
 * via the Agent tool's `prompt` parameter — this skeleton just sets the
 * persona and the available tool palette.
 *
 * Phase 2.2: scope enforcement is session-wide (canUseTool sees every write
 * regardless of which subagent issued it). True per-subagent scope isolation
 * requires either spawn-time canUseTool override (not currently supported by
 * the SDK) or loomflo-orchestrated parallel sessions (planned for Phase 3+).
 */
export function createLoomaSubagentDefinition(): LoomfloAgentDefinition {
  return {
    role: "looma",
    description:
      "Worker exécutant une tâche atomique déléguée par Loomi : lecture/écriture de fichiers, commandes shell, tests.",
    prompt: buildLoomaPrompt({
      taskDescription:
        "Tu reçois une tâche précise via le prompt initial du dispatcher. Lis-le attentivement.",
      fileScope: [],
      nodeInstructions:
        "Le périmètre d'écriture autorisé t'est communiqué par le dispatcher et appliqué automatiquement par le runtime.",
    }),
    defaultModel: "claude-sonnet-4-6",
    allowedTools: [...LOOMA_ALLOWED_TOOLS],
  };
}
