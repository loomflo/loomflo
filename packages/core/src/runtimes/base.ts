/**
 * Multi-runtime orchestration — base interface.
 *
 * LoomFlo orchestrates agentic CLI runtimes (Claude Agent SDK, Copilot SDK, Codex...)
 * behind a single uniform interface. Each runtime adapter wraps an external SDK and
 * translates its lifecycle / events into the loomflo abstraction.
 *
 * See specs/003-multi-runtime-orchestration/spec-v2.md for the full design.
 *
 * @module runtimes/base
 */

import type { CostTracker } from "../costs/index.js";
import type { SharedMemory } from "../memory/index.js";
import type { MessageBus } from "../agents/message-bus.js";
import type { Workflow } from "../workflow/types.js";

// ============================================================================
// Capabilities & identity
// ============================================================================

/** Identifier of the runtime family. */
export type RuntimeName = "claude-agent" | "copilot";

/** Static capabilities advertised by a runtime. */
export interface RuntimeCapabilities {
  /** Supports custom MCP server injection (in-process or external). */
  supportsMcp: boolean;
  /** Supports per-call tool authorization callback. */
  supportsCanUseTool: boolean;
  /** Supports session persistence (resume / fork / list). */
  supportsSessionPersistence: boolean;
  /** Supports streaming events (assistant deltas, tool calls). */
  supportsStreaming: boolean;
  /** Supports built-in subagents (Agent tool / nested agents). */
  supportsSubagents: boolean;
  /** Supports BYOK provider override (e.g., Anthropic via Copilot). */
  supportsByokProvider: boolean;
}

// ============================================================================
// Auth modes
// ============================================================================

/**
 * Resolved credentials for a runtime session.
 *
 * Two paths supported (see spec-v2 §8 décisions 8 & 12):
 * - "oauth-claude-code" : usage perso, lit ~/.claude/.credentials.json
 * - "api-key-anthropic" : usage équipe/SaaS, ANTHROPIC_API_KEY env ou config
 * - "api-key-openai" / "api-key-copilot-byok" / "oauth-copilot" pour Copilot
 */
export type ResolvedCredentials =
  | { kind: "oauth-claude-code"; warning?: string }
  | { kind: "api-key-anthropic"; apiKey: string }
  | { kind: "api-key-openai"; apiKey: string }
  | { kind: "oauth-copilot"; warning?: string }
  | { kind: "api-key-copilot-byok"; provider: "anthropic" | "openai"; apiKey: string };

// ============================================================================
// Session config
// ============================================================================

/** Per-agent role identifier (maps to AgentDefinitions in agents-config/). */
export type AgentRole = "loom" | "loomi" | "looma" | "loomex";

/** Glob patterns for write-scope enforcement (file ownership). */
export type GlobPattern = string;

/**
 * Reference to an MCP server to inject into a session.
 *
 * - `inMemory` : `createSdkMcpServer` instance (recommended for loomflo-tools)
 * - `stdio` / `sse` / `http` : external server, spawned/connected by the runtime
 */
export type McpServerRef =
  | { kind: "inMemory"; name: string; instance: unknown }
  | { kind: "stdio"; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { kind: "sse"; name: string; url: string }
  | { kind: "http"; name: string; url: string; headers?: Record<string, string> };

/** Optional budget caps for a single session. */
export interface SessionBudget {
  maxTokens?: number;
  maxCostUsd?: number;
}

/** Configuration for opening a runtime session. */
export interface SessionConfig {
  /** Working directory for the agent (workspace root). */
  workspacePath: string;
  /** Role to play (selects AgentDefinition + tool set). */
  agentRole: AgentRole;
  /** Model identifier (runtime-specific format). */
  model: string;
  /** MCP servers to expose (loomflo-tools is added by the runtime). */
  mcpServers: McpServerRef[];
  /** Optional system prompt override (otherwise inherited from AgentDefinition). */
  systemPromptOverride?: string;
  /** Write-scope (globs). When set, write tools enforce this scope. */
  fileScope?: GlobPattern[];
  /** Budget caps. */
  budget?: SessionBudget;
  /** Resolved credentials. */
  credentials: ResolvedCredentials;
  /** Optional initial prompt to send on session start. */
  initialPrompt?: string;
  /** Resume an existing session (runtime-specific id). */
  resumeSessionId?: string;
  /** Cross-cutting infrastructure used by tools (file ownership, message bus, memory). */
  context: SessionContext;
}

/** Infrastructure passed to MCP tools for cross-cutting concerns. */
export interface SessionContext {
  workflow: Pick<Workflow, "id" | "projectPath">;
  nodeId: string;
  agentId: string;
  costTracker: CostTracker;
  sharedMemory: SharedMemory;
  messageBus: MessageBus;
}

// ============================================================================
// Session events
// ============================================================================

/** Event emitted by a runtime session during execution. */
export type SessionEvent =
  | { kind: "session_started"; sessionId: string }
  | { kind: "assistant_text"; text: string; isDelta: boolean }
  | { kind: "tool_call"; toolName: string; input: Record<string, unknown>; toolUseId: string }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; output: unknown }
  | { kind: "cost_update"; inputTokens: number; outputTokens: number; usd: number }
  | { kind: "rate_limited"; retryAfterMs?: number }
  | { kind: "session_idle" }
  | { kind: "session_ended"; reason: "completed" | "aborted" | "error" | "budget_exceeded"; finalText?: string }
  | { kind: "error"; message: string; cause?: unknown };

export type SessionEventHandler = (event: SessionEvent) => void;

// ============================================================================
// RuntimeSession
// ============================================================================

/**
 * Live session opened by an AgentRuntime.
 *
 * Subscribe to events with `on()`, send messages with `send()`,
 * and clean up with `dispose()` to release resources.
 */
export interface RuntimeSession {
  readonly id: string;
  readonly runtimeName: RuntimeName;

  /** Send a follow-up prompt to the agent. */
  send(prompt: string): Promise<void>;

  /** Subscribe to session events. Returns an unsubscribe function. */
  on(handler: SessionEventHandler): () => void;

  /** Abort any in-flight work. */
  abort(): Promise<void>;

  /** Release all resources (must always be called). */
  dispose(): Promise<void>;

  /** Cumulative cost for this session so far. */
  getCostSoFar(): { inputTokens: number; outputTokens: number; usd: number };
}

// ============================================================================
// Model info (returned by listAvailableModels)
// ============================================================================

/** Information about a model available through this runtime. */
export interface ModelInfo {
  /** Identifier as expected by the runtime (e.g. "claude-sonnet-4-6", "gpt-5"). */
  id: string;
  /** Human-readable name. */
  displayName: string;
  /** Provider family (anthropic, openai, google, etc.). */
  provider: string;
  /** Whether this model is available with the resolved credentials. */
  available: boolean;
  /** Optional context window size in tokens. */
  contextTokens?: number;
}

// ============================================================================
// AgentRuntime — main interface
// ============================================================================

/**
 * Abstract interface for an agent runtime.
 *
 * Implementations wrap an external SDK (Claude Agent SDK, Copilot SDK, etc.)
 * and expose a uniform lifecycle. The orchestrator (NodeExecutor in daemon.ts)
 * picks a runtime based on the node's `runtime` config field.
 */
export interface AgentRuntime {
  readonly name: RuntimeName;
  readonly capabilities: RuntimeCapabilities;

  /** Open a new session. The session is live until `dispose()` is called. */
  startSession(config: SessionConfig): Promise<RuntimeSession>;

  /** Enumerate models available to the resolved credentials. */
  listAvailableModels(credentials: ResolvedCredentials): Promise<ModelInfo[]>;
}
