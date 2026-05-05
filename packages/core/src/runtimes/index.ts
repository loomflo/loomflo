/**
 * Runtimes registry — re-exports for the multi-runtime orchestration layer.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md
 *
 * @module runtimes
 */

export {
  ClaudeAgentRuntime,
  buildSdkOptions,
  buildSdkAuthEnv,
  buildAgentDefinitionForRole,
} from "./claude-agent.js";

export {
  MockAgentRuntime,
  DEFAULT_MOCK_SCENARIOS,
  type MockAgentRuntimeOptions,
  type MockScenario,
  type MockScenarioStep,
} from "./mock.js";

export { CopilotRuntime, buildCopilotProvider } from "./copilot.js";
export {
  buildCopilotTools,
  listCopilotToolNamesForRole,
  type BuildCopilotToolsOpts,
} from "./copilot-tools.js";

export {
  getAgentRuntime,
  resolveNodeRuntime,
  __setRuntimeInstanceForTest,
  REGISTRY_RUNTIME_NAMES,
  type NodeRuntimeName,
} from "./registry.js";

export {
  runNodeWithRuntime,
  resolveClaudeAgentCredentials,
  type RunNodeWithRuntimeDeps,
} from "./run-node.js";

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
