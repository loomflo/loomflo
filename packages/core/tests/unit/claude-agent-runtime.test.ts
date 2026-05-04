/**
 * Unit tests for ClaudeAgentRuntime — pure-function coverage.
 *
 * Does NOT spawn a real `query()` (would cost API credits and require auth).
 * Tests the option builders, agent definition selection, and runtime metadata.
 */

import { describe, it, expect } from "vitest";
import {
  ClaudeAgentRuntime,
  buildAgentDefinitionForRole,
  buildSdkAuthEnv,
  buildSdkOptions,
} from "../../src/runtimes/claude-agent.js";
import type { ResolvedCredentials, SessionConfig } from "../../src/runtimes/base.js";
import type { MessageBusLike } from "../../src/tools/send-message.js";
import type { CompletionHandlerLike } from "../../src/tools/report-complete.js";
import type { EscalationHandlerLike } from "../../src/tools/escalate.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubMessageBus: MessageBusLike = {
  async send(): Promise<void> {
    /* noop */
  },
};
const stubCompletionHandler: CompletionHandlerLike = {
  async reportComplete(): Promise<void> {
    /* noop */
  },
};
const stubEscalationHandler: EscalationHandlerLike = {
  async escalate(): Promise<void> {
    /* noop */
  },
};

const stubContext = {
  workflow: { id: "wf-1", projectPath: "/tmp/test" },
  nodeId: "node-1",
  agentId: "agent-1",
  costTracker: {} as unknown as CostTracker,
  sharedMemory: {} as unknown as SharedMemoryManager,
  messageBus: stubMessageBus,
  completionHandler: stubCompletionHandler,
  escalationHandler: stubEscalationHandler,
};

function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    workspacePath: "/tmp/test",
    agentRole: "looma",
    model: "claude-sonnet-4-6",
    mcpServers: [],
    fileScope: ["src/**"],
    credentials: { kind: "oauth-claude-code" },
    initialPrompt: "Hello",
    context: stubContext,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAgentDefinitionForRole
// ---------------------------------------------------------------------------

