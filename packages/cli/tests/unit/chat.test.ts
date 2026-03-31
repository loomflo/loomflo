/**
 * Unit tests for packages/cli/src/commands/chat.ts — createChatCommand.
 *
 * Covers happy path with action, happy path without action, connection
 * error on DaemonClient.connect(), API error response, and network
 * error during POST /chat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockPost = vi.fn();
const mockConnect = vi.fn();

vi.mock("../../src/client.js", () => ({
  DaemonClient: {
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createChatCommand } from "../../src/commands/chat.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  mockConnect.mockReset();
  mockPost.mockReset();

  mockConnect.mockResolvedValue({ post: mockPost });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Happy path — response with action
// ===========================================================================

describe("chat command — happy path with action", () => {
  it("should display category, response text, and action details", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        response: "I will add a login page.",
        action: {
          type: "add_node",
          details: { nodeId: "n3", title: "Login Page" },
        },
        category: "graph_modification",
      },
    });

    await runChat("Add a login page");

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockPost).toHaveBeenCalledWith("/chat", { message: "Add a login page" });

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
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        response: "The workflow is running smoothly.",
        action: null,
        category: "informational",
      },
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
// DaemonClient.connect() fails
// ===========================================================================

describe("chat command — connection error", () => {
  it("should log error and exit(1) when DaemonClient.connect() rejects", async () => {
    mockConnect.mockRejectedValue(new Error("Daemon not running"));

    await expect(runChat("hello")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: Daemon not running");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// API error response (non-ok)
// ===========================================================================

describe("chat command — API error response", () => {
  it("should log the error message and exit(1) on non-ok response", async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 400,
      data: { error: "Message is required" },
    });

    await expect(runChat("")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: Message is required");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// Network error during POST /chat
// ===========================================================================

describe("chat command — network error during POST", () => {
  it("should log connection error and exit(1) when post() throws", async () => {
    mockPost.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(runChat("hello")).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Failed to connect to daemon: ECONNREFUSED");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});
