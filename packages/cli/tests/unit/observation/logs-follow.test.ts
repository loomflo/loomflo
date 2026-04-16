import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

class FakeSubscription extends EventEmitter {
  closed = false;
  onMessage(cb: (m: unknown) => void): void { this.on("msg", cb); }
  onClose(cb: () => void): void { this.on("close", cb); }
  close(): void { this.closed = true; this.emit("close"); }
  _socket = {};
}

const fakeSub = new FakeSubscription();

vi.mock("../../../src/observation/ws.js", () => ({
  openSubscription: vi.fn().mockResolvedValue(fakeSub),
}));

vi.mock("../../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
  openClient: vi.fn().mockResolvedValue({
    request: vi.fn().mockResolvedValue({ events: [], total: 0 }),
  }),
}));

vi.mock("../../../src/project-resolver.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({
    identity: { id: "proj_x", name: "demo" },
    projectRoot: "/demo",
    created: false,
  }),
}));

describe("loomflo logs -f", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSub.closed = false;
    fakeSub.removeAllListeners();
  });

  it("streams events received over the subscription", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const { createLogsCommand } = await import("../../../src/commands/logs.js");
    const done = createLogsCommand().parseAsync(["node", "logs", "-f"]);

    // Give it time to connect, then emit an event
    await new Promise((r) => setTimeout(r, 30));
    fakeSub.emit("msg", {
      projectId: "proj_x",
      type: "node_status",
      nodeId: "impl-01",
      timestamp: "2026-04-15T00:00:00Z",
      status: "running",
    });

    // Then simulate SIGINT to stop
    await new Promise((r) => setTimeout(r, 30));
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 30));

    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("node_status");
    expect(plain).toContain("impl-01");

    exitSpy.mockRestore();
  });
});
