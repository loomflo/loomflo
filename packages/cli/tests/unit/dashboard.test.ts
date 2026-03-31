/**
 * Unit tests for packages/cli/src/commands/dashboard.ts — createDashboardCommand.
 *
 * Covers --no-open flag (print URL only), default browser open, daemon not
 * running, explicit --port override, invalid port, and browser open failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:os", () => ({
  platform: vi.fn(() => "linux"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { exec } from "node:child_process";
import { platform } from "node:os";
import { readDaemonConfig } from "../../src/client.js";
import { createDashboardCommand } from "../../src/commands/dashboard.js";

// ---------------------------------------------------------------------------
// Mock typecasts
// ---------------------------------------------------------------------------

const mockReadDaemonConfig = readDaemonConfig as ReturnType<typeof vi.fn>;
const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
const mockPlatform = platform as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default valid daemon config for tests. */
const DAEMON_CONFIG = { port: 4000, token: "test-token", pid: 1234 };

/**
 * Execute the dashboard command action with optional arguments.
 *
 * @param args - Additional CLI arguments.
 * @returns A promise that resolves when the command completes.
 */
async function runDashboard(args: string[] = []): Promise<void> {
  const cmd = createDashboardCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "dashboard", ...args]);
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

  mockReadDaemonConfig.mockReset();
  mockExec.mockReset();
  mockPlatform.mockReset().mockReturnValue("linux");

  mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);
  mockExec.mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// --no-open flag (print URL only)
// ===========================================================================

describe("dashboard command — --no-open flag", () => {
  it("should print the URL without opening the browser", async () => {
    await runDashboard(["--no-open"]);

    expect(mockConsoleLog).toHaveBeenCalledWith("http://127.0.0.1:4000");
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Default: open browser
// ===========================================================================

describe("dashboard command — default browser open", () => {
  it("should open the browser with xdg-open on linux", async () => {
    await runDashboard();

    expect(mockConsoleLog).toHaveBeenCalledWith("Opening dashboard at http://127.0.0.1:4000");
    expect(mockExec).toHaveBeenCalledOnce();
    const [command] = mockExec.mock.calls[0] as [string];
    expect(command).toBe('xdg-open "http://127.0.0.1:4000"');
  });

  it("should use 'open' command on darwin", async () => {
    mockPlatform.mockReturnValue("darwin");

    await runDashboard();

    const [command] = mockExec.mock.calls[0] as [string];
    expect(command).toBe('open "http://127.0.0.1:4000"');
  });

  it("should use 'start' command on win32", async () => {
    mockPlatform.mockReturnValue("win32");

    await runDashboard();

    const [command] = mockExec.mock.calls[0] as [string];
    expect(command).toBe('start "http://127.0.0.1:4000"');
  });
});

// ===========================================================================
// Daemon not running
// ===========================================================================

describe("dashboard command — daemon not running", () => {
  it("should log error and exit(1) when readDaemonConfig rejects", async () => {
    mockReadDaemonConfig.mockRejectedValue(new Error("ENOENT"));

    await expect(runDashboard()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Daemon is not running. Start with: loomflo start",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Explicit --port override
// ===========================================================================

describe("dashboard command — explicit port", () => {
  it("should use the provided port instead of reading daemon config", async () => {
    await runDashboard(["--port", "8080"]);

    expect(mockReadDaemonConfig).not.toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith("Opening dashboard at http://127.0.0.1:8080");
  });
});

// ===========================================================================
// Invalid port
// ===========================================================================

describe("dashboard command — invalid port", () => {
  it("should log error and exit(1) for non-numeric port", async () => {
    await expect(runDashboard(["--port", "abc"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Invalid port: abc");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should log error and exit(1) for port out of range", async () => {
    await expect(runDashboard(["--port", "99999"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Invalid port: 99999");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// Browser open failure
// ===========================================================================

describe("dashboard command — browser open failure", () => {
  it("should log fallback message when exec callback receives an error", async () => {
    mockExec.mockImplementation((_cmd: string, callback: (error: Error | null) => void): void => {
      callback(new Error("xdg-open not found"));
    });

    await runDashboard();

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Failed to open browser automatically. Visit http://127.0.0.1:4000 in your browser.",
    );
  });
});
