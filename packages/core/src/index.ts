/**
 * @loomflo/core — AI Agent Orchestration Framework.
 *
 * Public API surface for the Loomflo core engine. Re-exports all types,
 * schemas, providers, agents, tools, persistence, configuration, workflow
 * engine, and API server components.
 *
 * @packageDocumentation
 */

// ============================================================================
// Types & Schemas
// ============================================================================

export * from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

export * from "./config.js";

// ============================================================================
// Daemon
// ============================================================================

export * from "./daemon.js";
export type { ProjectRuntime, ProjectSummary } from "./daemon-types.js";
export { toProjectSummary } from "./daemon-types.js";

// ============================================================================
// Persistence
// ============================================================================

export * from "./persistence/state.js";
export * from "./persistence/events.js";

// ============================================================================
// LLM Providers
// ============================================================================

export * from "./providers/base.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export { OpenAIProvider } from "./providers/openai.js";
export { OllamaProvider } from "./providers/ollama.js";
export * from "./providers/credentials.js";

// ============================================================================
// Agents
// ============================================================================

export * from "./agents/base-agent.js";
export * from "./agents/escalation.js";
export * from "./agents/loom.js";
export * from "./agents/looma.js";
export * from "./agents/loomex.js";
export * from "./agents/loomi.js";
export { MessageBus } from "./agents/message-bus.js";
export * from "./agents/prompts.js";

// ============================================================================
// Tools
// ============================================================================

export * from "./tools/base.js";
export { readFileTool } from "./tools/file-read.js";
export { writeFileTool } from "./tools/file-write.js";
export { editFileTool } from "./tools/file-edit.js";
export { searchFilesTool } from "./tools/file-search.js";
export { listFilesTool } from "./tools/file-list.js";
export { shellExecTool } from "./tools/shell-exec.js";
export { memoryReadTool } from "./tools/memory-read.js";
export { memoryWriteTool } from "./tools/memory-write.js";
export { createSendMessageTool } from "./tools/send-message.js";
export { createReportCompleteTool } from "./tools/report-complete.js";
export { createEscalateTool } from "./tools/escalate.js";

// ============================================================================
// Costs
// ============================================================================

export * from "./costs/tracker.js";
export * from "./costs/rate-limiter.js";
export { BudgetExceededError } from "./costs/budget-error.js";

// ============================================================================
// Memory
// ============================================================================

export * from "./memory/shared-memory.js";

// ============================================================================
// Spec Engine
// ============================================================================

export * from "./spec/spec-engine.js";
export * from "./spec/prompts.js";

// ============================================================================
// Workflow Engine
// ============================================================================

export * from "./workflow/file-ownership.js";
export * from "./workflow/graph.js";
export * from "./workflow/node.js";
export * from "./workflow/scheduler.js";
export * from "./workflow/workflow.js";
export * from "./workflow/execution-engine.js";

// ============================================================================
// API Server
// ============================================================================

export * from "./api/server.js";
export * from "./api/auth.js";
export * from "./api/websocket.js";