describe("buildAgentDefinitionForRole", () => {
  it("returns the loom factory output for role=loom", () => {
    const def = buildAgentDefinitionForRole(makeConfig({ agentRole: "loom" }));
    expect(def.role).toBe("loom");
    expect(def.defaultModel).toBe("claude-opus-4-5");
    expect(def.allowedTools.some((t) => t.includes("read_file"))).toBe(true);
    expect(def.allowedTools.some((t) => t.includes("write_file"))).toBe(false);
  });

  it("returns the loomi factory output for role=loomi", () => {
    const def = buildAgentDefinitionForRole(makeConfig({ agentRole: "loomi" }));
    expect(def.role).toBe("loomi");
    expect(def.allowedTools).toContain("Agent");
    expect(def.allowedTools.some((t) => t.includes("escalate"))).toBe(true);
  });

  it("returns the looma factory output for role=looma", () => {
    const def = buildAgentDefinitionForRole(makeConfig({ agentRole: "looma" }));
    expect(def.role).toBe("looma");
    expect(def.allowedTools.some((t) => t.includes("write_file"))).toBe(true);
    expect(def.allowedTools.some((t) => t.includes("exec_command"))).toBe(true);
  });

  it("returns the loomex factory output for role=loomex", () => {
    const def = buildAgentDefinitionForRole(makeConfig({ agentRole: "loomex" }));
    expect(def.role).toBe("loomex");
    expect(def.allowedTools.some((t) => t.includes("write_file"))).toBe(false);
    expect(def.allowedTools.some((t) => t.includes("write_memory"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSdkAuthEnv
// ---------------------------------------------------------------------------

describe("buildSdkAuthEnv", () => {
  it("returns empty env for oauth-claude-code (SDK auto-pickup)", () => {
    const env = buildSdkAuthEnv({ kind: "oauth-claude-code" });
    expect(env).toEqual({});
  });

  it("sets ANTHROPIC_API_KEY for api-key-anthropic", () => {
    const env = buildSdkAuthEnv({ kind: "api-key-anthropic", apiKey: "sk-ant-test" });
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-test" });
  });

  it("throws for credentials kinds owned by CopilotRuntime", () => {
    const cases: ResolvedCredentials[] = [
      { kind: "api-key-openai", apiKey: "sk-test" },
      { kind: "oauth-copilot" },
      { kind: "api-key-copilot-byok", provider: "anthropic", apiKey: "sk-ant" },
    ];
    for (const creds of cases) {
      expect(() => buildSdkAuthEnv(creds)).toThrow(/ClaudeAgentRuntime does not support/);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSdkOptions
// ---------------------------------------------------------------------------

describe("buildSdkOptions", () => {
  it("disables built-in tools and allows the role's MCP tools", () => {
    const { options } = buildSdkOptions(makeConfig({ agentRole: "loomi" }));
    expect(options.tools).toEqual([]);
    expect(options.allowedTools).toEqual(expect.arrayContaining(["Agent"]));
    expect(options.allowedTools?.some((t) => t.includes("send_message"))).toBe(true);
  });

  it("registers the loomflo MCP server under the 'loomflo' name", () => {
    const { options } = buildSdkOptions(makeConfig());
    expect(options.mcpServers).toBeDefined();
    expect(Object.keys(options.mcpServers ?? {})).toContain("loomflo");
  });

  it("merges user-provided in-memory MCP servers alongside loomflo", () => {
    const fakeUserServer = { type: "sdk", name: "user-tools", instance: {} } as never;
    const { options } = buildSdkOptions(
      makeConfig({
        mcpServers: [{ kind: "inMemory", name: "user-tools", instance: fakeUserServer }],
      }),
    );
    const keys = Object.keys(options.mcpServers ?? {});
    expect(keys).toContain("loomflo");
    expect(keys).toContain("user-tools");
  });

  it("sets the 'agent' field to the requested role", () => {
    const { options } = buildSdkOptions(makeConfig({ agentRole: "looma" }));
    expect(options.agent).toBe("looma");
  });

  it("uses the AgentDefinition default model when config.model is empty", () => {
    const { options } = buildSdkOptions(makeConfig({ agentRole: "loom", model: "" }));
    const agents = options.agents ?? {};
    const loomDef = agents["loom"] as { model?: string };
    expect(loomDef.model).toBe("claude-opus-4-5");
  });

  it("respects systemPromptOverride when provided", () => {
    const { options } = buildSdkOptions(
      makeConfig({ agentRole: "loomi", systemPromptOverride: "CUSTOM PROMPT" }),
    );
    const agents = options.agents ?? {};
    const loomiDef = agents["loomi"] as { prompt?: string };
    expect(loomiDef.prompt).toBe("CUSTOM PROMPT");
  });

  it("propagates resumeSessionId as the SDK 'resume' option", () => {
    const { options } = buildSdkOptions(makeConfig({ resumeSessionId: "sess-123" }));
    expect(options.resume).toBe("sess-123");
  });

  it("does NOT include 'resume' when no resumeSessionId is provided", () => {
    const { options } = buildSdkOptions(makeConfig());
    expect(options.resume).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ClaudeAgentRuntime
// ---------------------------------------------------------------------------

describe("ClaudeAgentRuntime", () => {
  it("advertises the expected name and capabilities", () => {
    const r = new ClaudeAgentRuntime();
    expect(r.name).toBe("claude-agent");
    expect(r.capabilities.supportsMcp).toBe(true);
    expect(r.capabilities.supportsCanUseTool).toBe(true);
    expect(r.capabilities.supportsStreaming).toBe(true);
    expect(r.capabilities.supportsSubagents).toBe(true);
  });

  it("listAvailableModels returns the baseline catalog", async () => {
    const r = new ClaudeAgentRuntime();
    const models = await r.listAvailableModels({ kind: "oauth-claude-code" });
    expect(models.length).toBeGreaterThanOrEqual(3);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("claude-opus-4-5");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-haiku-4-5");
  });
});
