/**
 * Tests for per-session budget enforcement (Phase 6.1).
 */

import { describe, it, expect } from "vitest";
import { runNodeWithRuntime } from "../../src/runtimes/run-node.js";
import {
  __setRuntimeInstanceForTest,
  MockAgentRuntime,
  type MockScenario,
} from "../../src/runtimes/index.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { MessageBus } from "../../src/agents/message-bus.js";

const stubDeps = {
  workflowId: "wf-test",
  workspacePath: "/tmp/wf-test",
  costTracker: { recordCall: () => ({}) } as unknown as CostTracker,
  sharedMemory: {} as unknown as SharedMemoryManager,
  messageBus: { async send() {} } as unknown as MessageBus,
  completionHandler: { async reportComplete() {} },
  escalationHandler: { async escalate() {} },
};

const baseNode = {
  id: "n1",
  title: "test",
  instructions: "do nothing",
  fileOwnership: {},
};

// Scenario that emits two cost_updates totalling $0.05 then a third pushing
// it to $0.12. Useful for budget = $0.10 cases.
const multiCostScenario: MockScenario = {
  name: "multi-cost",
  steps: [
    { delayMs: 0, event: { kind: "assistant_text", text: "step 1", isDelta: false } },
    {
      delayMs: 0,
      event: { kind: "cost_update", inputTokens: 100, outputTokens: 50, usd: 0.02 },
    },
    { delayMs: 0, event: { kind: "assistant_text", text: "step 2", isDelta: false } },
    {
      delayMs: 0,
      event: { kind: "cost_update", inputTokens: 200, outputTokens: 100, usd: 0.03 },
    },
    { delayMs: 0, event: { kind: "assistant_text", text: "step 3", isDelta: false } },
    {
      delayMs: 0,
      event: { kind: "cost_update", inputTokens: 300, outputTokens: 200, usd: 0.07 },
    },
    { delayMs: 0, event: { kind: "assistant_text", text: "step 4 (after budget)", isDelta: false } },
    { delayMs: 0, event: { kind: "session_idle" } },
  ],
};

describe("Per-session budget enforcement (deps.maxCostUsd)", () => {
  it("aborts when cumulative cost crosses the budget", async () => {
    const runtime = new MockAgentRuntime({
      scenarios: [multiCostScenario],
      timingMultiplier: 0,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      const result = await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          credentialsOverride: { kind: "oauth-claude-code" },
          maxCostUsd: 0.04, // First cost_update ($0.02) is fine; sum reaches $0.05 on the 2nd, which crosses.
        },
      );

      expect(result?.status).toBe("blocked");
      expect(result?.error ?? "").toMatch(/budget exceeded/i);
      expect(result?.cost).toBeGreaterThanOrEqual(0.05);
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });

  it("does not abort when budget is generous", async () => {
    const runtime = new MockAgentRuntime({
      scenarios: [multiCostScenario],
      timingMultiplier: 0,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      const result = await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          credentialsOverride: { kind: "oauth-claude-code" },
          maxCostUsd: 1.0,
        },
      );

      expect(result?.status).toBe("done");
      expect(result?.error).toBeUndefined();
      expect(result?.cost).toBeCloseTo(0.12, 5);
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });

  it("does not enforce when maxCostUsd is undefined (default behavior)", async () => {
    const runtime = new MockAgentRuntime({
      scenarios: [multiCostScenario],
      timingMultiplier: 0,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      const result = await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          credentialsOverride: { kind: "oauth-claude-code" },
          // maxCostUsd: undefined
        },
      );

      expect(result?.status).toBe("done");
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });

  it("aborts only once even when multiple cost_updates would still trigger", async () => {
    let abortCalls = 0;
    const runtime = new MockAgentRuntime({
      scenarios: [multiCostScenario],
      timingMultiplier: 0,
    });
    // Wrap startSession to count abort() calls.
    const origStart = runtime.startSession.bind(runtime);
    runtime.startSession = async (cfg) => {
      const session = await origStart(cfg);
      const origAbort = session.abort.bind(session);
      session.abort = async () => {
        abortCalls += 1;
        return origAbort();
      };
      return session;
    };
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          credentialsOverride: { kind: "oauth-claude-code" },
          maxCostUsd: 0.01, // Triggers on the first cost_update ($0.02)
        },
      );

      // 1 from budget enforcement + at most 1 from dispose() if the session
      // hadn't completed cleanly. The point is: budget logic must not call
      // abort() once per subsequent cost_update event.
      expect(abortCalls).toBeLessThanOrEqual(2);
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });
});
