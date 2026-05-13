/**
 * Copilot SDK tool wrappers — re-exposes loomflo's built-in tools to a
 * `@github/copilot-sdk` session via `defineTool()`.
 *
 * The Copilot SDK supports MCP servers but only via stdio / http transports
 * (no in-process equivalent of `createSdkMcpServer` from the Claude Agent
 * SDK). To avoid the overhead of spawning a separate process per session, we
 * wrap each loomflo `Tool` directly with `defineTool()`. The tool
 * implementation files in `tools/*.ts` are reused as-is — no logic
 * duplication.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md §L1 (CopilotRuntime).
 *
 * @module runtimes/copilot-tools
 */

import { defineTool, type Tool as CopilotSdkTool } from "@github/copilot-sdk";
import { z } from "zod";
import { editFileTool } from "../tools/file-edit.js";
import { listFilesTool } from "../tools/file-list.js";
import { readFileTool } from "../tools/file-read.js";
import { searchFilesTool } from "../tools/file-search.js";
import { writeFileTool } from "../tools/file-write.js";
import { memoryReadTool } from "../tools/memory-read.js";
import { memoryWriteTool } from "../tools/memory-write.js";
import { shellExecTool } from "../tools/shell-exec.js";
import { createSendMessageTool, type MessageBusLike } from "../tools/send-message.js";
import {
  createReportCompleteTool,
  type CompletionHandlerLike,
} from "../tools/report-complete.js";
import { createEscalateTool, type EscalationHandlerLike } from "../tools/escalate.js";
import type { Tool, ToolContext } from "../tools/base.js";
import type { AgentRole, GlobPattern } from "./base.js";

// ============================================================================
// Options
// ============================================================================

export interface BuildCopilotToolsOpts {
  workspacePath: string;
  agentRole: AgentRole;
  agentId: string;
  nodeId: string;
  fileScope: GlobPattern[];
  messageBus: MessageBusLike;
  completionHandler: CompletionHandlerLike;
  escalationHandler: EscalationHandlerLike;
}

// ============================================================================
// Tool selection by role (mirrors mcp/loomflo-tools.ts)
// ============================================================================

function selectToolsForRole(
  role: AgentRole,
  deps: {
    messageBus: MessageBusLike;
    completionHandler: CompletionHandlerLike;
    escalationHandler: EscalationHandlerLike;
  },
): Tool[] {
  const tools: Tool[] = [readFileTool, listFilesTool, searchFilesTool, memoryReadTool];

  switch (role) {
    case "loom":
      tools.push(memoryWriteTool);
      return tools;

    case "loomi":
      tools.push(memoryWriteTool);
      tools.push(createSendMessageTool(deps.messageBus));
      tools.push(createEscalateTool(deps.escalationHandler));
      return tools;

    case "looma":
      tools.push(memoryWriteTool);
      tools.push(writeFileTool, editFileTool, shellExecTool);
      tools.push(createSendMessageTool(deps.messageBus));
      tools.push(createReportCompleteTool(deps.completionHandler));
      return tools;

    case "loomex":
      return tools;
  }
}

// ============================================================================
// defineTool wrapper
// ============================================================================

/**
 * Wrap a loomflo `Tool` as a Copilot SDK `Tool` via `defineTool()`.
 *
 * The loomflo tool's Zod input schema is reused directly as the Copilot tool's
 * `parameters`. The string return value of `Tool.execute(input, ctx)` is
 * passed through as the Copilot handler's return — the SDK accepts strings
 * (or ToolResultObject) for tool results.
 */
function wrapAsCopilotTool(loomfloTool: Tool, context: ToolContext): CopilotSdkTool<unknown> {
  if (!(loomfloTool.inputSchema instanceof z.ZodObject)) {
    throw new Error(
      `Loomflo tool "${loomfloTool.name}" must have a ZodObject input schema for Copilot defineTool`,
    );
  }
  return defineTool<unknown>(loomfloTool.name, {
    description: loomfloTool.description,
    parameters: loomfloTool.inputSchema as never,
    handler: async (args: unknown) => {
      return loomfloTool.execute(args, context);
    },
  });
}

// ============================================================================
// Public factory
// ============================================================================

/**
 * Build the array of Copilot SDK tools for a given session config.
 *
 * Used by CopilotRuntime when calling `client.createSession({ tools })`.
 * The role-based tool selection mirrors `createLoomfloMcpServer()` so an
 * agent has the same capability surface regardless of which runtime drives
 * the session.
 */
export function buildCopilotTools(opts: BuildCopilotToolsOpts): CopilotSdkTool<unknown>[] {
  const context: ToolContext = {
    workspacePath: opts.workspacePath,
    agentId: opts.agentId,
    nodeId: opts.nodeId,
    writeScope: opts.fileScope,
  };
  const selected = selectToolsForRole(opts.agentRole, {
    messageBus: opts.messageBus,
    completionHandler: opts.completionHandler,
    escalationHandler: opts.escalationHandler,
  });
  return selected.map((t) => wrapAsCopilotTool(t, context));
}

/**
 * Internal: list the loomflo tool names that would be exposed for a role.
 * Useful for tests + dashboards listing the agent's capabilities.
 */
export function listCopilotToolNamesForRole(
  role: AgentRole,
  deps: {
    messageBus: MessageBusLike;
    completionHandler: CompletionHandlerLike;
    escalationHandler: EscalationHandlerLike;
  },
): string[] {
  return selectToolsForRole(role, deps).map((t) => t.name);
}
