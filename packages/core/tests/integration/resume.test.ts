import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { saveWorkflowStateImmediate } from "../../src/persistence/state.js";
import { appendEvent, createEvent, queryEvents } from "../../src/persistence/events.js";
import { WorkflowManager, type ResumeInfo } from "../../src/workflow/workflow.js";
import type { Workflow, Node, Graph } from "../../src/types.js";
import { loadConfig } from "../../src/config.js";
import { verifyStateConsistency } from "../../src/persistence/state.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal node with defaults. */
function makeNode(overrides: Partial<Node> & { id: string; title: string }): Node {
  return {
    status: "pending",
    instructions: "Test instructions",
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
    providerRetryState: null,
    ...overrides,
  };
}

/** Create a test workflow with a 3-node linear graph: A → B → C. */
function makeWorkflow(
  projectPath: string,
  nodeOverrides?: Partial<Record<string, Partial<Node>>>,
): Workflow {
  const now = new Date().toISOString();
  const nodeA = makeNode({
    id: "node-a",
    title: "Node A",
    ...(nodeOverrides?.["node-a"] ?? {}),
  });
  const nodeB = makeNode({
    id: "node-b",
    title: "Node B",
    ...(nodeOverrides?.["node-b"] ?? {}),
  });
  const nodeC = makeNode({
    id: "node-c",
    title: "Node C",
    ...(nodeOverrides?.["node-c"] ?? {}),
  });

  const graph: Graph = {
    nodes: {
      "node-a": nodeA,
      "node-b": nodeB,
      "node-c": nodeC,
    },
    edges: [
      { from: "node-a", to: "node-b" },
      { from: "node-b", to: "node-c" },
    ],
    topology: "linear",
  };

  return {
    id: randomUUID(),
    status: "running",
    description: "Test workflow for resume",
    projectPath,
    graph,
    config: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      loomModel: "claude-opus-4-6",
      maxTokensPerCall: 4096,
      maxCallsPerAgent: 100,
      maxRetriesPerNode: 3,
      maxRetriesPerTask: 2,
      reviewerEnabled: true,
      defaultDelay: "0",
      budgetLimit: null,
      rateLimitPerMinute: 30,
      workspaceRoot: projectPath,
    },
    createdAt: now,
    updatedAt: now,
    totalCost: 0,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Workflow Resume (integration)", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = join(
      tmpdir(),
      `loomflo-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(projectPath, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(projectPath, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort.
    }
  });

  // --------------------------------------------------------------------------
  // Core resume scenarios
  // --------------------------------------------------------------------------

  it("should skip completed nodes and reset interrupted nodes", async () => {
    // Simulate: A is done, B was running (interrupted), C is pending.
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
        cost: 0.5,
      },
      "node-b": {
        status: "running",
        startedAt: "2026-01-01T01:00:00.000Z",
        retryCount: 1,
        cost: 0.3,
      },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    // Log events for consistency.
    await appendEvent(
      projectPath,
      createEvent({
        type: "node_completed",
        workflowId: workflow.id,
        nodeId: "node-a",
      }),
    );
    await appendEvent(
      projectPath,
      createEvent({
        type: "node_started",
        workflowId: workflow.id,
        nodeId: "node-b",
      }),
    );

    const result = await WorkflowManager.resume(projectPath);

    expect(result).not.toBeNull();
    const { manager, info } = result!;

    // A should be in completed list.
    expect(info.completedNodeIds).toContain("node-a");

    // B should be reset.
    expect(info.resetNodeIds).toContain("node-b");
    expect(info.resumedFrom).toBe("node-b");

    // Verify B was actually reset.
    const nodeB = manager.getNode("node-b");
    expect(nodeB).toBeDefined();
    expect(nodeB!.status).toBe("pending");
    expect(nodeB!.toJSON().agents).toEqual([]);
    expect(nodeB!.toJSON().retryCount).toBe(0);
    expect(nodeB!.toJSON().cost).toBe(0);

    // A should remain done.
    const nodeA = manager.getNode("node-a");
    expect(nodeA).toBeDefined();
    expect(nodeA!.status).toBe("done");
  });

  it("should reset nodes in review state", async () => {
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "review", startedAt: "2026-01-01T01:00:00.000Z" },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    const result = await WorkflowManager.resume(projectPath);
    expect(result).not.toBeNull();

    const { info, manager } = result!;
    expect(info.resetNodeIds).toContain("node-b");
    expect(manager.getNode("node-b")!.status).toBe("pending");
  });

  it("should keep failed and blocked nodes as-is", async () => {
    const workflow = makeWorkflow(projectPath, {
      "node-a": { status: "failed" },
      "node-b": { status: "blocked" },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    const result = await WorkflowManager.resume(projectPath);
    expect(result).not.toBeNull();

    const { info, manager } = result!;
    expect(info.resetNodeIds).not.toContain("node-a");
    expect(info.resetNodeIds).not.toContain("node-b");
    expect(manager.getNode("node-a")!.status).toBe("failed");
    expect(manager.getNode("node-b")!.status).toBe("blocked");
  });

  it("should handle paused workflow by transitioning to running", async () => {
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "pending" },
      "node-c": { status: "pending" },
    });
    workflow.status = "paused";

    await saveWorkflowStateImmediate(projectPath, workflow);

    const result = await WorkflowManager.resume(projectPath);
    expect(result).not.toBeNull();
    expect(result!.manager.status).toBe("running");
  });

  it("should track rescheduled waiting nodes with resumeAt", async () => {
    const futureTime = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour from now

    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "waiting", resumeAt: futureTime },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    const result = await WorkflowManager.resume(projectPath);
    expect(result).not.toBeNull();

    const { info } = result!;
    expect(info.rescheduledNodeIds).toContain("node-b");
  });

  it("should reset waiting nodes without resumeAt as inconsistent", async () => {
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "waiting", resumeAt: null },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    const result = await WorkflowManager.resume(projectPath);
    expect(result).not.toBeNull();

    const { info, manager } = result!;
    // Inconsistent waiting node should be reset.
    expect(info.resetNodeIds).toContain("node-b");
    expect(manager.getNode("node-b")!.status).toBe("pending");
  });

  it("should return null when no persisted state exists", async () => {
    const result = await WorkflowManager.resume(projectPath);
    expect(result).toBeNull();
  });

  it("should throw when workflow is in a non-resumable state", async () => {
    const workflow = makeWorkflow(projectPath);
    workflow.status = "done";

    await saveWorkflowStateImmediate(projectPath, workflow);

    await expect(WorkflowManager.resume(projectPath)).rejects.toThrow(
      /Cannot resume workflow in "done" status/,
    );
  });

  it("should log a workflow_resumed event", async () => {
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "running", startedAt: "2026-01-01T01:00:00.000Z" },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    await WorkflowManager.resume(projectPath);

    const events = await queryEvents(projectPath, { type: "workflow_resumed" });
    expect(events.length).toBe(1);
    expect(events[0]!.details).toHaveProperty("resumedFrom", "node-b");
    expect(events[0]!.details).toHaveProperty("completedNodeIds");
    expect(events[0]!.details).toHaveProperty("resetNodeIds");
  });

  // --------------------------------------------------------------------------
  // State verification
  // --------------------------------------------------------------------------

  it("should detect inconsistencies between workflow.json and events.jsonl", async () => {
    // Create a workflow where node-a is "done" but has no completion event.
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "pending" },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    // Log a node_started event but no node_completed for node-a.
    await appendEvent(
      projectPath,
      createEvent({
        type: "node_started",
        workflowId: workflow.id,
        nodeId: "node-a",
      }),
    );

    const result = await verifyStateConsistency(projectPath);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    // Should report the inconsistency.
    const hasNodeAIssue = result.issues.some((issue) => issue.includes("node-a"));
    expect(hasNodeAIssue).toBe(true);
  });

  it("should verify consistent state as valid", async () => {
    const workflow = makeWorkflow(projectPath, {
      "node-a": {
        status: "done",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
      "node-b": { status: "pending" },
      "node-c": { status: "pending" },
    });

    await saveWorkflowStateImmediate(projectPath, workflow);

    // Log proper events for node-a.
    await appendEvent(
      projectPath,
      createEvent({
        type: "node_started",
        workflowId: workflow.id,
        nodeId: "node-a",
      }),
    );
    await appendEvent(
      projectPath,
      createEvent({
        type: "node_completed",
        workflowId: workflow.id,
        nodeId: "node-a",
      }),
    );

    const result = await verifyStateConsistency(projectPath);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
