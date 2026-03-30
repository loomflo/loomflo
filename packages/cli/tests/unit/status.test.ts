/**
 * Unit tests for packages/cli/src/commands/status.ts — createStatusCommand.
 *
 * Covers happy path with active nodes and cost data, daemon not running,
 * no active workflow (404), network errors, no active nodes, cost fetch
 * failures, and null budget fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

const mockGet = vi.fn();

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn(),
  DaemonClient: vi.fn().mockImplementation(() => ({ get: mockGet })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { DaemonClient, readDaemonConfig } from "../../src/client.js";
import { createStatusCommand } from "../../src/commands/status.js";

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
 * Run the status command.
 *
 * @returns A promise that resolves or rejects based on command execution.
 */
async function runStatus(): Promise<void> {
  const cmd = createStatusCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "status"]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let mockProcessExit: ReturnType<typeof vi.fn>;
let mockConsoleLog: ReturnType<typeof vi.fn>;
let mockConsoleError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockProcessExit = vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  }) as unknown as ReturnType<typeof vi.fn>;

  mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  mockGet.mockReset();
  mockReadDaemonConfig.mockReset();
  MockDaemonClient.mockReset().mockImplementation(() => ({ get: mockGet }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Happy path
// ===========================================================================

/** Tests for successful status display with running workflow, active nodes, and costs. */
describe("status command — happy path", () => {
  it("should display workflow info, active nodes, cost table, and cost summary", async () => {
    mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

    mockGet.mockImplementation((path: string) => {
      if (path === "/workflow") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            id: "wf-abc123",
            status: "running",
            description: "Build a todo app",
            projectPath: "/tmp/project",
            totalCost: 1.5,
            createdAt: "2026-03-30T00:00:00Z",
            updatedAt: "2026-03-30T01:00:00Z",
            graph: { nodes: [], edges: [], topology: "dag" },
          },
        });
      }
      if (path === "/costs") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            total: 1.5,
            budgetLimit: 10,
            budgetRemaining: 8.5,
            loomCost: 0.05,
            nodes: [
              { id: "n1", title: "Setup", cost: 0.75, retries: 0 },
              { id: "n2", title: "Implement", cost: 0.75, retries: 1 },
            ],
          },
        });
      }
      if (path === "/nodes") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [
            { id: "n1", title: "Setup", status: "done", agentCount: 1, cost: 0.75, retryCount: 0 },
            {
              id: "n2",
              title: "Implement",
              status: "running",
              agentCount: 2,
              cost: 0.75,
              retryCount: 1,
            },
          ],
        });
      }
      return Promise.reject(new Error("unexpected path"));
    });

    await runStatus();

    // Workflow summary
    expect(mockConsoleLog).toHaveBeenCalledWith("Workflow");
    expect(mockConsoleLog).toHaveBeenCalledWith("  ID:          wf-abc123");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Status:      running");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Description: Build a todo app");

    // Active nodes section
    expect(mockConsoleLog).toHaveBeenCalledWith("Active Nodes");
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining("Implement [running] (2 agents)"),
    );

    // Cost table
    expect(mockConsoleLog).toHaveBeenCalledWith("Node Costs");

    // Cost summary
    expect(mockConsoleLog).toHaveBeenCalledWith("Cost Summary");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Total Cost:       $1.50");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Limit:     $10.00");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Remaining: $8.50");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Loom Overhead:    $0.05");

    // DaemonClient constructed with correct args
    expect(MockDaemonClient).toHaveBeenCalledWith(4000, "test-token");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Daemon not running
// ===========================================================================

