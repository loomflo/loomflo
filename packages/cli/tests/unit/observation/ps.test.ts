import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/observation/api.js", () => ({
  fetchProjectsRuntime: vi.fn().mockResolvedValue([
    { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", nodeCount: 5, cost: 0.42, uptimeSec: 134 },
    { id: "proj_b", name: "beta", projectPath: "/b", status: "idle", currentNodeId: null, nodeCount: 0, cost: 0, uptimeSec: 0 },
  ]),
}));

vi.mock("../../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

describe("loomflo ps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a themed table with PROJECT + STATUS + COST columns", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createPsCommand } = await import("../../../src/commands/ps.js");
    await createPsCommand().parseAsync(["node", "ps"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("PROJECT");
    expect(plain).toContain("alpha");
    expect(plain).toContain("beta");
    expect(plain).toMatch(/\$0\.42/);
  });

  it("--json emits the full runtime array", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createPsCommand } = await import("../../../src/commands/ps.js");
    await createPsCommand().parseAsync(["node", "ps", "--json"]);
    const parsed = JSON.parse(writes.join("").trim()) as unknown[];
    expect(parsed).toHaveLength(2);
  });
});
