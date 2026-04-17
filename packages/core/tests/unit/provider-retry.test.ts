import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyProviderError,
  createCancellableSleep,
  createProviderRetryState,
  advanceProviderRetryState,
  getProviderRetryDelay,
  formatRetryMessage,
  PROVIDER_BACKOFF_SCHEDULE_MS,
  MAX_PROVIDER_RETRY_ATTEMPTS,
} from "../../src/workflow/provider-retry.js";

// ============================================================================
// classifyProviderError
// ============================================================================

describe("classifyProviderError", () => {
  describe("rate-limit detection by status code", () => {
    it("classifies HTTP 429 as rate-limit", () => {
      const error = { status: 429, message: "Too Many Requests" };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it("classifies HTTP 529 (Anthropic overloaded) as rate-limit", () => {
      const error = { status: 529, message: "Overloaded" };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
      expect(result.statusCode).toBe(529);
    });

    it("does NOT classify HTTP 400 as rate-limit", () => {
      const error = { status: 400, message: "Bad Request" };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it("does NOT classify HTTP 401 as rate-limit", () => {
      const error = { status: 401, message: "Unauthorized" };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(false);
    });

    it("does NOT classify HTTP 500 as rate-limit", () => {
      const error = { status: 500, message: "Internal Server Error" };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(false);
    });

    it("extracts status from statusCode property", () => {
      const error = { statusCode: 429, message: "Rate limited" };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
      expect(result.statusCode).toBe(429);
    });
  });

  describe("rate-limit detection by error message patterns", () => {
    it("detects 'rate limit' in message", () => {
      const error = new Error("API rate limit exceeded");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("detects 'too many requests' in message", () => {
      const error = new Error("Too many requests, please slow down");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("detects 'overloaded' in message", () => {
      const error = new Error("Anthropic API overloaded after 5 retries");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("detects 'credit' in message", () => {
      const error = new Error("Insufficient credit balance");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("detects 'quota' in message", () => {
      const error = new Error("Quota exceeded for this billing period");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("detects 'billing' in message", () => {
      const error = new Error("Billing account suspended");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("detects 'insufficient funds' in message", () => {
      const error = new Error("Insufficient funds to process request");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
    });

    it("does NOT match generic errors", () => {
      const error = new Error("Connection timed out");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(false);
    });

    it("does NOT match auth errors", () => {
      const error = new Error("Invalid API key provided");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(false);
    });
  });

  describe("status code extraction from wrapped errors", () => {
    it("extracts status code from Anthropic-style error message", () => {
      const error = new Error("Anthropic API error (429): rate limit exceeded");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it("extracts status code from OpenAI-style error message", () => {
      const error = new Error("OpenAI-compat API error (429): too many requests");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it("does NOT match non-429 status in message", () => {
      const error = new Error("API error (500): internal server error");
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(false);
      expect(result.statusCode).toBe(500);
    });
  });

  describe("Retry-After header extraction", () => {
    it("extracts Retry-After as seconds", () => {
      const error = {
        status: 429,
        message: "Rate limited",
        headers: { "retry-after": "120" },
      };
      const result = classifyProviderError(error);
      expect(result.isRateLimit).toBe(true);
      expect(result.retryAfterMs).toBe(120_000);
    });

    it("extracts Retry-After with capitalized header name", () => {
      const error = {
        status: 429,
        message: "Rate limited",
        headers: { "Retry-After": "60" },
      };
      const result = classifyProviderError(error);
      expect(result.retryAfterMs).toBe(60_000);
    });

    it("returns null retryAfterMs when no header present", () => {
      const error = { status: 429, message: "Rate limited" };
      const result = classifyProviderError(error);
      expect(result.retryAfterMs).toBeNull();
    });

    it("returns null retryAfterMs for non-rate-limit errors", () => {
      const error = { status: 400, message: "Bad request" };
      const result = classifyProviderError(error);
      expect(result.retryAfterMs).toBeNull();
    });

    it("handles non-object errors (strings)", () => {
      const result = classifyProviderError("something went wrong");
      expect(result.isRateLimit).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.retryAfterMs).toBeNull();
    });

    it("handles null/undefined errors", () => {
      expect(classifyProviderError(null).isRateLimit).toBe(false);
      expect(classifyProviderError(undefined).isRateLimit).toBe(false);
    });
  });
});

// ============================================================================
// getProviderRetryDelay
// ============================================================================

describe("getProviderRetryDelay", () => {
  it("returns backoff schedule values for each attempt", () => {
    expect(getProviderRetryDelay(1, null)).toBe(5 * 60 * 1000); // 5 min
    expect(getProviderRetryDelay(2, null)).toBe(10 * 60 * 1000); // 10 min
    expect(getProviderRetryDelay(3, null)).toBe(30 * 60 * 1000); // 30 min
    expect(getProviderRetryDelay(4, null)).toBe(60 * 60 * 1000); // 1h
    expect(getProviderRetryDelay(5, null)).toBe(90 * 60 * 1000); // 1h30
    expect(getProviderRetryDelay(6, null)).toBe(2 * 60 * 60 * 1000); // 2h
    expect(getProviderRetryDelay(7, null)).toBe(4 * 60 * 60 * 1000); // 4h
    expect(getProviderRetryDelay(8, null)).toBe(8 * 60 * 60 * 1000); // 8h
    expect(getProviderRetryDelay(9, null)).toBe(24 * 60 * 60 * 1000); // 24h
  });

  it("returns null when max attempts exceeded (attempt 10)", () => {
    expect(getProviderRetryDelay(10, null)).toBeNull();
    expect(getProviderRetryDelay(11, null)).toBeNull();
  });

  it("uses Retry-After header value when provided", () => {
    // Retry-After says 90 seconds, but schedule says 5 min for attempt 1
    expect(getProviderRetryDelay(1, 90_000)).toBe(90_000);
  });

  it("ignores Retry-After when it is 0 or negative", () => {
    expect(getProviderRetryDelay(1, 0)).toBe(5 * 60 * 1000);
    expect(getProviderRetryDelay(1, -100)).toBe(5 * 60 * 1000);
  });

  it("still returns null at max attempts even with Retry-After", () => {
    expect(getProviderRetryDelay(10, 60_000)).toBeNull();
  });
});

// ============================================================================
// PROVIDER_BACKOFF_SCHEDULE_MS
// ============================================================================

describe("PROVIDER_BACKOFF_SCHEDULE_MS", () => {
  it("has exactly 9 entries (attempts 1-9, attempt 10 = stop)", () => {
    expect(PROVIDER_BACKOFF_SCHEDULE_MS).toHaveLength(9);
  });

  it("is monotonically increasing", () => {
    for (let i = 1; i < PROVIDER_BACKOFF_SCHEDULE_MS.length; i++) {
      expect(PROVIDER_BACKOFF_SCHEDULE_MS[i]).toBeGreaterThan(
        PROVIDER_BACKOFF_SCHEDULE_MS[i - 1]!,
      );
    }
  });

  it("MAX_PROVIDER_RETRY_ATTEMPTS equals schedule length + 1", () => {
    expect(MAX_PROVIDER_RETRY_ATTEMPTS).toBe(PROVIDER_BACKOFF_SCHEDULE_MS.length + 1);
    expect(MAX_PROVIDER_RETRY_ATTEMPTS).toBe(10);
  });
});

// ============================================================================
// createCancellableSleep
// ============================================================================

describe("createCancellableSleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves to true when timer completes", async () => {
    const sleep = createCancellableSleep(5000);

    expect(sleep.resumeAt).toBe("2026-04-17T12:00:05.000Z");

    vi.advanceTimersByTime(5000);

    const result = await sleep.promise;
    expect(result).toBe(true);
  });

  it("resolves to false when cancelled", async () => {
    const sleep = createCancellableSleep(5000);

    sleep.cancel();

    const result = await sleep.promise;
    expect(result).toBe(false);
  });

  it("cancel is idempotent (safe to call multiple times)", () => {
    const sleep = createCancellableSleep(5000);
    sleep.cancel();
    expect(() => sleep.cancel()).not.toThrow();
  });

  it("sets correct resumeAt timestamp", () => {
    const sleep = createCancellableSleep(300_000); // 5 minutes
    expect(sleep.resumeAt).toBe("2026-04-17T12:05:00.000Z");
  });

  it("does not resolve before timer fires", () => {
    const sleep = createCancellableSleep(10_000);
    let resolved = false;
    void sleep.promise.then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(5000);
    // Promise callbacks run as microtasks, so check after the tick
    expect(resolved).toBe(false);
  });
});

// ============================================================================
// State management functions
// ============================================================================

describe("createProviderRetryState", () => {
  it("creates state with attempt=1", () => {
    const state = createProviderRetryState(429, "Rate limited");
    expect(state.attempt).toBe(1);
    expect(state.lastStatusCode).toBe(429);
    expect(state.lastReason).toBe("Rate limited");
    expect(state.resumeAt).toBeNull();
  });

  it("handles null status code", () => {
    const state = createProviderRetryState(null, "Unknown provider error");
    expect(state.attempt).toBe(1);
    expect(state.lastStatusCode).toBeNull();
  });
});

describe("advanceProviderRetryState", () => {
  it("increments attempt count", () => {
    const initial = createProviderRetryState(429, "First error");
    const next = advanceProviderRetryState(initial, 429, "Second error");
    expect(next.attempt).toBe(2);
    expect(next.lastReason).toBe("Second error");
    expect(next.resumeAt).toBeNull();
  });

  it("preserves attempt counting through multiple advances", () => {
    let state = createProviderRetryState(429, "1");
    for (let i = 2; i <= 9; i++) {
      state = advanceProviderRetryState(state, 429, String(i));
    }
    expect(state.attempt).toBe(9);
  });

  it("updates status code on each advance", () => {
    const state1 = createProviderRetryState(429, "Rate limit");
    const state2 = advanceProviderRetryState(state1, 529, "Overloaded");
    expect(state2.lastStatusCode).toBe(529);
  });
});

// ============================================================================
// formatRetryMessage
// ============================================================================

describe("formatRetryMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats message with minutes for short waits", () => {
    const resumeAt = new Date("2026-04-17T12:05:00.000Z").toISOString();
    const msg = formatRetryMessage("node-1", 1, resumeAt, "Rate limited");
    expect(msg).toContain("node-1");
    expect(msg).toContain("attempt 1/10");
    expect(msg).toContain("5m");
    expect(msg).toContain("Rate limited");
  });

  it("formats message with hours for long waits", () => {
    const resumeAt = new Date("2026-04-17T14:30:00.000Z").toISOString();
    const msg = formatRetryMessage("node-2", 5, resumeAt, "Credit exhausted");
    expect(msg).toContain("attempt 5/10");
    expect(msg).toContain("2h30m");
  });

  it("formats message with just hours when no remaining minutes", () => {
    const resumeAt = new Date("2026-04-17T14:00:00.000Z").toISOString();
    const msg = formatRetryMessage("node-3", 4, resumeAt, "429");
    expect(msg).toContain("2h");
    expect(msg).not.toContain("2h0m");
  });
});

// ============================================================================
// Integration: State transitions with WorkflowNode
// ============================================================================

describe("WorkflowNode state transitions with provider retry states", () => {
  // These tests use the actual WorkflowNode to verify the state machine
  // supports the new states correctly.

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let WorkflowNode: typeof import("../../src/workflow/node.js").WorkflowNode;

  beforeEach(async () => {
    const mod = await import("../../src/workflow/node.js");
    WorkflowNode = mod.WorkflowNode;
  });

  it("allows running -> waiting_for_provider transition", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    node.transition("running");
    expect(node.canTransition("waiting_for_provider")).toBe(true);
    node.transition("waiting_for_provider");
    expect(node.status).toBe("waiting_for_provider");
  });

  it("allows waiting_for_provider -> running transition (retry)", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    node.transition("running");
    node.transition("waiting_for_provider");
    expect(node.canTransition("running")).toBe(true);
    node.transition("running");
    expect(node.status).toBe("running");
  });

  it("allows waiting_for_provider -> failed_provider_exhausted transition", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    node.transition("running");
    node.transition("waiting_for_provider");
    expect(node.canTransition("failed_provider_exhausted")).toBe(true);
    node.transition("failed_provider_exhausted");
    expect(node.status).toBe("failed_provider_exhausted");
  });

  it("failed_provider_exhausted is terminal (no transitions out)", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    node.transition("running");
    node.transition("waiting_for_provider");
    node.transition("failed_provider_exhausted");
    expect(node.canTransition("running")).toBe(false);
    expect(node.canTransition("pending")).toBe(false);
    expect(node.canTransition("failed")).toBe(false);
    expect(node.getValidTransitions()).toEqual([]);
  });

  it("sets completedAt when entering failed_provider_exhausted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    node.transition("running");
    node.transition("waiting_for_provider");
    node.transition("failed_provider_exhausted");
    expect(node.toJSON().completedAt).toBe("2026-04-17T12:00:00.000Z");

    vi.useRealTimers();
  });

  it("does NOT allow pending -> waiting_for_provider", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    expect(node.canTransition("waiting_for_provider")).toBe(false);
  });

  it("does NOT allow waiting -> waiting_for_provider", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    expect(node.canTransition("waiting_for_provider")).toBe(false);
  });

  it("providerRetryState getter and setter work", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    expect(node.providerRetryState).toBeNull();

    const state = createProviderRetryState(429, "Rate limited");
    node.setProviderRetryState(state);
    expect(node.providerRetryState).toEqual(state);

    node.setProviderRetryState(null);
    expect(node.providerRetryState).toBeNull();
  });

  it("providerRetryState persists through toJSON/fromJSON", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    const state = createProviderRetryState(429, "Rate limited");
    node.setProviderRetryState(state);

    const json = node.toJSON();
    expect(json.providerRetryState).toEqual(state);

    const restored = new WorkflowNode(json);
    expect(restored.providerRetryState).toEqual(state);
  });

  it("full retry cycle: running -> waiting_for_provider -> running -> done", () => {
    const node = WorkflowNode.create("n-1", "Test", "Test");
    node.transition("waiting");
    node.transition("running");

    // Hit rate limit
    node.transition("waiting_for_provider");
    const state = createProviderRetryState(429, "Rate limited");
    node.setProviderRetryState(state);

    // Retry succeeds
    node.transition("running");
    node.setProviderRetryState(null);
    node.transition("done");

    expect(node.status).toBe("done");
    expect(node.providerRetryState).toBeNull();
  });
});

// ============================================================================
// Integration: Execution Engine with provider retry
// ============================================================================

describe("WorkflowExecutionEngine provider retry integration", () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let WorkflowExecutionEngine: typeof import("../../src/workflow/execution-engine.js").WorkflowExecutionEngine;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let WorkflowManager: typeof import("../../src/workflow/workflow.js").WorkflowManager;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let CostTracker: typeof import("../../src/costs/tracker.js").CostTracker;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

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

    const engineMod = await import("../../src/workflow/execution-engine.js");
    WorkflowExecutionEngine = engineMod.WorkflowExecutionEngine;
    const wfMod = await import("../../src/workflow/workflow.js");
    WorkflowManager = wfMod.WorkflowManager;
    const costMod = await import("../../src/costs/tracker.js");
    CostTracker = costMod.CostTracker;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeWorkflow(nodeOverrides?: Record<string, unknown>) {
    const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      status: "running" as const,
      description: "Test",
      projectPath: "/tmp/test",
      graph: {
        nodes: {
          "node-1": {
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
            providerRetryState: null,
            ...nodeOverrides,
          },
        },
        edges: [],
        topology: "linear" as const,
      },
      config: {
        level: 3 as const,
        defaultDelay: "0",
        reviewerEnabled: true,
        maxRetriesPerNode: 3,
        maxRetriesPerTask: 2,
        maxLoomasPerLoomi: null,
        retryStrategy: "adaptive" as const,
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
        retryDelay: "0",
      },
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    };
  }

  it("retries on rate-limit error and succeeds on second attempt", async () => {
    let callCount = 0;
    const executor = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: rate-limit error
        const error = new Error("Anthropic API error (429): rate limit exceeded");
        Object.assign(error, { status: 429 });
        throw error;
      }
      // Second call: success
      return { status: "done", cost: 0.5 };
    });

    const manager = new WorkflowManager(makeWorkflow() as any);
    const costTracker = new CostTracker();
    const engine = new WorkflowExecutionEngine({
      manager,
      executor,
      costTracker,
    });

    // Start execution (will hit rate limit, then wait)
    const runPromise = engine.run();

    // Let the first call happen
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the 5-minute backoff
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    const result = await runPromise;

    expect(result.status).toBe("done");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.completedNodes).toContain("node-1");
  });

  it("transitions to failed_provider_exhausted after max attempts", async () => {
    // Always throw rate-limit error
    const executor = vi.fn().mockImplementation(async () => {
      const error = new Error("Rate limit exceeded");
      Object.assign(error, { status: 429 });
      throw error;
    });

    const manager = new WorkflowManager(makeWorkflow() as any);
    const costTracker = new CostTracker();
    const engine = new WorkflowExecutionEngine({
      manager,
      executor,
      costTracker,
    });

    const runPromise = engine.run();

    // The recursive handleProviderRateLimit needs timer advances between each
    // retry attempt. Each iteration: executor runs (microtask) + sleep (timer).
    // We advance generously to ensure all 10 attempts are exhausted.
    const totalBackoffMs = PROVIDER_BACKOFF_SCHEDULE_MS.reduce((sum, ms) => sum + ms, 0);

    // Advance in a single large jump — the recursive handler awaits each sleep
    // sequentially, so each timer fires in order as we advance.
    // We need to advance multiple times because each timer callback creates
    // the next timer only after the current sleep resolves.
    for (let i = 0; i < MAX_PROVIDER_RETRY_ATTEMPTS + 2; i++) {
      await vi.advanceTimersByTimeAsync(totalBackoffMs);
    }

    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(result.failedNodes).toContain("node-1");

    // Check the node is in failed_provider_exhausted state
    const node = manager.getNode("node-1");
    expect(node?.status).toBe("failed_provider_exhausted");
  });

  it("does NOT trigger provider retry on non-rate-limit errors", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("Invalid API key"));

    const manager = new WorkflowManager(makeWorkflow() as any);
    const costTracker = new CostTracker();
    const engine = new WorkflowExecutionEngine({
      manager,
      executor,
      costTracker,
    });

    const result = await engine.run();

    expect(result.status).toBe("failed");
    expect(executor).toHaveBeenCalledTimes(1);
    // Node should be in regular 'failed' state, not 'failed_provider_exhausted'
    const node = manager.getNode("node-1");
    expect(node?.status).toBe("failed");
  });

  it("cancels provider retry sleep on engine stop", async () => {
    let callCount = 0;
    const executor = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const error = new Error("Rate limited");
        Object.assign(error, { status: 429 });
        throw error;
      }
      return { status: "done", cost: 0 };
    });

    const manager = new WorkflowManager(makeWorkflow() as any);
    const costTracker = new CostTracker();
    const engine = new WorkflowExecutionEngine({
      manager,
      executor,
      costTracker,
    });

    const runPromise = engine.run();

    // Let the first call fail with rate limit
    await vi.advanceTimersByTimeAsync(0);

    // Stop the engine while waiting
    engine.stop();

    // Resolve any pending promises
    await vi.advanceTimersByTimeAsync(0);

    const result = await runPromise;

    expect(result.status).toBe("paused");
    // Second call should NOT happen because we stopped
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("uses Retry-After header value instead of backoff schedule", async () => {
    let callCount = 0;
    const executor = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        const error = new Error("Rate limited");
        Object.assign(error, {
          status: 429,
          headers: { "retry-after": "30" }, // 30 seconds
        });
        throw error;
      }
      return { status: "done", cost: 0.1 };
    });

    const manager = new WorkflowManager(makeWorkflow() as any);
    const costTracker = new CostTracker();
    const engine = new WorkflowExecutionEngine({
      manager,
      executor,
      costTracker,
    });

    const runPromise = engine.run();

    // Let the first call fail
    await vi.advanceTimersByTimeAsync(0);

    // Advance by 30 seconds (Retry-After value), not 5 minutes (backoff schedule)
    await vi.advanceTimersByTimeAsync(30_000 + 100);

    const result = await runPromise;

    expect(result.status).toBe("done");
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("handles non-rate-limit error on retry (falls through to normal failure)", async () => {
    let callCount = 0;
    const executor = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First: rate limit
        const error = new Error("Rate limited");
        Object.assign(error, { status: 429 });
        throw error;
      }
      // Second: different error (not rate limit)
      throw new Error("Authentication failed");
    });

    const manager = new WorkflowManager(makeWorkflow() as any);
    const costTracker = new CostTracker();
    const engine = new WorkflowExecutionEngine({
      manager,
      executor,
      costTracker,
    });

    const runPromise = engine.run();

    // Let the first call fail with rate limit
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the backoff
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    const result = await runPromise;

    expect(result.status).toBe("failed");
    expect(executor).toHaveBeenCalledTimes(2);
    // Node should be regular failed, not provider_exhausted
    const node = manager.getNode("node-1");
    expect(node?.status).toBe("failed");
  });
});
