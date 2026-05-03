/**
 * Loom (Architect) AgentDefinition factory.
 *
 * Loom dialogues with the user, generates specs, manages the workflow graph,
 * monitors shared memory, and handles escalations. Does NOT write project code.
 *
 * Reuses the existing `buildLoomPrompt(params)` template from agents/prompts.ts
 * to keep prompt evolution centralized.
 *
 * @module agents-config/loom
 */

import { buildLoomPrompt, type LoomPromptParams } from "../agents/prompts.js";
import { MCP_TOOL_PREFIX } from "../mcp/index.js";
import type { LoomfloAgentDefinition } from "./index.js";

const t = (name: string): string => `${MCP_TOOL_PREFIX}${name}`;

/** MCP tool names available to Loom — read-only + memory + graph mutation. */
export const LOOM_ALLOWED_TOOLS: readonly string[] = [
  t("read_file"),
  t("list_files"),
  t("search_files"),
  t("memory_read"),
  t("memory_write"),
  t("add_node"),
  t("remove_node"),
  t("update_node_instructions"),
  t("escalate_response"),
];

/**
 * Build the Loom AgentDefinition for a session.
 *
 * @param params - Runtime context (project description, graph state, chat history).
 * @returns AgentDefinition consumable by ClaudeAgentRuntime.
 */
export function createLoomAgentDefinition(params: LoomPromptParams): LoomfloAgentDefinition {
  return {
    role: "loom",
    description:
      "Architecte du workflow loomflo. Dialogue avec l'utilisateur, planifie la spec, modifie le DAG, traite les escalations. N'écrit pas de code projet.",
    prompt: buildLoomPrompt(params),
    defaultModel: "claude-opus-4-5",
    allowedTools: [...LOOM_ALLOWED_TOOLS],
  };
}
