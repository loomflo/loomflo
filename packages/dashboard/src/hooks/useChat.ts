// ============================================================================
// useChat Hook
//
// Manages conversation state with Loom (the architect agent). Sends messages
// via the REST API, receives real-time responses via WebSocket, and maintains
// the message history compatible with ChatInterface.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import type { ChatMessage } from "../components/ChatInterface.js";
import { useProject } from "../context/ProjectContext.js";
import { useWebSocket } from "./useWebSocket.js";

// ============================================================================
// Types
// ============================================================================

/** Return value of the useChat hook. */
export interface UseChatReturn {
  /** Ordered array of chat messages. */
  messages: ChatMessage[];
  /** Send a new message to Loom. */
  sendMessage: (message: string) => void;
  /** Whether Loom is currently processing a response. */
  isLoading: boolean;
  /** Error message from the most recent operation, or null. */
  error: string | null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * React hook that manages conversation state with the Loom architect agent.
 *
 * Sends user messages via the REST API and subscribes to WebSocket
 * `chat_response` events for real-time updates.
 *
 * @param projectId - The project to chat with.
 * @returns Messages, send function, loading and error indicators.
 */
export function useChat(projectId: string): UseChatReturn {
  const { client, baseUrl, token } = useProject();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch the full chat history from the REST API.
   * A 404 response is treated as an empty conversation, not an error.
   */
  const fetchHistory = useCallback(async (): Promise<void> => {
    try {
      const response = await client.postChat(projectId, { messages: [] });
      if (response.message) {
        // postChat returns a single response; history may not be available
        // via a GET endpoint in the new API, so we start fresh.
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("404")) {
        setMessages([]);
      } else {
        // Silently ignore fetch errors for history on initial load
      }
    }
  }, [client, projectId]);

  /** Fetch history on mount (best-effort). */
  useEffect((): void => {
    void fetchHistory();
  }, [fetchHistory]);

  /**
   * Send a message to Loom via the REST API.
   *
   * Immediately appends the user message to local state, then calls
   * the chat endpoint and appends Loom's response.
   *
   * @param message - The user's message text.
   */
  const sendMessage = useCallback(
    (message: string): void => {
      const userMessage: ChatMessage = {
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      void (async (): Promise<void> => {
        try {
          const response = await client.postChat(projectId, {
            messages: [{ role: "user", content: message }],
          });
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: response.message.content,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Failed to send message");
        } finally {
          setIsLoading(false);
        }
      })();
    },
    [client, projectId],
  );

  /** Subscribe to WebSocket chat_response events for real-time updates. */
  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame): void => {
      const type = frame["type"] as string | undefined;
      if (type === "chat_response") {
        const wsMessage: ChatMessage = {
          role: "assistant",
          content: (frame["message"] as string) ?? "",
          timestamp: (frame["timestamp"] as string) ?? new Date().toISOString(),
          action:
            frame["action"] !== null && frame["action"] !== undefined
              ? { type: frame["action"] as string, details: {} }
              : null,
        };
        setMessages((prev) => [...prev, wsMessage]);
        setIsLoading(false);
      }
    },
  });

  return { messages, sendMessage, isLoading, error };
}
