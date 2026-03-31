import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Config, Graph, Node, Workflow } from "../../src/types.js";
import { WorkflowManager } from "../../src/workflow/workflow.js";
import { CostTracker } from "../../src/costs/tracker.js";
import {
  WorkflowExecutionEngine,
  type NodeExecutor,
  type NodeExecutionResult,
} from "../../src/workflow/execution-engine.js";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../src/persistence/state.js", () => ({
  saveWorkflowState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/persistence/events.js", () => ({
  createEvent: vi.fn().mockImplementation((params: Record<string, unknown>) => ({
    ts: new Date().toISOString(),
    ...params,
    nodeId: (params as { nodeId?: string | null }).nodeId ?? null,
    agentId: (params as { agentId?: string | null }).agentId ?? null,
    details: (params as { details?: Record<string, unknown> }).details ?? {},
  })),
  appendEvent: vi.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeConfig(): Config {
  return {
    level: 3,
    defaultDelay: "0",
    reviewerEnabled: true,
    maxRetriesPerNode: 3,
    maxRetriesPerTask: 2,
    maxLoomasPerLoomi: null,
    retryStrategy: "adaptive",
    models: {
      loom: "claude-opus-4-6",
      loomi: "claude-sonnet-4-6",
      looma: "claude-sonnet-4-6",
      loomex: "claude-sonnet-4-6",
    },
    provider: "anthropic",
    budgetLimit: null,
    pauseOnBudgetReached: true,
    sandboxCommands: true,
    allowNetwork: false,
    dashboardPort: 3000,
    dashboardAutoOpen: true,
    agentTimeout: 600_000,
    agentTokenLimit: 100_000,
    apiRateLimit: 60,
  };
}

