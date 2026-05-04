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
  t("read_memory"),
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

/**
 * Build a Loomex `AgentDefinition` for SDK subagent registration.
 *
 * Mirrors createLoomaSubagentDefinition: a generic persona/tool skeleton
 * usable when populating `Options.agents`. The concrete tasks-to-verify list
 * is supplied by the dispatcher at invocation time.
 */
export function createLoomexSubagentDefinition(): LoomfloAgentDefinition {
  return {
    role: "loomex",
    description:
      "Reviewer en lecture seule. Vérifie le travail produit dans le node et émet un verdict PASS/FAIL/BLOCKED.",
    prompt: buildLoomexPrompt({
      nodeTitle: "(provided by dispatcher)",
      nodeInstructions:
        "Le node sous review et la liste des tâches à vérifier te sont transmis par le dispatcher.",
      tasksToVerify: [],
    }),
    defaultModel: "claude-sonnet-4-6",
    allowedTools: [...LOOMEX_ALLOWED_TOOLS],
  };
}
