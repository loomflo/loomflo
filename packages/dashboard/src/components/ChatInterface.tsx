// ============================================================================
// ChatInterface Component
//
// Interactive chat panel for conversing with Loom (the architect agent).
// Displays a scrollable message list with role indicators, timestamps, and
// optional action badges. Includes a text input for sending messages and a
// typing indicator while waiting for a response. Dark-themed, consistent
// with the rest of the dashboard.
// ============================================================================

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement, SyntheticEvent } from 'react';

// ============================================================================
// Types
// ============================================================================

/** A single chat message with optional action metadata. */
export interface ChatMessage {
  /** Message author: user or Loom (assistant). */
  role: 'user' | 'assistant';
  /** Message text content. */
  content: string;
  /** ISO 8601 timestamp when the message was sent. */
  timestamp: string;
  /** Graph action taken by Loom, or null/undefined if none. */
  action?: { type: string; details: Record<string, unknown> } | null;
}

/** Props for the {@link ChatInterface} component. */
export interface ChatInterfaceProps {
  /** Ordered array of chat messages to display. */
  messages: ChatMessage[];
  /** Callback invoked when the user submits a new message. */
  onSend: (message: string) => void;
  /** Whether Loom is currently processing a response. */
  isLoading: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Pixel threshold from the bottom of the scroll container within which
 * auto-scroll remains active.
 */
const AUTO_SCROLL_THRESHOLD = 40;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format an ISO 8601 timestamp as `HH:MM`.
 *
 * @param iso - ISO 8601 timestamp string.
 * @returns Formatted time string.
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Produce a human-readable label for an action type.
 *
 * @param type - The raw action type string (e.g., "graph_modified").
 * @returns Formatted label with underscores replaced by spaces.
 */
function formatActionType(type: string): string {
  return type.replace(/_/g, ' ');
}

// ============================================================================
// Sub-components
// ============================================================================

/** Props for {@link MessageBubble}. */
interface MessageBubbleProps {
  /** The chat message to render. */
  message: ChatMessage;
}

/**
 * Renders a single chat message bubble with role indicator, content,
 * timestamp, and optional action badge.
 *
 * @param props - Message data.
 * @returns Rendered message bubble element.
 */
const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps): ReactElement {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-blue-900 text-blue-100'
            : 'bg-gray-800 text-gray-200'
        }`}
      >
        {/* Role indicator */}
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide ${
              isUser ? 'text-blue-400' : 'text-purple-400'
            }`}
          >
            {isUser ? 'You' : 'Loom'}
          </span>
          <span className="text-[10px] text-gray-500">{formatTime(message.timestamp)}</span>
        </div>

        {/* Content */}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {message.content}
        </p>

        {/* Action badge */}
        {message.action != null && (
          <div className="mt-2 inline-flex items-center gap-1 rounded bg-cyan-900/60 px-2 py-0.5">
            <span className="text-[10px] font-medium text-cyan-300">
              {formatActionType(message.action.type)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Animated typing indicator shown while Loom is processing a response.
 *
 * @returns Rendered typing indicator element.
 */
const TypingIndicator = memo(function TypingIndicator(): ReactElement {
  return (
    <div className="flex justify-start">
      <div className="rounded-lg bg-gray-800 px-3 py-2">
        <div className="mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-purple-400">
            Loom
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// ChatInterface Component
// ============================================================================

/**
 * Interactive chat panel for conversing with the Loom architect agent.
 *
 * Renders a scrollable message list, a typing indicator while Loom is
 * responding, and a text input at the bottom for composing new messages.
 * Auto-scrolls to the latest message unless the user has scrolled upward.
 *
 * @param props - Messages, send callback, and loading state.
 * @returns Rendered chat interface element.
 */
export const ChatInterface = memo(function ChatInterface({
  messages,
  onSend,
  isLoading,
}: ChatInterfaceProps): ReactElement {
  // ---- State ----
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  // ---- Refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---- Auto-scroll effect ----
  useEffect((): void => {
    const el = scrollContainerRef.current;
    if (autoScroll && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading, autoScroll]);

  // ---- Handlers ----
  const handleScroll = useCallback((): void => {
    const el = scrollContainerRef.current;
    if (!el) {
      return;
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD;
    setAutoScroll(isNearBottom);
  }, []);

  const handleSubmit = useCallback(
    (e: SyntheticEvent<HTMLFormElement>): void => {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed === '' || isLoading) {
        return;
      }
      onSend(trimmed);
      setInput('');
      setAutoScroll(true);
    },
    [input, isLoading, onSend],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed === '' || isLoading) {
          return;
        }
        onSend(trimmed);
        setInput('');
        setAutoScroll(true);
      }
    },
    [input, isLoading, onSend],
  );

  // ---- Render ----
  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-md">
      {/* Header */}
      <div className="flex items-center border-b border-gray-700 px-4 py-2">
        <span className="text-sm font-medium text-gray-200">Chat with Loom</span>
        <span className="ml-auto text-xs text-gray-500">
          {messages.length} message{messages.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Message list */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No messages yet. Send a message to start chatting with Loom.
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble key={`${msg.timestamp}-${String(idx)}`} message={msg} />
          ))
        )}

        {isLoading && <TypingIndicator />}
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-gray-700 px-4 py-3"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder="Message Loom..."
          disabled={isLoading}
          rows={1}
          className="flex-1 resize-none rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || input.trim() === ''}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
});
