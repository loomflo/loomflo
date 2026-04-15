import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

const mockRequest = vi.fn();
const mockResolveProject = vi.fn();
const mockOpenClient = vi.fn();

vi.mock("../../src/project-resolver.js", () => ({
  resolveProject: (...a: unknown[]) => mockResolveProject(...a),
}));

vi.mock("../../src/client.js", () => ({
  openClient: (...a: unknown[]) => mockOpenClient(...a),
}));

import { createStatusCommand } from "../../src/commands/status.js";

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

interface CostsData {
  total: number;
  budgetLimit: number | null;
  budgetRemaining: number | null;
  nodes: { id: string; title: string; cost: number; retries: number }[];
  loomCost: number;
}

interface NodeData {
  id: string;
  title: string;
  status: string;
  agentCount: number;
  cost: number;
  retryCount: number;
}

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

function makeNodes(nodes?: NodeData[]): NodeData[] {
  return (
    nodes ?? [
      { id: "n1", title: "Planning", status: "running", agentCount: 2, cost: 0.8, retryCount: 0 },
      { id: "n2", title: "Implementation", status: "review", agentCount: 3, cost: 1.7, retryCount: 1 },
    ]
  );
}

const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

let stdoutWrites: string[];
let stderrWrites: string[];

function setupResponses(responses: Record<string, unknown>): void {
  mockRequest.mockImplementation((_method: string, path: string) => {
    const basePath = path.split("?")[0] ?? path;
    const value = responses[basePath];
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  });
}

function stdoutPlain(): string {
  return stdoutWrites.map(stripAnsi).join("");
}

async function runStatus(args: string[] = ["node", "status"]): Promise<void> {
  const cmd = createStatusCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args);
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  });

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
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("status command — happy path", () => {
  it("should display workflow ID, status, description, active nodes, cost table, and cost summary", async () => {
    setupResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stdoutPlain();
    expect(plain).toContain("Workflow");
    expect(plain).toContain("wf-abc123");
    expect(plain).toContain("running");
    expect(plain).toContain("Build a todo app");
    expect(plain).toContain("Active Nodes");
    expect(plain).toContain("Planning");
    expect(plain).toContain("Implementation");
    expect(plain).toContain("Node Costs");
    expect(plain).toContain("$0.80");
    expect(plain).toContain("$1.70");
    expect(plain).toContain("Cost Summary");
    expect(plain).toContain("$2.50");
    expect(plain).toContain("$10.00");
    expect(plain).toContain("$7.50");
    expect(plain).toContain("$0.30");
  });
});

describe("status command — daemon not running", () => {
  it("should write error to stderr when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await runStatus();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
  });
});

describe("status command — no active workflow (404)", () => {
  it("should show 'No active workflow' message", async () => {
    setupResponses({
      "/workflow": new Error("GET /workflow -> HTTP 404"),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stdoutPlain();
    expect(plain).toContain("No active workflow");
    expect(process.exitCode).toBeUndefined();
  });
});

describe("status command — failed to connect", () => {
  it("should write error when GET /workflow rejects with non-404", async () => {
    setupResponses({
      "/workflow": new Error("GET /workflow -> HTTP 500"),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Failed to connect to daemon");
    expect(process.exitCode).toBe(1);
  });

  it("should write error when request rejects with a network error", async () => {
    setupResponses({
      "/workflow": new Error("ECONNREFUSED"),
      "/costs": makeCosts(),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Failed to connect to daemon");
    expect(process.exitCode).toBe(1);
  });
});

describe("status command — no active nodes", () => {
  it("should not display 'Active Nodes' section when all nodes are done or pending", async () => {
    const inactiveNodes: NodeData[] = [
      { id: "n1", title: "Planning", status: "done", agentCount: 2, cost: 0.8, retryCount: 0 },
      { id: "n2", title: "Setup", status: "pending", agentCount: 0, cost: 0.0, retryCount: 0 },
    ];

    setupResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts(),
      "/nodes": makeNodes(inactiveNodes),
    });

    await runStatus();

    const plain = stdoutPlain();
    expect(plain).toContain("Workflow");
    expect(plain).not.toContain("Active Nodes");
    expect(plain).toContain("Node Costs");
  });
});

describe("status command — no cost data", () => {
  it("should show workflow summary without cost section when /costs rejects", async () => {
    setupResponses({
      "/workflow": makeWorkflow(),
      "/costs": new Error("GET /costs -> HTTP 503"),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stdoutPlain();
    expect(plain).toContain("Workflow");
    expect(plain).toContain("wf-abc123");
    expect(plain).not.toContain("Cost Summary");
  });
});

describe("status command — budget limit null", () => {
  it("should display 'None' for budget limit when budgetLimit is null", async () => {
    setupResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts({ budgetLimit: null }),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stdoutPlain();
    expect(plain).toContain("None");
  });
});

describe("status command — budget remaining null", () => {
  it("should display 'N/A' for budget remaining when budgetRemaining is null", async () => {
    setupResponses({
      "/workflow": makeWorkflow(),
      "/costs": makeCosts({ budgetRemaining: null }),
      "/nodes": makeNodes(),
    });

    await runStatus();

    const plain = stdoutPlain();
    expect(plain).toContain("N/A");
  });
});

describe("status command — formatCost formatting", () => {
  it("should format costs with $ prefix and exactly 2 decimal places", async () => {
    setupResponses({
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

    const plain = stdoutPlain();
    expect(plain).toContain("$1234.50");
    expect(plain).toContain("$0.10");
    expect(plain).toContain("$5000.00");
    expect(plain).toContain("$3765.50");
    expect(plain).toContain("$0.00");
  });
});

describe("status command — not a loomflo project", () => {
  it("should write error to stderr when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await runStatus();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("not a loomflo project");
    expect(process.exitCode).toBe(1);
  });
});
