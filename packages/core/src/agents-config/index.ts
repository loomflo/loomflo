/**
 * Agent definitions for loomflo's four roles, consumed by ClaudeAgentRuntime.
 *
 * Loom/Loomi/Looma/Loomex are no longer a custom runtime — they are
 * `AgentDefinition` values consumed by `@anthropic-ai/claude-agent-sdk`.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md §5
 *
 * @module agents-config
 */

import type { AgentRole } from "../runtimes/base.js";

export type LoomfloAgentDefinition = {
  /** Agent role this definition implements. */
  role: AgentRole;
  /** Natural-language description of when to invoke this agent. */
  description: string;
  /** Full system prompt for the agent. */
  prompt: string;
  /** Default model alias or full id (e.g., "sonnet", "claude-opus-4-5"). */
  defaultModel: string;
  /** Allowed MCP tool names (e.g., "mcp__loomflo__read_file"). */
  allowedTools: string[];
};

export const AGENTS_CONFIG_VERSION = "0.1.0";

export { createLoomAgentDefinition, LOOM_ALLOWED_TOOLS } from "./loom.js";
export { createLoomiAgentDefinition, LOOMI_ALLOWED_TOOLS } from "./loomi.js";
export {
  createLoomaAgentDefinition,
  createLoomaSubagentDefinition,
  LOOMA_ALLOWED_TOOLS,
} from "./looma.js";
export {
  createLoomexAgentDefinition,
  createLoomexSubagentDefinition,
  LOOMEX_ALLOWED_TOOLS,
} from "./loomex.js";
