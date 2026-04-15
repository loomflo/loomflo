/**
 * Unit tests for packages/cli/src/commands/stop.ts — createStopCommand.
 *
 * Covers success path, request error, daemon-not-running (openClient rejects),
 * and resolveProject-fails path (no .loomflo/project.json found).
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

import { createStopCommand } from "../../src/commands/stop.js";

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
 * Execute the stop command action.
 *
 * @returns A promise that resolves when the command completes.
 */
async function runStop(): Promise<void> {
  const cmd = createStopCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "stop"]);
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
// Success path
// ===========================================================================

describe("stop command — success", () => {
  it("should call POST /workflow/stop and log success message", async () => {
    mockRequest.mockResolvedValue(undefined);

    await runStop();

    expect(mockResolveProject).toHaveBeenCalledWith({
      cwd: process.cwd(),
      createIfMissing: false,
    });
    expect(mockOpenClient).toHaveBeenCalledWith(IDENTITY.id);
    expect(mockRequest).toHaveBeenCalledWith("POST", "/workflow/stop");
    expect(mockConsoleLog).toHaveBeenCalledWith(
      `Project ${IDENTITY.name} (${IDENTITY.id}) stopped.`,
    );
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Request throws (workflow stop fails)
// ===========================================================================

describe("stop command — request error", () => {
  it("should log error and exit(1) when request throws", async () => {
    mockRequest.mockRejectedValue(new Error("POST /workflow/stop -> HTTP 500"));

    await expect(runStop()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Error: POST /workflow/stop -> HTTP 500");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// Daemon not running (openClient rejects)
// ===========================================================================

describe("stop command — daemon not running", () => {
  it("should log error and exit(1) when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await expect(runStop()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: Daemon is not running. Run 'loomflo start' first.",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// resolveProject fails (no .loomflo/project.json)
// ===========================================================================

describe("stop command — not a loomflo project", () => {
  it("should log error and exit(1) when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await expect(runStop()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: /tmp is not a loomflo project (no .loomflo/project.json found).",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockOpenClient).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
