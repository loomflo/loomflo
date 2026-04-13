// ============================================================================
// useChat Hook
//
// Manages conversation state with Loom (the architect agent). Sends messages
// via the REST API, receives real-time responses via WebSocket, and maintains
// the message history compatible with ChatInterface.
// ============================================================================

import { useCallback, useEffect, useState } from "react";

import type { ChatMessage } from "../components/ChatInterface.js";
import { apiClient, ApiError } from "../lib/api.js";
import type { UseWebSocketReturn } from "./useWebSocket.js";

// ============================================================================
// Types
// ============================================================================

/** The subscribe function signature extracted from useWebSocket. */
type Subscribe = UseWebSocketReturn["subscribe"];

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
 * Fetches chat history on mount, sends user messages via the REST API, and
 * subscribes to WebSocket `chat_response` events for real-time updates.
 *
 * @param subscribe - The subscribe function from {@link useWebSocket}.
 * @returns Messages, send function, loading and error indicators.
 */
export function useChat(subscribe: Subscribe): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch the full chat history from the REST API.
   * A 404 response is treated as an empty conversation, not an error.
   */
  const fetchHistory = useCallback(async (): Promise<void> => {
    try {
      const history = await apiClient.getChatHistory();
      setMessages(
        history.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })),
      );
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setMessages([]);
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch chat history");
      }
    }
  }, []);

  /** Fetch history on mount. */
  useEffect((): void => {
    void fetchHistory();
  }, [fetchHistory]);

  /**
   * Send a message to Loom via the REST API.
   *
   * Immediately appends the user message to local state, then calls
   * the chat endpoint and appends Loom's response including any action.
   *
   * @param message - The user's message text.
   */
  const sendMessage = useCallback((message: string): void => {
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
        const response = await apiClient.chat(message);
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: response.response,
          timestamp: new Date().toISOString(),
          action: response.action,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send message");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  /** Subscribe to WebSocket chat_response events for real-time updates. */
  useEffect((): (() => void) => {
    const unsub = subscribe("chat_response", (event): void => {
      const wsMessage: ChatMessage = {
        role: "assistant",
        content: event.message,
        timestamp: event.timestamp,
        action: event.action !== null ? { type: event.action, details: {} } : null,
      };
      setMessages((prev) => [...prev, wsMessage]);
      setIsLoading(false);
    });

    return unsub;
  }, [subscribe]);

  return { messages, sendMessage, isLoading, error };
}
