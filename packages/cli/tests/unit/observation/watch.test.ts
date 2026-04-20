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

vi.mock("../../../src/observation/api.js", () => ({
  fetchProjectsRuntime: vi.fn().mockResolvedValue([
    { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", nodeCount: 5, cost: 0.42, uptimeSec: 10 },
  ]),
}));

vi.mock("../../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

describe("loomflo watch (cross-project)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSub.closed = false;
    fakeSub.removeAllListeners();
  });

  it("writes an initial frame and unsubscribes on SIGINT", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    // Override process.exit to not actually exit
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const { createWatchCommand } = await import("../../../src/commands/watch.js");
    const cmd = createWatchCommand();
    const done = cmd.parseAsync(["node", "watch", "-n", "1"]);

    // Give it time to render the initial frame, then simulate SIGINT
    await new Promise((r) => setTimeout(r, 50));
    process.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 50));

    expect(writes.join("")).toContain("alpha");
    expect(fakeSub.closed).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });
});
