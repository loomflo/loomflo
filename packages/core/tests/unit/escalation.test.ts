import { describe, it, expect, beforeEach, vi } from "vitest";
import { EscalationManager } from "../../src/agents/escalation.js";
import type {
  EscalationManagerConfig,
  GraphModification,
  GraphModifierLike,
} from "../../src/agents/escalation.js";
import type { EscalationRequest } from "../../src/tools/escalate.js";
import type { LLMProvider } from "../../src/providers/base.js";
import type { LLMResponse } from "../../src/types.js";
import { CostTracker } from "../../src/costs/tracker.js";

// ===========================================================================
// Mock Helpers
// ===========================================================================

/** Create a mock LLM response with the given JSON text content. */
function makeLLMResponse(text: string, inputTokens = 100, outputTokens = 50): LLMResponse {
  return {
    content: [{ type: "text" as const, text }],
    stopReason: "end_turn" as const,
    usage: { inputTokens, outputTokens },
    model: "claude-opus-4-6",
  };
}

/** Create a mock LLMProvider that returns the given response. */
function makeMockProvider(response: LLMResponse): LLMProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
  };
}

/** Create a mock GraphModifierLike. */
function makeMockGraphModifier(): GraphModifierLike & { calls: GraphModification[] } {
  const calls: GraphModification[] = [];
  return {
    calls,
    applyModification: vi.fn(async (mod: GraphModification) => {
      calls.push(mod);
    }),
  };
}

/** Create a mock SharedMemoryManager. */
function makeMockSharedMemory(): {
  write: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
} {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi
      .fn()
      .mockResolvedValue({
        content: "",
        name: "",
        path: "",
        lastModifiedBy: "system",
        lastModifiedAt: new Date().toISOString(),
      }),
  };
}

/** Standard escalation request for testing. */
function makeEscalationRequest(overrides?: Partial<EscalationRequest>): EscalationRequest {
  return {
    reason: "Node exhausted all retries",
    nodeId: "node-auth",
    agentId: "loomi-node-auth",
    suggestedAction: "modify_node",
    details: "Workers failed to implement auth middleware correctly after 3 attempts",
    ...overrides,
  };
}

