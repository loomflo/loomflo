import type { CostTracker } from "./costs/tracker.js";
import type { MessageBus } from "./agents/message-bus.js";
import type { SharedMemoryManager } from "./memory/shared-memory.js";
import type { LLMProvider } from "./providers/base.js";
import type { Workflow } from "./types.js";
import type { Config } from "./config.js";

/** Per-project runtime state held in the daemon registry. */
export interface ProjectRuntime {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
  workflow: Workflow | null;
  provider: LLMProvider;
  config: Config;
  costTracker: CostTracker;
  messageBus: MessageBus;
  sharedMemory: SharedMemoryManager;
  startedAt: string;
  status: "idle" | "running" | "blocked" | "failed" | "completed";
}

/** Lightweight summary for `/projects` list responses. */
export interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
  status: ProjectRuntime["status"];
  startedAt: string;
  /** Total accumulated cost in USD across this project's workflow. */
  cost: number;
  /** ID of the currently running node, or null when no workflow/node is active. */
  currentNodeId: string | null;
}

/** Convert a ProjectRuntime into the public summary shape. */
export function toProjectSummary(rt: ProjectRuntime): ProjectSummary {
  return {
    id: rt.id,
    name: rt.name,
    projectPath: rt.projectPath,
    providerProfileId: rt.providerProfileId,
    status: rt.status,
    startedAt: rt.startedAt,
    cost: rt.costTracker.getTotalCost(),
    currentNodeId: resolveCurrentNodeId(rt.workflow),
  };
}

function resolveCurrentNodeId(workflow: ProjectRuntime["workflow"]): string | null {
  if (!workflow) return null;
  for (const node of Object.values(workflow.graph.nodes)) {
    if (node.status === "running") return node.id;
  }
  return null;
}
