/**
 * Unit tests for packages/cli/src/commands/resume.ts — createResumeCommand.
 *
 * Covers happy path with full resume info, daemon not running (openClient rejects),
 * request error, resolveProject fails, empty resume info arrays, and resumedFrom null.
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

import { createResumeCommand } from "../../src/commands/resume.js";

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
// Happy path — full resume info
// ===========================================================================

describe("resume command — happy path", () => {
  it("should display resume summary with completed, reset, rescheduled, and resumedFrom", async () => {
    mockRequest.mockResolvedValue({
      status: "running",
      resumeInfo: {
        resumedFrom: "node-3",
        completedNodeIds: ["node-1", "node-2"],
        resetNodeIds: ["node-3", "node-4"],
        rescheduledNodeIds: ["node-5"],
      },
    });

    await runResume();

    expect(mockResolveProject).toHaveBeenCalledWith({
      cwd: process.cwd(),
      createIfMissing: false,
    });
    expect(mockOpenClient).toHaveBeenCalledWith(IDENTITY.id);
    expect(mockRequest).toHaveBeenCalledWith("POST", "/workflow/resume");

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
// Daemon not running (openClient rejects)
// ===========================================================================

describe("resume command — daemon not running", () => {
  it("should log error and exit(1) when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await expect(runResume()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: Daemon is not running. Run 'loomflo start' first.",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Request throws (API error)
// ===========================================================================

describe("resume command — request error", () => {
  it("should log error and exit(1) when request throws", async () => {
    mockRequest.mockRejectedValue(new Error("POST /workflow/resume -> HTTP 409"));

    await expect(runResume()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: POST /workflow/resume -> HTTP 409");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// resolveProject fails (no .loomflo/project.json)
// ===========================================================================

describe("resume command — not a loomflo project", () => {
  it("should log error and exit(1) when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await expect(runResume()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: /tmp is not a loomflo project (no .loomflo/project.json found).",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockOpenClient).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Empty arrays and null resumedFrom
// ===========================================================================

describe("resume command — minimal resume info", () => {
  it("should skip optional sections when arrays are empty and resumedFrom is null", async () => {
    mockRequest.mockResolvedValue({
      status: "running",
      resumeInfo: {
        resumedFrom: null,
        completedNodeIds: [],
        resetNodeIds: [],
        rescheduledNodeIds: [],
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
