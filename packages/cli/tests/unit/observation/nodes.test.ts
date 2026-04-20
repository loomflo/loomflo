import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

vi.mock("../../../src/observation/api.js", () => ({
  httpGet: vi.fn().mockResolvedValue({
    nodes: [
      { id: "spec-01", title: "Define auth model", status: "completed", cost: 0.12, agentCount: 1, retryCount: 0, startedAt: "2026-04-15T00:00:00Z", completedAt: "2026-04-15T00:00:42Z" },
      { id: "impl-01", title: "auth-middleware", status: "running", cost: 0.26, agentCount: 2, retryCount: 1, startedAt: "2026-04-15T00:01:00Z", completedAt: null },
      { id: "impl-02", title: "session-store", status: "pending", cost: 0, agentCount: 0, retryCount: 0, startedAt: null, completedAt: null },
    ],
  }),
}));

vi.mock("../../../src/project-resolver.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({
    identity: { id: "proj_x", name: "demo" },
    projectRoot: "/demo",
    created: false,
  }),
}));

describe("loomflo nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the nodes table with TITLE + STATUS + DUR", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createNodesCommand } = await import("../../../src/commands/nodes.js");
    await createNodesCommand().parseAsync(["node", "nodes", "--all"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("spec-01");
    expect(plain).toContain("impl-01");
    expect(plain).toContain("auth-middleware");
  });

  it("--json emits the raw nodes array", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createNodesCommand } = await import("../../../src/commands/nodes.js");
    await createNodesCommand().parseAsync(["node", "nodes", "--json", "--all"]);
    const parsed = JSON.parse(writes.join("").trim()) as unknown[];
    expect(parsed).toHaveLength(3);
  });

  it("without --all, filters out completed and failed nodes", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createNodesCommand } = await import("../../../src/commands/nodes.js");
    await createNodesCommand().parseAsync(["node", "nodes"]);
    const plain = stripAnsi(writes.join(""));
    // "completed" node spec-01 should be filtered out
    expect(plain).not.toContain("spec-01");
    // running and pending should remain
    expect(plain).toContain("impl-01");
    expect(plain).toContain("impl-02");
  });
});
