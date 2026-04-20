/**
 * Unit tests for packages/cli/src/commands/chat.ts — createChatCommand.
 *
 * Covers happy path with action, happy path without action, connection
 * error (openClient rejects), request error, and resolveProject fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

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
// Helpers
// ---------------------------------------------------------------------------

/** Default project identity returned by resolveProject. */
const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

/**
 * Execute the chat command action with the given message argument.
 *
 * @param message - The chat message to send.
 * @param extraArgs - Additional CLI arguments (e.g., "--json").
 * @returns A promise that resolves when the command completes.
 */
async function runChat(message: string, extraArgs: string[] = []): Promise<void> {
  const cmd = createChatCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "chat", ...extraArgs, message]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let stdoutWrites: string[];
let stderrWrites: string[];

beforeEach(() => {
  stdoutWrites = [];
  stderrWrites = [];

  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => {
    stderrWrites.push(typeof c === "string" ? c : c.toString());
    return true;
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stdoutPlain(): string {
  return stdoutWrites.map(stripAnsi).join("");
}

function stderrPlain(): string {
  return stderrWrites.map(stripAnsi).join("");
}

// ===========================================================================
// Happy path — response with action
// ===========================================================================

describe("chat command — happy path with action", () => {
  it("should display category, response text, and action details", async () => {
    mockRequest.mockResolvedValue({
      response: "I will add a login page.",
      action: {
        type: "add_node",
        details: { nodeId: "n3", title: "Login Page" },
      },
      category: "graph_modification",
    });

    await runChat("Add a login page");

    expect(mockResolveProject).toHaveBeenCalledWith({
      cwd: process.cwd(),
      createIfMissing: false,
    });
    expect(mockOpenClient).toHaveBeenCalledWith(IDENTITY.id);
    expect(mockRequest).toHaveBeenCalledWith("POST", "/chat", { message: "Add a login page" });

    const plain = stdoutPlain();
    expect(plain).toContain("I will add a login page.");
    expect(plain).toContain("graph_modification");
    expect(plain).toContain("add_node");
    expect(plain).toContain("nodeId");
    expect(plain).toContain('"n3"');
    expect(plain).toContain("title");
    expect(plain).toContain('"Login Page"');
  });
});

// ===========================================================================
// Happy path — response without action
// ===========================================================================

describe("chat command — happy path without action", () => {
  it("should display category and response text without action section", async () => {
    mockRequest.mockResolvedValue({
      response: "The workflow is running smoothly.",
      action: null,
      category: "informational",
    });

    await runChat("How is the workflow?");

    const plain = stdoutPlain();
    expect(plain).toContain("The workflow is running smoothly.");
    expect(plain).toContain("informational");
    // Only the response line should be written (no action lines)
    expect(stdoutWrites).toHaveLength(1);
  });
});

// ===========================================================================
// openClient rejects (daemon not running)
// ===========================================================================

describe("chat command — connection error", () => {
  it("should write error to stderr and set exitCode when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await runChat("hello");

    const plain = stderrPlain();
    expect(plain).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
    expect(mockRequest).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });
});

// ===========================================================================
// Request throws (API error or network error)
// ===========================================================================

describe("chat command — request error", () => {
  it("should write error to stderr and set exitCode when request throws", async () => {
    mockRequest.mockRejectedValue(new Error("POST /chat -> HTTP 400"));

    await runChat("");

    const plain = stderrPlain();
    expect(plain).toContain("POST /chat -> HTTP 400");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("should write error to stderr and set exitCode when request throws a network error", async () => {
    mockRequest.mockRejectedValue(new Error("ECONNREFUSED"));

    await runChat("hello");

    const plain = stderrPlain();
    expect(plain).toContain("ECONNREFUSED");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

// ===========================================================================
// resolveProject fails (no .loomflo/project.json)
// ===========================================================================

describe("chat command — not a loomflo project", () => {
  it("should write error to stderr and set exitCode when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await runChat("hello");

    const plain = stderrPlain();
    expect(plain).toContain("not a loomflo project");
    expect(process.exitCode).toBe(1);
    expect(mockOpenClient).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });
});