/** Tests for when readDaemonConfig throws (daemon not running). */
describe("status command — daemon not running", () => {
  it("should log an error and exit(1) when readDaemonConfig throws", async () => {
    mockReadDaemonConfig.mockRejectedValue(new Error("ENOENT"));

    await expect(runStatus()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Daemon is not running. Start with: loomflo start",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// No workflow (404)
// ===========================================================================

/** Tests for when no active workflow exists (GET /workflow returns 404). */
describe("status command — no workflow (404)", () => {
  it("should log 'No active workflow' and return without exit", async () => {
    mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

    mockGet.mockImplementation((path: string) => {
      if (path === "/workflow") {
        return Promise.resolve({
          ok: false,
          status: 404,
          data: { error: "Not found" },
        });
      }
      if (path === "/costs") {
        return Promise.resolve({ ok: true, status: 200, data: { total: 0 } });
      }
      if (path === "/nodes") {
        return Promise.resolve({ ok: true, status: 200, data: [] });
      }
      return Promise.reject(new Error("unexpected path"));
    });

    await runStatus();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "No active workflow. Start one with: loomflo start",
    );
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Network error
// ===========================================================================

/** Tests for network errors when the daemon is unreachable. */
describe("status command — network error", () => {
  it("should log failed to connect and exit(1) when GET /workflow rejects", async () => {
    mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

    mockGet.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(runStatus()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Failed to connect to daemon.");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// No active nodes
// ===========================================================================

/** Tests for when all nodes are completed (no active nodes to display). */
describe("status command — no active nodes", () => {
  it("should not display Active Nodes section when all nodes are done", async () => {
    mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

    mockGet.mockImplementation((path: string) => {
      if (path === "/workflow") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            id: "wf-done",
            status: "completed",
            description: "Finished work",
            projectPath: "/tmp/project",
            totalCost: 2.0,
            createdAt: "2026-03-30T00:00:00Z",
            updatedAt: "2026-03-30T02:00:00Z",
            graph: { nodes: [], edges: [], topology: "dag" },
          },
        });
      }
      if (path === "/costs") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            total: 2.0,
            budgetLimit: 10,
            budgetRemaining: 8.0,
            loomCost: 0.1,
            nodes: [],
          },
        });
      }
      if (path === "/nodes") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [
            { id: "n1", title: "Setup", status: "done", agentCount: 0, cost: 1.0, retryCount: 0 },
            {
              id: "n2",
              title: "Implement",
              status: "done",
              agentCount: 0,
              cost: 1.0,
              retryCount: 0,
            },
          ],
        });
      }
      return Promise.reject(new Error("unexpected path"));
    });

    await runStatus();

    // Workflow summary is displayed
    expect(mockConsoleLog).toHaveBeenCalledWith("Workflow");

    // Active Nodes section should NOT appear
    const logCalls = mockConsoleLog.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(logCalls).not.toContain("Active Nodes");

    // Cost table should still appear (nodes exist, just not active)
    expect(mockConsoleLog).toHaveBeenCalledWith("Node Costs");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// No cost data
// ===========================================================================

/** Tests for when the costs endpoint fails but workflow still displays. */
describe("status command — no cost data", () => {
  it("should still show workflow summary when /costs fails", async () => {
    mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

    mockGet.mockImplementation((path: string) => {
      if (path === "/workflow") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            id: "wf-nocost",
            status: "running",
            description: "Testing costs failure",
            projectPath: "/tmp/project",
            totalCost: 0,
            createdAt: "2026-03-30T00:00:00Z",
            updatedAt: "2026-03-30T01:00:00Z",
            graph: { nodes: [], edges: [], topology: "dag" },
          },
        });
      }
      if (path === "/costs") {
        return Promise.reject(new Error("costs endpoint down"));
      }
      if (path === "/nodes") {
        return Promise.resolve({ ok: true, status: 200, data: [] });
      }
      return Promise.reject(new Error("unexpected path"));
    });

    await runStatus();

    // Workflow summary is displayed
    expect(mockConsoleLog).toHaveBeenCalledWith("Workflow");
    expect(mockConsoleLog).toHaveBeenCalledWith("  ID:          wf-nocost");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Status:      running");

    // Cost Summary should NOT appear
    const logCalls = mockConsoleLog.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(logCalls).not.toContain("Cost Summary");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Null budget fields
// ===========================================================================

/** Tests for null budgetLimit and budgetRemaining display values. */
describe("status command — null budget fields", () => {
  it("should show 'None' for null budgetLimit and 'N/A' for null budgetRemaining", async () => {
    mockReadDaemonConfig.mockResolvedValue(DAEMON_CONFIG);

    mockGet.mockImplementation((path: string) => {
      if (path === "/workflow") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            id: "wf-nobudget",
            status: "running",
            description: "No budget set",
            projectPath: "/tmp/project",
            totalCost: 1.0,
            createdAt: "2026-03-30T00:00:00Z",
            updatedAt: "2026-03-30T01:00:00Z",
            graph: { nodes: [], edges: [], topology: "dag" },
          },
        });
      }
      if (path === "/costs") {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: {
            total: 1.0,
            budgetLimit: null,
            budgetRemaining: null,
            loomCost: 0.02,
            nodes: [],
          },
        });
      }
      if (path === "/nodes") {
        return Promise.resolve({ ok: true, status: 200, data: [] });
      }
      return Promise.reject(new Error("unexpected path"));
    });

    await runStatus();

    expect(mockConsoleLog).toHaveBeenCalledWith("Cost Summary");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Total Cost:       $1.00");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Limit:     None");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Remaining: N/A");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Loom Overhead:    $0.02");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});
