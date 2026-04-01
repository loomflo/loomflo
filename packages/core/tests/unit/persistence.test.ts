import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Workflow, Event, EventType } from "../../src/types.js";
import {
  loadWorkflowState,
  saveWorkflowState,
  saveWorkflowStateImmediate,
  flushPendingWrites,
} from "../../src/persistence/state.js";
import { createEvent, appendEvent, queryEvents } from "../../src/persistence/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Workflow object for testing. */
function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "init",
    description: "Test workflow",
    projectPath: "/tmp/test-project",
    graph: {
      nodes: {},
      edges: [],
      topology: "linear",
    },
    config: {
      level: 3,
      defaultDelay: "0",
      reviewerEnabled: true,
      maxRetriesPerNode: 3,
      maxRetriesPerTask: 2,
      maxLoomasPerLoomi: null,
      retryStrategy: "adaptive",
      models: {
        loom: "claude-opus-4-6",
        loomi: "claude-opus-4-6",
        looma: "claude-opus-4-6",
        loomex: "claude-opus-4-6",
      },
      provider: "anthropic",
      budgetLimit: null,
      pauseOnBudgetReached: true,
      sandboxCommands: true,
      allowNetwork: false,
      dashboardPort: 3000,
      dashboardAutoOpen: true,
      agentTimeout: 600_000,
      agentTokenLimit: null,
      apiRateLimit: 60,
    },
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    totalCost: 0,
    ...overrides,
  };
}

/** Build a minimal valid Event object for testing. */
function makeEvent(overrides?: Partial<Event>): Event {
  return {
    ts: "2026-03-24T10:00:00.000Z",
    type: "workflow_created",
    workflowId: "wf-1",
    nodeId: null,
    agentId: null,
    details: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "loomflo-test-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// STATE PERSISTENCE
// ===========================================================================

describe("loadWorkflowState", () => {
  it("returns null for non-existent file", async () => {
    const result = await loadWorkflowState(tmpDir);
    expect(result).toBeNull();
  });

  it("returns parsed Workflow for valid file", async () => {
    const workflow = makeWorkflow();
    const dir = join(tmpDir, ".loomflo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "workflow.json"), JSON.stringify(workflow), "utf-8");

    const result = await loadWorkflowState(tmpDir);
    expect(result).toEqual(workflow);
  });

  it("throws on invalid JSON", async () => {
    const dir = join(tmpDir, ".loomflo");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "workflow.json"), "{not valid json}", "utf-8");

    await expect(loadWorkflowState(tmpDir)).rejects.toThrow("Invalid JSON");
  });

  it("throws on schema validation failure", async () => {
    const dir = join(tmpDir, ".loomflo");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "workflow.json"),
      JSON.stringify({ id: "not-a-uuid", status: "bogus" }),
      "utf-8",
    );

    await expect(loadWorkflowState(tmpDir)).rejects.toThrow("Invalid workflow state");
  });
});

