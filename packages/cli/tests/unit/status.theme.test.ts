import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

let stdoutWrites: string[];
let stderrWrites: string[];

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
    info: { port: 4000, token: "t", pid: 1234, version: "0.3.0" },
    request: mockRequest,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setupResponses(responses: Record<string, unknown>): void {
  mockRequest.mockImplementation((_method: string, path: string) => {
    const basePath = path.split("?")[0] ?? path;
    const value = responses[basePath];
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  });
}

describe("loomflo status — themed output", () => {
  it("prints heading + kv pairs via process.stdout.write", async () => {
    setupResponses({
      "/workflow": {
        id: "wf-abc",
        status: "running",
        description: "Build a todo app",
        projectPath: "/tmp/p",
        totalCost: 1.5,
        createdAt: "2026-03-30T00:00:00Z",
        updatedAt: "2026-03-30T01:00:00Z",
        graph: {
          nodes: [{ id: "n1", title: "Planning", type: "task" }],
          edges: [],
          topology: "linear",
        },
      },
      "/costs": {
        total: 2.5,
        budgetLimit: 10.0,
        budgetRemaining: 7.5,
        nodes: [{ id: "n1", title: "Planning", cost: 0.8, retries: 0 }],
        loomCost: 0.3,
      },
      "/nodes": [
        {
          id: "n1",
          title: "Planning",
          status: "running",
          agentCount: 2,
          cost: 0.8,
          retryCount: 0,
        },
      ],
    });

    const cmd = createStatusCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "status"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("Workflow");
    expect(plain).toContain("wf-abc");
    expect(plain).toContain("running");
    expect(plain).toContain("$2.50");
  });
});

describe("loomflo status --json", () => {
  it("prints a JSON object with workflow+cost info", async () => {
    setupResponses({
      "/workflow": {
        id: "wf-abc",
        status: "running",
        description: "Build a todo app",
        projectPath: "/tmp/p",
        totalCost: 1.5,
        createdAt: "2026-03-30T00:00:00Z",
        updatedAt: "2026-03-30T01:00:00Z",
        graph: {
          nodes: [{ id: "n1", title: "Planning", type: "task" }],
          edges: [],
          topology: "linear",
        },
      },
      "/costs": {
        total: 2.5,
        budgetLimit: 10.0,
        budgetRemaining: 7.5,
        nodes: [],
        loomCost: 0.3,
      },
      "/nodes": [],
    });

    const cmd = createStatusCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "status", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("workflow");
    expect(parsed).toHaveProperty("cost");
  });
});
