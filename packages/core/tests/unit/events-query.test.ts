import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Event } from "../../src/types.js";
import { createEvent, appendEvent, queryEvents } from "../../src/persistence/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  tmpDir = await mkdtemp(join(tmpdir(), "loomflo-events-query-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// queryEvents
// ===========================================================================

describe("queryEvents", () => {
  it("returns events from a valid events.jsonl", async () => {
    const e1 = makeEvent({ type: "node_started", nodeId: "n1" });
    const e2 = makeEvent({ type: "node_completed", nodeId: "n1", ts: "2026-03-24T10:01:00.000Z" });

    await appendEvent(tmpDir, e1);
    await appendEvent(tmpDir, e2);

    const result = await queryEvents(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(e1);
    expect(result[1]).toEqual(e2);
  });

  it("returns [] when the events file does not exist", async () => {
    const result = await queryEvents(tmpDir);
    expect(result).toEqual([]);
  });

  it("skips malformed JSON lines", async () => {
    const good = makeEvent({ type: "node_started", nodeId: "n1" });
    const dir = join(tmpDir, ".loomflo");
    await mkdir(dir, { recursive: true });

    const lines = [JSON.stringify(good), "NOT VALID JSON{{{", ""].join("\n");
    await writeFile(join(dir, "events.jsonl"), lines, "utf-8");

    const result = await queryEvents(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(good);
  });

  it("skips lines that fail schema validation", async () => {
    const good = makeEvent({ type: "node_started", nodeId: "n1" });
    const dir = join(tmpDir, ".loomflo");
    await mkdir(dir, { recursive: true });

    const badObj = { ts: "not-a-datetime", type: "bogus_type", workflowId: 123 };
    const lines = [JSON.stringify(good), JSON.stringify(badObj), ""].join("\n");
    await writeFile(join(dir, "events.jsonl"), lines, "utf-8");

    const result = await queryEvents(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(good);
  });

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  describe("filters", () => {
    let events: Event[];

    beforeEach(async () => {
      events = [
        makeEvent({
          type: "node_started",
          nodeId: "n1",
          agentId: "a1",
          ts: "2026-03-24T10:00:00.000Z",
        }),
        makeEvent({
          type: "node_completed",
          nodeId: "n1",
          agentId: "a1",
          ts: "2026-03-24T10:01:00.000Z",
        }),
        makeEvent({
          type: "node_started",
          nodeId: "n2",
          agentId: "a2",
          ts: "2026-03-24T10:02:00.000Z",
        }),
        makeEvent({
          type: "node_failed",
          nodeId: "n2",
          agentId: "a2",
          ts: "2026-03-24T10:03:00.000Z",
        }),
        makeEvent({
          type: "workflow_started",
          nodeId: null,
          agentId: null,
          ts: "2026-03-24T10:04:00.000Z",
        }),
      ];
      for (const e of events) {
        await appendEvent(tmpDir, e);
      }
    });

    it("filters by single type", async () => {
      const result = await queryEvents(tmpDir, { type: "node_started" });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.type === "node_started")).toBe(true);
    });

    it("filters by multiple types", async () => {
      const result = await queryEvents(tmpDir, { type: ["node_started", "node_failed"] });
      expect(result).toHaveLength(3);
      expect(result.every((e) => e.type === "node_started" || e.type === "node_failed")).toBe(true);
    });

    it("filters by nodeId", async () => {
      const result = await queryEvents(tmpDir, { nodeId: "n2" });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.nodeId === "n2")).toBe(true);
    });

    it("filters by agentId", async () => {
      const result = await queryEvents(tmpDir, { agentId: "a1" });
      expect(result).toHaveLength(2);
      expect(result.every((e) => e.agentId === "a1")).toBe(true);
    });

    it("applies limit (takes from end)", async () => {
      const result = await queryEvents(tmpDir, { limit: 2 });
      expect(result).toHaveLength(2);
      expect(result[0]!.ts).toBe("2026-03-24T10:03:00.000Z");
      expect(result[1]!.ts).toBe("2026-03-24T10:04:00.000Z");
    });

    it("filters by after (inclusive)", async () => {
      const result = await queryEvents(tmpDir, { after: "2026-03-24T10:03:00.000Z" });
      expect(result).toHaveLength(2);
    });

    it("filters by before (exclusive)", async () => {
      const result = await queryEvents(tmpDir, { before: "2026-03-24T10:02:00.000Z" });
      expect(result).toHaveLength(2);
    });

    it("combines type + nodeId + limit", async () => {
      const result = await queryEvents(tmpDir, { type: "node_started", nodeId: "n1", limit: 1 });
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe("node_started");
      expect(result[0]!.nodeId).toBe("n1");
    });
  });
});