describe("saveWorkflowState (debounced)", () => {
  it("writes workflow.json after debounce", async () => {
    vi.useFakeTimers();
    const workflow = makeWorkflow();

    const promise = saveWorkflowState(tmpDir, workflow);
    vi.advanceTimersByTime(300);
    await promise;

    const raw = await readFile(join(tmpDir, ".loomflo", "workflow.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(workflow);
  });

  it("coalesces multiple writes — only last state is persisted", async () => {
    vi.useFakeTimers();
    const first = makeWorkflow({ description: "first" });
    const second = makeWorkflow({ description: "second" });

    const p1 = saveWorkflowState(tmpDir, first);
    const p2 = saveWorkflowState(tmpDir, second);

    // Flush forces pending writes instead of relying on the cleared timer
    await flushPendingWrites();
    await Promise.all([p1, p2]);

    const raw = await readFile(join(tmpDir, ".loomflo", "workflow.json"), "utf-8");
    expect(JSON.parse(raw).description).toBe("second");
  });
});

describe("saveWorkflowStateImmediate", () => {
  it("writes immediately without waiting for debounce", async () => {
    const workflow = makeWorkflow({ description: "immediate" });
    await saveWorkflowStateImmediate(tmpDir, workflow);

    const raw = await readFile(join(tmpDir, ".loomflo", "workflow.json"), "utf-8");
    expect(JSON.parse(raw).description).toBe("immediate");
  });

  it("cancels pending debounced write and resolves pending promises", async () => {
    vi.useFakeTimers();
    const debounced = makeWorkflow({ description: "debounced" });
    const immediate = makeWorkflow({ description: "immediate" });

    // Start a debounced write (do not advance timers)
    const debouncedPromise = saveWorkflowState(tmpDir, debounced);

    // Immediate write cancels the pending debounced write
    await saveWorkflowStateImmediate(tmpDir, immediate);

    // The debounced promise should also resolve (not hang)
    await debouncedPromise;

    const raw = await readFile(join(tmpDir, ".loomflo", "workflow.json"), "utf-8");
    expect(JSON.parse(raw).description).toBe("immediate");
  });
});

describe("flushPendingWrites", () => {
  it("writes all pending debounced states", async () => {
    vi.useFakeTimers();
    const dir1 = await mkdtemp(join(tmpdir(), "loomflo-flush-1-"));
    const dir2 = await mkdtemp(join(tmpdir(), "loomflo-flush-2-"));

    try {
      const wf1 = makeWorkflow({ description: "flush-1" });
      const wf2 = makeWorkflow({ description: "flush-2" });

      // Start debounced writes (don't advance timers)
      const p1 = saveWorkflowState(dir1, wf1);
      const p2 = saveWorkflowState(dir2, wf2);

      // Flush forces all pending writes
      await flushPendingWrites();
      await Promise.all([p1, p2]);

      const raw1 = await readFile(join(dir1, ".loomflo", "workflow.json"), "utf-8");
      const raw2 = await readFile(join(dir2, ".loomflo", "workflow.json"), "utf-8");
      expect(JSON.parse(raw1).description).toBe("flush-1");
      expect(JSON.parse(raw2).description).toBe("flush-2");
    } finally {
      await rm(dir1, { recursive: true, force: true });
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it("resolves immediately when no writes are pending", async () => {
    await expect(flushPendingWrites()).resolves.toBeUndefined();
  });
});

// ===========================================================================
// EVENT PERSISTENCE
// ===========================================================================

describe("createEvent", () => {
  it("generates event with current timestamp and type", () => {
    const before = new Date().toISOString();
    const event = createEvent({ type: "workflow_started", workflowId: "wf-1" });
    const after = new Date().toISOString();

    expect(event.type).toBe("workflow_started");
    expect(event.workflowId).toBe("wf-1");
    expect(event.ts >= before).toBe(true);
    expect(event.ts <= after).toBe(true);
  });

  it("uses null defaults for optional fields", () => {
    const event = createEvent({ type: "workflow_created", workflowId: "wf-1" });

    expect(event.nodeId).toBeNull();
    expect(event.agentId).toBeNull();
    expect(event.details).toEqual({});
  });

  it("passes through provided optional fields", () => {
    const event = createEvent({
      type: "node_started",
      workflowId: "wf-1",
      nodeId: "node-1",
      agentId: "looma-1",
      details: { foo: "bar" },
    });

    expect(event.nodeId).toBe("node-1");
    expect(event.agentId).toBe("looma-1");
    expect(event.details).toEqual({ foo: "bar" });
  });
});

describe("appendEvent", () => {
  it("creates directory and appends to events.jsonl", async () => {
    const event = makeEvent();
    await appendEvent(tmpDir, event);

    const content = await readFile(join(tmpDir, ".loomflo", "events.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed).toEqual(event);
  });

  it("appends multiple events as separate lines", async () => {
    const e1 = makeEvent({ type: "workflow_created" });
    const e2 = makeEvent({ type: "workflow_started", ts: "2026-03-24T10:01:00.000Z" });
    const e3 = makeEvent({
      type: "node_started",
      nodeId: "node-1",
      ts: "2026-03-24T10:02:00.000Z",
    });

    await appendEvent(tmpDir, e1);
    await appendEvent(tmpDir, e2);
    await appendEvent(tmpDir, e3);

    const content = await readFile(join(tmpDir, ".loomflo", "events.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual(e1);
    expect(JSON.parse(lines[1]!)).toEqual(e2);
    expect(JSON.parse(lines[2]!)).toEqual(e3);
  });
});

describe("queryEvents", () => {
  it("returns empty array when no file exists", async () => {
    const result = await queryEvents(tmpDir);
    expect(result).toEqual([]);
  });

  it("parses all valid events from file", async () => {
    const e1 = makeEvent({ type: "workflow_created" });
    const e2 = makeEvent({ type: "workflow_started", ts: "2026-03-24T10:01:00.000Z" });

    await appendEvent(tmpDir, e1);
    await appendEvent(tmpDir, e2);

    const result = await queryEvents(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(e1);
    expect(result[1]).toEqual(e2);
  });

  it("skips malformed JSON lines", async () => {
    const valid = makeEvent();
    const dir = join(tmpDir, ".loomflo");
    await mkdir(dir, { recursive: true });
    const content = JSON.stringify(valid) + "\n{broken json}\n" + JSON.stringify(valid) + "\n";
    await writeFile(join(dir, "events.jsonl"), content, "utf-8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await queryEvents(tmpDir);
    expect(result).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("invalid JSON"));
    warnSpy.mockRestore();
  });

  it("filters by single type", async () => {
    await appendEvent(tmpDir, makeEvent({ type: "workflow_created" }));
    await appendEvent(
      tmpDir,
      makeEvent({ type: "workflow_started", ts: "2026-03-24T10:01:00.000Z" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ type: "node_started", nodeId: "n1", ts: "2026-03-24T10:02:00.000Z" }),
    );

    const result = await queryEvents(tmpDir, { type: "workflow_started" });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("workflow_started");
  });

  it("filters by type array", async () => {
    await appendEvent(tmpDir, makeEvent({ type: "workflow_created" }));
    await appendEvent(
      tmpDir,
      makeEvent({ type: "workflow_started", ts: "2026-03-24T10:01:00.000Z" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ type: "node_started", nodeId: "n1", ts: "2026-03-24T10:02:00.000Z" }),
    );

    const types: EventType[] = ["workflow_created", "node_started"];
    const result = await queryEvents(tmpDir, { type: types });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.type)).toEqual(["workflow_created", "node_started"]);
  });

  it("filters by nodeId", async () => {
    await appendEvent(tmpDir, makeEvent({ type: "workflow_created" }));
    await appendEvent(
      tmpDir,
      makeEvent({ type: "node_started", nodeId: "n1", ts: "2026-03-24T10:01:00.000Z" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ type: "node_started", nodeId: "n2", ts: "2026-03-24T10:02:00.000Z" }),
    );

    const result = await queryEvents(tmpDir, { nodeId: "n1" });
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeId).toBe("n1");
  });

  it("filters by agentId", async () => {
    await appendEvent(
      tmpDir,
      makeEvent({ type: "agent_created", agentId: "looma-1", ts: "2026-03-24T10:00:00.000Z" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ type: "agent_created", agentId: "looma-2", ts: "2026-03-24T10:01:00.000Z" }),
    );

    const result = await queryEvents(tmpDir, { agentId: "looma-1" });
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe("looma-1");
  });

  it("filters by after timestamp (inclusive)", async () => {
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T09:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T10:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T11:00:00.000Z" }));

    const result = await queryEvents(tmpDir, { after: "2026-03-24T10:00:00.000Z" });
    expect(result).toHaveLength(2);
    expect(result[0]!.ts).toBe("2026-03-24T10:00:00.000Z");
    expect(result[1]!.ts).toBe("2026-03-24T11:00:00.000Z");
  });

  it("filters by before timestamp (exclusive)", async () => {
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T09:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T10:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T11:00:00.000Z" }));

    const result = await queryEvents(tmpDir, { before: "2026-03-24T10:00:00.000Z" });
    expect(result).toHaveLength(1);
    expect(result[0]!.ts).toBe("2026-03-24T09:00:00.000Z");
  });

  it("filters by after and before combined", async () => {
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T08:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T09:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T10:00:00.000Z" }));
    await appendEvent(tmpDir, makeEvent({ ts: "2026-03-24T11:00:00.000Z" }));

    const result = await queryEvents(tmpDir, {
      after: "2026-03-24T09:00:00.000Z",
      before: "2026-03-24T11:00:00.000Z",
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.ts).toBe("2026-03-24T09:00:00.000Z");
    expect(result[1]!.ts).toBe("2026-03-24T10:00:00.000Z");
  });

  it("applies limit (takes from end)", async () => {
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T08:00:00.000Z", type: "workflow_created" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T09:00:00.000Z", type: "workflow_started" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T10:00:00.000Z", type: "node_started", nodeId: "n1" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T11:00:00.000Z", type: "node_completed", nodeId: "n1" }),
    );

    const result = await queryEvents(tmpDir, { limit: 2 });
    expect(result).toHaveLength(2);
    expect(result[0]!.ts).toBe("2026-03-24T10:00:00.000Z");
    expect(result[1]!.ts).toBe("2026-03-24T11:00:00.000Z");
  });

  it("combines multiple filters", async () => {
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T08:00:00.000Z", type: "node_started", nodeId: "n1" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T09:00:00.000Z", type: "node_started", nodeId: "n2" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T10:00:00.000Z", type: "node_completed", nodeId: "n1" }),
    );
    await appendEvent(
      tmpDir,
      makeEvent({ ts: "2026-03-24T11:00:00.000Z", type: "node_started", nodeId: "n1" }),
    );

    const result = await queryEvents(tmpDir, {
      type: "node_started",
      nodeId: "n1",
      after: "2026-03-24T09:00:00.000Z",
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.ts).toBe("2026-03-24T11:00:00.000Z");
  });
});
