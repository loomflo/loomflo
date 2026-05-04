/**
 * Bridge between the daemon's NodeExecutor and the AgentRuntime layer.
 *
 * `runNodeWithRuntime(node, deps)` opens a session on the runtime selected by
 * `node.runtime`, streams events into the daemon's event log + cost tracker,
 * and resolves to a NodeExecutionResult once the session ends.
 *
 * Phase 1 scope:
 *  - One session = one node = role "loomi" (or whatever `agentRole` deps says).
 *  - File scope is broad (`["**\/*"]`) when not specified — Phase 2 wires
 *    granular file ownership through the SDK's canUseTool callback.
 *  - Subagents (Loomi spawning Looma via SDK Agent tool) are deferred to
 *    Phase 2: the Loomi AgentDefinition declares "Agent" in allowedTools so
 *    the SDK can dispatch to subagents we'll register later.
 *
 * @module runtimes/run-node
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Node } from "../types.js";
import type { CostTracker } from "../costs/tracker.js";
import type { SharedMemoryManager } from "../memory/shared-memory.js";
import type { MessageBus } from "../agents/message-bus.js";
import type { CompletionHandlerLike } from "../tools/report-complete.js";
import type { EscalationHandlerLike } from "../tools/escalate.js";
import type { NodeExecutionResult } from "../workflow/execution-engine.js";
import { getAgentRuntime, resolveNodeRuntime } from "./registry.js";
import type {
  AgentRole,
  ResolvedCredentials,
  SessionConfig,
  SessionEvent,
} from "./base.js";

// ============================================================================
// Credentials resolution
// ============================================================================

/**
 * Resolve credentials for the Claude Agent runtime.
 *
 * Order of precedence:
 *   1. `ANTHROPIC_API_KEY` env var (production / CI / SaaS path)
 *   2. `~/.claude/.credentials.json` exists (Claude Code OAuth path)
 *
 * For the mock runtime, credentials are unused but the type requires a value;
 * we return the OAuth marker as a no-op default.
 *
 * Exported for testability.
 */
export function resolveClaudeAgentCredentials(opts?: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): ResolvedCredentials {
  const env = opts?.env ?? process.env;
  const home = opts?.homeDir ?? homedir();

  const apiKey = env["ANTHROPIC_API_KEY"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return { kind: "api-key-anthropic", apiKey };
  }

  const credPath = join(home, ".claude", ".credentials.json");
  if (existsSync(credPath)) {
    return {
      kind: "oauth-claude-code",
      warning: "Using personal Claude.ai OAuth — local/individual use only",
    };
  }

  throw new Error(
    "ClaudeAgentRuntime requires either ANTHROPIC_API_KEY env var or " +
      "~/.claude/.credentials.json (Claude Code OAuth). Neither was found.",
  );
}

// ============================================================================
// Dependencies bundle
// ============================================================================

export interface RunNodeWithRuntimeDeps {
  workflowId: string;
  workspacePath: string;
  costTracker: CostTracker;
  sharedMemory: SharedMemoryManager;
  messageBus: MessageBus;
  completionHandler: CompletionHandlerLike;
  escalationHandler: EscalationHandlerLike;
  /** Role to play (default: "loomi"). */
  agentRole?: AgentRole;
  /** Model identifier (runtime-specific). Falls back to AgentDefinition default. */
  model?: string;
  /** Credentials override — useful for tests. */
  credentialsOverride?: ResolvedCredentials;
  /** Optional callback invoked for each session event (telemetry / dashboard). */
  onEvent?: (event: SessionEvent) => void;
}

// ============================================================================
// runNodeWithRuntime
// ============================================================================

/**
 * Execute a node via its declared `runtime` and resolve to a NodeExecutionResult.
 *
 * Returns null if `node.runtime === "loomi-native"` so the caller falls back
 * to the legacy runLoomi path.
 */
export async function runNodeWithRuntime(
  node: Pick<Node, "id" | "title" | "instructions" | "runtime" | "fileOwnership">,
  deps: RunNodeWithRuntimeDeps,
): Promise<NodeExecutionResult | null> {
  const runtimeName = resolveNodeRuntime(node);
  const runtime = getAgentRuntime(runtimeName);
  if (!runtime) {
    // loomi-native handled by caller
    return null;
  }

  const credentials =
    deps.credentialsOverride ??
    (runtimeName === "mock"
      ? ({ kind: "oauth-claude-code" } as ResolvedCredentials)
      : resolveClaudeAgentCredentials());

  const agentRole: AgentRole = deps.agentRole ?? "loomi";
  const agentId = `${agentRole}-${node.id}`;

  // Phase 1: broad scope. Phase 2 will derive per-agent scope from
  // node.fileOwnership and pass it to canUseTool.
  const fileScope = ["**/*"];

  const config: SessionConfig = {
    workspacePath: deps.workspacePath,
    agentRole,
    model: deps.model ?? "",
    mcpServers: [],
    fileScope,
    credentials,
    initialPrompt: node.instructions,
    context: {
      workflow: { id: deps.workflowId, projectPath: deps.workspacePath },
      nodeId: node.id,
      agentId,
      costTracker: deps.costTracker,
      sharedMemory: deps.sharedMemory,
      messageBus: deps.messageBus,
      completionHandler: deps.completionHandler,
      escalationHandler: deps.escalationHandler,
    },
  };

  const session = await runtime.startSession(config);

  return new Promise<NodeExecutionResult>((resolve) => {
    let totalCostUsd = 0;
    let lastErrorMessage: string | undefined;

    const unsubscribe = session.on((event) => {
      deps.onEvent?.(event);

      if (event.kind === "cost_update") {
        totalCostUsd += event.usd;
      } else if (event.kind === "error") {
        lastErrorMessage = event.message;
      } else if (event.kind === "session_ended") {
        unsubscribe();
        void session.dispose().then(() => {
          let status: NodeExecutionResult["status"];
          let error: string | undefined;
          switch (event.reason) {
            case "completed":
              status = "done";
              break;
            case "aborted":
              status = "blocked";
              error = "Session aborted before completion";
              break;
            case "budget_exceeded":
              status = "blocked";
              error = "Session budget exceeded";
              break;
            case "error":
              status = "failed";
              error = lastErrorMessage ?? "Unknown runtime error";
              break;
          }
          resolve({ status, cost: totalCostUsd, ...(error ? { error } : {}) });
        });
      }
    });
  });
}
