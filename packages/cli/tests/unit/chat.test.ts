/**
 * Unit tests for packages/cli/src/commands/chat.ts — createChatCommand.
 *
 * Covers happy path with action, happy path without action, connection
 * error (openClient rejects), request error, and resolveProject fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
 * @returns A promise that resolves when the command completes.
 */
async function runChat(message: string): Promise<void> {
  const cmd = createChatCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "chat", message]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let mockConsoleLog: ReturnType<typeof vi.fn>;
let mockConsoleError: ReturnType<typeof vi.fn>;
let mockProcessExit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockProcessExit = vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  }) as unknown as ReturnType<typeof vi.fn>;

  mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

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
    info: { port: 4000, token: "t", pid: 1234, version: "0.2.0" },
    request: mockRequest,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

    expect(mockConsoleLog).toHaveBeenCalledWith("[graph_modification] I will add a login page.");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Action: add_node");
    expect(mockConsoleLog).toHaveBeenCalledWith('    nodeId: "n3"');
    expect(mockConsoleLog).toHaveBeenCalledWith('    title: "Login Page"');

    expect(mockProcessExit).not.toHaveBeenCalled();
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

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[informational] The workflow is running smoothly.",
    );
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// openClient rejects (daemon not running)
// ===========================================================================

describe("chat command — connection error", () => {
  it("should log error and exit(1) when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await expect(runChat("hello")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: Daemon is not running. Run 'loomflo start' first.",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Request throws (API error or network error)
// ===========================================================================

describe("chat command — request error", () => {
  it("should log error and exit(1) when request throws", async () => {
    mockRequest.mockRejectedValue(new Error("POST /chat -> HTTP 400"));

    await expect(runChat("")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: POST /chat -> HTTP 400");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should log error and exit(1) when request throws a network error", async () => {
    mockRequest.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(runChat("hello")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: ECONNREFUSED");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// resolveProject fails (no .loomflo/project.json)
// ===========================================================================

describe("chat command — not a loomflo project", () => {
  it("should log error and exit(1) when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await expect(runChat("hello")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: /tmp is not a loomflo project (no .loomflo/project.json found).",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockOpenClient).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
