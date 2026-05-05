/**
 * Tests for the runtime-related WebSocket event extensions added in Phase 4b.
 */

import { describe, it, expect } from "vitest";
import { WebSocketBroadcaster } from "../../src/api/websocket.js";

describe("WebSocketBroadcaster — runtime extensions", () => {
  it("emitRuntimeSessionStarted produces a typed event with timestamp", () => {
    const captured: Record<string, unknown>[] = [];
    const ws = new WebSocketBroadcaster((e) => captured.push(e));
    ws.emitRuntimeSessionStarted({
      projectId: "p1",
      nodeId: "n1",
      agentId: "loomi-n1",
      runtimeName: "claude-agent",
      sessionId: "sess-abc",
      model: "claude-sonnet-4-6",
    });
    expect(captured.length).toBe(1);
    const event = captured[0]!;
    expect(event["type"]).toBe("runtime_session_started");
    expect(typeof event["timestamp"]).toBe("string");
    expect(event["nodeId"]).toBe("n1");
    expect(event["sessionId"]).toBe("sess-abc");
    expect(event["model"]).toBe("claude-sonnet-4-6");
  });

  it("emitRuntimeSessionEvent forwards the underlying SessionEvent payload", () => {
    const captured: Record<string, unknown>[] = [];
    const ws = new WebSocketBroadcaster((e) => captured.push(e));
    ws.emitRuntimeSessionEvent({
      projectId: "p1",
      nodeId: "n1",
      agentId: "looma-1",
      sessionId: "sess-def",
      event: { kind: "assistant_text", text: "ok", isDelta: false },
    });
    const event = captured[0]!;
    expect(event["type"]).toBe("runtime_session_event");
    expect(event["event"]).toEqual({
      kind: "assistant_text",
      text: "ok",
      isDelta: false,
    });
  });

  it("emitMcpToolCalled carries tool identity + input", () => {
    const captured: Record<string, unknown>[] = [];
    const ws = new WebSocketBroadcaster((e) => captured.push(e));
    ws.emitMcpToolCalled({
      projectId: "p1",
      nodeId: "n1",
      agentId: "looma-1",
      toolName: "mcp__loomflo__write_file",
      toolUseId: "tu_42",
      input: { path: "src/foo.ts", content: "hi" },
    });
    const event = captured[0]!;
    expect(event["type"]).toBe("mcp_tool_called");
    expect(event["toolName"]).toBe("mcp__loomflo__write_file");
    expect(event["input"]).toEqual({ path: "src/foo.ts", content: "hi" });
  });

  it("omits projectId when not provided (single-project mode)", () => {
    const captured: Record<string, unknown>[] = [];
    const ws = new WebSocketBroadcaster((e) => captured.push(e));
    ws.emitRuntimeSessionStarted({
      nodeId: "n1",
      agentId: "loomi-n1",
      runtimeName: "mock",
      sessionId: "sess-xyz",
    });
    const event = captured[0]!;
    expect(event["projectId"]).toBeUndefined();
    expect(event["model"]).toBeUndefined();
  });
});
