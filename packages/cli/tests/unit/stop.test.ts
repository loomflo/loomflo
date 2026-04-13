/**
 * Unit tests for packages/cli/src/commands/stop.ts — createStopCommand.
 *
 * Covers daemon not running, graceful shutdown success, API error with --force,
 * API error without --force, network error with alive PID, network error with
 * dead process, and SIGTERM failure on network error.
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
import { createStopCommand } from "../../src/commands/stop.js";

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
 * Execute the stop command action with optional arguments.
 *
 * @param args - Additional CLI arguments (e.g. "--force").
 * @returns A promise that resolves when the command completes.
 */
async function runStop(args: string[] = []): Promise<void> {
  const cmd = createStopCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "stop", ...args]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let mockConsoleLog: ReturnType<typeof vi.fn>;
let mockConsoleError: ReturnType<typeof vi.fn>;
let mockProcessExit: ReturnType<typeof vi.fn>;
let mockProcessKill: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockProcessExit = vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  }) as unknown as ReturnType<typeof vi.fn>;

  mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  mockProcessKill = vi.spyOn(process, "kill").mockImplementation(() => true);

  mockPost.mockReset();
  mockReadDaemonConfig.mockReset();
  MockDaemonClient.mockReset().mockImplementation(() => ({ post: mockPost }));

  mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// Daemon not running
// ===========================================================================

describe("stop command — daemon not running", () => {
  it("should log 'not running' and return when readDaemonConfig rejects", async () => {
    mockReadDaemonConfig.mockRejectedValue(new Error("ENOENT"));

    await runStop();

    expect(mockConsoleLog).toHaveBeenCalledWith("Daemon is not running.");
    expect(mockProcessExit).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Graceful shutdown — success, process exits quickly
// ===========================================================================

describe("stop command — graceful shutdown success", () => {
  it("should send shutdown request and report success when process exits", async () => {
    mockPost.mockResolvedValue({ ok: true, status: 200, data: {} });

    // process.kill(pid, 0) should throw on second call (process gone)
    let killCallCount = 0;
    mockProcessKill.mockImplementation((pid: number, signal?: string | number) => {
      if (signal === 0) {
        killCallCount++;
        if (killCallCount >= 2) {
          throw new Error("ESRCH");
        }
        return true;
      }
      return true;
    });

    const promise = runStop();

    // Advance past the poll intervals to let waitForProcessExit detect exit
    await vi.advanceTimersByTimeAsync(1000);

    await promise;

    expect(mockPost).toHaveBeenCalledWith("/shutdown");
    expect(mockConsoleLog).toHaveBeenCalledWith("Stopping Loomflo daemon...");
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "Shutdown signal sent. Waiting for active calls to finish...",
    );
    expect(mockConsoleLog).toHaveBeenCalledWith("Daemon stopped.");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// API error without --force
// ===========================================================================

describe("stop command — API error without --force", () => {
  it("should log error and exit(1) when shutdown returns non-ok and no --force", async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 500,
      data: { error: "Internal error" },
    });

    // process.exit(1) throws inside a try block, so the catch block runs.
    // Make isProcessAlive return false so the catch branch returns immediately.
    mockProcessKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    });

    await runStop();

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Daemon did not accept shutdown request. Use --force to send SIGTERM.",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// API error with --force
// ===========================================================================

describe("stop command — API error with --force", () => {
  it("should send SIGTERM when shutdown returns non-ok and --force is set", async () => {
    mockPost.mockResolvedValue({
      ok: false,
      status: 500,
      data: { error: "Internal error" },
    });

    // process.kill(pid, 0) should throw immediately (process gone after SIGTERM)
    mockProcessKill.mockImplementation((pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    });

    const promise = runStop(["--force"]);

    await vi.advanceTimersByTimeAsync(1000);

    await promise;

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "Graceful shutdown not available. Sending SIGTERM...",
    );
    expect(mockProcessKill).toHaveBeenCalledWith(1234, "SIGTERM");
  });
});

// ===========================================================================
// Network error — process no longer running
// ===========================================================================

describe("stop command — network error, dead process", () => {
  it("should log 'no longer running' when post throws and process is dead", async () => {
    mockPost.mockRejectedValue(new Error("ECONNREFUSED"));

    // process.kill(pid, 0) throws — process is dead
    mockProcessKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    });

    await runStop();

    expect(mockConsoleLog).toHaveBeenCalledWith("Daemon process is no longer running.");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Network error — process alive, SIGTERM sent
// ===========================================================================

describe("stop command — network error, alive process", () => {
  it("should send SIGTERM when post throws but process is alive", async () => {
    mockPost.mockRejectedValue(new Error("ECONNREFUSED"));

    // First kill(pid, 0) succeeds (alive), then later throws (dead)
    let killCount = 0;
    mockProcessKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        killCount++;
        if (killCount >= 3) {
          throw new Error("ESRCH");
        }
        return true;
      }
      return true;
    });

    const promise = runStop();

    await vi.advanceTimersByTimeAsync(2000);

    await promise;

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "Cannot reach daemon API. Sending SIGTERM to process...",
    );
    expect(mockProcessKill).toHaveBeenCalledWith(1234, "SIGTERM");
    expect(mockConsoleLog).toHaveBeenCalledWith("Daemon stopped.");
  });
});

// ===========================================================================
// Network error — SIGTERM fails (process exited between check and kill)
// ===========================================================================

describe("stop command — network error, SIGTERM fails", () => {
  it("should log 'no longer running' when kill(SIGTERM) throws", async () => {
    mockPost.mockRejectedValue(new Error("ECONNREFUSED"));

    // kill(pid, 0) succeeds (alive), but kill(pid, SIGTERM) throws
    mockProcessKill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        return true;
      }
      if (signal === "SIGTERM") {
        throw new Error("ESRCH");
      }
      return true;
    });

    await runStop();

    expect(mockConsoleLog).toHaveBeenCalledWith("Daemon process is no longer running.");
  });
});

// ===========================================================================
// PID is 0 (no PID info) — graceful shutdown only
// ===========================================================================

describe("stop command — pid is 0", () => {
  it("should skip PID-based waiting when pid is 0", async () => {
    mockReadDaemonConfig.mockResolvedValue({ port: 4000, token: "test-token", pid: 0 });
    mockPost.mockResolvedValue({ ok: true, status: 200, data: {} });

    await runStop();

    expect(mockConsoleLog).toHaveBeenCalledWith("Daemon stopped.");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});
