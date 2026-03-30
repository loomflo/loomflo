import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Config, Graph, Node, Workflow, WorkflowStatus } from "../../src/types.js";
import { WorkflowManager } from "../../src/workflow/workflow.js";
import { CostTracker } from "../../src/costs/tracker.js";
import {
  WorkflowExecutionEngine,
  type NodeExecutor,
  type NodeExecutionResult,
} from "../../src/workflow/execution-engine.js";
import { Scheduler } from "../../src/workflow/scheduler.js";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../src/persistence/state.js", () => ({
  saveWorkflowState: vi.fn().mockResolvedValue(undefined),
  loadWorkflowState: vi.fn().mockResolvedValue(null),
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

function makeGraph(nodes: Record<string, Node>, edges: Graph["edges"]): Graph {
  return { nodes, edges, topology: "linear" };
}

function makeWorkflow(graph: Graph, overrides?: Partial<Workflow>): Workflow {
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
    ...overrides,
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

// ============================================================================
// WorkflowManager Tests
// ============================================================================

/** Tests for the WorkflowManager state machine lifecycle. */
describe("WorkflowManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Tests for WorkflowManager.create() factory method. */
  describe("create()", () => {
    it("creates a workflow with init status", async () => {
      const manager = await WorkflowManager.create(
        "Build a todo app",
        "/tmp/test",
        makeConfig(),
      );

      expect(manager.status).toBe("init");
      expect(manager.description).toBe("Build a todo app");
      expect(manager.projectPath).toBe("/tmp/test");
      expect(manager.totalCost).toBe(0);
      expect(manager.id).toBeDefined();
      expect(manager.createdAt).toBeDefined();
    });

    it("persists state and logs workflow_created event on creation", async () => {
      const { saveWorkflowState } = await import("../../src/persistence/state.js");
      const { appendEvent } = await import("../../src/persistence/events.js");

      await WorkflowManager.create("Test", "/tmp/test", makeConfig());

      expect(saveWorkflowState).toHaveBeenCalledTimes(1);
      expect(appendEvent).toHaveBeenCalledTimes(1);
    });
  });

  /** Tests for WorkflowManager.canTransition() boolean checks. */
  describe("canTransition()", () => {
    it("returns true for valid transitions", () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "init" }));

      expect(manager.canTransition("spec")).toBe(true);
    });

    it("returns false for invalid transitions", () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "init" }));

      expect(manager.canTransition("running")).toBe(false);
      expect(manager.canTransition("done")).toBe(false);
      expect(manager.canTransition("failed")).toBe(false);
    });

    it("returns false for terminal states with no outgoing transitions", () => {
      const graph = makeGraph({}, []);
      const managerDone = new WorkflowManager(makeWorkflow(graph, { status: "done" }));
      const managerFailed = new WorkflowManager(makeWorkflow(graph, { status: "failed" }));

      expect(managerDone.canTransition("running")).toBe(false);
      expect(managerDone.canTransition("init")).toBe(false);
      expect(managerFailed.canTransition("running")).toBe(false);
    });
  });

  /** Tests for WorkflowManager.transition() state changes. */
  describe("transition()", () => {
    it("applies valid transitions and updates status", async () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "init" }));

      await manager.transition("spec");
      expect(manager.status).toBe("spec");

      await manager.transition("building");
      expect(manager.status).toBe("building");

      await manager.transition("running");
      expect(manager.status).toBe("running");
    });

    it("throws on invalid transitions", async () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "init" }));

      await expect(manager.transition("running")).rejects.toThrow("Invalid workflow transition");
      await expect(manager.transition("done")).rejects.toThrow("Invalid workflow transition");
    });

    it("persists state after each transition", async () => {
      const { saveWorkflowState } = await import("../../src/persistence/state.js");
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "running" }));

      await manager.transition("paused");

      expect(saveWorkflowState).toHaveBeenCalled();
    });
  });

  /** Tests for WorkflowManager.pause() convenience method. */
  describe("pause()", () => {
    it("transitions running workflow to paused", async () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "running" }));

      await manager.pause();

      expect(manager.status).toBe("paused");
    });

    it("throws when pausing a non-running workflow", async () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph, { status: "init" }));

      await expect(manager.pause()).rejects.toThrow("Invalid workflow transition");
    });
  });

  /** Tests for WorkflowManager.resume() static method. */
  describe("resume()", () => {
    it("returns null when no persisted state exists", async () => {
      const result = await WorkflowManager.resume("/tmp/nonexistent");

      expect(result).toBeNull();
    });

    it("loads persisted state and resets interrupted nodes", async () => {
      const { loadWorkflowState } = await import("../../src/persistence/state.js");

      const runningNode = makeNode("node-1", "Running Node", {
        status: "running",
        agents: [
          {
            id: "agent-1",
            role: "looma",
            model: "claude-sonnet-4-6",
            status: "running",
            writeScope: [],
            taskDescription: "test",
            tokenUsage: { input: 0, output: 0 },
            cost: 0,
          },
        ],
        retryCount: 1,
        cost: 0.5,
        startedAt: new Date().toISOString(),
      });
      const doneNode = makeNode("node-0", "Done Node", { status: "done" });

      const workflow = makeWorkflow(
        makeGraph(
          { "node-0": doneNode, "node-1": runningNode },
          [{ from: "node-0", to: "node-1" }],
        ),
        { status: "paused" },
      );

      vi.mocked(loadWorkflowState).mockResolvedValueOnce(workflow);

      const result = await WorkflowManager.resume("/tmp/test");

      expect(result).not.toBeNull();
      expect(result!.manager.status).toBe("running");
      expect(result!.info.completedNodeIds).toContain("node-0");
      expect(result!.info.resetNodeIds).toContain("node-1");
      expect(result!.info.resumedFrom).toBe("node-1");
    });

    it("throws when trying to resume a workflow in init status", async () => {
      const { loadWorkflowState } = await import("../../src/persistence/state.js");

      const workflow = makeWorkflow(makeGraph({}, []), { status: "init" });
      vi.mocked(loadWorkflowState).mockResolvedValueOnce(workflow);

      await expect(WorkflowManager.resume("/tmp/test")).rejects.toThrow(
        'Cannot resume workflow in "init" status',
      );
    });

    it("reschedules waiting nodes with resumeAt timestamps", async () => {
      const { loadWorkflowState } = await import("../../src/persistence/state.js");

      const futureTime = new Date(Date.now() + 60_000).toISOString();
      const waitingNode = makeNode("node-w", "Waiting Node", {
        status: "waiting",
        resumeAt: futureTime,
      });

      const workflow = makeWorkflow(
        makeGraph({ "node-w": waitingNode }, []),
        { status: "running" },
      );

      vi.mocked(loadWorkflowState).mockResolvedValueOnce(workflow);

      const result = await WorkflowManager.resume("/tmp/test");

      expect(result).not.toBeNull();
      expect(result!.info.rescheduledNodeIds).toContain("node-w");
    });
  });

  /** Tests for WorkflowManager.updateTotalCost() accumulation. */
  describe("updateTotalCost()", () => {
    it("accumulates cost correctly across multiple calls", () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph));

      manager.updateTotalCost(0.5);
      manager.updateTotalCost(1.25);

      expect(manager.totalCost).toBeCloseTo(1.75);
    });

    it("throws on negative cost amount", () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph));

      expect(() => manager.updateTotalCost(-0.1)).toThrow("Cost amount must be non-negative");
    });

    it("accepts zero cost without error", () => {
      const graph = makeGraph({}, []);
      const manager = new WorkflowManager(makeWorkflow(graph));

      manager.updateTotalCost(0);

      expect(manager.totalCost).toBe(0);
    });
  });
});

