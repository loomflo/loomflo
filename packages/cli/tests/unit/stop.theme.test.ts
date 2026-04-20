import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
// Constants
// ---------------------------------------------------------------------------

const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
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

  mockRequest.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Themed output
// ===========================================================================

describe("loomflo stop — themed output", () => {
  it("prints check-line with stopped message via process.stdout.write", async () => {
    const cmd = createStopCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "stop"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("stopped");
  });

  it("includes project name in themed output", async () => {
    const cmd = createStopCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "stop"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain(IDENTITY.name);
  });
});

// ===========================================================================
// JSON output
// ===========================================================================

describe("loomflo stop --json", () => {
  it("prints a JSON record with project info", async () => {
    const cmd = createStopCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "stop", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("project");

    const project = parsed["project"] as Record<string, unknown>;
    expect(project).toHaveProperty("id", IDENTITY.id);
    expect(project).toHaveProperty("name", IDENTITY.name);
  });
});
