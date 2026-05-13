/**
 * Unit tests for MockAgentRuntime.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_MOCK_SCENARIOS,
  MockAgentRuntime,
  type MockScenario,
} from "../../src/runtimes/mock.js";
import type { SessionConfig, SessionEvent } from "../../src/runtimes/base.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";

const stubContext = {
  workflow: { id: "wf-1", projectPath: "/tmp/test" },
  nodeId: "node-1",
  agentId: "agent-1",
  costTracker: {} as unknown as CostTracker,
  sharedMemory: {} as unknown as SharedMemoryManager,
  messageBus: { async send() {} },
  completionHandler: { async reportComplete() {} },
  escalationHandler: { async escalate() {} },
};

function makeConfig(): SessionConfig {
  return {
    workspacePath: "/tmp/test",
    agentRole: "looma",
    model: "mock-fast",
    mcpServers: [],
    credentials: { kind: "oauth-claude-code" },
    initialPrompt: "Hello",
    context: stubContext,
  };
}

// ---------------------------------------------------------------------------
// Construction & metadata
// ---------------------------------------------------------------------------

describe("MockAgentRuntime construction", () => {
  it("exposes the expected runtime name and capabilities", () => {
    const r = new MockAgentRuntime();
    expect(r.name).toBe("mock");
    expect(r.capabilities.supportsMcp).toBe(true);
    expect(r.capabilities.supportsByokProvider).toBe(true);
  });

  it("throws if instantiated with an empty scenario pool", () => {
    expect(() => new MockAgentRuntime({ scenarios: [] })).toThrow(
      /requires at least one scenario/,
    );
  });

  it("listAvailableModels returns the mock catalog", async () => {
    const r = new MockAgentRuntime();
    const models = await r.listAvailableModels({ kind: "oauth-claude-code" });
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.provider).toBe("mock");
  });
});

// ---------------------------------------------------------------------------
// Scenario selection
// ---------------------------------------------------------------------------

describe("MockAgentRuntime.pickScenario", () => {
  it("seed yields deterministic picks", () => {
    const r1 = new MockAgentRuntime({ seed: 42 });
    const r2 = new MockAgentRuntime({ seed: 42 });
    expect(r1.pickScenario().name).toBe(r2.pickScenario().name);
  });

  it("forceScenario locks the picker to a named scenario", () => {
    const r = new MockAgentRuntime({ forceScenario: "happy-path-with-write" });
    expect(r.pickScenario().name).toBe("happy-path-with-write");
    expect(r.pickScenario().name).toBe("happy-path-with-write");
  });

  it("throws if forceScenario doesn't match any scenario", () => {
    const r = new MockAgentRuntime({ forceScenario: "does-not-exist" });
    expect(() => r.pickScenario()).toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Session replay
// ---------------------------------------------------------------------------

describe("MockAgentRuntime session replay", () => {
  it("replays the scripted events in order with no real delay (timingMultiplier=0)", async () => {
    const r = new MockAgentRuntime({
      forceScenario: "happy-path-text-only",
      timingMultiplier: 0,
    });
    const session = await r.startSession(makeConfig());
    const events: SessionEvent[] = [];
    session.on((e) => events.push(e));

    // Wait for session_ended.
    await new Promise<void>((resolve) => {
      session.on((e) => {
        if (e.kind === "session_ended") resolve();
      });
    });
    await session.dispose();

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("session_started");
    expect(kinds.at(-1)).toBe("session_ended");
    expect(kinds).toContain("assistant_text");
    expect(kinds).toContain("cost_update");
    expect(kinds).toContain("session_idle");
  });

  it("aggregates cost updates from the cost_update event", async () => {
    const customScenario: MockScenario = {
      name: "two-cost-events",
      steps: [
        { delayMs: 0, event: { kind: "cost_update", inputTokens: 100, outputTokens: 50, usd: 0.01 } },
        { delayMs: 0, event: { kind: "cost_update", inputTokens: 200, outputTokens: 30, usd: 0.02 } },
        { delayMs: 0, event: { kind: "session_idle" } },
      ],
    };
    const r = new MockAgentRuntime({
      scenarios: [customScenario],
      timingMultiplier: 0,
    });
    const session = await r.startSession(makeConfig());
    await new Promise<void>((resolve) => {
      session.on((e) => {
        if (e.kind === "session_ended") resolve();
      });
    });

    const cost = session.getCostSoFar();
    expect(cost.inputTokens).toBe(300);
    expect(cost.outputTokens).toBe(80);
    expect(cost.usd).toBeCloseTo(0.03, 6);
    await session.dispose();
  });

  it("abort() emits session_ended with reason=aborted", async () => {
    const slowScenario: MockScenario = {
      name: "slow",
      steps: [
        { delayMs: 1_000, event: { kind: "assistant_text", text: "never reached", isDelta: false } },
      ],
    };
    const r = new MockAgentRuntime({ scenarios: [slowScenario], timingMultiplier: 1 });
    const session = await r.startSession(makeConfig());
    const events: SessionEvent[] = [];
    const done = new Promise<void>((resolve) => {
      session.on((e) => {
        events.push(e);
        if (e.kind === "session_ended") resolve();
      });
    });

    // Abort before the delay elapses.
    setTimeout(() => void session.abort(), 30);
    await done;

    const ended = events.find((e) => e.kind === "session_ended") as Extract<
      SessionEvent,
      { kind: "session_ended" }
    >;
    expect(ended.reason).toBe("aborted");
    await session.dispose();
  });
});

// ---------------------------------------------------------------------------
// Default scenarios sanity
// ---------------------------------------------------------------------------

describe("DEFAULT_MOCK_SCENARIOS", () => {
  it("ships at least 4 scenarios covering different shapes", () => {
    expect(DEFAULT_MOCK_SCENARIOS.length).toBeGreaterThanOrEqual(4);
    const names = DEFAULT_MOCK_SCENARIOS.map((s) => s.name);
    expect(names).toContain("happy-path-text-only");
    expect(names).toContain("happy-path-with-tool-call");
    expect(names).toContain("happy-path-with-write");
  });

  it("every scenario ends with session_idle (so cost summary is observable)", () => {
    for (const sc of DEFAULT_MOCK_SCENARIOS) {
      const lastKind = sc.steps.at(-1)?.event.kind;
      expect(lastKind).toBe("session_idle");
    }
  });
});
