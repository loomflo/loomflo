import { describe, it, expect, beforeEach } from "vitest";
import { MessageBus } from "../../src/agents/message-bus.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** UUID v4 regex for structural validation. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 datetime regex (simplified). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let bus: MessageBus;

beforeEach(() => {
  bus = new MessageBus();
});

// ===========================================================================
// Registration
// ===========================================================================

describe("registerAgent", () => {
  it("creates a queue for the agent", () => {
    bus.registerAgent("agent-1", "node-1");
    // Verify by collecting — registered agent returns empty array, not undefined behavior.
    const msgs = bus.collect("agent-1", "node-1");
    expect(msgs).toEqual([]);
  });

  it("is idempotent (double registration is a no-op)", async () => {
    bus.registerAgent("agent-1", "node-1");
    bus.registerAgent("agent-2", "node-1");

    // Send a message before double-register.
    await bus.send("agent-2", "agent-1", "node-1", "before");

    // Re-register agent-1 — must not clear its queue.
    bus.registerAgent("agent-1", "node-1");

    const msgs = bus.collect("agent-1", "node-1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("before");
  });
});

describe("unregisterAgent", () => {
  it("removes the queue", async () => {
    bus.registerAgent("agent-1", "node-1");
    bus.registerAgent("agent-2", "node-1");
    await bus.send("agent-2", "agent-1", "node-1", "hi");

    bus.unregisterAgent("agent-1", "node-1");

    // Collecting from unregistered agent returns empty.
    const msgs = bus.collect("agent-1", "node-1");
    expect(msgs).toEqual([]);

    // Sending to unregistered agent should fail.
    await expect(bus.send("agent-2", "agent-1", "node-1", "gone")).rejects.toThrow(
      'recipient "agent-1" is not registered',
    );
  });

  it("cleans up empty node entries", async () => {
    bus.registerAgent("agent-1", "node-1");
    bus.unregisterAgent("agent-1", "node-1");

    // Node should be gone entirely — sending fails with "no agents registered".
    await expect(bus.send("anyone", "anyone", "node-1", "msg")).rejects.toThrow(
      'no agents registered for node "node-1"',
    );
  });
});

// ===========================================================================
// Send
// ===========================================================================

describe("send", () => {
  it("delivers message to recipient within same node", async () => {
    bus.registerAgent("sender", "node-1");
    bus.registerAgent("receiver", "node-1");

    await bus.send("sender", "receiver", "node-1", "hello");

    const msgs = bus.collect("receiver", "node-1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("hello");
    expect(msgs[0]!.from).toBe("sender");
    expect(msgs[0]!.to).toBe("receiver");
  });

  it("logs message to the global message log", async () => {
    bus.registerAgent("a", "n1");
    bus.registerAgent("b", "n1");

    await bus.send("a", "b", "n1", "logged");

    const log = bus.getMessageLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.content).toBe("logged");
  });

  it("rejects if no agents registered for node", async () => {
    await expect(bus.send("a", "b", "nonexistent", "msg")).rejects.toThrow(
      'no agents registered for node "nonexistent"',
    );
  });

  it("rejects if sender not registered to node", async () => {
    bus.registerAgent("receiver", "node-1");

    await expect(bus.send("unknown-sender", "receiver", "node-1", "msg")).rejects.toThrow(
      'sender "unknown-sender" is not registered to node "node-1"',
    );
  });

  it("rejects if recipient not registered to node", async () => {
    bus.registerAgent("sender", "node-1");

    await expect(bus.send("sender", "unknown-receiver", "node-1", "msg")).rejects.toThrow(
      'recipient "unknown-receiver" is not registered to node "node-1"',
    );
  });

  it("creates message with correct structure", async () => {
    bus.registerAgent("a", "n1");
    bus.registerAgent("b", "n1");

    await bus.send("a", "b", "n1", "payload");

    const msgs = bus.collect("b", "n1");
    expect(msgs).toHaveLength(1);
    const msg = msgs[0]!;
    expect(msg.id).toMatch(UUID_RE);
    expect(msg.from).toBe("a");
    expect(msg.to).toBe("b");
    expect(msg.nodeId).toBe("n1");
    expect(msg.content).toBe("payload");
    expect(msg.timestamp).toMatch(ISO_RE);
  });
});

// ===========================================================================
// Broadcast
// ===========================================================================

describe("broadcast", () => {
  it("delivers to all agents in node except sender", async () => {
    bus.registerAgent("sender", "node-1");
    bus.registerAgent("r1", "node-1");
    bus.registerAgent("r2", "node-1");

    await bus.broadcast("sender", "node-1", "announcement");

    const r1Msgs = bus.collect("r1", "node-1");
    const r2Msgs = bus.collect("r2", "node-1");
    const senderMsgs = bus.collect("sender", "node-1");

    expect(r1Msgs).toHaveLength(1);
    expect(r1Msgs[0]!.content).toBe("announcement");
    expect(r2Msgs).toHaveLength(1);
    expect(r2Msgs[0]!.content).toBe("announcement");
    expect(senderMsgs).toHaveLength(0);
  });

  it("rejects if sender not registered", async () => {
    bus.registerAgent("other", "node-1");

    await expect(bus.broadcast("unknown", "node-1", "msg")).rejects.toThrow(
      'sender "unknown" is not registered to node "node-1"',
    );
  });

  it("creates separate messages for each recipient (different IDs)", async () => {
    bus.registerAgent("sender", "node-1");
    bus.registerAgent("r1", "node-1");
    bus.registerAgent("r2", "node-1");

    await bus.broadcast("sender", "node-1", "hello all");

    const r1Msgs = bus.collect("r1", "node-1");
    const r2Msgs = bus.collect("r2", "node-1");

    expect(r1Msgs[0]!.id).not.toBe(r2Msgs[0]!.id);
    expect(r1Msgs[0]!.to).toBe("r1");
    expect(r2Msgs[0]!.to).toBe("r2");
  });

  it("delivers nothing when only sender is registered", async () => {
    bus.registerAgent("lonely", "node-1");

    await bus.broadcast("lonely", "node-1", "echo?");

    const msgs = bus.collect("lonely", "node-1");
    expect(msgs).toHaveLength(0);

    // Nothing logged either.
    expect(bus.getMessageLog()).toHaveLength(0);
  });

  it("rejects if no agents registered for node", async () => {
    await expect(bus.broadcast("a", "nonexistent", "msg")).rejects.toThrow(
      'no agents registered for node "nonexistent"',
    );
  });
});

// ===========================================================================
// Collect
// ===========================================================================

describe("collect", () => {
  it("returns queued messages and drains the queue", async () => {
    bus.registerAgent("a", "n1");
    bus.registerAgent("b", "n1");

    await bus.send("a", "b", "n1", "msg1");
    await bus.send("a", "b", "n1", "msg2");

    const msgs = bus.collect("b", "n1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.content).toBe("msg1");
    expect(msgs[1]!.content).toBe("msg2");
  });

  it("returns empty array when no messages queued", () => {
    bus.registerAgent("a", "n1");
    const msgs = bus.collect("a", "n1");
    expect(msgs).toEqual([]);
  });

  it("returns empty array for unregistered agent/node", () => {
    const byNode = bus.collect("nobody", "no-node");
    expect(byNode).toEqual([]);

    bus.registerAgent("a", "n1");
    const byAgent = bus.collect("unknown", "n1");
    expect(byAgent).toEqual([]);
  });

  it("subsequent collect returns empty (queue was drained)", async () => {
    bus.registerAgent("a", "n1");
    bus.registerAgent("b", "n1");

    await bus.send("a", "b", "n1", "once");

    const first = bus.collect("b", "n1");
    expect(first).toHaveLength(1);

    const second = bus.collect("b", "n1");
    expect(second).toHaveLength(0);
  });
});

// ===========================================================================
// Cross-node rejection
// ===========================================================================

describe("cross-node rejection", () => {
  it("agents in different nodes cannot communicate via send", async () => {
    bus.registerAgent("a", "node-1");
    bus.registerAgent("b", "node-2");

    // Sender on node-1, recipient on node-2 — recipient not found on node-1.
    await expect(bus.send("a", "b", "node-1", "cross")).rejects.toThrow(
      'recipient "b" is not registered to node "node-1"',
    );

    // Sender on node-2, recipient on node-1 — recipient not found on node-2.
    await expect(bus.send("b", "a", "node-2", "cross")).rejects.toThrow(
      'recipient "a" is not registered to node "node-2"',
    );
  });

  it("agents in different nodes do not receive broadcasts from other nodes", async () => {
    bus.registerAgent("sender", "node-1");
    bus.registerAgent("local", "node-1");
    bus.registerAgent("remote", "node-2");

    await bus.broadcast("sender", "node-1", "node-1 only");

    const localMsgs = bus.collect("local", "node-1");
    const remoteMsgs = bus.collect("remote", "node-2");

    expect(localMsgs).toHaveLength(1);
    expect(remoteMsgs).toHaveLength(0);
  });
});

// ===========================================================================
// Message log
// ===========================================================================

describe("getMessageLog", () => {
  it("returns all messages when no nodeId filter", async () => {
    bus.registerAgent("a", "n1");
    bus.registerAgent("b", "n1");
    bus.registerAgent("c", "n2");
    bus.registerAgent("d", "n2");

    await bus.send("a", "b", "n1", "msg1");
    await bus.send("c", "d", "n2", "msg2");

    const log = bus.getMessageLog();
    expect(log).toHaveLength(2);
  });

  it("filters by nodeId when provided", async () => {
    bus.registerAgent("a", "n1");
    bus.registerAgent("b", "n1");
    bus.registerAgent("c", "n2");
    bus.registerAgent("d", "n2");

    await bus.send("a", "b", "n1", "for-n1");
    await bus.send("c", "d", "n2", "for-n2");

    const n1Log = bus.getMessageLog("n1");
    expect(n1Log).toHaveLength(1);
    expect(n1Log[0]!.content).toBe("for-n1");

    const n2Log = bus.getMessageLog("n2");
    expect(n2Log).toHaveLength(1);
    expect(n2Log[0]!.content).toBe("for-n2");
  });

  it("returns empty for unknown nodeId", () => {
    expect(bus.getMessageLog("nonexistent")).toHaveLength(0);
  });

  it("includes broadcast messages in log", async () => {
    bus.registerAgent("sender", "n1");
    bus.registerAgent("r1", "n1");
    bus.registerAgent("r2", "n1");

    await bus.broadcast("sender", "n1", "bc");

    const log = bus.getMessageLog("n1");
    expect(log).toHaveLength(2); // One per recipient.
  });
});
