import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
// Constants
// ---------------------------------------------------------------------------

const DAEMON_CONFIG = { port: 4000, token: "test-token", pid: 1234 };

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let stdoutWrites: string[];

beforeEach(() => {
  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  });

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
// dashboard --no-open — themed output
// ===========================================================================

describe("loomflo dashboard --no-open — themed output", () => {
  it("prints check-line with URL via process.stdout.write", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard", "--no-open"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("http://127.0.0.1:4000");
  });

  it("does not invoke exec when --no-open is passed", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard", "--no-open"]);

    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// dashboard --no-open --json
// ===========================================================================

describe("loomflo dashboard --no-open --json", () => {
  it("prints a JSON record with url property", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard", "--no-open", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("url", "http://127.0.0.1:4000");
  });
});

// ===========================================================================
// dashboard with explicit port — themed output
// ===========================================================================

describe("loomflo dashboard --port --no-open — themed output", () => {
  it("uses the explicit port in themed output", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard", "--port", "8080", "--no-open"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("http://127.0.0.1:8080");
  });
});