function makeNode(id: string, title: string, overrides?: Partial<Node>): Node {
  return {
    id,
    title,
    status: "pending",
    instructions: `Instructions for ${title}`,
    delay: "0",
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 3,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeWorkflow(graph: Graph): Workflow {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: "running",
    description: "Test workflow",
    projectPath: "/tmp/test-project",
    graph,
    config: makeConfig(),
    createdAt: now,
    updatedAt: now,
    totalCost: 0,
  };
}

function successExecutor(): NodeExecutor {
  return vi.fn().mockResolvedValue({
    status: "done",
    cost: 0.5,
  } satisfies NodeExecutionResult);
}

function failExecutor(): NodeExecutor {
  return vi.fn().mockResolvedValue({
    status: "failed",
    cost: 0.1,
    error: "Execution failed",
  } satisfies NodeExecutionResult);
}

function delayedExecutor(ms: number): NodeExecutor {
  return vi.fn().mockImplementation(
    () =>
      new Promise<NodeExecutionResult>((resolve) => {
        setTimeout(() => resolve({ status: "done", cost: 0.25 }), ms);
      }),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("WorkflowExecutionEngine", () => {
  let costTracker: CostTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    costTracker = new CostTracker();
  });

  // --------------------------------------------------------------------------
  // Linear topology: A → B → C
  // --------------------------------------------------------------------------

  describe("linear topology (A → B → C)", () => {
    function makeLinearGraph(): Graph {
      return {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
          "node-c": makeNode("node-c", "Node C"),
        },
        edges: [
          { from: "node-a", to: "node-b" },
          { from: "node-b", to: "node-c" },
        ],
        topology: "linear",
      };
    }

    it("executes all nodes sequentially and completes", async () => {
      const executor = successExecutor();
      const manager = new WorkflowManager(makeWorkflow(makeLinearGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toEqual(["node-a", "node-b", "node-c"]);
      expect(result.failedNodes).toEqual([]);
      expect(executor).toHaveBeenCalledTimes(3);

      // Verify execution order: A called before B, B before C
      const calls = (executor as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]![0].id).toBe("node-a");
      expect(calls[1]![0].id).toBe("node-b");
      expect(calls[2]![0].id).toBe("node-c");
    });

    it("stops at first failure and marks downstream as blocked", async () => {
      const callCount = { n: 0 };
      const executor: NodeExecutor = vi.fn().mockImplementation(() => {
        callCount.n++;
        if (callCount.n === 2) {
          return Promise.resolve({
            status: "failed",
            cost: 0.1,
            error: "Node B failed",
          } satisfies NodeExecutionResult);
        }
        return Promise.resolve({
          status: "done",
          cost: 0.5,
        } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(makeLinearGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      expect(result.completedNodes).toEqual(["node-a"]);
      // node-b failed, node-c blocked
      expect(result.failedNodes).toContain("node-b");
      expect(result.failedNodes).toContain("node-c");
      // node-c never executed
      expect(executor).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Divergent topology: A → [B, C]
  // --------------------------------------------------------------------------

  describe("divergent topology (A → [B, C])", () => {
    function makeDivergentGraph(): Graph {
      return {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
          "node-c": makeNode("node-c", "Node C"),
        },
        edges: [
          { from: "node-a", to: "node-b" },
          { from: "node-a", to: "node-c" },
        ],
        topology: "tree",
      };
    }

    it("activates B and C in parallel after A completes", async () => {
      const executionOrder: string[] = [];
      const executor: NodeExecutor = vi.fn().mockImplementation((node: { id: string }) => {
        executionOrder.push(node.id);
        return Promise.resolve({ status: "done", cost: 0.25 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(makeDivergentGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toHaveLength(3);
      expect(executionOrder[0]).toBe("node-a");
      // B and C come after A, order between them may vary
      expect(executionOrder).toContain("node-b");
      expect(executionOrder).toContain("node-c");
    });
  });

  // --------------------------------------------------------------------------
  // Convergent topology: [A, B] → C (A is source for both)
  // Actually: Root → [A, B] → C
  // --------------------------------------------------------------------------

  describe("convergent topology (Root → [A, B] → C)", () => {
    function makeConvergentGraph(): Graph {
      return {
        nodes: {
          root: makeNode("root", "Root"),
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
          "node-c": makeNode("node-c", "Node C"),
        },
        edges: [
          { from: "root", to: "node-a" },
          { from: "root", to: "node-b" },
          { from: "node-a", to: "node-c" },
          { from: "node-b", to: "node-c" },
        ],
        topology: "mixed",
      };
    }

    it("activates C only after both A and B complete", async () => {
      const executionOrder: string[] = [];
      const executor: NodeExecutor = vi.fn().mockImplementation((node: { id: string }) => {
        executionOrder.push(node.id);
        return Promise.resolve({ status: "done", cost: 0.1 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(makeConvergentGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toHaveLength(4);

      const cIndex = executionOrder.indexOf("node-c");
      const aIndex = executionOrder.indexOf("node-a");
      const bIndex = executionOrder.indexOf("node-b");
      expect(cIndex).toBeGreaterThan(aIndex);
      expect(cIndex).toBeGreaterThan(bIndex);
    });

    it("blocks C when A fails even if B succeeds", async () => {
      const executor: NodeExecutor = vi.fn().mockImplementation((node: { id: string }) => {
        if (node.id === "node-a") {
          return Promise.resolve({
            status: "failed",
            cost: 0,
            error: "A failed",
          } satisfies NodeExecutionResult);
        }
        return Promise.resolve({ status: "done", cost: 0 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(makeConvergentGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      expect(result.completedNodes).toContain("root");
      expect(result.completedNodes).toContain("node-b");
      expect(result.failedNodes).toContain("node-a");
      expect(result.failedNodes).toContain("node-c");
    });
  });

  // --------------------------------------------------------------------------
  // Mixed topology: A → [B, C] → D
  // --------------------------------------------------------------------------

  describe("mixed topology (A → [B, C] → D)", () => {
    function makeMixedGraph(): Graph {
      return {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
          "node-c": makeNode("node-c", "Node C"),
          "node-d": makeNode("node-d", "Node D"),
        },
        edges: [
          { from: "node-a", to: "node-b" },
          { from: "node-a", to: "node-c" },
          { from: "node-b", to: "node-d" },
          { from: "node-c", to: "node-d" },
        ],
        topology: "mixed",
      };
    }

    it("executes full diamond: A → [B, C] → D", async () => {
      const executionOrder: string[] = [];
      const executor: NodeExecutor = vi.fn().mockImplementation((node: { id: string }) => {
        executionOrder.push(node.id);
        return Promise.resolve({ status: "done", cost: 0 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(makeMixedGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toHaveLength(4);

      // A must be first, D must be last
      expect(executionOrder[0]).toBe("node-a");
      expect(executionOrder[3]).toBe("node-d");
    });
  });

  // --------------------------------------------------------------------------
  // Single node
  // --------------------------------------------------------------------------

  describe("single node", () => {
    function makeSingleGraph(): Graph {
      return {
        nodes: {
          "node-a": makeNode("node-a", "Only Node"),
        },
        edges: [],
        topology: "linear",
      };
    }

    it("executes and completes a single-node graph", async () => {
      const executor = successExecutor();
      const manager = new WorkflowManager(makeWorkflow(makeSingleGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toEqual(["node-a"]);
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it("reports failure when the single node fails", async () => {
      const executor = failExecutor();
      const manager = new WorkflowManager(makeWorkflow(makeSingleGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      expect(result.failedNodes).toEqual(["node-a"]);
    });
  });

  // --------------------------------------------------------------------------
  // Budget enforcement
  // --------------------------------------------------------------------------

  describe("budget enforcement", () => {
    function makeLinearGraph(): Graph {
      return {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
        },
        edges: [{ from: "node-a", to: "node-b" }],
        topology: "linear",
      };
    }

    it("pauses workflow when budget is exceeded", async () => {
      const tracker = new CostTracker(0.4);
      const executor: NodeExecutor = vi.fn().mockImplementation(() => {
        // Simulate cost exceeding budget
        tracker.recordCall("claude-sonnet-4-6", 50_000, 10_000, "agent-1", "node-a");
        return Promise.resolve({ status: "done", cost: 0.3 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(makeLinearGraph()));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker: tracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("paused");
      expect(result.haltReason).toBe("Budget limit reached");
      expect(result.completedNodes).toContain("node-a");
    });
  });

  // --------------------------------------------------------------------------
  // Stop signal
  // --------------------------------------------------------------------------

  describe("stop signal", () => {
    it("stops the engine and returns paused result", async () => {
      const graph: Graph = {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
        },
        edges: [{ from: "node-a", to: "node-b" }],
        topology: "linear",
      };

      let engine: WorkflowExecutionEngine;
      const executor: NodeExecutor = vi.fn().mockImplementation((node: { id: string }) => {
        if (node.id === "node-a") {
          // Stop after first node starts executing
          engine.stop();
        }
        return Promise.resolve({ status: "done", cost: 0 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(graph));
      engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("paused");
      expect(result.haltReason).toBe("Engine stopped by external signal");
    });
  });

  // --------------------------------------------------------------------------
  // Executor throws
  // --------------------------------------------------------------------------

  describe("executor error handling", () => {
    it("treats thrown errors as node failures", async () => {
      const executor: NodeExecutor = vi.fn().mockRejectedValue(new Error("Unexpected crash"));

      const graph: Graph = {
        nodes: { "node-a": makeNode("node-a", "Node A") },
        edges: [],
        topology: "linear",
      };

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      expect(result.failedNodes).toContain("node-a");
    });
  });

  // --------------------------------------------------------------------------
  // Wrong workflow status
  // --------------------------------------------------------------------------

  describe("precondition checks", () => {
    it("throws when workflow is not in running state", async () => {
      const workflow = makeWorkflow({
        nodes: { "node-a": makeNode("node-a", "A") },
        edges: [],
        topology: "linear",
      });
      workflow.status = "init";

      const manager = new WorkflowManager(workflow);
      const engine = new WorkflowExecutionEngine({
        manager,
        executor: successExecutor(),
        costTracker,
      });

      await expect(engine.run()).rejects.toThrow("Cannot start execution");
    });
  });

  // --------------------------------------------------------------------------
  // Cost accumulation
  // --------------------------------------------------------------------------

  describe("cost tracking", () => {
    it("accumulates costs from node executions", async () => {
      const graph: Graph = {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
        },
        edges: [{ from: "node-a", to: "node-b" }],
        topology: "linear",
      };

      let callNum = 0;
      const executor: NodeExecutor = vi.fn().mockImplementation(() => {
        callNum++;
        costTracker.recordCall(
          "claude-sonnet-4-6",
          1000,
          500,
          `agent-${String(callNum)}`,
          `node-${callNum === 1 ? "a" : "b"}`,
        );
        return Promise.resolve({ status: "done", cost: 0.01 } satisfies NodeExecutionResult);
      });

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Parallel execution timing
  // --------------------------------------------------------------------------

  describe("parallel execution", () => {
    it("executes parallel branches concurrently, not sequentially", async () => {
      const graph: Graph = {
        nodes: {
          root: makeNode("root", "Root"),
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
          "node-c": makeNode("node-c", "Node C"),
        },
        edges: [
          { from: "root", to: "node-a" },
          { from: "root", to: "node-b" },
          { from: "root", to: "node-c" },
        ],
        topology: "tree",
      };

      const concurrentNodeIds: string[] = [];
      let activeCount = 0;
      let maxConcurrent = 0;

      const executor: NodeExecutor = vi.fn().mockImplementation(
        (node: { id: string }) =>
          new Promise<NodeExecutionResult>((resolve) => {
            activeCount++;
            if (activeCount > maxConcurrent) {
              maxConcurrent = activeCount;
            }
            if (node.id !== "root") {
              concurrentNodeIds.push(node.id);
            }
            // Simulate async work
            setTimeout(() => {
              activeCount--;
              resolve({ status: "done", cost: 0 });
            }, 10);
          }),
      );

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toHaveLength(4);
      // After root completes, A, B, C should all be active concurrently
      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // Blocked node propagation
  // --------------------------------------------------------------------------

  describe("blocked node propagation", () => {
    it("propagates blocked status through chain: A fails → B blocked → C blocked", async () => {
      const graph: Graph = {
        nodes: {
          "node-a": makeNode("node-a", "Node A"),
          "node-b": makeNode("node-b", "Node B"),
          "node-c": makeNode("node-c", "Node C"),
        },
        edges: [
          { from: "node-a", to: "node-b" },
          { from: "node-b", to: "node-c" },
        ],
        topology: "linear",
      };

      const executor: NodeExecutor = vi.fn().mockResolvedValue({
        status: "blocked",
        cost: 0,
        error: "Blocked by dependency",
      } satisfies NodeExecutionResult);

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
      });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      // Only node-a was executed; node-b and node-c are blocked downstream
      expect(executor).toHaveBeenCalledTimes(1);
      expect(result.failedNodes).toContain("node-a");
      expect(result.failedNodes).toContain("node-b");
      expect(result.failedNodes).toContain("node-c");
    });
  });

  // --------------------------------------------------------------------------
  // getActiveNodeCount / getCompletedNodes / getFailedNodes accessors
  // --------------------------------------------------------------------------

  describe("accessor methods", () => {
    it("returns empty arrays before execution", () => {
      const graph: Graph = {
        nodes: { "node-a": makeNode("node-a", "A") },
        edges: [],
        topology: "linear",
      };

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor: successExecutor(),
        costTracker,
      });

      expect(engine.getActiveNodeCount()).toBe(0);
      expect(engine.getCompletedNodes()).toEqual([]);
      expect(engine.getFailedNodes()).toEqual([]);
    });
  });
});
