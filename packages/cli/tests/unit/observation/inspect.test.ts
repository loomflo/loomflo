import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

vi.mock("../../../src/observation/api.js", () => ({
  httpGet: vi.fn().mockResolvedValue({
    id: "impl-01",
    title: "auth-middleware",
    status: "running",
    agents: [
      { id: "a1", role: "loomex", status: "running", tokens: 4321 },
      { id: "a2", role: "reviewer", status: "idle", tokens: 0 },
    ],
    fileOwnership: ["src/auth/middleware.ts"],
    retryCount: 1,
    maxRetries: 3,
    reviewReport: null,
    cost: 0.26,
    startedAt: "2026-04-15T00:01:00Z",
    completedAt: null,
  }),
}));

vi.mock("../../../src/project-resolver.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({
    identity: { id: "proj_x", name: "demo" },
    projectRoot: "/demo",
    created: false,
  }),
}));

describe("loomflo inspect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a multi-section detail view", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createInspectCommand } = await import("../../../src/commands/inspect.js");
    await createInspectCommand().parseAsync(["node", "inspect", "impl-01"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("impl-01");
    expect(plain).toContain("auth-middleware");
    expect(plain).toContain("Agents");
    expect(plain).toContain("loomex");
    expect(plain).toContain("Files");
    expect(plain).toContain("src/auth/middleware.ts");
  });

  it("--json emits the raw detail object", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createInspectCommand } = await import("../../../src/commands/inspect.js");
    await createInspectCommand().parseAsync(["node", "inspect", "impl-01", "--json"]);
    const parsed = JSON.parse(writes.join("").trim()) as { id: string };
    expect(parsed.id).toBe("impl-01");
  });
});
