// ============================================================================
// useChat
//
// Wraps GET /chat/history + POST /chat for one project. Listens for
// `chat_response` WS events to append assistant replies in real-time
// (the daemon may emit them out-of-band from the POST response).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { useApi, useWs } from "../context/AppContext.js";
import type { ChatHistoryEntry } from "../lib/types.js";

export interface ChatResource {
  messages: ChatHistoryEntry[];
  sending: boolean;
  loading: boolean;
  error: Error | null;
  /** Sends a user message; resolves with the assistant's reply text. */
  send: (message: string) => Promise<string>;
  refresh: () => Promise<void>;
}

export function useChat(projectId: string | null | undefined): ChatResource {
  const api = useApi();
  const ws = useWs();

  const [messages, setMessages] = useState<ChatHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getChatHistory(projectId);
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(
    async (message: string): Promise<string> => {
      if (!projectId) return "";
      setSending(true);
      setError(null);
      const optimistic: ChatHistoryEntry = {
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const res = await api.postChat(projectId, message);
        const assistant: ChatHistoryEntry = {
          role: "assistant",
          content: res.response,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistant]);
        return res.response;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setSending(false);
      }
    },
    [api, projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    const off = ws.on("chat_response", (ev) => {
      if (ev.projectId !== undefined && ev.projectId !== projectId) return;
      // Avoid double-appending: only push if the latest assistant message
      // doesn't already match the broadcast text.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.content === ev.response) return prev;
        return [
          ...prev,
          {
            role: "assistant",
            content: ev.response,
            timestamp: ev.timestamp,
          },
        ];
      });
    });
    return off;
  }, [ws, projectId]);

  return { messages, sending, loading, error, send, refresh };
}
