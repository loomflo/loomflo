import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

vi.mock("../../../src/observation/api.js", () => ({
  httpGet: vi.fn().mockResolvedValue({
    graph: {
      nodes: {
        a: { id: "a", title: "root", status: "completed" },
        b: { id: "b", title: "mid", status: "running" },
      },
      edges: [{ from: "a", to: "b" }],
      topology: ["a", "b"],
    },
  }),
}));

vi.mock("../../../src/project-resolver.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({
    identity: { id: "proj_x", name: "demo" },
    projectRoot: "/demo",
    created: false,
  }),
}));

describe("loomflo tree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the ASCII graph", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createTreeCommand } = await import("../../../src/commands/tree.js");
    await createTreeCommand().parseAsync(["node", "tree"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("root");
    expect(plain).toContain("mid");
  });
});
