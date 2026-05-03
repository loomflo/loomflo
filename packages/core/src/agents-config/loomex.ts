/**
 * Loomex (Reviewer) AgentDefinition factory.
 *
 * Loomex inspects worker output against node instructions and produces a
 * PASS/FAIL/BLOCKED verdict. Read-only — does NOT modify project files.
 *
 * Reuses `buildLoomexPrompt(params)` from agents/prompts.ts.
 *
 * @module agents-config/loomex
 */

import { buildLoomexPrompt, type LoomexPromptParams } from "../agents/prompts.js";
import { MCP_TOOL_PREFIX } from "../mcp/index.js";
import type { LoomfloAgentDefinition } from "./index.js";

const t = (name: string): string => `${MCP_TOOL_PREFIX}${name}`;

/** MCP tool names available to Loomex — strictly read-only + memory read. */
export const LOOMEX_ALLOWED_TOOLS: readonly string[] = [
  t("read_file"),
  t("list_files"),
  t("search_files"),
  t("memory_read"),
  // No write_file, no shell_exec — Loomex must remain side-effect-free.
];

/**
 * Build the Loomex AgentDefinition for a review pass.
 *
 * @param params - Runtime context (node title, instructions, tasks to verify).
 * @returns AgentDefinition consumable by ClaudeAgentRuntime.
 */
export function createLoomexAgentDefinition(params: LoomexPromptParams): LoomfloAgentDefinition {
  return {
    role: "loomex",
    description:
      "Reviewer loomflo. Vérifie en lecture seule la qualité du travail des workers contre les instructions du node, retourne PASS/FAIL/BLOCKED.",
    prompt: buildLoomexPrompt(params),
    defaultModel: "claude-sonnet-4-6",
    allowedTools: [...LOOMEX_ALLOWED_TOOLS],
  };
}
