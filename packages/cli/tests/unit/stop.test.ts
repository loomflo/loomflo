/**
 * Unit tests for packages/cli/src/commands/stop.ts — createStopCommand.
 *
 * Covers success path, request error, daemon-not-running (openClient rejects),
 * and resolveProject-fails path (no .loomflo/project.json found).
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
async function runStop(args: string[] = ["node", "stop"]): Promise<void> {
  const cmd = createStopCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args);
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
// Success path
// ===========================================================================

describe("stop command — success", () => {
  it("should call POST /workflow/stop and write themed success message to stdout", async () => {
    mockRequest.mockResolvedValue(undefined);

    await runStop();

    expect(mockResolveProject).toHaveBeenCalledWith({
      cwd: process.cwd(),
      createIfMissing: false,
    });
    expect(mockOpenClient).toHaveBeenCalledWith(IDENTITY.id);
    expect(mockRequest).toHaveBeenCalledWith("POST", "/workflow/stop");

    const plain = stdoutPlain();
    expect(plain).toContain("\u2713");
    expect(plain).toContain(`project ${IDENTITY.name} stopped`);
    expect(plain).toContain(IDENTITY.id);
  });
});

// ===========================================================================
// Request throws (workflow stop fails)
// ===========================================================================

describe("stop command — request error", () => {
  it("should write error to stderr and set exitCode when request throws", async () => {
    mockRequest.mockRejectedValue(new Error("POST /workflow/stop -> HTTP 500"));

    await runStop();

    const plain = stderrPlain();
    expect(plain).toContain("POST /workflow/stop -> HTTP 500");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

// ===========================================================================
// Daemon not running (openClient rejects)
// ===========================================================================

describe("stop command — daemon not running", () => {
  it("should write error to stderr and set exitCode when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await runStop();

    const plain = stderrPlain();
    expect(plain).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
    expect(mockRequest).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });
});

// ===========================================================================
// resolveProject fails (no .loomflo/project.json)
// ===========================================================================

describe("stop command — not a loomflo project", () => {
  it("should write error to stderr and set exitCode when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await runStop();

    const plain = stderrPlain();
    expect(plain).toContain("not a loomflo project");
    expect(process.exitCode).toBe(1);
    expect(mockOpenClient).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
    process.exitCode = undefined;
  });
});