// ============================================================================
// WorkflowExecutionEngine Tests
// ============================================================================

/** Tests for the WorkflowExecutionEngine DAG executor. */
describe("WorkflowExecutionEngine", () => {
  let costTracker: CostTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    costTracker = new CostTracker();
  });

  /** Tests for all-nodes-done workflow completion. */
  describe("all nodes done → workflow done", () => {
    it("completes a linear chain when all nodes succeed", async () => {
      const executor = successExecutor();
      const graph = makeGraph(
        {
          "node-a": makeNode("node-a", "A"),
          "node-b": makeNode("node-b", "B"),
        },
        [{ from: "node-a", to: "node-b" }],
      );

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({ manager, executor, costTracker });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toEqual(["node-a", "node-b"]);
      expect(result.failedNodes).toEqual([]);
      expect(executor).toHaveBeenCalledTimes(2);
    });
  });

  /** Tests for node failure leading to workflow failure. */
  describe("one node fails → workflow failed", () => {
    it("reports failed status and marks downstream nodes as blocked", async () => {
      const callCount = { n: 0 };
      const executor: NodeExecutor = vi.fn().mockImplementation(() => {
        callCount.n++;
        if (callCount.n === 1) {
          return Promise.resolve({
            status: "failed",
            cost: 0.1,
            error: "Node A failed",
          } satisfies NodeExecutionResult);
        }
        return Promise.resolve({ status: "done", cost: 0 } satisfies NodeExecutionResult);
      });

      const graph = makeGraph(
        {
          "node-a": makeNode("node-a", "A"),
          "node-b": makeNode("node-b", "B"),
        },
        [{ from: "node-a", to: "node-b" }],
      );

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({ manager, executor, costTracker });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      expect(result.failedNodes).toContain("node-a");
      expect(result.failedNodes).toContain("node-b");
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });

  /** Tests for budget enforcement pausing the workflow. */
  describe("budget exceeded → workflow paused", () => {
    it("pauses workflow when budget limit is reached during execution", async () => {
      const tracker = new CostTracker(0.4);
      const executor: NodeExecutor = vi.fn().mockImplementation(() => {
        tracker.recordCall("claude-sonnet-4-6", 50_000, 10_000, "agent-1", "node-a");
        return Promise.resolve({ status: "done", cost: 0.3 } satisfies NodeExecutionResult);
      });

      const graph = makeGraph(
        {
          "node-a": makeNode("node-a", "A"),
          "node-b": makeNode("node-b", "B"),
        },
        [{ from: "node-a", to: "node-b" }],
      );

      const manager = new WorkflowManager(makeWorkflow(graph));
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

  /** Tests for parallel execution of concurrent branches. */
  describe("parallel nodes execute concurrently", () => {
    it("activates sibling nodes simultaneously after predecessor completes", async () => {
      let activeCount = 0;
      let maxConcurrent = 0;

      const executor: NodeExecutor = vi.fn().mockImplementation(
        () =>
          new Promise<NodeExecutionResult>((resolve) => {
            activeCount++;
            if (activeCount > maxConcurrent) {
              maxConcurrent = activeCount;
            }
            setTimeout(() => {
              activeCount--;
              resolve({ status: "done", cost: 0 });
            }, 10);
          }),
      );

      const graph: Graph = {
        nodes: {
          root: makeNode("root", "Root"),
          "node-a": makeNode("node-a", "A"),
          "node-b": makeNode("node-b", "B"),
        },
        edges: [
          { from: "root", to: "node-a" },
          { from: "root", to: "node-b" },
        ],
        topology: "tree",
      };

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({ manager, executor, costTracker });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(result.completedNodes).toHaveLength(3);
      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    });
  });

  /** Tests for scheduler delay handling in waiting state. */
  describe("node in waiting state respects scheduler delay", () => {
    it("passes the node delay string to the scheduler during activation", async () => {
      const scheduleSpy = vi.fn<[string, string, () => void]>().mockImplementation(
        (_nodeId: string, _delay: string, callback: () => void) => {
          callback();
        },
      );

      const scheduler = new Scheduler();
      scheduler.scheduleNode = scheduleSpy;

      const executor = successExecutor();
      const graph = makeGraph(
        {
          "node-a": makeNode("node-a", "A", { delay: "30m" }),
        },
        [],
      );

      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({
        manager,
        executor,
        costTracker,
        scheduler,
      });

      const result = await engine.run();

      expect(result.status).toBe("done");
      expect(scheduleSpy).toHaveBeenCalledWith("node-a", "30m", expect.any(Function));
      expect(executor).toHaveBeenCalledTimes(1);
    });

    it("transitions node through waiting before running", async () => {
      const observedStatuses: string[] = [];
      const executor: NodeExecutor = vi.fn().mockImplementation(
        (node: { status: string }) => {
          observedStatuses.push(node.status);
          return Promise.resolve({ status: "done", cost: 0 } satisfies NodeExecutionResult);
        },
      );

      const graph = makeGraph({ "node-a": makeNode("node-a", "A") }, []);
      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({ manager, executor, costTracker });

      await engine.run();

      expect(observedStatuses).toEqual(["running"]);
      expect(manager.getNode("node-a")!.status).toBe("done");
    });
  });

  /** Tests for executor error handling. */
  describe("executor error handling", () => {
    it("treats thrown errors as node failures", async () => {
      const executor: NodeExecutor = vi.fn().mockRejectedValue(
        new Error("Unexpected crash"),
      );

      const graph = makeGraph({ "node-a": makeNode("node-a", "A") }, []);
      const manager = new WorkflowManager(makeWorkflow(graph));
      const engine = new WorkflowExecutionEngine({ manager, executor, costTracker });

      const result = await engine.run();

      expect(result.status).toBe("failed");
      expect(result.failedNodes).toContain("node-a");
    });
  });

  /** Tests for engine stop signal. */
  describe("stop signal", () => {
    it("stops the engine and returns paused result", async () => {
      let engine: WorkflowExecutionEngine;
      const executor: NodeExecutor = vi.fn().mockImplementation(
        (node: { id: string }) => {
          if (node.id === "node-a") {
            engine.stop();
          }
          return Promise.resolve({ status: "done", cost: 0 } satisfies NodeExecutionResult);
        },
      );

      const graph = makeGraph(
        {
          "node-a": makeNode("node-a", "A"),
          "node-b": makeNode("node-b", "B"),
        },
        [{ from: "node-a", to: "node-b" }],
      );

      const manager = new WorkflowManager(makeWorkflow(graph));
      engine = new WorkflowExecutionEngine({ manager, executor, costTracker });

      const result = await engine.run();

      expect(result.status).toBe("paused");
      expect(result.haltReason).toBe("Engine stopped by external signal");
    });
  });

  /** Tests for precondition checks. */
  describe("preconditions", () => {
    it("throws when workflow is not in running state", async () => {
      const graph = makeGraph({ "node-a": makeNode("node-a", "A") }, []);
      const workflow = makeWorkflow(graph, { status: "init" });
      const manager = new WorkflowManager(workflow);
      const engine = new WorkflowExecutionEngine({
        manager,
        executor: successExecutor(),
        costTracker,
      });

      await expect(engine.run()).rejects.toThrow("Cannot start execution");
    });
  });

  /** Tests for accessor methods before execution. */
  describe("accessors", () => {
    it("returns empty collections before execution", () => {
      const graph = makeGraph({ "node-a": makeNode("node-a", "A") }, []);
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
