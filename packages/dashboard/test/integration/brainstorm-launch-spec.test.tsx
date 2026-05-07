// ============================================================================
// Integration: chat send + workflow init through real ApiClient against a
// stubbed daemon. This is the contract the brainstorm "Lancer la spec"
// flow relies on.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiClient } from "../../src/lib/api.js";
import { createFakeWs, type FakeWs } from "../hooks/harness.js";

let api: ApiClient;
let ws: FakeWs;
const fetchMock = vi.fn();

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useChat } from "../../src/hooks/useChat.js";

beforeEach(() => {
  fetchMock.mockReset();
  ws = createFakeWs();
  api = new ApiClient({ baseUrl: "http://daemon", token: "tok" });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonRes(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("brainstorm launch spec — chat round-trip", () => {
  it("sends user input via /chat and surfaces the assistant reply", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ messages: [] }))
      .mockResolvedValueOnce(
        jsonRes({ response: "spec phase queued", action: { type: "init", details: {} }, category: "command" }),
      );

    const { result } = renderHook(() => useChat("proj_aaaaaaaa"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send("Construis-moi le projet.");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]!.content).toBe("Construis-moi le projet.");
    expect(result.current.messages[1]!.content).toBe("spec phase queued");

    // Verify the daemon received POST /chat with the right body.
    const postCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postCall[0]).toBe("http://daemon/projects/proj_aaaaaaaa/chat");
    expect(postCall[1].method).toBe("POST");
    expect(JSON.parse(postCall[1].body as string)).toEqual({
      message: "Construis-moi le projet.",
    });
  });

  it("a chat_response WS event appended after the daemon ack does not duplicate", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ messages: [] }))
      .mockResolvedValueOnce(
        jsonRes({ response: "from REST", action: null, category: "answer" }),
      );

    const { result } = renderHook(() => useChat("proj_aaaaaaaa"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.send("Bonjour.");
    });
    expect(result.current.messages).toHaveLength(2);

    // The daemon broadcasts the same response on the WS — should be deduped.
    act(() => {
      ws.emit({
        type: "chat_response",
        timestamp: "t",
        projectId: "proj_aaaaaaaa",
        response: "from REST",
        category: "answer",
        action: null,
      });
    });
    expect(result.current.messages).toHaveLength(2);
  });
});
