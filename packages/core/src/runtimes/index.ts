/**
 * Runtimes registry — re-exports for the multi-runtime orchestration layer.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md
 *
 * @module runtimes
 */

export type {
  AgentRuntime,
  AgentRole,
  GlobPattern,
  McpServerRef,
  ModelInfo,
  ResolvedCredentials,
  RuntimeCapabilities,
  RuntimeName,
  RuntimeSession,
  SessionBudget,
  SessionConfig,
  SessionContext,
  SessionEvent,
  SessionEventHandler,
} from "./base.js";
