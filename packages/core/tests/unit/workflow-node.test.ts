import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkflowNode } from "../../src/workflow/node.js";
import type { AgentInfo, Node, ReviewReport } from "../../src/types.js";

// ===========================================================================
// Helpers
// ===========================================================================

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "looma-1",
    role: "looma",
    model: "claude-sonnet-4-6",
    status: "created",
    writeScope: [],
    taskDescription: "test task",
    tokenUsage: { input: 0, output: 0 },
    cost: 0,
    ...overrides,
  };
}

function makeReviewReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    verdict: "PASS",
    tasksVerified: [],
    details: "All checks passed.",
    recommendation: "None",
    createdAt: "2026-03-27T00:00:00.000Z",
    ...overrides,
  };
}

function makeNodeData(overrides: Partial<Node> = {}): Node {
  return {
    id: "node-1",
    title: "Test Node",
    status: "pending",
    instructions: "Do something",
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

// ===========================================================================
// WorkflowNode
// ===========================================================================

describe("WorkflowNode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Constructor & properties
  // =========================================================================

  describe("constructor", () => {
    it("wraps node data and exposes readonly properties", () => {
      const node = new WorkflowNode(makeNodeData());
      expect(node.id).toBe("node-1");
      expect(node.title).toBe("Test Node");
      expect(node.status).toBe("pending");
      expect(node.retryCount).toBe(0);
      expect(node.maxRetries).toBe(3);
      expect(node.reviewReport).toBeNull();
      expect(node.agents).toEqual([]);
    });

    it("does not share internal arrays with the original data", () => {
      const agents = [makeAgent()];
      const data = makeNodeData({ agents });
      const node = new WorkflowNode(data);
      agents.push(makeAgent({ id: "looma-2" }));
      expect(node.agents).toHaveLength(1);
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe("create", () => {
    it("creates a node in pending state with defaults", () => {
      const node = WorkflowNode.create("n-1", "Auth Setup", "Set up auth");
      expect(node.id).toBe("n-1");
      expect(node.title).toBe("Auth Setup");
      expect(node.status).toBe("pending");
      expect(node.maxRetries).toBe(3);
      expect(node.retryCount).toBe(0);
      const json = node.toJSON();
      expect(json.delay).toBe("0");
      expect(json.startedAt).toBeNull();
      expect(json.completedAt).toBeNull();
    });

    it("accepts optional overrides", () => {
      const agent = makeAgent();
      const node = WorkflowNode.create("n-2", "Build", "Build it", {
        delay: "30m",
        maxRetries: 5,
        agents: [agent],
        fileOwnership: { "looma-1": ["src/**"] },
      });
      expect(node.maxRetries).toBe(5);
      expect(node.agents).toHaveLength(1);
      expect(node.toJSON().delay).toBe("30m");
      expect(node.fileOwnership).toEqual({ "looma-1": ["src/**"] });
    });
  });

  // =========================================================================
  // State machine transitions
  // =========================================================================

  describe("canTransition", () => {
    it("allows valid pending → waiting", () => {
      const node = new WorkflowNode(makeNodeData({ status: "pending" }));
      expect(node.canTransition("waiting")).toBe(true);
    });

    it("rejects pending → running (must go through waiting)", () => {
      const node = new WorkflowNode(makeNodeData({ status: "pending" }));
      expect(node.canTransition("running")).toBe(false);
    });

    it("allows waiting → running", () => {
      const node = new WorkflowNode(makeNodeData({ status: "waiting" }));
      expect(node.canTransition("running")).toBe(true);
    });

    it("allows running → review, done, failed, blocked", () => {
      const node = new WorkflowNode(makeNodeData({ status: "running" }));
      expect(node.canTransition("review")).toBe(true);
      expect(node.canTransition("done")).toBe(true);
      expect(node.canTransition("failed")).toBe(true);
      expect(node.canTransition("blocked")).toBe(true);
    });

    it("allows review → done, running, blocked, failed", () => {
      const node = new WorkflowNode(makeNodeData({ status: "review" }));
      expect(node.canTransition("done")).toBe(true);
      expect(node.canTransition("running")).toBe(true);
      expect(node.canTransition("blocked")).toBe(true);
      expect(node.canTransition("failed")).toBe(true);
    });

    it("rejects transitions from terminal states", () => {
      for (const terminal of ["done", "failed", "blocked"] as const) {
        const node = new WorkflowNode(makeNodeData({ status: terminal }));
        expect(node.canTransition("pending")).toBe(false);
        expect(node.canTransition("running")).toBe(false);
      }
    });
  });

  describe("getValidTransitions", () => {
    it("returns correct transitions for each state", () => {
      expect(new WorkflowNode(makeNodeData({ status: "pending" })).getValidTransitions()).toEqual([
        "waiting",
      ]);

      expect(new WorkflowNode(makeNodeData({ status: "waiting" })).getValidTransitions()).toEqual([
        "running",
      ]);

      expect(new WorkflowNode(makeNodeData({ status: "running" })).getValidTransitions()).toEqual([
        "review",
        "done",
        "failed",
        "blocked",
      ]);

      expect(new WorkflowNode(makeNodeData({ status: "review" })).getValidTransitions()).toEqual([
        "done",
        "running",
        "blocked",
        "failed",
      ]);

      expect(new WorkflowNode(makeNodeData({ status: "done" })).getValidTransitions()).toEqual([]);

      expect(new WorkflowNode(makeNodeData({ status: "failed" })).getValidTransitions()).toEqual(
        [],
      );

      expect(new WorkflowNode(makeNodeData({ status: "blocked" })).getValidTransitions()).toEqual(
        [],
      );
    });
  });

  describe("transition", () => {
    it("updates status on valid transition", () => {
      const node = new WorkflowNode(makeNodeData({ status: "pending" }));
      node.transition("waiting");
      expect(node.status).toBe("waiting");
    });

    it("throws on invalid transition", () => {
      const node = new WorkflowNode(makeNodeData({ status: "pending" }));
      expect(() => node.transition("done")).toThrow('Invalid transition: "pending" → "done"');
    });

    it("sets startedAt when entering running for the first time", () => {
      const node = new WorkflowNode(makeNodeData({ status: "waiting" }));
      node.transition("running");
      const json = node.toJSON();
      expect(json.startedAt).toBe("2026-03-27T12:00:00.000Z");
    });

    it("does not overwrite startedAt on retry (review → running)", () => {
      const node = new WorkflowNode(
        makeNodeData({
          status: "review",
          startedAt: "2026-03-27T10:00:00.000Z",
        }),
      );
      node.transition("running");
      expect(node.toJSON().startedAt).toBe("2026-03-27T10:00:00.000Z");
    });

    it("sets completedAt when entering done", () => {
      const node = new WorkflowNode(makeNodeData({ status: "running" }));
      node.transition("done");
      expect(node.toJSON().completedAt).toBe("2026-03-27T12:00:00.000Z");
    });

    it("sets completedAt when entering failed", () => {
      const node = new WorkflowNode(makeNodeData({ status: "running" }));
      node.transition("failed");
      expect(node.toJSON().completedAt).toBe("2026-03-27T12:00:00.000Z");
    });

    it("sets completedAt when entering blocked", () => {
      const node = new WorkflowNode(makeNodeData({ status: "running" }));
      node.transition("blocked");
      expect(node.toJSON().completedAt).toBe("2026-03-27T12:00:00.000Z");
    });

    it("follows full happy path: pending → waiting → running → done", () => {
      const node = WorkflowNode.create("n-1", "Test", "Test");
      node.transition("waiting");
      node.transition("running");
      node.transition("done");
      expect(node.status).toBe("done");
    });

    it("follows retry path: running → review → running (retry)", () => {
      const node = new WorkflowNode(makeNodeData({ status: "running" }));
      node.transition("review");
      expect(node.status).toBe("review");
      node.transition("running");
      expect(node.status).toBe("running");
    });
  });

  // =========================================================================
  // Retry management
  // =========================================================================

  describe("incrementRetry", () => {
    it("increments the retry count", () => {
      const node = new WorkflowNode(makeNodeData({ retryCount: 0, maxRetries: 3 }));
      node.incrementRetry();
      expect(node.retryCount).toBe(1);
      node.incrementRetry();
      expect(node.retryCount).toBe(2);
    });

    it("throws when at max retries", () => {
      const node = new WorkflowNode(makeNodeData({ retryCount: 3, maxRetries: 3 }));
      expect(() => node.incrementRetry()).toThrow(
        "Cannot increment retry: count (3) already at or above max (3)",
      );
    });
  });

  // =========================================================================
  // Review report
  // =========================================================================

  describe("setReviewReport", () => {
    it("sets the review report", () => {
      const node = new WorkflowNode(makeNodeData());
      const report = makeReviewReport();
      node.setReviewReport(report);
      expect(node.reviewReport).toEqual(report);
    });
  });

  // =========================================================================
  // Agent management
  // =========================================================================

  describe("addAgent", () => {
    it("adds an agent to the node", () => {
      const node = new WorkflowNode(makeNodeData());
      const agent = makeAgent();
      node.addAgent(agent);
      expect(node.agents).toHaveLength(1);
      expect(node.agents[0]!.id).toBe("looma-1");
    });

    it("throws on duplicate agent ID", () => {
      const node = new WorkflowNode(makeNodeData({ agents: [makeAgent()] }));
      expect(() => node.addAgent(makeAgent())).toThrow('Agent "looma-1" already exists');
    });
  });

  describe("updateAgent", () => {
    it("merges partial updates", () => {
      const node = new WorkflowNode(makeNodeData({ agents: [makeAgent()] }));
      node.updateAgent("looma-1", { status: "running" });
      expect(node.agents[0]!.status).toBe("running");
      expect(node.agents[0]!.role).toBe("looma");
    });

    it("throws if agent not found", () => {
      const node = new WorkflowNode(makeNodeData());
      expect(() => node.updateAgent("missing", {})).toThrow('Agent "missing" not found');
    });

    it("preserves agent ID even if updates try to change it", () => {
      const node = new WorkflowNode(makeNodeData({ agents: [makeAgent()] }));
      node.updateAgent("looma-1", { id: "different" } as Partial<AgentInfo>);
      expect(node.agents[0]!.id).toBe("looma-1");
    });
  });

  describe("removeAgent", () => {
    it("removes an agent and its file ownership", () => {
      const agent = makeAgent();
      const node = new WorkflowNode(
        makeNodeData({
          agents: [agent],
          fileOwnership: { "looma-1": ["src/**"] },
        }),
      );
      node.removeAgent("looma-1");
      expect(node.agents).toHaveLength(0);
      expect(node.fileOwnership).toEqual({});
    });

    it("throws if agent not found", () => {
      const node = new WorkflowNode(makeNodeData());
      expect(() => node.removeAgent("missing")).toThrow('Agent "missing" not found');
    });
  });

  // =========================================================================
  // File ownership
  // =========================================================================

  describe("validateWriteScope", () => {
    it("returns true when file matches ownership pattern", () => {
      const node = new WorkflowNode(
        makeNodeData({
          agents: [makeAgent()],
          fileOwnership: { "looma-1": ["src/**/*.ts"] },
        }),
      );
      expect(node.validateWriteScope("looma-1", "src/utils/helper.ts")).toBe(true);
    });

    it("returns false when file does not match", () => {
      const node = new WorkflowNode(
        makeNodeData({
          agents: [makeAgent()],
          fileOwnership: { "looma-1": ["src/**/*.ts"] },
        }),
      );
      expect(node.validateWriteScope("looma-1", "tests/foo.ts")).toBe(false);
    });

    it("returns false when agent has no ownership entry", () => {
      const node = new WorkflowNode(makeNodeData());
      expect(node.validateWriteScope("unknown", "src/foo.ts")).toBe(false);
    });

    it("returns false when ownership patterns array is empty", () => {
      const node = new WorkflowNode(
        makeNodeData({
          agents: [makeAgent()],
          fileOwnership: { "looma-1": [] },
        }),
      );
      expect(node.validateWriteScope("looma-1", "src/foo.ts")).toBe(false);
    });

    it("supports multiple glob patterns", () => {
      const node = new WorkflowNode(
        makeNodeData({
          agents: [makeAgent()],
          fileOwnership: { "looma-1": ["src/**", "lib/**"] },
        }),
      );
      expect(node.validateWriteScope("looma-1", "src/a.ts")).toBe(true);
      expect(node.validateWriteScope("looma-1", "lib/b.ts")).toBe(true);
      expect(node.validateWriteScope("looma-1", "test/c.ts")).toBe(false);
    });
  });

  describe("setFileOwnership", () => {
    it("assigns patterns to an existing agent", () => {
      const node = new WorkflowNode(makeNodeData({ agents: [makeAgent()] }));
      node.setFileOwnership("looma-1", ["src/**", "lib/**"]);
      expect(node.fileOwnership["looma-1"]).toEqual(["src/**", "lib/**"]);
    });

    it("throws if agent not assigned to node", () => {
      const node = new WorkflowNode(makeNodeData());
      expect(() => node.setFileOwnership("missing", ["src/**"])).toThrow(
        'Agent "missing" not found',
      );
    });

    it("does not share internal array with caller", () => {
      const node = new WorkflowNode(makeNodeData({ agents: [makeAgent()] }));
      const patterns = ["src/**"];
      node.setFileOwnership("looma-1", patterns);
      patterns.push("lib/**");
      expect(node.fileOwnership["looma-1"]).toEqual(["src/**"]);
    });
  });

  describe("validateNoOverlap", () => {
    it("returns valid when no overlaps exist", () => {
      const agent1 = makeAgent({ id: "looma-1" });
      const agent2 = makeAgent({ id: "looma-2" });
      const node = new WorkflowNode(
        makeNodeData({
          agents: [agent1, agent2],
          fileOwnership: {
            "looma-1": ["src/**"],
            "looma-2": ["tests/**"],
          },
        }),
      );
      const result = node.validateNoOverlap();
      expect(result.valid).toBe(true);
      expect(result.overlaps).toHaveLength(0);
    });

    it("detects overlapping patterns", () => {
      const agent1 = makeAgent({ id: "looma-1" });
      const agent2 = makeAgent({ id: "looma-2" });
      const node = new WorkflowNode(
        makeNodeData({
          agents: [agent1, agent2],
          fileOwnership: {
            "looma-1": ["src/**"],
            "looma-2": ["src/utils/**"],
          },
        }),
      );
      const result = node.validateNoOverlap();
      expect(result.valid).toBe(false);
      expect(result.overlaps).toHaveLength(1);
      expect(result.overlaps[0]).toContain("looma-1");
      expect(result.overlaps[0]).toContain("looma-2");
    });

    it("returns valid with only one agent", () => {
      const node = new WorkflowNode(
        makeNodeData({
          agents: [makeAgent()],
          fileOwnership: { "looma-1": ["src/**"] },
        }),
      );
      const result = node.validateNoOverlap();
      expect(result.valid).toBe(true);
    });

    it("returns valid with no ownership entries", () => {
      const node = new WorkflowNode(makeNodeData());
      const result = node.validateNoOverlap();
      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // Serialization
  // =========================================================================

  describe("toJSON", () => {
    it("returns a plain Node object", () => {
      const agent = makeAgent();
      const data = makeNodeData({
        agents: [agent],
        fileOwnership: { "looma-1": ["src/**"] },
      });
      const node = new WorkflowNode(data);
      const json = node.toJSON();
      expect(json).toEqual(data);
    });

    it("returns a defensive copy (mutations do not affect the node)", () => {
      const node = WorkflowNode.create("n-1", "Test", "Test");
      const json = node.toJSON();
      json.status = "done";
      expect(node.status).toBe("pending");
    });

    it("agents array in JSON is a deep copy", () => {
      const node = new WorkflowNode(makeNodeData({ agents: [makeAgent()] }));
      const json = node.toJSON();
      json.agents.push(makeAgent({ id: "looma-extra" }));
      expect(node.agents).toHaveLength(1);
    });
  });
});