/** Build a full EscalationManagerConfig with mocks. */
function makeConfig(
  overrides?: Partial<{
    provider: LLMProvider;
    graphModifier: GraphModifierLike;
    sharedMemory: ReturnType<typeof makeMockSharedMemory>;
    costTracker: CostTracker;
  }>,
): EscalationManagerConfig & {
  provider: LLMProvider;
  graphModifier: GraphModifierLike & { calls: GraphModification[] };
  sharedMemory: ReturnType<typeof makeMockSharedMemory>;
  costTracker: CostTracker;
} {
  const graphModifier = (overrides?.graphModifier ??
    makeMockGraphModifier()) as GraphModifierLike & { calls: GraphModification[] };
  const sharedMemory = overrides?.sharedMemory ?? makeMockSharedMemory();
  const costTracker = overrides?.costTracker ?? new CostTracker();
  const provider =
    overrides?.provider ??
    makeMockProvider(
      makeLLMResponse(
        JSON.stringify({
          action: "modify_node",
          nodeId: "node-auth",
          modifiedInstructions: "Updated auth instructions",
          reason: "Simplifying the auth requirements",
        }),
      ),
    );

  return {
    provider,
    model: "claude-opus-4-6",
    workspacePath: "/tmp/test-workspace",
    sharedMemory: sharedMemory as unknown as EscalationManagerConfig["sharedMemory"],
    costTracker,
    eventLog: { workflowId: "wf-test-123" },
    graphModifier,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("EscalationManager", () => {
  let config: ReturnType<typeof makeConfig>;
  let manager: EscalationManager;

  beforeEach(() => {
    config = makeConfig();
    manager = new EscalationManager(config);
  });

  describe("escalate()", () => {
    it("calls the LLM provider with the escalation details", async () => {
      const request = makeEscalationRequest();
      await manager.escalate(request);

      expect(config.provider.complete).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(config.provider.complete).mock.calls[0]![0]!;
      expect(callArgs.model).toBe("claude-opus-4-6");
      expect(callArgs.system).toContain("Loom");
      expect(callArgs.system).toContain("escalation");
      expect(callArgs.messages[0]!.content).toContain("node-auth");
      expect(callArgs.messages[0]!.content).toContain("loomi-node-auth");
    });

    it("applies the graph modification from the LLM response", async () => {
      const request = makeEscalationRequest();
      await manager.escalate(request);

      expect(config.graphModifier.calls).toHaveLength(1);
      expect(config.graphModifier.calls[0]!.action).toBe("modify_node");
      expect(config.graphModifier.calls[0]!.nodeId).toBe("node-auth");
      expect(config.graphModifier.calls[0]!.modifiedInstructions).toBe("Updated auth instructions");
    });

    it("records cost via the cost tracker", async () => {
      const request = makeEscalationRequest();
      await manager.escalate(request);

      const summary = config.costTracker.getSummary();
      expect(summary.entries).toHaveLength(1);
      expect(summary.entries[0]!.agentId).toBe("loom-escalation");
      expect(summary.entries[0]!.nodeId).toBe("node-auth");
      expect(summary.entries[0]!.model).toBe("claude-opus-4-6");
    });

    it("writes to ARCHITECTURE_CHANGES.md shared memory", async () => {
      const request = makeEscalationRequest();
      await manager.escalate(request);

      expect(config.sharedMemory.write).toHaveBeenCalled();
      const writeCall = config.sharedMemory.write.mock.calls.find(
        (c: unknown[]) => c[0] === "ARCHITECTURE_CHANGES.md",
      );
      expect(writeCall).toBeDefined();
      const content = writeCall![1] as string;
      expect(content).toContain("modify_node");
      expect(content).toContain("node-auth");
      expect(content).toContain("loomi-node-auth");
    });

    it("includes suggested action in the user message when present", async () => {
      const request = makeEscalationRequest({ suggestedAction: "skip_node" });
      await manager.escalate(request);

      const callArgs = vi.mocked(config.provider.complete).mock.calls[0]![0]!;
      const userContent = callArgs.messages[0]!.content as string;
      expect(userContent).toContain("skip_node");
    });

    it("includes details in the user message when present", async () => {
      const request = makeEscalationRequest({ details: "Missing database dependency" });
      await manager.escalate(request);

      const callArgs = vi.mocked(config.provider.complete).mock.calls[0]![0]!;
      const userContent = callArgs.messages[0]!.content as string;
      expect(userContent).toContain("Missing database dependency");
    });
  });

  describe("no_action response", () => {
    it("does not call graphModifier when LLM returns no_action", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          JSON.stringify({
            action: "no_action",
            reason: "Transient issue, will resolve on its own",
          }),
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.graphModifier.calls).toHaveLength(0);
    });

    it("still writes to ARCHITECTURE_CHANGES.md for no_action", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          JSON.stringify({
            action: "no_action",
            reason: "Transient issue",
          }),
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.sharedMemory.write).toHaveBeenCalled();
    });
  });

  describe("add_node response", () => {
    it("applies add_node modification correctly", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          JSON.stringify({
            action: "add_node",
            newNode: {
              title: "Install DB Dependencies",
              instructions: "Install and configure the database driver",
              insertBefore: "node-auth",
            },
            reason: "Auth node needs DB to be configured first",
          }),
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.graphModifier.calls).toHaveLength(1);
      expect(cfg.graphModifier.calls[0]!.action).toBe("add_node");
      expect(cfg.graphModifier.calls[0]!.newNode!.title).toBe("Install DB Dependencies");
      expect(cfg.graphModifier.calls[0]!.newNode!.insertBefore).toBe("node-auth");
    });

    it("includes new node info in ARCHITECTURE_CHANGES.md", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          JSON.stringify({
            action: "add_node",
            newNode: {
              title: "Setup DB",
              instructions: "Configure database connection",
              insertAfter: "node-init",
            },
            reason: "Need DB before auth",
          }),
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      const writeCall = cfg.sharedMemory.write.mock.calls.find(
        (c: unknown[]) => c[0] === "ARCHITECTURE_CHANGES.md",
      );
      const content = writeCall![1] as string;
      expect(content).toContain("Setup DB");
      expect(content).toContain("Insert after");
      expect(content).toContain("node-init");
    });
  });

  describe("skip_node response", () => {
    it("applies skip_node with the target nodeId", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          JSON.stringify({
            action: "skip_node",
            nodeId: "node-auth",
            reason: "Auth is not critical for the MVP",
          }),
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.graphModifier.calls).toHaveLength(1);
      expect(cfg.graphModifier.calls[0]!.action).toBe("skip_node");
      expect(cfg.graphModifier.calls[0]!.nodeId).toBe("node-auth");
    });
  });

  describe("remove_node response", () => {
    it("applies remove_node with the target nodeId", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          JSON.stringify({
            action: "remove_node",
            nodeId: "node-auth",
            reason: "Auth is handled by an external service",
          }),
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.graphModifier.calls).toHaveLength(1);
      expect(cfg.graphModifier.calls[0]!.action).toBe("remove_node");
      expect(cfg.graphModifier.calls[0]!.nodeId).toBe("node-auth");
    });
  });

  describe("error handling", () => {
    it("does not throw when LLM returns empty response", async () => {
      const provider = makeMockProvider({
        content: [],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 0 },
        model: "claude-opus-4-6",
      });
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await expect(mgr.escalate(makeEscalationRequest())).resolves.toBeUndefined();
    });

    it("does not throw when LLM returns unparseable JSON", async () => {
      const provider = makeMockProvider(makeLLMResponse("This is not JSON at all!"));
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await expect(mgr.escalate(makeEscalationRequest())).resolves.toBeUndefined();
    });

    it("does not throw when LLM call itself throws", async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error("API rate limit")),
      };
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await expect(mgr.escalate(makeEscalationRequest())).resolves.toBeUndefined();
    });

    it("does not throw when graphModifier throws", async () => {
      const graphModifier: GraphModifierLike & { calls: GraphModification[] } = {
        calls: [],
        applyModification: vi.fn().mockRejectedValue(new Error("Graph cycle detected")),
      };
      const cfg = makeConfig({ graphModifier });
      const mgr = new EscalationManager(cfg);

      await expect(mgr.escalate(makeEscalationRequest())).resolves.toBeUndefined();
    });

    it("does not throw when shared memory write fails", async () => {
      const sharedMemory = makeMockSharedMemory();
      sharedMemory.write.mockRejectedValue(new Error("Disk full"));
      const cfg = makeConfig({ sharedMemory });
      const mgr = new EscalationManager(cfg);

      await expect(mgr.escalate(makeEscalationRequest())).resolves.toBeUndefined();
    });

    it("handles LLM response with markdown-fenced JSON", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          'Here is my decision:\n```json\n{"action":"skip_node","nodeId":"node-auth","reason":"Cannot resolve"}\n```',
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.graphModifier.calls).toHaveLength(1);
      expect(cfg.graphModifier.calls[0]!.action).toBe("skip_node");
    });

    it("handles LLM response with JSON wrapped in text", async () => {
      const provider = makeMockProvider(
        makeLLMResponse(
          'I think the best approach is {"action":"remove_node","nodeId":"node-auth","reason":"Redundant"} given the situation.',
        ),
      );
      const cfg = makeConfig({ provider });
      const mgr = new EscalationManager(cfg);

      await mgr.escalate(makeEscalationRequest());

      expect(cfg.graphModifier.calls).toHaveLength(1);
      expect(cfg.graphModifier.calls[0]!.action).toBe("remove_node");
    });
  });

  describe("escalation without optional fields", () => {
    it("handles request with no suggestedAction or details", async () => {
      const request = makeEscalationRequest({
        suggestedAction: undefined,
        details: undefined,
      });

      await manager.escalate(request);

      expect(config.provider.complete).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(config.provider.complete).mock.calls[0]![0]!;
      const userContent = callArgs.messages[0]!.content as string;
      expect(userContent).not.toContain("Suggested Action");
      expect(userContent).not.toContain("Additional Context");
    });
  });
});
