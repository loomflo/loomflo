import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CostTracker,
  DEFAULT_PRICING,
  type CostEntry,
  type CostSummary,
} from "../../src/costs/tracker.js";
import { RateLimiter, type RateLimitResult } from "../../src/costs/rate-limiter.js";

// ===========================================================================
// CostTracker
// ===========================================================================

describe("CostTracker", () => {
  describe("recordCall", () => {
    it("calculates cost correctly using default claude-opus-4-6 pricing", () => {
      const tracker = new CostTracker();
      const entry = tracker.recordCall(
        "claude-opus-4-6",
        1000, // input tokens
        500, // output tokens
        "agent-1",
        "node-1",
      );
      // opus: input $15/M, output $75/M
      // cost = (1000 * 15 + 500 * 75) / 1_000_000 = (15000 + 37500) / 1_000_000 = 0.0525
      expect(entry.cost).toBeCloseTo(0.0525, 10);
      expect(entry.model).toBe("claude-opus-4-6");
      expect(entry.inputTokens).toBe(1000);
      expect(entry.outputTokens).toBe(500);
      expect(entry.agentId).toBe("agent-1");
      expect(entry.nodeId).toBe("node-1");
      expect(entry.timestamp).toBeTruthy();
    });

    it("calculates cost correctly using default claude-sonnet-4-6 pricing", () => {
      const tracker = new CostTracker();
      const entry = tracker.recordCall("claude-sonnet-4-6", 2000, 1000, "agent-2", "node-2");
      // sonnet: input $3/M, output $15/M
      // cost = (2000 * 3 + 1000 * 15) / 1_000_000 = (6000 + 15000) / 1_000_000 = 0.021
      expect(entry.cost).toBeCloseTo(0.021, 10);
    });

    it("uses fallback pricing for unknown models", () => {
      const tracker = new CostTracker();
      const entry = tracker.recordCall(
        "unknown-model-v9",
        1_000_000,
        1_000_000,
        "agent-1",
        "node-1",
      );
      // fallback: input $3/M, output $15/M
      // cost = (1_000_000 * 3 + 1_000_000 * 15) / 1_000_000 = 3 + 15 = 18
      expect(entry.cost).toBeCloseTo(18, 10);
    });

    it("uses custom pricing overrides when provided", () => {
      const tracker = new CostTracker(null, {
        "custom-model": { inputPricePerMToken: 10, outputPricePerMToken: 30 },
      });
      const entry = tracker.recordCall("custom-model", 1_000_000, 1_000_000, "agent-1", "node-1");
      // custom: input $10/M, output $30/M → 10 + 30 = 40
      expect(entry.cost).toBeCloseTo(40, 10);
    });

    it("custom pricing overrides default pricing for same model", () => {
      const tracker = new CostTracker(null, {
        "claude-opus-4-6": { inputPricePerMToken: 1, outputPricePerMToken: 2 },
      });
      const entry = tracker.recordCall(
        "claude-opus-4-6",
        1_000_000,
        1_000_000,
        "agent-1",
        "node-1",
      );
      // overridden: input $1/M, output $2/M → 1 + 2 = 3
      expect(entry.cost).toBeCloseTo(3, 10);
    });
  });

  describe("getNodeCost", () => {
    it("returns aggregated cost for a specific node", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-1", "node-A");
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-2", "node-A");
      // Each call: 1_000_000 * 3 / 1_000_000 = 3.0
      expect(tracker.getNodeCost("node-A")).toBeCloseTo(6.0, 10);
    });

    it("returns 0 for a node with no recorded calls", () => {
      const tracker = new CostTracker();
      expect(tracker.getNodeCost("nonexistent")).toBe(0);
    });
  });

  describe("getAgentCost", () => {
    it("returns aggregated cost for a specific agent", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-X", "node-1");
      tracker.recordCall("claude-sonnet-4-6", 0, 1_000_000, "agent-X", "node-2");
      // call1: 3.0, call2: 15.0
      expect(tracker.getAgentCost("agent-X")).toBeCloseTo(18.0, 10);
    });

    it("returns 0 for an agent with no recorded calls", () => {
      const tracker = new CostTracker();
      expect(tracker.getAgentCost("nonexistent")).toBe(0);
    });
  });

  describe("getTotalCost", () => {
    it("accumulates cost across multiple calls", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1"); // 3.0
      tracker.recordCall("claude-opus-4-6", 0, 1_000_000, "a2", "n2"); // 75.0
      expect(tracker.getTotalCost()).toBeCloseTo(78.0, 10);
    });

    it("returns 0 when no calls have been recorded", () => {
      const tracker = new CostTracker();
      expect(tracker.getTotalCost()).toBe(0);
    });
  });

  describe("getSummary", () => {
    it("returns correct structure with all fields", () => {
      const tracker = new CostTracker(100);
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-1", "node-1");
      tracker.recordCall("claude-opus-4-6", 0, 1_000_000, "agent-2", "node-2");

      const summary: CostSummary = tracker.getSummary();

      expect(summary.totalCost).toBeCloseTo(78.0, 10);
      expect(summary.perNode).toEqual(
        expect.objectContaining({ "node-1": expect.any(Number), "node-2": expect.any(Number) }),
      );
      expect(summary.perNode["node-1"]).toBeCloseTo(3.0, 10);
      expect(summary.perNode["node-2"]).toBeCloseTo(75.0, 10);
      expect(summary.perAgent).toEqual(
        expect.objectContaining({ "agent-1": expect.any(Number), "agent-2": expect.any(Number) }),
      );
      expect(summary.budgetLimit).toBe(100);
      expect(summary.budgetRemaining).toBeCloseTo(22.0, 10);
      expect(summary.entries).toHaveLength(2);
    });

    it("returns null budgetLimit and budgetRemaining when no limit is set", () => {
      const tracker = new CostTracker();
      const summary = tracker.getSummary();
      expect(summary.budgetLimit).toBeNull();
      expect(summary.budgetRemaining).toBeNull();
    });

    it("returns a copy of entries (not a reference)", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 1000, 500, "a1", "n1");
      const entries1 = tracker.getSummary().entries;
      const entries2 = tracker.getSummary().entries;
      expect(entries1).not.toBe(entries2);
      expect(entries1).toEqual(entries2);
    });
  });

  describe("isBudgetExceeded", () => {
    it("returns false when no limit is set", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-opus-4-6", 1_000_000, 1_000_000, "a1", "n1");
      expect(tracker.isBudgetExceeded()).toBe(false);
    });

    it("returns false when under budget", () => {
      const tracker = new CostTracker(100);
      tracker.recordCall("claude-sonnet-4-6", 1000, 500, "a1", "n1");
      expect(tracker.isBudgetExceeded()).toBe(false);
    });

    it("returns true when exactly at budget", () => {
      // sonnet: 1M input = $3
      const tracker = new CostTracker(3);
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1");
      expect(tracker.isBudgetExceeded()).toBe(true);
    });

    it("returns true when over budget", () => {
      const tracker = new CostTracker(1);
      tracker.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1"); // $15
      expect(tracker.isBudgetExceeded()).toBe(true);
    });
  });

  describe("setBudgetLimit", () => {
    it("updates the limit dynamically", () => {
      const tracker = new CostTracker(1000);
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "a1", "n1"); // $3
      expect(tracker.isBudgetExceeded()).toBe(false);

      tracker.setBudgetLimit(2);
      expect(tracker.isBudgetExceeded()).toBe(true);
    });

    it("removes the limit when set to null", () => {
      const tracker = new CostTracker(1);
      tracker.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1"); // $15
      expect(tracker.isBudgetExceeded()).toBe(true);

      tracker.setBudgetLimit(null);
      expect(tracker.isBudgetExceeded()).toBe(false);
    });
  });

  describe("getEntries", () => {
    it("returns all entries when no filter is provided", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      tracker.recordCall("claude-opus-4-6", 200, 100, "a2", "n2");
      const entries = tracker.getEntries();
      expect(entries).toHaveLength(2);
    });

    it("returns only matching entries when nodeId filter is provided", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "node-A");
      tracker.recordCall("claude-opus-4-6", 200, 100, "a2", "node-B");
      tracker.recordCall("claude-sonnet-4-6", 300, 150, "a3", "node-A");

      const filtered = tracker.getEntries("node-A");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.nodeId === "node-A")).toBe(true);
    });

    it("returns empty array when nodeId has no entries", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      expect(tracker.getEntries("nonexistent")).toEqual([]);
    });

    it("returns a copy of entries (not a reference)", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 100, 50, "a1", "n1");
      const entries1 = tracker.getEntries();
      const entries2 = tracker.getEntries();
      expect(entries1).not.toBe(entries2);
    });
  });

  describe("budgetRemaining", () => {
    it("is never negative (clamped to 0)", () => {
      const tracker = new CostTracker(1);
      tracker.recordCall("claude-opus-4-6", 1_000_000, 0, "a1", "n1"); // $15, way over $1 limit
      const summary = tracker.getSummary();
      expect(summary.budgetRemaining).toBe(0);
    });
  });

  describe("multiple agents on same node", () => {
    it("accumulates costs correctly for the node and each agent", () => {
      const tracker = new CostTracker();
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-A", "shared-node"); // $3
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-B", "shared-node"); // $3
      tracker.recordCall("claude-sonnet-4-6", 1_000_000, 0, "agent-A", "shared-node"); // $3

      expect(tracker.getNodeCost("shared-node")).toBeCloseTo(9.0, 10);
      expect(tracker.getAgentCost("agent-A")).toBeCloseTo(6.0, 10);
      expect(tracker.getAgentCost("agent-B")).toBeCloseTo(3.0, 10);
      expect(tracker.getTotalCost()).toBeCloseTo(9.0, 10);
    });
  });
});

