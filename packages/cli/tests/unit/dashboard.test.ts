/**
 * Unit tests for packages/cli/src/commands/dashboard.ts — createDashboardCommand.
 *
 * Covers --no-open flag (print URL only), default browser open, daemon not
 * running, explicit --port override, invalid port, and browser open failure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

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

  mockReadDaemonConfig.mockReset();
  mockExec.mockReset();
  mockPlatform.mockReset().mockReturnValue("linux");

  mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);
  mockExec.mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// ===========================================================================
// --no-open flag (print URL only)
// ===========================================================================

describe("dashboard command — --no-open flag", () => {
  it("should print the URL without opening the browser", async () => {
    await runDashboard(["--no-open"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("http://127.0.0.1:4000");
    expect(mockExec).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

// ===========================================================================
// Default: open browser
// ===========================================================================

describe("dashboard command — default browser open", () => {
  it("should open the browser with xdg-open on linux", async () => {
    await runDashboard();

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("opening browser");
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
  it("should write error to stderr and set exitCode=1 when readDaemonConfig rejects", async () => {
    mockReadDaemonConfig.mockRejectedValue(new Error("ENOENT"));

    await runDashboard();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Daemon is not running. Start with: loomflo start");
    expect(process.exitCode).toBe(1);
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
    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("http://127.0.0.1:8080");
  });
});

// ===========================================================================
// Invalid port
// ===========================================================================

describe("dashboard command — invalid port", () => {
  it("should write error to stderr and set exitCode=1 for non-numeric port", async () => {
    await runDashboard(["--port", "abc"]);

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Invalid port: abc");
    expect(process.exitCode).toBe(1);
  });

  it("should write error to stderr and set exitCode=1 for port out of range", async () => {
    await runDashboard(["--port", "99999"]);

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Invalid port: 99999");
    expect(process.exitCode).toBe(1);
  });
});

// ===========================================================================
// Browser open failure
// ===========================================================================

describe("dashboard command — browser open failure", () => {
  it("should write fallback message to stderr when exec callback receives an error", async () => {
    mockExec.mockImplementation((_cmd: string, callback: (error: Error | null) => void): void => {
      callback(new Error("xdg-open not found"));
    });

    await runDashboard();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain(
      "Failed to open browser automatically. Visit http://127.0.0.1:4000 in your browser.",
    );
  });
});
