/**
 * Unit tests for packages/cli/src/commands/resume.ts — createResumeCommand.
 *
 * Covers happy path with full resume info, daemon not running,
 * API error response, empty resume info arrays, and resumedFrom null.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockPost = vi.fn();

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn(),
  DaemonClient: vi.fn().mockImplementation(() => ({ post: mockPost })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { DaemonClient, readDaemonConfig } from "../../src/client.js";
import { createResumeCommand } from "../../src/commands/resume.js";

// ---------------------------------------------------------------------------
// Mock typecasts
// ---------------------------------------------------------------------------

const mockReadDaemonConfig = readDaemonConfig as ReturnType<typeof vi.fn>;
const MockDaemonClient = DaemonClient as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default valid daemon config for tests. */
const DAEMON_CONFIG = { port: 4000, token: "test-token", pid: 1234 };

/**
 * Execute the resume command action.
 *
 * @returns A promise that resolves when the command completes.
 */
async function runResume(): Promise<void> {
  const cmd = createResumeCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "resume"]);
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

  mockPost.mockReset();
  mockReadDaemonConfig.mockReset();
  MockDaemonClient.mockReset().mockImplementation(() => ({ post: mockPost }));

  mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Happy path — full resume info
// ===========================================================================

describe("resume command — happy path", () => {
  it("should display resume summary with completed, reset, rescheduled, and resumedFrom", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: "running",
        resumeInfo: {
          resumedFrom: "node-3",
          completedNodeIds: ["node-1", "node-2"],
          resetNodeIds: ["node-3", "node-4"],
          rescheduledNodeIds: ["node-5"],
        },
      },
    });

    await runResume();

    expect(MockDaemonClient).toHaveBeenCalledWith(4000, "test-token");
    expect(mockPost).toHaveBeenCalledWith("/workflow/resume");

    expect(mockConsoleLog).toHaveBeenCalledWith("Resuming workflow...");
    expect(mockConsoleLog).toHaveBeenCalledWith("Workflow resumed. Status: running");

    expect(mockConsoleLog).toHaveBeenCalledWith("  Completed (skipped): 2 nodes");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Interrupted (reset): 2 nodes");
    expect(mockConsoleLog).toHaveBeenCalledWith("    - node-3");
    expect(mockConsoleLog).toHaveBeenCalledWith("    - node-4");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Rescheduled: 1 nodes");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Resuming from: node-3");
    expect(mockConsoleLog).toHaveBeenCalledWith("Execution will continue from where it left off.");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Daemon not running
// ===========================================================================

describe("resume command — daemon not running", () => {
  it("should log error and exit(1) when readDaemonConfig rejects", async () => {
    mockReadDaemonConfig.mockRejectedValue(new Error("ENOENT"));

    await expect(runResume()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Daemon is not running. Start with: loomflo start",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// API error response
// ===========================================================================

describe("resume command — API error response", () => {
  it("should log the error and exit(1) on non-ok response", async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "Workflow is not paused" },
    });

    await expect(runResume()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Failed to resume: Workflow is not paused");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// Empty arrays and null resumedFrom
// ===========================================================================

describe("resume command — minimal resume info", () => {
  it("should skip optional sections when arrays are empty and resumedFrom is null", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: "running",
        resumeInfo: {
          resumedFrom: null,
          completedNodeIds: [],
          resetNodeIds: [],
          rescheduledNodeIds: [],
        },
      },
    });

    await runResume();

    expect(mockConsoleLog).toHaveBeenCalledWith("Workflow resumed. Status: running");
    expect(mockConsoleLog).toHaveBeenCalledWith("Execution will continue from where it left off.");

    const logCalls = (mockConsoleLog.mock.calls as unknown[][]).map((c) => c[0] as string);
    expect(logCalls).not.toContainEqual(expect.stringContaining("Completed (skipped)"));
    expect(logCalls).not.toContainEqual(expect.stringContaining("Interrupted (reset)"));
    expect(logCalls).not.toContainEqual(expect.stringContaining("Rescheduled"));
    expect(logCalls).not.toContainEqual(expect.stringContaining("Resuming from"));

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});
