import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn(),
  getRunningDaemon: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createProjectCommand } from "../../src/commands/project.js";
import { getRunningDaemon } from "../../src/daemon-control.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAEMON_INFO = {
  port: 41234,
  token: "t",
  pid: 99,
  version: "0.3.0",
};

const PROJECTS = [
  {
    id: "proj_a",
    name: "alpha",
    projectPath: "/tmp/a",
    status: "idle",
    startedAt: "2026-04-01T00:00:00Z",
  },
];

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

  (getRunningDaemon as ReturnType<typeof vi.fn>).mockReset();
  mockFetch.mockReset();

  (getRunningDaemon as ReturnType<typeof vi.fn>).mockResolvedValue(DAEMON_INFO);

  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => PROJECTS,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// project list — themed output
// ===========================================================================

describe("loomflo project list — themed output", () => {
  it("prints project name via process.stdout.write", async () => {
    const cmd = createProjectCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "project", "list"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("alpha");
  });

  it("renders a table-like format with status", async () => {
    const cmd = createProjectCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "project", "list"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("idle");
    expect(plain).toContain("proj_a");
  });
});

// ===========================================================================
// project list --json
// ===========================================================================

describe("loomflo project list --json", () => {
  it("prints a JSON array of projects", async () => {
    const cmd = createProjectCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "project", "list", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);

    const project = parsed[0] as Record<string, unknown>;
    expect(project).toHaveProperty("id", "proj_a");
    expect(project).toHaveProperty("name", "alpha");
    expect(project).toHaveProperty("status", "idle");
  });
});
