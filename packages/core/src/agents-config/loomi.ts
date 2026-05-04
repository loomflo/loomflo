/**
 * Loomi (Orchestrator) AgentDefinition factory.
 *
 * Loomi plans worker teams, assigns file scopes, supervises workers, handles
 * retries, and escalates to Loom when needed. Does NOT write project code.
 *
 * Reuses `buildLoomiPrompt(params)` from agents/prompts.ts.
 *
 * @module agents-config/loomi
 */

import { buildLoomiPrompt, type LoomiPromptParams } from "../agents/prompts.js";
import { MCP_TOOL_PREFIX } from "../mcp/index.js";
import type { LoomfloAgentDefinition } from "./index.js";

const t = (name: string): string => `${MCP_TOOL_PREFIX}${name}`;

/** MCP tool names available to Loomi. */
export const LOOMI_ALLOWED_TOOLS: readonly string[] = [
  t("read_file"),
  t("list_files"),
  t("search_files"),
  t("read_memory"),
  t("write_memory"),
  t("send_message"),
  t("report_complete"),
  t("escalate"),
  // Built-in subagent dispatcher (Claude Agent SDK) for spawning Looma workers.
  "Agent",
];

/**
 * Build the Loomi AgentDefinition for a node execution.
 *
 * @param params - Runtime context for this node (title, instructions, worker count, scopes).
 * @returns AgentDefinition consumable by ClaudeAgentRuntime.
 */
export function createLoomiAgentDefinition(params: LoomiPromptParams): LoomfloAgentDefinition {
  return {
    role: "loomi",
    description:
      "Orchestrateur d'un node loomflo. Planifie l'équipe de workers, alloue les périmètres de fichiers, supervise l'exécution, gère retries et review.",
    prompt: buildLoomiPrompt(params),
    defaultModel: "claude-sonnet-4-6",
    allowedTools: [...LOOMI_ALLOWED_TOOLS],
  };
}
