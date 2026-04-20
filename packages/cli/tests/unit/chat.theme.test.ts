import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockRequest = vi.fn();
const mockResolveProject = vi.fn();
const mockOpenClient = vi.fn();

vi.mock("../../src/project-resolver.js", () => ({
  resolveProject: (...a: unknown[]) => mockResolveProject(...a),
}));

vi.mock("../../src/client.js", () => ({
  openClient: (...a: unknown[]) => mockOpenClient(...a),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createChatCommand } from "../../src/commands/chat.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

const CHAT_RESPONSE = {
  response: "I will add a login page.",
  action: { type: "add_node", details: { nodeId: "n3" } },
  category: "graph_modification",
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let stdoutWrites: string[];

beforeEach(() => {
  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  });

  mockRequest.mockReset();
  mockResolveProject.mockReset();
  mockOpenClient.mockReset();

  mockResolveProject.mockResolvedValue({
    identity: IDENTITY,
    projectRoot: "/tmp/test",
    created: false,
  });

  mockOpenClient.mockResolvedValue({
    projectId: IDENTITY.id,
    info: { port: 4000, token: "t", pid: 1234, version: "0.3.0" },
    request: mockRequest,
  });

  mockRequest.mockResolvedValue(CHAT_RESPONSE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Themed output
// ===========================================================================

describe("loomflo chat — themed output", () => {
  it("prints response text via process.stdout.write", async () => {
    const cmd = createChatCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "chat", "Add a login page"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("I will add a login page.");
  });

  it("includes category in themed output", async () => {
    const cmd = createChatCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "chat", "Add a login page"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("graph_modification");
  });

  it("includes action type when action is present", async () => {
    const cmd = createChatCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "chat", "Add a login page"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("add_node");
  });
});

// ===========================================================================
// JSON output
// ===========================================================================

describe("loomflo chat --json", () => {
  it("prints a JSON record with response, category, and action", async () => {
    const cmd = createChatCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "chat", "--json", "Add a login page"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("response", "I will add a login page.");
    expect(parsed).toHaveProperty("category", "graph_modification");
    expect(parsed).toHaveProperty("action");

    const action = parsed["action"] as Record<string, unknown>;
    expect(action).toHaveProperty("type", "add_node");
  });
});
