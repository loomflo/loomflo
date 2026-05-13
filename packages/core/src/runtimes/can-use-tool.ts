/**
 * `canUseTool` callback factory for ClaudeAgentRuntime.
 *
 * The Claude Agent SDK invokes `canUseTool` before executing each tool call.
 * Returning `{behavior: "deny", message}` gives the model an actionable error
 * it can adapt to — much cleaner than a tool-side rejection string buried in
 * a tool_result.
 *
 * Loomflo uses this as a defense-in-depth layer for file-ownership scope:
 * the underlying `writeFileTool` already validates scope server-side, but
 * the `canUseTool` callback prevents the tool from being invoked in the first
 * place when the path is out of scope. That avoids consuming tokens on doomed
 * invocations and gives clearer feedback to the agent.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md décision 5
 *
 * @module runtimes/can-use-tool
 */

import picomatch from "picomatch";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { MCP_TOOL_PREFIX } from "../mcp/index.js";
import type { GlobPattern } from "./base.js";

/** MCP tools that mutate the filesystem and are subject to file scope. */
const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  `${MCP_TOOL_PREFIX}write_file`,
  `${MCP_TOOL_PREFIX}edit_file`,
]);

/**
 * Normalise a path coming from a tool input: trim leading "./", strip leading
 * "/", and collapse no-ops. We do NOT resolve against the workspace because
 * the underlying tool is responsible for that — picomatch operates on the
 * project-relative form the agent provided.
 */
function normalisePath(path: string): string {
  let p = path.trim();
  if (p.startsWith("./")) p = p.slice(2);
  while (p.startsWith("/")) p = p.slice(1);
  return p;
}

/**
 * Build a `canUseTool` callback that denies write tool invocations whose
 * `path` argument lies outside the supplied `fileScope` glob patterns.
 *
 * - Non-write tools are always allowed (they're either read-only or already
 *   constrained by the role's `allowedTools`).
 * - An empty `fileScope` denies all writes.
 * - A `["**\/*"]` scope is permissive (Phase 1 default).
 *
 * Exported for unit testing.
 */
export function buildCanUseTool(fileScope: GlobPattern[]): CanUseTool {
  const matcher =
    fileScope.length === 0 ? null : picomatch(fileScope);

  return async (toolName, input) => {
    if (!WRITE_TOOL_NAMES.has(toolName)) {
      return { behavior: "allow" } satisfies PermissionResult;
    }

    const rawPath = input["path"];
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      return {
        behavior: "deny",
        message: `${toolName}: missing or invalid 'path' argument`,
      } satisfies PermissionResult;
    }

    if (!matcher) {
      return {
        behavior: "deny",
        message:
          "Write denied — this agent has no file scope assigned. " +
          "Files cannot be created or modified.",
      } satisfies PermissionResult;
    }

    const relPath = normalisePath(rawPath);
    if (matcher(relPath)) {
      return { behavior: "allow" } satisfies PermissionResult;
    }
    return {
      behavior: "deny",
      message:
        `Write denied — path "${rawPath}" is outside this agent's allowed file scope. ` +
        `Allowed patterns: ${fileScope.join(", ")}.`,
    } satisfies PermissionResult;
  };
}
