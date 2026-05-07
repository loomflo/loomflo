import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "./harness.js";

let api: FakeApi;
let ws: FakeWs;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
}));

import { useChat } from "../../src/hooks/useChat.js";

describe("useChat", () => {
  it("loads chat history on mount", async () => {
    api = makeFakeApi({
      getChatHistory: () =>
        Promise.resolve({
          messages: [{ role: "user", content: "hi", timestamp: "t" }],
        }),
    });
    ws = createFakeWs();
    const { result } = renderHook(() => useChat("p1"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
  });

  it("appends optimistic user + assistant on send()", async () => {
    api = makeFakeApi({
      getChatHistory: () => Promise.resolve({ messages: [] }),
      postChat: () => Promise.resolve({ response: "pong", action: null, category: "answer" }),
    });
    ws = createFakeWs();
    const { result } = renderHook(() => useChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send("ping");
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]!.role).toBe("user");
    expect(result.current.messages[1]!.role).toBe("assistant");
    expect(result.current.messages[1]!.content).toBe("pong");
  });

  it("appends an assistant message from a chat_response WS event", async () => {
    api = makeFakeApi({ getChatHistory: () => Promise.resolve({ messages: [] }) });
    ws = createFakeWs();
    const { result } = renderHook(() => useChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      ws.emit({
        type: "chat_response",
        timestamp: "t",
        projectId: "p1",
        response: "from server",
        category: "answer",
        action: null,
      });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!.content).toBe("from server");
  });

  it("does not double-append if the latest message already matches", async () => {
    api = makeFakeApi({ getChatHistory: () => Promise.resolve({ messages: [] }) });
    ws = createFakeWs();
    const { result } = renderHook(() => useChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      ws.emit({
        type: "chat_response",
        timestamp: "t",
        projectId: "p1",
        response: "hi",
        category: "answer",
        action: null,
      });
      ws.emit({
        type: "chat_response",
        timestamp: "t2",
        projectId: "p1",
        response: "hi",
        category: "answer",
        action: null,
      });
    });
    expect(result.current.messages).toHaveLength(1);
  });

  it("captures errors from postChat into error state", async () => {
    api = makeFakeApi({
      getChatHistory: () => Promise.resolve({ messages: [] }),
      postChat: () => Promise.reject(new Error("boom")),
    });
    ws = createFakeWs();
    const { result } = renderHook(() => useChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.send("ping");
    });
    expect(result.current.error?.message).toBe("boom");
  });

  it("ignores chat events from other projects", async () => {
    api = makeFakeApi({ getChatHistory: () => Promise.resolve({ messages: [] }) });
    ws = createFakeWs();
    const { result } = renderHook(() => useChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      ws.emit({
        type: "chat_response",
        timestamp: "t",
        projectId: "OTHER",
        response: "x",
        category: "answer",
        action: null,
      });
    });
    expect(result.current.messages).toHaveLength(0);
  });
});
