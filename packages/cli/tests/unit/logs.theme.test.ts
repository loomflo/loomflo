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

import { createLogsCommand } from "../../src/commands/logs.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

const EVENTS_RESPONSE = {
  events: [
    {
      ts: "2026-01-01T00:00:00Z",
      type: "node_status",
      nodeId: "n1",
      agentId: null,
      details: {},
    },
  ],
  total: 1,
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
    info: { port: 4000, token: "t", pid: 1234, version: "0.2.0" },
    request: mockRequest,
  });

  mockRequest.mockResolvedValue(EVENTS_RESPONSE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Themed output
// ===========================================================================

describe("loomflo logs — themed output", () => {
  it("prints event type via process.stdout.write", async () => {
    const cmd = createLogsCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "logs"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("node_status");
  });

  it("includes node ID in themed output", async () => {
    const cmd = createLogsCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "logs"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("n1");
  });
});

// ===========================================================================
// JSON output (NDJSON)
// ===========================================================================

describe("loomflo logs --json", () => {
  it("prints NDJSON with event data", async () => {
    const cmd = createLogsCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "logs", "--json"]);

    const raw = stdoutWrites.join("").trim();
    // NDJSON: each line is a valid JSON object
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const event = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(event).toHaveProperty("type", "node_status");
    expect(event).toHaveProperty("nodeId", "n1");
    expect(event).toHaveProperty("ts");
  });
});
