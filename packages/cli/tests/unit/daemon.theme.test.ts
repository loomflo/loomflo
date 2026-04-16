import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn(),
  getRunningDaemon: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createDaemonCommand } from "../../src/commands/daemon.js";
import { ensureDaemonRunning, getRunningDaemon } from "../../src/daemon-control.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAEMON_INFO = {
  port: 41234,
  token: "t",
  pid: 99,
  version: "0.3.0",
};

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

  (ensureDaemonRunning as ReturnType<typeof vi.fn>).mockReset();
  (getRunningDaemon as ReturnType<typeof vi.fn>).mockReset();

  (ensureDaemonRunning as ReturnType<typeof vi.fn>).mockResolvedValue(DAEMON_INFO);
  (getRunningDaemon as ReturnType<typeof vi.fn>).mockResolvedValue(DAEMON_INFO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// daemon start — themed output
// ===========================================================================

describe("loomflo daemon start — themed output", () => {
  it("prints check-line with daemon info via process.stdout.write", async () => {
    const cmd = createDaemonCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "daemon", "start"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("daemon");
  });

  it("includes port and pid in themed output", async () => {
    const cmd = createDaemonCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "daemon", "start"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain(String(DAEMON_INFO.port));
    expect(plain).toContain(String(DAEMON_INFO.pid));
  });
});

// ===========================================================================
// daemon start --json
// ===========================================================================

describe("loomflo daemon start --json", () => {
  it("prints a JSON record with action, port, and pid", async () => {
    const cmd = createDaemonCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "daemon", "start", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("action", "start");
    expect(parsed).toHaveProperty("port", DAEMON_INFO.port);
    expect(parsed).toHaveProperty("pid", DAEMON_INFO.pid);
  });
});