// ===========================================================================
// RateLimiter
// ===========================================================================

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first call (bucket starts full)", () => {
    const limiter = new RateLimiter(10);
    const result = limiter.acquireOrReject("agent-1");
    expect(result.allowed).toBe(true);
  });

  it("allows multiple calls within the limit", () => {
    const limiter = new RateLimiter(5);
    for (let i = 0; i < 5; i++) {
      const result = limiter.acquireOrReject("agent-1");
      expect(result.allowed).toBe(true);
    }
  });

  it("rejects calls when bucket is exhausted", () => {
    const limiter = new RateLimiter(3);
    // Exhaust the bucket
    for (let i = 0; i < 3; i++) {
      limiter.acquireOrReject("agent-1");
    }
    const result = limiter.acquireOrReject("agent-1");
    expect(result.allowed).toBe(false);
  });

  it("includes retryAfterMs > 0 in rejected result", () => {
    const limiter = new RateLimiter(1);
    limiter.acquireOrReject("agent-1"); // consumes the single token
    const result = limiter.acquireOrReject("agent-1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("allows calls after token refill from elapsed time", () => {
    const limiter = new RateLimiter(1); // 1 per minute
    limiter.acquireOrReject("agent-1"); // consumes the single token

    // Advance time by 60 seconds (full refill for 1 call/min)
    vi.advanceTimersByTime(60_000);

    const result = limiter.acquireOrReject("agent-1");
    expect(result.allowed).toBe(true);
  });

  it("reset clears state for a specific agent", () => {
    const limiter = new RateLimiter(1);
    limiter.acquireOrReject("agent-1"); // exhaust bucket

    const rejected = limiter.acquireOrReject("agent-1");
    expect(rejected.allowed).toBe(false);

    limiter.reset("agent-1");

    // After reset, bucket is re-initialized full on next call
    const allowed = limiter.acquireOrReject("agent-1");
    expect(allowed.allowed).toBe(true);
  });

  it("resetAll clears state for all agents", () => {
    const limiter = new RateLimiter(1);
    limiter.acquireOrReject("agent-1");
    limiter.acquireOrReject("agent-2");

    limiter.resetAll();

    expect(limiter.acquireOrReject("agent-1").allowed).toBe(true);
    expect(limiter.acquireOrReject("agent-2").allowed).toBe(true);
  });

  it("maintains independent buckets for different agents", () => {
    const limiter = new RateLimiter(2);
    // Exhaust agent-1's bucket
    limiter.acquireOrReject("agent-1");
    limiter.acquireOrReject("agent-1");
    expect(limiter.acquireOrReject("agent-1").allowed).toBe(false);

    // agent-2 should still have its full bucket
    expect(limiter.acquireOrReject("agent-2").allowed).toBe(true);
    expect(limiter.acquireOrReject("agent-2").allowed).toBe(true);
    expect(limiter.acquireOrReject("agent-2").allowed).toBe(false);
  });

  it("defaults to 60 calls per minute", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 60; i++) {
      expect(limiter.acquireOrReject("agent-1").allowed).toBe(true);
    }
    expect(limiter.acquireOrReject("agent-1").allowed).toBe(false);
  });
});
