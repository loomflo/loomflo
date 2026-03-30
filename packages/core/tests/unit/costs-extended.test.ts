import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CostTracker,
  DEFAULT_PRICING,
  type CostEntry,
  type OnRecordCallback,
} from "../../src/costs/tracker.js";

/**
 * Extended CostTracker tests covering aggregation, callbacks, edge cases,
 * budget dynamics, entry immutability, and custom pricing merge behavior.
 * Complements the base suite in costs.test.ts.
 */
describe("CostTracker — extended", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  // -----------------------------------------------------------------------
  // Per-node / per-agent aggregation across many calls
  // -----------------------------------------------------------------------

  /** Verifies per-node and per-agent cost aggregation across multiple nodes and agents. */
  describe("multi-node / multi-agent aggregation", () => {
    it("aggregates costs correctly across three nodes and four agents", () => {
      // sonnet: input $3/M, output $15/M
      // Each call: 500_000 input → $1.5 input cost, 0 output
      tracker.recordCall("claude-sonnet-4-6", 500_000, 0, "agentA", "node1");
      tracker.recordCall("claude-sonnet-4-6", 500_000, 0, "agentB", "node1");
      tracker.recordCall("claude-sonnet-4-6", 500_000, 0, "agentC", "node2");
      tracker.recordCall("claude-sonnet-4-6", 500_000, 0, "agentD", "node3");
      tracker.recordCall("claude-sonnet-4-6", 500_000, 0, "agentA", "node3");

      expect(tracker.getNodeCost("node1")).toBeCloseTo(3.0, 10);
      expect(tracker.getNodeCost("node2")).toBeCloseTo(1.5, 10);
      expect(tracker.getNodeCost("node3")).toBeCloseTo(3.0, 10);

      expect(tracker.getAgentCost("agentA")).toBeCloseTo(3.0, 10);
      expect(tracker.getAgentCost("agentB")).toBeCloseTo(1.5, 10);
      expect(tracker.getAgentCost("agentC")).toBeCloseTo(1.5, 10);
      expect(tracker.getAgentCost("agentD")).toBeCloseTo(1.5, 10);

      expect(tracker.getTotalCost()).toBeCloseTo(7.5, 10);
    });

    it("keeps per-agent cost independent when agent spans multiple nodes", () => {
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "shared-agent", "nodeX");
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "shared-agent", "nodeY");

      expect(tracker.getAgentCost("shared-agent")).toBeCloseTo(6.0, 10);
      expect(tracker.getNodeCost("nodeX")).toBeCloseTo(3.0, 10);
      expect(tracker.getNodeCost("nodeY")).toBeCloseTo(3.0, 10);
    });
  });

  // -----------------------------------------------------------------------
  // getSummary — exhaustive field verification
  // -----------------------------------------------------------------------

  /** Validates every field in the CostSummary object. */
  describe("getSummary exhaustive fields", () => {
    it("returns all CostSummary fields with correct values after mixed calls", () => {
      const t = new CostTracker(50);
      t.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1"); // $15
      t.recordCall("claude-sonnet-4-6", 0, 1_000_000, "a2", "n2"); // $15

      const summary = t.getSummary();

      expect(summary.totalCost).toBeCloseTo(30.0, 10);
      expect(summary.budgetLimit).toBe(50);
      expect(summary.budgetRemaining).toBeCloseTo(20.0, 10);

      expect(Object.keys(summary.perNode)).toHaveLength(2);
      expect(summary.perNode["n1"]).toBeCloseTo(15.0, 10);
      expect(summary.perNode["n2"]).toBeCloseTo(15.0, 10);

      expect(Object.keys(summary.perAgent)).toHaveLength(2);
      expect(summary.perAgent["a1"]).toBeCloseTo(15.0, 10);
      expect(summary.perAgent["a2"]).toBeCloseTo(15.0, 10);

      expect(summary.entries).toHaveLength(2);
      expect(summary.entries[0].model).toBe("claude-opus-4-6");
      expect(summary.entries[1].model).toBe("claude-sonnet-4-6");
    });
  });

  // -----------------------------------------------------------------------
  // getEntries — with and without nodeId, copy semantics
  // -----------------------------------------------------------------------

  /** Tests getEntries filtering and immutability guarantees. */
  describe("getEntries filtering and immutability", () => {
    it("returns entries only for the requested nodeId", () => {
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "alpha");
      tracker.recordCall("claude-sonnet-4-6", 200, 100, "a2", "beta");
      tracker.recordCall("claude-sonnet-4-6", 300, 150, "a3", "alpha");

      const alphaEntries = tracker.getEntries("alpha");
      expect(alphaEntries).toHaveLength(2);
      expect(alphaEntries.every((e: CostEntry) => e.nodeId === "alpha")).toBe(true);
    });

    it("returns all entries when nodeId is omitted", () => {
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      tracker.recordCall("claude-opus-4-6", 200, 100, "a2", "n2");

      expect(tracker.getEntries()).toHaveLength(2);
    });

    it("mutating the returned all-entries array does not affect internal state", () => {
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");

      const entries = tracker.getEntries();
      entries.push({
        model: "fake",
        inputTokens: 0,
        outputTokens: 0,
        cost: 999,
        agentId: "fake",
        nodeId: "fake",
        timestamp: "",
      });

      expect(tracker.getEntries()).toHaveLength(1);
    });

    it("mutating the returned filtered-entries array does not affect internal state", () => {
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      tracker.recordCall("claude-sonnet-4-6", 200, 100, "a2", "n2");

      const filtered = tracker.getEntries("n1");
      filtered.length = 0;

      expect(tracker.getEntries("n1")).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // setOnRecordCallback
  // -----------------------------------------------------------------------

  /** Ensures the on-record callback receives correct arguments after each call. */
  describe("setOnRecordCallback", () => {
    it("fires with correct entry, nodeCost, totalCost, and budgetRemaining", () => {
      const t = new CostTracker(100);
      const cb: OnRecordCallback = vi.fn();
      t.setOnRecordCallback(cb);

      const entry = t.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1"); // $3

      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith(entry, 3.0, 3.0, 97.0);
    });

    it("fires on every subsequent call with accumulated values", () => {
      const t = new CostTracker(100);
      const cb: OnRecordCallback = vi.fn();
      t.setOnRecordCallback(cb);

      t.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1"); // $3
      t.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1"); // $3

      expect(cb).toHaveBeenCalledTimes(2);

      const secondArgs = (cb as ReturnType<typeof vi.fn>).mock.calls[1] as [
        CostEntry,
        number,
        number,
        number | null,
      ];
      expect(secondArgs[1]).toBeCloseTo(6.0, 10); // nodeCost
      expect(secondArgs[2]).toBeCloseTo(6.0, 10); // totalCost
      expect(secondArgs[3]).toBeCloseTo(94.0, 10); // budgetRemaining
    });

    it("passes null budgetRemaining when no limit is set", () => {
      const cb: OnRecordCallback = vi.fn();
      tracker.setOnRecordCallback(cb);

      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1");

      const args = (cb as ReturnType<typeof vi.fn>).mock.calls[0] as [
        CostEntry,
        number,
        number,
        number | null,
      ];
      expect(args[3]).toBeNull();
    });

    it("does not fire after callback is removed with null", () => {
      const cb: OnRecordCallback = vi.fn();
      tracker.setOnRecordCallback(cb);
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      expect(cb).toHaveBeenCalledOnce();

      tracker.setOnRecordCallback(null);
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      expect(cb).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // setBudgetLimit — dynamic updates reflected in isBudgetExceeded
  // -----------------------------------------------------------------------

  /** Tests that setBudgetLimit changes propagate to isBudgetExceeded correctly. */
  describe("setBudgetLimit dynamic behavior", () => {
    it("setting a limit on a previously unlimited tracker enables budget checking", () => {
      tracker.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1"); // $15
      expect(tracker.isBudgetExceeded()).toBe(false);

      tracker.setBudgetLimit(10);
      expect(tracker.isBudgetExceeded()).toBe(true);
    });

    it("raising the limit makes an exceeded budget no longer exceeded", () => {
      const t = new CostTracker(5);
      t.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1"); // $15
      expect(t.isBudgetExceeded()).toBe(true);

      t.setBudgetLimit(20);
      expect(t.isBudgetExceeded()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases: zero tokens, large token counts, floating point precision
  // -----------------------------------------------------------------------

  /** Edge-case tests for boundary token values and numeric precision. */
  describe("edge cases", () => {
    it("handles zero input and zero output tokens", () => {
      const entry = tracker.recordCall("claude-sonnet-4-6", 0, 0, "a1", "n1");
      expect(entry.cost).toBe(0);
      expect(tracker.getTotalCost()).toBe(0);
      expect(tracker.getNodeCost("n1")).toBe(0);
      expect(tracker.getAgentCost("a1")).toBe(0);
    });

    it("handles very large token counts without overflow", () => {
      // 1 billion input tokens at sonnet input pricing: 1e9 * 3 / 1e6 = 3000
      const entry = tracker.recordCall("claude-sonnet-4-6", 1_000_000_000, 0, "a1", "n1");
      expect(entry.cost).toBeCloseTo(3000, 5);
    });

    it("maintains floating-point precision across many small calls", () => {
      const t = new CostTracker();
      const callCount = 1000;
      // Each call: 1 input token at sonnet pricing = 1 * 3 / 1_000_000 = 0.000003
      for (let i = 0; i < callCount; i++) {
        t.recordCall("claude-sonnet-4-6", 1, 0, "a1", "n1");
      }
      // Expected total: 1000 * 0.000003 = 0.003
      expect(t.getTotalCost()).toBeCloseTo(0.003, 8);
    });
  });

  // -----------------------------------------------------------------------
  // Custom pricing merge with defaults
  // -----------------------------------------------------------------------

  /** Verifies custom pricing is merged with defaults without losing default entries. */
  describe("custom pricing merge", () => {
    it("preserves default models when custom pricing adds a new model", () => {
      const t = new CostTracker(null, {
        "local-llama": { inputPricePerMToken: 0, outputPricePerMToken: 0 },
      });

      // Default opus pricing should still work
      const opusEntry = t.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1");
      expect(opusEntry.cost).toBeCloseTo(15.0, 10);

      // Custom model should use provided pricing
      const llamaEntry = t.recordCall("local-llama", 1_000_000, 1_000_000, "a2", "n2");
      expect(llamaEntry.cost).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getNodeCost / getAgentCost for unknown IDs
  // -----------------------------------------------------------------------

  /** Confirms zero-cost return for IDs that were never recorded. */
  describe("unknown IDs return zero cost", () => {
    it("getNodeCost returns 0 for an ID never used even after other recordings", () => {
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1");
      expect(tracker.getNodeCost("never-used-node")).toBe(0);
    });

    it("getAgentCost returns 0 for an ID never used even after other recordings", () => {
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1");
      expect(tracker.getAgentCost("never-used-agent")).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getSummary entries copy — mutation safety
  // -----------------------------------------------------------------------

  /** Ensures mutating the summary entries array does not corrupt internal state. */
  describe("getSummary entries immutability", () => {
    it("pushing to summary.entries does not affect subsequent getSummary calls", () => {
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");

      const summary1 = tracker.getSummary();
      summary1.entries.push({
        model: "injected",
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        agentId: "x",
        nodeId: "x",
        timestamp: "",
      });

      const summary2 = tracker.getSummary();
      expect(summary2.entries).toHaveLength(1);
    });
  });
});
