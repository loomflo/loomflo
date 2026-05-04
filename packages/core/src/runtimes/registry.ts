/**
 * Runtime registry — picks an `AgentRuntime` instance from a node's `runtime`
 * field.
 *
 * Loomflo creates runtime instances lazily and caches them per process. Each
 * runtime is stateless across sessions, so a single shared instance is safe.
 *
 * `loomi-native` is NOT a real AgentRuntime — it's the historical runLoomi
 * code path. The daemon's NodeExecutor handles it directly (no AgentRuntime
 * indirection). This registry only knows about runtimes that implement the
 * AgentRuntime interface.
 *
 * @module runtimes/registry
 */

import type { Node } from "../types.js";
import type { AgentRuntime, RuntimeName } from "./base.js";
import { ClaudeAgentRuntime } from "./claude-agent.js";
import { MockAgentRuntime } from "./mock.js";

/** Discriminator value used by Node.runtime — wider than RuntimeName because it includes "loomi-native". */
export type NodeRuntimeName = "loomi-native" | "claude-agent" | "mock";

let claudeAgentInstance: ClaudeAgentRuntime | undefined;
let mockInstance: MockAgentRuntime | undefined;

/**
 * Get the shared `AgentRuntime` instance for a given runtime name.
 *
 * Returns `null` for `"loomi-native"` — the daemon must handle that case
 * separately (legacy runLoomi path).
 *
 * @param name - The runtime identifier from `Node.runtime`.
 * @returns The cached runtime instance, or null for the legacy native path.
 */
export function getAgentRuntime(name: NodeRuntimeName): AgentRuntime | null {
  switch (name) {
    case "loomi-native":
      return null;
    case "claude-agent":
      claudeAgentInstance ??= new ClaudeAgentRuntime();
      return claudeAgentInstance;
    case "mock":
      mockInstance ??= new MockAgentRuntime();
      return mockInstance;
  }
}

/**
 * Resolve the runtime name for a node, falling back to "loomi-native" if
 * unset. Useful when reading older persisted workflows that predate the field.
 */
export function resolveNodeRuntime(node: Pick<Node, "runtime">): NodeRuntimeName {
  return (node.runtime as NodeRuntimeName | undefined) ?? "loomi-native";
}

/**
 * For tests: replace the cached instance for a runtime name. Pass `null` to
 * clear (forces re-creation on next get).
 */
export function __setRuntimeInstanceForTest(
  name: Exclude<NodeRuntimeName, "loomi-native">,
  instance: AgentRuntime | null,
): void {
  if (name === "claude-agent") {
    claudeAgentInstance = (instance as ClaudeAgentRuntime | null) ?? undefined;
  } else if (name === "mock") {
    mockInstance = (instance as MockAgentRuntime | null) ?? undefined;
  }
}

/** All non-native runtime names available in the registry. */
export const REGISTRY_RUNTIME_NAMES: ReadonlyArray<RuntimeName> = ["claude-agent", "mock" as RuntimeName];
