// packages/cli/tests/unit/daemon-command.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockGetRunningDaemon = vi.fn();
const mockFindOrphanDaemonPid = vi.fn();
const mockEnsureDaemonRunning = vi.fn();

vi.mock("../../src/daemon-control.js", () => ({
  getRunningDaemon: (...a: unknown[]) => mockGetRunningDaemon(...a),
  findOrphanDaemonPid: (...a: unknown[]) => mockFindOrphanDaemonPid(...a),
  ensureDaemonRunning: (...a: unknown[]) => mockEnsureDaemonRunning(...a),
}));

import { createDaemonCommand } from "../../src/commands/daemon.js";

describe("daemon command", () => {
  it("has start/stop/status/restart subcommands", () => {
    const cmd = createDaemonCommand();
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["restart", "start", "status", "stop"]);
  });

  it("stop supports --force flag", () => {
    const cmd = createDaemonCommand();
    const stop = cmd.commands.find((c) => c.name() === "stop")!;
    const hasForce = stop.options.some((o) => o.long === "--force");
    expect(hasForce).toBe(true);
  });

  it("each subcommand supports --json flag", () => {
    const cmd = createDaemonCommand();
    for (const sub of cmd.commands) {
      const hasJson = sub.options.some((o) => o.long === "--json");
      expect(hasJson, `${sub.name()} should have --json`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Orphan-handling branch of `daemon stop`
// ---------------------------------------------------------------------------

describe("daemon stop — orphan recovery", () => {
  let stdoutWrites: string[];
  let stderrWrites: string[];
  let killSpy: ReturnType<typeof vi.spyOn>;

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
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    mockGetRunningDaemon.mockReset();
    mockFindOrphanDaemonPid.mockReset();
    mockEnsureDaemonRunning.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runStop(args: string[]): Promise<void> {
    const cmd = createDaemonCommand();
    cmd.exitOverride();
    await cmd.parseAsync(args, { from: "user" });
  }

  it("signals an orphaned daemon when daemon.json is missing", async () => {
    mockGetRunningDaemon.mockResolvedValue(null);
    mockFindOrphanDaemonPid.mockResolvedValue(9999);

    await runStop(["stop", "--force"]);

    expect(killSpy).toHaveBeenCalledWith(9999, "SIGKILL");
    const out = stripAnsi(stdoutWrites.join(""));
    expect(out).toContain("orphaned daemon");
    expect(out).toContain("9999");
  });

  it("uses SIGTERM for orphan when --force is not passed", async () => {
    mockGetRunningDaemon.mockResolvedValue(null);
    mockFindOrphanDaemonPid.mockResolvedValue(4242);

    await runStop(["stop"]);

    expect(killSpy).toHaveBeenCalledWith(4242, "SIGTERM");
  });

  it("emits orphan JSON with pid and signal under --json", async () => {
    mockGetRunningDaemon.mockResolvedValue(null);
    mockFindOrphanDaemonPid.mockResolvedValue(1234);

    await runStop(["stop", "--force", "--json"]);

    const out = stdoutWrites.join("");
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      action: "stop",
      pid: 1234,
      signal: "SIGKILL",
      orphan: true,
    });
  });

  it("reports not_running when no daemon and no orphan", async () => {
    mockGetRunningDaemon.mockResolvedValue(null);
    mockFindOrphanDaemonPid.mockResolvedValue(null);

    await runStop(["stop"]);

    expect(killSpy).not.toHaveBeenCalled();
    const out = stripAnsi(stdoutWrites.join(""));
    expect(out).toContain("daemon is not running");
  });
});
