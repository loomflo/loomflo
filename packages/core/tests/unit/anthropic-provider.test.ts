import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CompletionParams, ProviderConfig } from "../../src/providers/base.js";
import type { ToolDefinition } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockCreate, MockAPIError } = vi.hoisted(() => {
  class MockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "APIError";
    }
  }
  return {
    mockCreate: vi.fn(),
    MockAPIError,
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
    static APIError = MockAPIError;
    constructor(_config: Record<string, unknown>) {
      // Config accepted but unused in mock
    }
  }
  return { default: MockAnthropic };
});

// Import after mocks are set up
import { AnthropicProvider } from "../../src/providers/anthropic.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseParams(overrides?: Partial<CompletionParams>): CompletionParams {
  return {
    messages: [{ role: "user", content: "Hello" }],
    system: "You are a test assistant.",
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

function makeTextResponse(
  text: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCreate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Unit tests for the AnthropicProvider LLM provider implementation. */
describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });

  // --- 1. complete() success with text content ---

  describe("complete() with text content", () => {
    it("returns correct text, stop reason, usage, and model", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Hello, world!"));

      const result = await provider.complete(makeBaseParams());

      expect(result.content).toEqual([{ type: "text", text: "Hello, world!" }]);
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(20);
      expect(result.model).toBe("claude-sonnet-4-6");
    });
  });

  // --- 2. complete() with tool_use content ---

  describe("complete() with tool_use content", () => {
    it("returns correct tool name, id, and input", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "toolu_123",
            name: "read_file",
            input: { path: "/test.ts" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 15, output_tokens: 25 },
        model: "claude-sonnet-4-6",
      });

      const result = await provider.complete(makeBaseParams());

      expect(result.content).toEqual([
        {
          type: "tool_use",
          id: "toolu_123",
          name: "read_file",
          input: { path: "/test.ts" },
        },
      ]);
      expect(result.stopReason).toBe("tool_use");
    });
  });

  // --- 3. complete() with mixed content (text + tool_use) ---

  describe("complete() with mixed content", () => {
    it("returns both text and tool_use blocks", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: "text", text: "I will read the file." },
          {
            type: "tool_use",
            id: "toolu_456",
            name: "read_file",
            input: { path: "/src/main.ts" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 30 },
        model: "claude-sonnet-4-6",
      });

      const result = await provider.complete(makeBaseParams());

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "I will read the file.",
      });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "toolu_456",
        name: "read_file",
        input: { path: "/src/main.ts" },
      });
      expect(result.stopReason).toBe("tool_use");
    });
  });

  // --- 4. complete() error handling ---

  describe("complete() error handling", () => {
    it("re-throws non-retryable Anthropic API errors with structured message", async () => {
      mockCreate.mockRejectedValueOnce(new MockAPIError(400, "Invalid request"));

      await expect(provider.complete(makeBaseParams())).rejects.toThrow(
        "Anthropic API error (400): Invalid request",
      );
    });

    it("throws immediately on 401 without retry", async () => {
      mockCreate.mockRejectedValueOnce(new MockAPIError(401, "Unauthorized"));

      await expect(provider.complete(makeBaseParams())).rejects.toThrow(
        "Anthropic API error (401): Unauthorized",
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("throws immediately on 403 without retry", async () => {
      mockCreate.mockRejectedValueOnce(new MockAPIError(403, "Forbidden"));

      await expect(provider.complete(makeBaseParams())).rejects.toThrow(
        "Anthropic API error (403): Forbidden",
      );
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("re-throws non-API errors unchanged", async () => {
      const networkError = new Error("ECONNREFUSED");
      mockCreate.mockRejectedValueOnce(networkError);

      await expect(provider.complete(makeBaseParams())).rejects.toThrow("ECONNREFUSED");
    });
  });

  // --- 4b. complete() retry behavior ---

  describe("complete() retry behavior", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries on 429 and succeeds on second attempt", async () => {
      mockCreate
        .mockRejectedValueOnce(new MockAPIError(429, "Rate limit exceeded"))
        .mockResolvedValueOnce(makeTextResponse("Recovered"));

      const promise = provider.complete(makeBaseParams());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.content).toEqual([{ type: "text", text: "Recovered" }]);
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("retries on 529 and succeeds on third attempt", async () => {
      mockCreate
        .mockRejectedValueOnce(new MockAPIError(529, "Overloaded"))
        .mockRejectedValueOnce(new MockAPIError(529, "Overloaded"))
        .mockResolvedValueOnce(makeTextResponse("OK"));

      const promise = provider.complete(makeBaseParams());
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.content).toEqual([{ type: "text", text: "OK" }]);
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(console.error).toHaveBeenCalledTimes(2);
    });

    it("throws overloaded message after 5 retries on 429", async () => {
      for (let i = 0; i < 6; i++) {
        mockCreate.mockRejectedValueOnce(new MockAPIError(429, "Rate limit exceeded"));
      }

      const promise = provider.complete(makeBaseParams());
      const assertion = expect(promise).rejects.toThrow(
        "Anthropic API overloaded after 5 retries — check https://status.anthropic.com",
      );
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockCreate).toHaveBeenCalledTimes(6);
      expect(console.error).toHaveBeenCalledTimes(5);
    });

    it("throws overloaded message after 5 retries on 529", async () => {
      for (let i = 0; i < 6; i++) {
        mockCreate.mockRejectedValueOnce(new MockAPIError(529, "Overloaded"));
      }

      const promise = provider.complete(makeBaseParams());
      const assertion = expect(promise).rejects.toThrow(
        "Anthropic API overloaded after 5 retries — check https://status.anthropic.com",
      );
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockCreate).toHaveBeenCalledTimes(6);
    });

    it("logs retry attempt details to stderr", async () => {
      mockCreate
        .mockRejectedValueOnce(new MockAPIError(429, "Rate limit exceeded"))
        .mockResolvedValueOnce(makeTextResponse("OK"));

      const promise = provider.complete(makeBaseParams());
      await vi.runAllTimersAsync();
      await promise;

      expect(console.error).toHaveBeenCalledTimes(1);
      const logMessage = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(logMessage).toMatch(
        /^AnthropicProvider: retry 1\/5 after status 429 — waiting \d+ms$/,
      );
    });
  });

  // --- 5. complete() with tools parameter ---

  describe("complete() with tools parameter", () => {
    it("translates tool definitions to Anthropic format with input_schema", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      const tools: ToolDefinition[] = [
        {
          name: "read_file",
          description: "Read a file from disk",
          inputSchema: {
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ];

      await provider.complete(makeBaseParams({ tools }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.tools).toEqual([
        {
          name: "read_file",
          description: "Read a file from disk",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ]);
    });

    it("omits tools from request when none provided", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      await provider.complete(makeBaseParams());

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.tools).toBeUndefined();
    });

    it("omits tools from request when empty array provided", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      await provider.complete(makeBaseParams({ tools: [] }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.tools).toBeUndefined();
    });
  });

  // --- 6. complete() with system prompt ---

  describe("complete() with system prompt", () => {
    it("passes system message correctly to the SDK", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Ahoy!"));

      await provider.complete(makeBaseParams({ system: "You are a pirate." }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.system).toBe("You are a pirate.");
    });
  });

  // --- 7. Token counting ---

  describe("token counting", () => {
    it("maps input_tokens and output_tokens to inputTokens and outputTokens", async () => {
      mockCreate.mockResolvedValueOnce(
        makeTextResponse("Result", {
          usage: { input_tokens: 500, output_tokens: 1200 },
        }),
      );

      const result = await provider.complete(makeBaseParams());

      expect(result.usage).toEqual({
        inputTokens: 500,
        outputTokens: 1200,
      });
    });
  });

  // --- 8. Model override ---

  describe("model override", () => {
    it("uses model from params over provider default", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done.", { model: "claude-opus-4-6" }));

      await provider.complete(makeBaseParams({ model: "claude-opus-4-6" }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.model).toBe("claude-opus-4-6");
    });

    it("falls back to provider default when params.model is empty", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      const customProvider = new AnthropicProvider({
        apiKey: "test-key",
        defaultModel: "claude-opus-4-6",
      });

      await customProvider.complete(makeBaseParams({ model: "" }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.model).toBe("claude-opus-4-6");
    });

    it("uses claude-sonnet-4-6 when no model specified anywhere", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      const defaultProvider = new AnthropicProvider({ apiKey: "test-key" });

      await defaultProvider.complete(makeBaseParams({ model: "" }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.model).toBe("claude-sonnet-4-6");
    });
  });

  // --- 9. maxTokens ---

  describe("maxTokens", () => {
    it("passes maxTokens through as max_tokens", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      await provider.complete(makeBaseParams({ maxTokens: 2048 }));

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.max_tokens).toBe(2048);
    });

    it("uses provider default (8192) when maxTokens not specified", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      await provider.complete(makeBaseParams());

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.max_tokens).toBe(8192);
    });

    it("uses custom defaultMaxTokens from provider config", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("Done."));

      const customProvider = new AnthropicProvider({
        apiKey: "test-key",
        defaultMaxTokens: 4096,
      });

      await customProvider.complete(makeBaseParams());

      const callArgs = mockCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.max_tokens).toBe(4096);
    });
  });

  // --- 10. Empty response handling ---

  describe("empty response handling", () => {
    it("returns empty content array when SDK returns no content blocks", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 0 },
        model: "claude-sonnet-4-6",
      });

      const result = await provider.complete(makeBaseParams());

      expect(result.content).toEqual([]);
      expect(result.stopReason).toBe("end_turn");
      expect(result.usage.outputTokens).toBe(0);
    });
  });

  // --- 11. OAuth token authentication mode ---

  describe("OAuth token authentication", () => {
    it("instantiates correctly with oauthToken instead of apiKey", () => {
      expect(() => new AnthropicProvider({ oauthToken: "sk-ant-o-test-token" })).not.toThrow();
    });

    it("completes successfully when initialized with oauthToken", async () => {
      mockCreate.mockResolvedValueOnce(makeTextResponse("OAuth response"));

      const oauthProvider = new AnthropicProvider({ oauthToken: "sk-ant-o-test-token" });
      const result = await oauthProvider.complete(makeBaseParams());

      expect(result.content).toEqual([{ type: "text", text: "OAuth response" }]);
      expect(result.stopReason).toBe("end_turn");
    });

    it("throws when neither apiKey nor oauthToken is provided", async () => {
      const { ProviderConfigSchema } = await import("../../src/providers/base.js");
      const result = ProviderConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

// --- 12. Dynamic OAuth token (T4.1 / T4.2) ---
describe("AnthropicProvider — dynamic OAuth token", () => {
  it("T4.1 — calls token getter on every complete() invocation", async () => {
    // token getter that increments a counter
    let callCount = 0;
    const tokenGetter = (): string => {
      callCount++;
      return "sk-ant-oat01-mock";
    };
    // Cast needed because ProviderConfig.oauthToken is currently string only
    const provider = new AnthropicProvider({
      oauthToken: tokenGetter,
    } as unknown as ProviderConfig);
    mockCreate.mockResolvedValueOnce(makeTextResponse("first"));
    mockCreate.mockResolvedValueOnce(makeTextResponse("second"));
    await provider.complete(makeBaseParams());
    await provider.complete(makeBaseParams());
    expect(callCount).toBe(2);
  });

  it("T4.2 — static string token behaves as before", async () => {
    const provider = new AnthropicProvider({ oauthToken: "sk-ant-oat01-static" });
    mockCreate.mockResolvedValueOnce(makeTextResponse("static ok"));
    const result = await provider.complete(makeBaseParams());
    expect(result.content).toEqual([{ type: "text", text: "static ok" }]);
  });
});
