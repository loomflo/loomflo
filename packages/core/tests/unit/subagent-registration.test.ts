/**
 * Tests for subagent registration in `buildSdkOptions`.
 *
 * Verifies that when the main role is loomi or loom, the SDK's `agents`
 * Options field is populated with looma + loomex skeletons so the built-in
 * Agent tool can dispatch to them.
 */

import { describe, it, expect } from "vitest";
import {
  buildSdkOptions,
  toSdkAgentDef,
} from "../../src/runtimes/claude-agent.js";
import {
  createLoomaSubagentDefinition,
  createLoomexSubagentDefinition,
} from "../../src/agents-config/index.js";
import type { SessionConfig } from "../../src/runtimes/base.js";
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

function makeConfig(role: SessionConfig["agentRole"]): SessionConfig {
  return {
    workspacePath: "/tmp/test",
    agentRole: role,
    model: "claude-sonnet-4-6",
    mcpServers: [],
    fileScope: ["**/*"],
    credentials: { kind: "oauth-claude-code" },
    initialPrompt: "Hello",
    context: stubContext,
  };
}

describe("buildSdkOptions — agents map", () => {
  it("registers looma + loomex subagents when main role is loomi", () => {
    const { options } = buildSdkOptions(makeConfig("loomi"));
    const agents = options.agents ?? {};
    const keys = Object.keys(agents);
    expect(keys).toContain("loomi");
    expect(keys).toContain("looma");
    expect(keys).toContain("loomex");
  });

  it("registers looma + loomex subagents when main role is loom", () => {
    const { options } = buildSdkOptions(makeConfig("loom"));
    const agents = options.agents ?? {};
    expect(Object.keys(agents)).toEqual(
      expect.arrayContaining(["loom", "looma", "loomex"]),
    );
  });

  it("registers ONLY the main role when role is looma (no recursive subagent setup)", () => {
    const { options } = buildSdkOptions(makeConfig("looma"));
    const agents = options.agents ?? {};
    expect(Object.keys(agents)).toEqual(["looma"]);
  });

  it("registers ONLY the main role when role is loomex", () => {
    const { options } = buildSdkOptions(makeConfig("loomex"));
    const agents = options.agents ?? {};
    expect(Object.keys(agents)).toEqual(["loomex"]);
  });
});

describe("toSdkAgentDef", () => {
  it("converts a LoomfloAgentDefinition to the SDK shape", () => {
    const loomfloDef = createLoomaSubagentDefinition();
    const sdkDef = toSdkAgentDef(loomfloDef);
    expect(sdkDef.description).toBe(loomfloDef.description);
    expect(sdkDef.prompt).toBe(loomfloDef.prompt);
    expect(sdkDef.tools).toEqual([...loomfloDef.allowedTools]);
    expect(sdkDef.model).toBe(loomfloDef.defaultModel);
  });

  it("applies promptOverride and modelOverride", () => {
    const loomfloDef = createLoomexSubagentDefinition();
    const sdkDef = toSdkAgentDef(loomfloDef, "OVERRIDE PROMPT", "claude-haiku-4-5");
    expect(sdkDef.prompt).toBe("OVERRIDE PROMPT");
    expect(sdkDef.model).toBe("claude-haiku-4-5");
  });

  it("ignores empty modelOverride and falls back to defaultModel", () => {
    const loomfloDef = createLoomaSubagentDefinition();
    const sdkDef = toSdkAgentDef(loomfloDef, undefined, "");
    expect(sdkDef.model).toBe(loomfloDef.defaultModel);
  });
});

describe("subagent definitions sanity", () => {
  it("looma subagent gets the full looma tool palette", () => {
    const def = createLoomaSubagentDefinition();
    expect(def.role).toBe("looma");
    expect(def.allowedTools.some((t) => t.includes("write_file"))).toBe(true);
    expect(def.allowedTools.some((t) => t.includes("exec_command"))).toBe(true);
    expect(def.allowedTools.some((t) => t.includes("report_complete"))).toBe(true);
  });

  it("loomex subagent is read-only (no write tools)", () => {
    const def = createLoomexSubagentDefinition();
    expect(def.role).toBe("loomex");
    expect(def.allowedTools.some((t) => t.includes("write_file"))).toBe(false);
    expect(def.allowedTools.some((t) => t.includes("write_memory"))).toBe(false);
    expect(def.allowedTools.some((t) => t.includes("exec_command"))).toBe(false);
  });
});
