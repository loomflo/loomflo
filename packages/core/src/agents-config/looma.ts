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
  t("shell_exec"),
  t("memory_read"),
  t("memory_write"),
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
