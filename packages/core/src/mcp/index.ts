/**
 * MCP servers exposed by loomflo to agent runtimes.
 *
 * The primary export is `createLoomfloMcpServer()` — an in-process MCP server
 * that wraps the loomflo built-in tools (read_file, write_file, shell_exec,
 * memory, message bus, etc.) with role-based scoping and file ownership
 * enforcement.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md §L2
 *
 * @module mcp
 */

export const MCP_LOOMFLO_VERSION = "0.1.0";
export const MCP_TOOL_PREFIX = "mcp__loomflo__";

export {
  createLoomfloMcpServer,
  listToolNamesForRole,
  type CreateLoomfloMcpServerOpts,
} from "./loomflo-tools.js";
