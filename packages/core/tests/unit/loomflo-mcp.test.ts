/**
 * Unit tests for the loomflo MCP server factory.
 *
 * Verifies role-based tool selection and that the SDK MCP config is built
 * correctly. Does not boot a real Claude Agent session — that's covered by
 * the runtime integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createLoomfloMcpServer,
  listToolNamesForRole,
} from "../../src/mcp/loomflo-tools.js";
import type { MessageBusLike } from "../../src/tools/send-message.js";
import type { CompletionHandlerLike } from "../../src/tools/report-complete.js";
import type { EscalationHandlerLike } from "../../src/tools/escalate.js";

// ---------------------------------------------------------------------------
// Stub deps
// ---------------------------------------------------------------------------

const stubMessageBus: MessageBusLike = {
  async send(): Promise<void> {
    /* noop */
  },
};

const stubCompletionHandler: CompletionHandlerLike = {
  async handleCompletion(): Promise<void> {
    /* noop */
  },
};

const stubEscalationHandler: EscalationHandlerLike = {
  async escalate(): Promise<void> {
    /* noop */
  },
};

const stubDeps = {
  messageBus: stubMessageBus,
  completionHandler: stubCompletionHandler,
  escalationHandler: stubEscalationHandler,
};

// ---------------------------------------------------------------------------
// Tool selection by role
// ---------------------------------------------------------------------------

describe("listToolNamesForRole", () => {
  it("loom : read-only base + write_memory (no shell, no file write)", () => {
    const names = listToolNamesForRole("loom", stubDeps);
    expect(names).toContain("read_file");
    expect(names).toContain("list_files");
    expect(names).toContain("search_files");
    expect(names).toContain("read_memory");
    expect(names).toContain("write_memory");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("edit_file");
    expect(names).not.toContain("exec_command");
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("report_complete");
  });

  it("loomi : base + write_memory + send_message + escalate (no file write, no shell)", () => {
    const names = listToolNamesForRole("loomi", stubDeps);
    expect(names).toContain("write_memory");
    expect(names).toContain("send_message");
    expect(names).toContain("escalate");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("exec_command");
    expect(names).not.toContain("report_complete");
  });

  it("looma : full read/write/shell + send_message + report_complete (no escalate)", () => {
    const names = listToolNamesForRole("looma", stubDeps);
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("exec_command");
    expect(names).toContain("send_message");
    expect(names).toContain("report_complete");
    expect(names).not.toContain("escalate");
  });

  it("loomex : strictly read-only (no writes anywhere, no coordination)", () => {
    const names = listToolNamesForRole("loomex", stubDeps);
    expect(names).toEqual(
      expect.arrayContaining(["read_file", "list_files", "search_files", "read_memory"]),
    );
    expect(names).not.toContain("write_memory");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("edit_file");
    expect(names).not.toContain("exec_command");
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("report_complete");
    expect(names).not.toContain("escalate");
  });
});

// ---------------------------------------------------------------------------
// MCP server construction
// ---------------------------------------------------------------------------

describe("createLoomfloMcpServer", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "loomflo-mcp-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("returns an SDK MCP server config with the loomflo name", () => {
    const server = createLoomfloMcpServer({
      workspacePath: workspace,
      agentRole: "looma",
      agentId: "test-looma",
      nodeId: "test-node",
      fileScope: ["**/*"],
      ...stubDeps,
    });

    // The SDK's createSdkMcpServer returns an object with type, name, version, instance.
    expect(server).toMatchObject({
      type: "sdk",
      name: "loomflo",
    });
    expect(server).toHaveProperty("instance");
  });

  it("builds servers for all four roles without throwing", () => {
    const baseOpts = {
      workspacePath: workspace,
      agentId: "test-agent",
      nodeId: "test-node",
      fileScope: ["**/*"],
      ...stubDeps,
    };

    expect(() =>
      createLoomfloMcpServer({ ...baseOpts, agentRole: "loom" }),
    ).not.toThrow();
    expect(() =>
      createLoomfloMcpServer({ ...baseOpts, agentRole: "loomi" }),
    ).not.toThrow();
    expect(() =>
      createLoomfloMcpServer({ ...baseOpts, agentRole: "looma" }),
    ).not.toThrow();
    expect(() =>
      createLoomfloMcpServer({ ...baseOpts, agentRole: "loomex" }),
    ).not.toThrow();
  });
});

