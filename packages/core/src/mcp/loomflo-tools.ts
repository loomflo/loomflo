/**
 * Loomflo MCP server factory — exposes loomflo's built-in tools as an
 * in-process MCP server consumable by `@anthropic-ai/claude-agent-sdk`
 * (or any other MCP client).
 *
 * Strategy: re-uses the EXISTING `Tool` implementations from `tools/*.ts`
 * (read_file, write_file, shell_exec, memory, send_message, etc.) by wrapping
 * each one with `tool()` from the SDK. We do NOT duplicate tool logic —
 * the same code path serves both the legacy `runLoomi` agent loop and the
 * new ClaudeAgentRuntime.
 *
 * Role-based selection: each agent role gets a curated subset of tools:
 * - loom    : read-only + memory + (graph mutations TODO)
 * - loomi   : read-only + memory write + send_message + escalate
 * - looma   : full read/write/shell + memory + send_message + report_complete
 * - loomex  : strict read-only (review-time, no side effects)
 *
 * File ownership / write scope is enforced inside `writeFileTool` /
 * `editFileTool` themselves (picomatch against `ToolContext.writeScope`),
 * so the MCP wrapper inherits enforcement for free.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md §L2
 *
 * @module mcp/loomflo-tools
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
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
import type { AgentRole, GlobPattern } from "../runtimes/base.js";
import { MCP_LOOMFLO_VERSION } from "./index.js";

// ============================================================================
// Options
// ============================================================================

/**
 * Configuration for `createLoomfloMcpServer`.
 *
 * The same MCP server is created per-session by ClaudeAgentRuntime, so
 * each session gets isolated context (workspace, agentId, scope, deps).
 */
export interface CreateLoomfloMcpServerOpts {
  /** Absolute workspace path. Tools resolve all paths against this root. */
  workspacePath: string;
  /** Role of the agent this MCP server serves. Selects the tool subset. */
  agentRole: AgentRole;
  /** Stable identifier for the agent (used for messageBus, audit). */
  agentId: string;
  /** Workflow node identifier (used for messageBus scoping). */
  nodeId: string;
  /** Glob patterns for write scope. Empty array = no writes allowed. */
  fileScope: GlobPattern[];
  /** Message bus for intra-node agent communication. */
  messageBus: MessageBusLike;
  /** Handler invoked when a Looma worker reports completion. */
  completionHandler: CompletionHandlerLike;
  /** Handler invoked when Loomi escalates to Loom. */
  escalationHandler: EscalationHandlerLike;
}

// ============================================================================
// Tool selection by role
// ============================================================================

/**
 * Build the loomflo Tool[] for a given role + dependencies.
 *
 * Returned tools are still the original `Tool` implementations — they will
 * be wrapped by `wrapAsMcpTool` for SDK consumption.
 */
function selectToolsForRole(
  role: AgentRole,
  deps: {
    messageBus: MessageBusLike;
    completionHandler: CompletionHandlerLike;
    escalationHandler: EscalationHandlerLike;
  },
): Tool[] {
  // Read-only base set: every role gets these.
  const tools: Tool[] = [readFileTool, listFilesTool, searchFilesTool, memoryReadTool];

  switch (role) {
    case "loom":
      // Loom only mutates memory and the graph (graph mutations TODO).
      tools.push(memoryWriteTool);
      // TODO: add_node, remove_node, update_node_instructions when implemented.
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
      // Strictly read-only — no memory writes, no shell, no file writes.
      return tools;
  }
}

// ============================================================================
// MCP wrapper
// ============================================================================

/**
 * Wrap a loomflo `Tool` as an SDK-MCP `tool()`.
 *
 * Extracts the Zod shape from the Tool's `inputSchema` (always a ZodObject
 * for loomflo tools) and bridges the `execute(input, context) -> string`
 * contract to the MCP `CallToolResult` format.
 *
 * Errors are propagated as text content (loomflo tools never throw — they
 * return descriptive error strings).
 */
function wrapAsMcpTool(loomfloTool: Tool, context: ToolContext): ReturnType<typeof tool> {
  // All loomflo tools use z.object(...) at the top level; extract its shape.
  const schema = loomfloTool.inputSchema;
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(
      `Loomflo tool "${loomfloTool.name}" must have a ZodObject input schema; got ${schema.constructor.name}`,
    );
  }
  const shape = schema.shape as z.ZodRawShape;

  return tool(
    loomfloTool.name,
    loomfloTool.description,
    shape,
    async (args: Record<string, unknown>) => {
      const result = await loomfloTool.execute(args, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    },
  );
}

// ============================================================================
// Public factory
// ============================================================================

/**
 * Create an in-process MCP server exposing loomflo's tools to an agent.
 *
 * The returned value is a `McpSdkServerConfigWithInstance` ready to pass
 * directly to the Claude Agent SDK's `mcpServers` Options field:
 *
 * ```ts
 * const server = createLoomfloMcpServer({ ... });
 * await query({
 *   prompt: "...",
 *   options: {
 *     mcpServers: { loomflo: server },
 *     allowedTools: ["mcp__loomflo__*"],
 *   },
 * });
 * ```
 *
 * Tools available to the agent are scoped to the requested `agentRole`:
 * - loom    : read-only + memory + (graph mutations TODO)
 * - loomi   : read-only + memory write + send_message + escalate
 * - looma   : full read/write/shell + memory + send_message + report_complete
 * - loomex  : strict read-only
 */
export function createLoomfloMcpServer(
  opts: CreateLoomfloMcpServerOpts,
): ReturnType<typeof createSdkMcpServer> {
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

  const mcpTools = selected.map((t) => wrapAsMcpTool(t, context));

  return createSdkMcpServer({
    name: "loomflo",
    version: MCP_LOOMFLO_VERSION,
    tools: mcpTools,
  });
}

/**
 * Internal helper for tests: list the tool names the factory would expose
 * for a given role. Doesn't construct an MCP server — useful for assertions.
 */
export function listToolNamesForRole(
  role: AgentRole,
  deps: {
    messageBus: MessageBusLike;
    completionHandler: CompletionHandlerLike;
    escalationHandler: EscalationHandlerLike;
  },
): string[] {
  return selectToolsForRole(role, deps).map((t) => t.name);
}
