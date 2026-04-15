/**
 * Unit tests for packages/cli/src/commands/status.ts — createStatusCommand.
 *
 * Covers happy path with active workflow, daemon not running, no active workflow (404),
 * connection failures, non-404 API errors, inactive-only nodes, missing cost data,
 * null budget values, and dollar formatting via formatCost.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { createStatusCommand } from "../../src/commands/status.js";

// ---------------------------------------------------------------------------
// Types (mirror internal types from status.ts for test data)
// ---------------------------------------------------------------------------

/** Shape of the workflow API response body used in tests. */
interface WorkflowData {
  id: string;
  status: string;
  description: string;
  projectPath: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  graph: {
    nodes: { id: string; title: string; type: string }[];
    edges: { source: string; target: string }[];
    topology: string;
  };
}

/** Shape of the costs API response body used in tests. */
interface CostsData {
  total: number;
  budgetLimit: number | null;
  budgetRemaining: number | null;
  nodes: { id: string; title: string; cost: number; retries: number }[];
  loomCost: number;
}

/** Shape of a single node entry used in tests. */
interface NodeData {
  id: string;
  title: string;
  status: string;
  agentCount: number;
  cost: number;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

/**
 * Create a successful workflow response (raw data, no envelope).
 *
 * @param overrides - Partial workflow fields to override defaults.
 * @returns A WorkflowData object.
 */
function makeWorkflow(overrides?: Partial<WorkflowData>): WorkflowData {
  return {
    id: "wf-abc123",
    status: "running",
    description: "Build a todo app",
    projectPath: "/tmp/project",
    totalCost: 1.5,
    createdAt: "2026-03-30T00:00:00Z",
    updatedAt: "2026-03-30T01:00:00Z",
    graph: {
      nodes: [
        { id: "n1", title: "Planning", type: "task" },
        { id: "n2", title: "Implementation", type: "task" },
      ],
      edges: [{ source: "n1", target: "n2" }],
      topology: "linear",
    },
    ...overrides,
  };
}

/**
 * Create a successful costs response.
 *
 * @param overrides - Partial cost fields to override defaults.
 * @returns A CostsData object.
 */
function makeCosts(overrides?: Partial<CostsData>): CostsData {
  return {
    total: 2.5,
    budgetLimit: 10.0,
    budgetRemaining: 7.5,
    nodes: [
      { id: "n1", title: "Planning", cost: 0.8, retries: 0 },
      { id: "n2", title: "Implementation", cost: 1.7, retries: 1 },
    ],
    loomCost: 0.3,
    ...overrides,
  };
}

/**
 * Create a successful nodes response.
 *
 * @param nodes - Custom node entries. Defaults to two active nodes (running, review).
 * @returns An array of NodeData objects.
 */
function makeNodes(nodes?: NodeData[]): NodeData[] {
  return (
    nodes ?? [
      {
        id: "n1",
        title: "Planning",
        status: "running",
        agentCount: 2,
        cost: 0.8,
        retryCount: 0,
      },
      {
        id: "n2",
        title: "Implementation",
        status: "review",
        agentCount: 3,
        cost: 1.7,
        retryCount: 1,
      },
    ]
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default project identity returned by resolveProject. */
const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

/**
 * Execute the status command action.
 *
 * @returns A promise that resolves when the command completes or rejects
 *   if process.exit is called (mocked to throw).
 */
async function runStatus(): Promise<void> {
  const cmd = createStatusCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "status"]);
}

/**
 * Set up mockRequest to return path-based responses.
 *
 * Keys are API paths relative to the project (e.g. "/workflow").
 * Values that are Error instances cause the corresponding request() call
 * to reject; all other values resolve normally.
 *
 * @param responses - Map of API path to resolved value or Error (for rejection).
 */
function setupRequestResponses(responses: Record<string, unknown>): void {
  mockRequest.mockImplementation(
    (_method: string, path: string): Promise<unknown> => {
      // Strip query string for matching
      const basePath = path.split("?")[0] ?? path;
      const value = responses[basePath];
      if (value instanceof Error) {
        return Promise.reject(value);
      }
      return Promise.resolve(value);
    },
  );
}

/**
 * Collect all calls to console.log as an array of first-argument strings.
 *
 * @returns Array of strings passed as the first argument to console.log.
 */
function logLines(): string[] {
  return (mockConsoleLog.mock.calls as unknown[][]).map((call) => call[0] as string);
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Happy path
// ===========================================================================

/** Tests for successful status display with running workflow, active nodes, and costs. */
describe("status command — happy path", () => {
  it("should display workflow ID, status, description, active nodes, cost table, and cost summary", async () => {
    setupRequestResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await runStatus();

    // Workflow summary (sectionHeader adds bold+underline ANSI codes)
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mWorkflow\x1b[0m");
    expect(mockConsoleLog).toHaveBeenCalledWith("  ID:          wf-abc123");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Status:      \x1b[32mrunning\x1b[0m");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Description: Build a todo app");

    // Active nodes (both running and review) with colored statuses
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mActive Nodes\x1b[0m");
    expect(mockConsoleLog).toHaveBeenCalledWith("  - Planning [\x1b[32mrunning\x1b[0m] (2 agents)");
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "  - Implementation [\x1b[35mreview\x1b[0m] (3 agents)",
    );

    // Cost table
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mNode Costs\x1b[0m");
    const lines = logLines();
    const planningRow = lines.find(
      (l) => l.includes("Planning") && l.includes("running") && l.includes("$0.80"),
    );
    const implRow = lines.find(
      (l) => l.includes("Implementation") && l.includes("review") && l.includes("$1.70"),
    );
    expect(planningRow).toBeDefined();
    expect(implRow).toBeDefined();

    // Cost summary
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mCost Summary\x1b[0m");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Total Cost:       $2.50");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Limit:     $10.00");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Remaining: $7.50");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Loom Overhead:    $0.30");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Daemon not running (openClient rejects)
// ===========================================================================

/** Tests for when openClient rejects (daemon not running). */
describe("status command — daemon not running", () => {
  it("should log error and exit(1) when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await expect(runStatus()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: Daemon is not running. Run 'loomflo start' first.",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// No active workflow (404)
// ===========================================================================

/** Tests for when GET /workflow returns 404 (no active workflow). */
describe("status command — no active workflow (404)", () => {
  it("should log 'No active workflow' message and NOT exit with error", async () => {
    setupRequestResponses({
      "/workflow": new Error("GET /workflow -> HTTP 404"),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await runStatus();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "No active workflow. Start one with: loomflo start",
    );
    expect(mockProcessExit).not.toHaveBeenCalled();
    expect(mockConsoleError).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Failed to connect (workflow request rejects with non-404)
// ===========================================================================

/** Tests for when GET /workflow rejects with a non-404 error. */
describe("status command — failed to connect", () => {
  it("should log 'Failed to connect' error and exit(1) when GET /workflow rejects with non-404", async () => {
    setupRequestResponses({
      "/workflow": new Error("GET /workflow -> HTTP 500"),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await expect(runStatus()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Failed to connect to daemon.");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it("should log 'Failed to connect' when request rejects with a network error", async () => {
    setupRequestResponses({
      "/workflow": new Error("ECONNREFUSED"),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await expect(runStatus()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith("Failed to connect to daemon.");
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});

// ===========================================================================
// No active nodes
// ===========================================================================

/** Tests for when all nodes have non-active statuses (done, pending). */
describe("status command — no active nodes", () => {
  it("should not display 'Active Nodes' section when all nodes are done or pending", async () => {
    const inactiveNodes: NodeData[] = [
      { id: "n1", title: "Planning", status: "done", agentCount: 2, cost: 0.8, retryCount: 0 },
      { id: "n2", title: "Setup", status: "pending", agentCount: 0, cost: 0.0, retryCount: 0 },
    ];

    setupRequestResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts(),
      "/nodes": makeNodes(inactiveNodes),
    });

    await runStatus();

    // Workflow summary should still appear (with ANSI styling)
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mWorkflow\x1b[0m");

    // Active Nodes section must NOT appear
    const lines = logLines();
    expect(lines).not.toContain("\x1b[1m\x1b[4mActive Nodes\x1b[0m");

    // Node Costs table should still appear (nodes exist, just not active)
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mNode Costs\x1b[0m");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// No cost data
// ===========================================================================

/** Tests for when the /costs request fails — workflow summary still displays. */
describe("status command — no cost data", () => {
  it("should show workflow summary without cost section when /costs rejects", async () => {
    setupRequestResponses({
      "/workflow": makeWorkflow(),
      "/costs": new Error("GET /costs -> HTTP 503"),
      "/nodes": makeNodes(),
    });

    await runStatus();

    // Workflow summary should still display (with ANSI styling)
    expect(mockConsoleLog).toHaveBeenCalledWith("\x1b[1m\x1b[4mWorkflow\x1b[0m");
    expect(mockConsoleLog).toHaveBeenCalledWith("  ID:          wf-abc123");

    // Cost Summary section must NOT appear
    const lines = logLines();
    expect(lines).not.toContain("\x1b[1m\x1b[4mCost Summary\x1b[0m");

    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Budget limit null
// ===========================================================================

/** Tests for when budgetLimit is null in the costs response. */
describe("status command — budget limit null", () => {
  it("should display 'None' for budget limit when budgetLimit is null", async () => {
    setupRequestResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts({ budgetLimit: null }),
      "/nodes": makeNodes(),
    });

    await runStatus();

    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Limit:     None");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Budget remaining null
// ===========================================================================

/** Tests for when budgetRemaining is null in the costs response. */
describe("status command — budget remaining null", () => {
  it("should display 'N/A' for budget remaining when budgetRemaining is null", async () => {
    setupRequestResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts({ budgetRemaining: null }),
      "/nodes": makeNodes(),
    });

    await runStatus();

    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Remaining: N/A");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// formatCost helper (tested via output)
// ===========================================================================

/** Tests for the formatCost helper — verified through rendered cost output. */
describe("status command — formatCost formatting", () => {
  it("should format costs with $ prefix and exactly 2 decimal places", async () => {
    setupRequestResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts({
        total: 1234.5,
        loomCost: 0.1,
        budgetLimit: 5000,
        budgetRemaining: 3765.5,
      }),
      "/nodes": makeNodes([
        { id: "n1", title: "Node-A", status: "done", agentCount: 1, cost: 0, retryCount: 0 },
      ]),
    });

    await runStatus();

    // Cost summary values verified for $ prefix and 2 decimal places
    expect(mockConsoleLog).toHaveBeenCalledWith("  Total Cost:       $1234.50");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Loom Overhead:    $0.10");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Limit:     $5000.00");
    expect(mockConsoleLog).toHaveBeenCalledWith("  Budget Remaining: $3765.50");

    // Node cost table row should contain $0.00 for zero cost
    const lines = logLines();
    const nodeRow = lines.find((l) => l.includes("Node-A") && l.includes("done"));
    expect(nodeRow).toBeDefined();
    expect(nodeRow).toContain("$0.00");
  });
});

// ===========================================================================
// resolveProject fails (no .loomflo/project.json)
// ===========================================================================

/** Tests for when resolveProject rejects (not in a loomflo project directory). */
describe("status command — not a loomflo project", () => {
  it("should log error and exit(1) when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await expect(runStatus()).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith(
      "Error: /tmp is not a loomflo project (no .loomflo/project.json found).",
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
    expect(mockOpenClient).not.toHaveBeenCalled();
  });
});
