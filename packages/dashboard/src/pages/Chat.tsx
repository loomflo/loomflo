// ============================================================================
// Chat Page
//
// Full-height chat UI for conversing with Loom (the architect agent).
// Connects via WebSocket for real-time responses and renders the
// ChatInterface component with message history, send capability, and
// action confirmation badges.
// ============================================================================

import { memo } from "react";
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";

import { ChatInterface } from "../components/ChatInterface.js";
import { useChat } from "../hooks/useChat.js";

// ============================================================================
// ChatPage Component
// ============================================================================

/**
 * Chat page providing a full-height conversational interface with the Loom
 * architect agent.
 *
 * Reads the projectId from URL params and delegates conversation state
 * management to {@link useChat}. Renders {@link ChatInterface} for the
 * message list, input, and action confirmation badges.
 *
 * Displays an inline error banner when the chat hook reports an error.
 *
 * @returns Rendered chat page element.
 */
export const ChatPage = memo(function ChatPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { messages, sendMessage, isLoading, error } = useChat(projectId!);

  return (
    <div className="flex h-full flex-col">
      {error !== null && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ChatInterface messages={messages} onSend={sendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
});
