/**
 * Unit tests for OpenAIProvider.
 *
 * T-P3.1: constructor with minimal config (apiKey only)
 * T-P3.2: constructor with baseUrl
 * T-P3.3: complete() on 401 non-retryable error
 * T-P3.4: complete() on 429 retryable — retries then succeeds
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the openai SDK
// ---------------------------------------------------------------------------

const { mockCreate, MockAPIError } = vi.hoisted(() => {
  class _MockAPIError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "APIError";
      this.status = status;
    }
  }
  return {
    mockCreate: vi.fn(),
    MockAPIError: _MockAPIError,
  };
});

vi.mock("openai", () => {
  class MockOpenAI {
    static APIError = MockAPIError;
    chat = { completions: { create: mockCreate } };
    constructor() {
      /* noop */
    }
  }
  return { default: MockOpenAI, __esModule: true };
});

import { OpenAIProvider } from "../../../src/providers/openai.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CompletionParams for exercising complete(). */
function minimalParams() {
  return {
    messages: [{ role: "user" as const, content: "hello" }],
    system: "You are a helpful assistant",
    model: "moonshot-v1-8k",
  };
}

/** A successful chat completion response shape. */
function successResponse() {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    model: "moonshot-v1-8k",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hi there!" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAIProvider", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // T-P3.1
  it("T-P3.1 — constructor with minimal config (apiKey only)", () => {
    const provider = new OpenAIProvider({ apiKey: "sk-test-key" });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
  });

  // T-P3.2
  it("T-P3.2 — constructor with baseUrl", () => {
    const provider = new OpenAIProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://api.moonshot.cn/v1",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
  });

  // T-P3.3
  it("T-P3.3 — complete() on 401 non-retryable error throws", async () => {
    mockCreate.mockRejectedValue(new MockAPIError(401, "Unauthorized"));

    const provider = new OpenAIProvider({ apiKey: "bad-key" });
    await expect(provider.complete(minimalParams())).rejects.toThrow("OpenAI-compat API error");
    // 401 is not retryable — should be called exactly once
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // T-P3.4
  it("T-P3.4 — complete() on 429 retryable — retries then succeeds", async () => {
    // Two 429 failures, then success
    mockCreate
      .mockRejectedValueOnce(new MockAPIError(429, "Rate limited"))
      .mockRejectedValueOnce(new MockAPIError(429, "Rate limited"))
      .mockResolvedValueOnce(successResponse());

    const provider = new OpenAIProvider({ apiKey: "sk-test-key" });

    // Stub timers so retry delays don't slow the test
    vi.useFakeTimers();
    const resultPromise = provider.complete(minimalParams());

    // Advance past the retry delays (1s + jitter, 2s + jitter)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(3000);

    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.content).toEqual([{ type: "text", text: "Hi there!" }]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
