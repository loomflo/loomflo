import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Daemon } from "../../src/daemon.js";
import WebSocket from "ws";
import { once } from "node:events";

describe("WebSocket subscription", () => {
  let daemon: Daemon;
  let port: number;

  beforeEach(async () => {
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest("tok");
    // Read the bound port from the internal server address.
    const server = (
      daemon as unknown as { server: { server: { address: () => { port: number } } } }
    ).server;
    port = server.server.address().port;
  });

  afterEach(async () => await daemon.stop());

  it("forwards only subscribed project events", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["loomflo.bearer", "tok"]);
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "subscribe", projectIds: ["proj_a"] }));
    await new Promise((r) => setTimeout(r, 50));

    const received: unknown[] = [];
    ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));

    // @ts-expect-error protected test access
    daemon.broadcastForProject("proj_a", { type: "tick" });
    // @ts-expect-error protected test access
    daemon.broadcastForProject("proj_b", { type: "tick" });
    await new Promise((r) => setTimeout(r, 100));

    ws.close();
    const ticks = received.filter(
      (m): m is { projectId: string; type: string } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "tick",
    );
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.projectId).toBe("proj_a");
  });

  it("forwards all events when subscribed with {all: true}", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["loomflo.bearer", "tok"]);
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "subscribe", all: true }));
    await new Promise((r) => setTimeout(r, 50));

    const received: unknown[] = [];
    ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));

    // @ts-expect-error test access
    daemon.broadcastForProject("proj_a", { type: "tick" });
    // @ts-expect-error test access
    daemon.broadcastForProject("proj_b", { type: "tick" });
    await new Promise((r) => setTimeout(r, 100));

    ws.close();
    const ticks = received.filter(
      (m): m is { projectId: string; type: string } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "tick",
    );
    expect(ticks.map((t) => t.projectId).sort()).toEqual(["proj_a", "proj_b"]);
  });
});
