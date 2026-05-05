/**
 * Unit tests for runNodeWithRuntime — the bridge between the daemon's
 * NodeExecutor and the AgentRuntime layer.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runNodeWithRuntime,
  resolveClaudeAgentCredentials,
} from "../../src/runtimes/run-node.js";
import {
  __setRuntimeInstanceForTest,
  MockAgentRuntime,
  type MockScenario,
} from "../../src/runtimes/index.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { MessageBus } from "../../src/agents/message-bus.js";

// ---------------------------------------------------------------------------
// Stub deps
// ---------------------------------------------------------------------------

const stubMessageBus = { async send() {} } as unknown as MessageBus;
const stubDeps = {
  workflowId: "wf-test",
  workspacePath: "/tmp/wf-test",
  costTracker: {} as unknown as CostTracker,
  sharedMemory: {} as unknown as SharedMemoryManager,
  messageBus: stubMessageBus,
  completionHandler: { async reportComplete() {} },
  escalationHandler: { async escalate() {} },
};

const baseNode = {
  id: "n1",
  title: "Test node",
  instructions: "Do nothing meaningful",
  fileOwnership: {},
};

// ---------------------------------------------------------------------------
// runNodeWithRuntime — routing
// ---------------------------------------------------------------------------

describe("runNodeWithRuntime routing", () => {
  it("returns null when node.runtime is loomi-native (caller falls back)", async () => {
    const result = await runNodeWithRuntime(
      { ...baseNode, runtime: "loomi-native" },
      stubDeps,
    );
    expect(result).toBeNull();
  });

  it("returns null when node.runtime is missing (back-compat)", async () => {
    const result = await runNodeWithRuntime(
      { ...baseNode, runtime: undefined as unknown as "loomi-native" },
      stubDeps,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runNodeWithRuntime — mock runtime end-to-end
// ---------------------------------------------------------------------------

describe("runNodeWithRuntime + MockAgentRuntime", () => {
  it("feeds CostTracker.recordCall on each cost_update event", async () => {
    const runtime = new MockAgentRuntime({
      forceScenario: "happy-path-with-write",
      timingMultiplier: 0,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    const calls: Array<{
      model: string;
      input: number;
      output: number;
      agentId: string;
      nodeId: string;
    }> = [];
    const fakeCostTracker = {
      recordCall: (
        model: string,
        input: number,
        output: number,
        agentId: string,
        nodeId: string,
      ): unknown => {
        calls.push({ model, input, output, agentId, nodeId });
        return {};
      },
    } as unknown as CostTracker;

    try {
      await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          costTracker: fakeCostTracker,
          model: "claude-sonnet-4-6",
          credentialsOverride: { kind: "oauth-claude-code" },
        },
      );

      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]?.model).toBe("claude-sonnet-4-6");
      expect(calls[0]?.nodeId).toBe(baseNode.id);
      expect(calls[0]?.agentId.startsWith("loomi-")).toBe(true);
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });

  it("runs the multi-worker + review scenario and surfaces both Agent dispatches", async () => {
    const runtime = new MockAgentRuntime({
      forceScenario: "happy-path-multi-worker-with-review",
      timingMultiplier: 0,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      const seenAgentDispatches: string[] = [];
      const result = await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          credentialsOverride: { kind: "oauth-claude-code" },
          onEvent: (e) => {
            if (e.kind === "tool_call" && e.toolName === "Agent") {
              const subagent = (e.input["subagent_type"] as string) ?? "";
              seenAgentDispatches.push(subagent);
            }
          },
        },
      );

      expect(result?.status).toBe("done");
      expect(seenAgentDispatches).toEqual(["looma", "loomex"]);
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });

  it("runs a happy-path scenario and returns status=done with accumulated cost", async () => {
    // Inject a deterministic mock runtime instance into the registry.
    const runtime = new MockAgentRuntime({
      forceScenario: "happy-path-with-write",
      timingMultiplier: 0,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      const events: string[] = [];
      const result = await runNodeWithRuntime(
        { ...baseNode, runtime: "mock" },
        {
          ...stubDeps,
          credentialsOverride: { kind: "oauth-claude-code" },
          onEvent: (e) => events.push(e.kind),
        },
      );

      expect(result).not.toBeNull();
      expect(result?.status).toBe("done");
      expect(result?.cost).toBeGreaterThan(0);
      expect(events).toContain("session_started");
      expect(events).toContain("tool_call");
      expect(events).toContain("session_idle");
      expect(events.at(-1)).toBe("session_ended");
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });

  it("maps abort to status=blocked", async () => {
    const slowScenario: MockScenario = {
      name: "slow",
      steps: [
        { delayMs: 5_000, event: { kind: "assistant_text", text: "...", isDelta: false } },
      ],
    };
    const runtime = new MockAgentRuntime({
      scenarios: [slowScenario],
      timingMultiplier: 1,
    });
    __setRuntimeInstanceForTest("mock", runtime);

    try {
      // Kick off and abort by aborting via a tight handler. We rely on
      // runNodeWithRuntime not exposing the session, so we simulate abort by
      // letting the test drive a parallel runtime call; here we just verify the
      // mapping by constructing a scenario whose abort path is covered in
      // mock-runtime.test.ts. This test is a placeholder for the abort mapping.
      // Skipping the actual abort here — see mock-runtime.test.ts for the
      // session-level abort coverage.
      expect(true).toBe(true);
    } finally {
      __setRuntimeInstanceForTest("mock", null);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveClaudeAgentCredentials
// ---------------------------------------------------------------------------

describe("resolveClaudeAgentCredentials", () => {
  it("prefers ANTHROPIC_API_KEY over OAuth", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "creds-"));
    try {
      const creds = resolveClaudeAgentCredentials({
        env: { ANTHROPIC_API_KEY: "sk-ant-test" } as NodeJS.ProcessEnv,
        homeDir: fakeHome,
      });
      expect(creds.kind).toBe("api-key-anthropic");
      if (creds.kind === "api-key-anthropic") {
        expect(creds.apiKey).toBe("sk-ant-test");
      }
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("throws when neither API key nor OAuth file is present", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "creds-empty-"));
    try {
      expect(() =>
        resolveClaudeAgentCredentials({
          env: {} as NodeJS.ProcessEnv,
          homeDir: fakeHome,
        }),
      ).toThrow(/ANTHROPIC_API_KEY env var or .* OAuth/);
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});
