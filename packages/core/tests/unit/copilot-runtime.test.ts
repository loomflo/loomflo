/**
 * Unit tests for CopilotRuntime — pure-function coverage.
 *
 * The full session flow (CopilotClient.start + createSession + sendAndWait)
 * is covered by the e2e smoke test, which is opt-in via env var.
 */

import { describe, it, expect } from "vitest";
import { CopilotRuntime, buildCopilotProvider } from "../../src/runtimes/copilot.js";
import {
  buildCopilotTools,
  listCopilotToolNamesForRole,
} from "../../src/runtimes/copilot-tools.js";
import type { ResolvedCredentials } from "../../src/runtimes/base.js";

const stubDeps = {
  messageBus: { async send() {} },
  completionHandler: { async reportComplete() {} },
  escalationHandler: { async escalate() {} },
};

// ---------------------------------------------------------------------------
// CopilotRuntime metadata
// ---------------------------------------------------------------------------

describe("CopilotRuntime", () => {
  it("advertises the expected runtime name and capabilities", () => {
    const r = new CopilotRuntime();
    expect(r.name).toBe("copilot");
    expect(r.capabilities.supportsByokProvider).toBe(true);
    expect(r.capabilities.supportsStreaming).toBe(true);
    expect(r.capabilities.supportsCanUseTool).toBe(false); // Copilot SDK has no canUseTool
    expect(r.capabilities.supportsSubagents).toBe(false); // not wired in Phase 3
  });

  it("listAvailableModels returns the Copilot baseline catalog", async () => {
    const r = new CopilotRuntime();
    const models = await r.listAvailableModels({ kind: "oauth-copilot" });
    expect(models.length).toBeGreaterThan(0);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("gpt-5");
    expect(ids).toContain("claude-sonnet-4.5");
  });
});

// ---------------------------------------------------------------------------
// buildCopilotProvider — credential mapping
// ---------------------------------------------------------------------------

describe("buildCopilotProvider", () => {
  it("returns undefined for oauth-copilot (use Copilot subscription)", () => {
    const p = buildCopilotProvider({ kind: "oauth-copilot" });
    expect(p).toBeUndefined();
  });

  it("maps api-key-anthropic to provider type=anthropic", () => {
    const p = buildCopilotProvider({ kind: "api-key-anthropic", apiKey: "sk-ant-x" });
    expect(p?.type).toBe("anthropic");
    expect(p?.apiKey).toBe("sk-ant-x");
  });

  it("maps api-key-openai to provider type=openai", () => {
    const p = buildCopilotProvider({ kind: "api-key-openai", apiKey: "sk-x" });
    expect(p?.type).toBe("openai");
    expect(p?.apiKey).toBe("sk-x");
  });

  it("maps api-key-copilot-byok to the chosen provider", () => {
    const a = buildCopilotProvider({
      kind: "api-key-copilot-byok",
      provider: "anthropic",
      apiKey: "sk-ant-x",
    });
    expect(a?.type).toBe("anthropic");

    const b = buildCopilotProvider({
      kind: "api-key-copilot-byok",
      provider: "openai",
      apiKey: "sk-x",
    });
    expect(b?.type).toBe("openai");
  });

  it("throws for oauth-claude-code (must use ClaudeAgentRuntime instead)", () => {
    expect(() =>
      buildCopilotProvider({ kind: "oauth-claude-code" } as ResolvedCredentials),
    ).toThrow(/CopilotRuntime does not support oauth-claude-code/);
  });
});

// ---------------------------------------------------------------------------
// buildCopilotTools / listCopilotToolNamesForRole
// ---------------------------------------------------------------------------

describe("listCopilotToolNamesForRole", () => {
  it("loomi: read base + memory_write + send_message + escalate (no shell)", () => {
    const names = listCopilotToolNamesForRole("loomi", stubDeps);
    expect(names).toContain("send_message");
    expect(names).toContain("escalate");
    expect(names).toContain("write_memory");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("exec_command");
  });

  it("looma: full read/write/shell + send_message + report_complete", () => {
    const names = listCopilotToolNamesForRole("looma", stubDeps);
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("exec_command");
    expect(names).toContain("report_complete");
    expect(names).not.toContain("escalate");
  });

  it("loomex: strictly read-only", () => {
    const names = listCopilotToolNamesForRole("loomex", stubDeps);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("write_memory");
    expect(names).not.toContain("exec_command");
  });
});

describe("buildCopilotTools", () => {
  it("returns one Copilot SDK Tool per loomflo tool selected for the role", () => {
    const tools = buildCopilotTools({
      workspacePath: "/tmp/test",
      agentRole: "looma",
      agentId: "looma-1",
      nodeId: "node-1",
      fileScope: ["**/*"],
      ...stubDeps,
    });
    const expectedCount = listCopilotToolNamesForRole("looma", stubDeps).length;
    expect(tools.length).toBe(expectedCount);
    // Every Copilot SDK Tool exposes a `name` getter.
    const names = tools.map((t) => (t as unknown as { name: string }).name);
    expect(names).toContain("write_file");
    expect(names).toContain("read_file");
  });
});
