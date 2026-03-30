import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { LLMProvider, CompletionParams } from "../../src/providers/base.js";
import type { LLMResponse, ContentBlock } from "../../src/types.js";
import type { Tool } from "../../src/tools/base.js";
import { runAgentLoop } from "../../src/agents/base-agent.js";
import type { AgentLoopConfig } from "../../src/agents/base-agent.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build an LLMResponse with end_turn and a text block. */
function textResponse(text: string, inputTokens = 10, outputTokens = 20): LLMResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: { inputTokens, outputTokens },
    model: "mock-model",
  };
}

/** Build an LLMResponse that requests tool use. */
function toolUseResponse(
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  inputTokens = 10,
  outputTokens = 20,
): LLMResponse {
  const content: ContentBlock[] = calls.map((c) => ({
    type: "tool_use" as const,
    id: c.id,
    name: c.name,
    input: c.input,
  }));
  return {
    content,
    stopReason: "tool_use",
    usage: { inputTokens, outputTokens },
    model: "mock-model",
  };
}

/** Build a mock LLMProvider that returns a sequence of responses. */
function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    async complete(_params: CompletionParams): Promise<LLMResponse> {
      const response = responses[callIndex];
      if (!response) {
        throw new Error("Mock provider ran out of responses");
      }
      callIndex++;
      return response;
    },
  };
}

/** Build a mock Tool with a zod input schema and configurable execute. */
function mockTool(
  name: string,
  schema: z.ZodType<unknown>,
  executeFn: (input: unknown) => Promise<string>,
): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    inputSchema: schema,
    execute: executeFn,
  };
}

/** Build a default AgentLoopConfig with overrides. */
function makeConfig(overrides?: Partial<AgentLoopConfig>): AgentLoopConfig {
  return {
    systemPrompt: "You are a test agent.",
    tools: [],
    provider: mockProvider([textResponse("default")]),
    model: "mock-model",
    timeout: 30_000,
    tokenLimit: 100_000,
    agentId: "test-agent",
    nodeId: "test-node",
    workspacePath: "/tmp/test-workspace",
    writeScope: ["**/*"],
    ...overrides,
  };
}

// ===========================================================================
// Simple completion
// ===========================================================================

describe("runAgentLoop — simple completion", () => {
  it("returns completed status when LLM responds with end_turn", async () => {
    const provider = mockProvider([textResponse("Hello, world!")]);
    const config = makeConfig({ provider });

    const result = await runAgentLoop(config, [{ role: "user", content: "Say hello" }]);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Hello, world!");
    expect(result.error).toBeUndefined();
  });

  it("accumulates token usage from a single LLM call", async () => {
    const provider = mockProvider([textResponse("done", 50, 100)]);
    const config = makeConfig({ provider });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.tokenUsage).toEqual({ input: 50, output: 100 });
  });

  it("returns empty output when LLM responds with no text blocks", async () => {
    const response: LLMResponse = {
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 5 },
      model: "mock-model",
    };
    const config = makeConfig({ provider: mockProvider([response]) });

    const result = await runAgentLoop(config, [{ role: "user", content: "test" }]);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("");
  });

  it("joins multiple text blocks with newlines", async () => {
    const response: LLMResponse = {
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "mock-model",
    };
    const config = makeConfig({ provider: mockProvider([response]) });

    const result = await runAgentLoop(config, [{ role: "user", content: "test" }]);

    expect(result.output).toBe("line one\nline two");
  });
});

// ===========================================================================
// Tool use cycle
// ===========================================================================

describe("runAgentLoop — tool use cycle", () => {
  it("executes a tool and sends result back to LLM", async () => {
    const echoTool = mockTool("echo", z.object({ message: z.string() }), async (input: unknown) => {
      const { message } = input as { message: string };
      return `echoed: ${message}`;
    });

    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "echo", input: { message: "ping" } }]),
      textResponse("Tool worked!"),
    ]);

    const config = makeConfig({ provider, tools: [echoTool] });
    const result = await runAgentLoop(config, [{ role: "user", content: "Use echo" }]);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Tool worked!");
  });

  it("accumulates tokens across tool-use iterations", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "noop", input: {} }], 100, 200),
      textResponse("done", 150, 250),
    ]);

    const config = makeConfig({ provider, tools: [noopTool] });
    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.tokenUsage).toEqual({ input: 250, output: 450 });
  });
});

// ===========================================================================
// Multiple tool calls in one response
// ===========================================================================

describe("runAgentLoop — multiple tool calls", () => {
  it("executes all tool_use blocks sequentially in one response", async () => {
    const executionOrder: string[] = [];

    const toolA = mockTool("tool_a", z.object({ val: z.string() }), async (input: unknown) => {
      const { val } = input as { val: string };
      executionOrder.push(`a:${val}`);
      return `result_a:${val}`;
    });

    const toolB = mockTool("tool_b", z.object({ num: z.number() }), async (input: unknown) => {
      const { num } = input as { num: number };
      executionOrder.push(`b:${String(num)}`);
      return `result_b:${String(num)}`;
    });

    const provider = mockProvider([
      toolUseResponse([
        { id: "tu-1", name: "tool_a", input: { val: "x" } },
        { id: "tu-2", name: "tool_b", input: { num: 42 } },
      ]),
      textResponse("Both done"),
    ]);

    const config = makeConfig({ provider, tools: [toolA, toolB] });
    const result = await runAgentLoop(config, [{ role: "user", content: "do both" }]);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Both done");
    expect(executionOrder).toEqual(["a:x", "b:42"]);
  });
});

// ===========================================================================
// Unknown tool
// ===========================================================================

describe("runAgentLoop — unknown tool", () => {
  it("returns error message to LLM for unknown tool name", async () => {
    const completeSpy = vi.fn<(params: CompletionParams) => Promise<LLMResponse>>();
    completeSpy
      .mockResolvedValueOnce(toolUseResponse([{ id: "tu-1", name: "nonexistent", input: {} }]))
      .mockResolvedValueOnce(textResponse("I see the error"));

    const provider: LLMProvider = { complete: completeSpy };
    const config = makeConfig({ provider, tools: [] });

    const result = await runAgentLoop(config, [{ role: "user", content: "call nonexistent" }]);

    expect(result.status).toBe("completed");

    // The messages array is mutated in-place, so by the time we inspect,
    // the final assistant response has been appended. The tool_result user
    // message is the second-to-last element.
    const secondCall = completeSpy.mock.calls[1]!;
    const secondMessages = secondCall[0].messages;
    const toolResultMsg = secondMessages[secondMessages.length - 2]!;
    expect(toolResultMsg.role).toBe("user");

    const toolResults = toolResultMsg.content as ContentBlock[];
    expect(toolResults).toHaveLength(1);
    const resultBlock = toolResults[0]!;
    expect(resultBlock.type).toBe("tool_result");
    if (resultBlock.type === "tool_result") {
      expect(resultBlock.content).toContain("Unknown tool");
      expect(resultBlock.content).toContain("nonexistent");
    }
  });
});

// ===========================================================================
// Invalid tool input
// ===========================================================================

describe("runAgentLoop — invalid tool input", () => {
  it("returns validation error to LLM when input fails zod schema", async () => {
    const strictTool = mockTool(
      "strict_tool",
      z.object({ required_field: z.string().min(1) }),
      async () => "should not be called",
    );

    const completeSpy = vi.fn<(params: CompletionParams) => Promise<LLMResponse>>();
    completeSpy
      .mockResolvedValueOnce(toolUseResponse([{ id: "tu-1", name: "strict_tool", input: {} }]))
      .mockResolvedValueOnce(textResponse("Got it"));

    const provider: LLMProvider = { complete: completeSpy };
    const config = makeConfig({ provider, tools: [strictTool] });

    const result = await runAgentLoop(config, [{ role: "user", content: "use strict_tool" }]);

    expect(result.status).toBe("completed");

    // The messages array is mutated in-place; the tool_result message
    // is the second-to-last element after the final assistant append.
    const secondCall = completeSpy.mock.calls[1]!;
    const secondMessages = secondCall[0].messages;
    const toolResultMsg = secondMessages[secondMessages.length - 2]!;
    expect(toolResultMsg.role).toBe("user");
    const toolResults = toolResultMsg.content as ContentBlock[];
    const resultBlock = toolResults[0]!;
    expect(resultBlock.type).toBe("tool_result");
    if (resultBlock.type === "tool_result") {
      expect(resultBlock.content).toContain("Invalid input");
      expect(resultBlock.content).toContain("strict_tool");
    }
  });

  it("does not execute the tool when validation fails", async () => {
    const executeSpy = vi.fn<() => Promise<string>>().mockResolvedValue("executed");
    const guarded = mockTool(
      "guarded",
      z.object({ count: z.number().int().positive() }),
      executeSpy,
    );

    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "guarded", input: { count: -5 } }]),
      textResponse("ok"),
    ]);

    const config = makeConfig({ provider, tools: [guarded] });
    await runAgentLoop(config, [{ role: "user", content: "test" }]);

    expect(executeSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Wall-clock timeout
// ===========================================================================

describe("runAgentLoop — wall-clock timeout", () => {
  it("returns timeout status when elapsed time exceeds timeout", async () => {
    // Use vi.spyOn to mock Date.now
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(5000) // first iteration check — within timeout
      .mockReturnValueOnce(60000); // second iteration check — past timeout

    const noopTool = mockTool("noop", z.object({}), async () => "ok");
    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "noop", input: {} }]),
      textResponse("should not reach this"),
    ]);

    const config = makeConfig({ provider, tools: [noopTool], timeout: 10_000 });
    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("wall-clock timeout");
    expect(result.error).toContain("10000");

    dateNowSpy.mockRestore();
  });

  it("includes partial output from last assistant message on timeout", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(1000) // first iteration — ok
      .mockReturnValueOnce(50000); // second iteration — timeout

    // First response: tool_use with some text
    const firstResponse: LLMResponse = {
      content: [
        { type: "text", text: "I will call a tool" },
        { type: "tool_use", id: "tu-1", name: "noop", input: {} },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "mock-model",
    };

    const noopTool = mockTool("noop", z.object({}), async () => "ok");
    const provider = mockProvider([firstResponse, textResponse("unreachable")]);
    const config = makeConfig({ provider, tools: [noopTool], timeout: 10_000 });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("timeout");
    expect(result.output).toBe("I will call a tool");

    dateNowSpy.mockRestore();
  });
});

// ===========================================================================
// Token limit exceeded
// ===========================================================================

describe("runAgentLoop — token limit", () => {
  it("returns token_limit status when cumulative tokens exceed limit", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "noop", input: {} }], 400, 600),
      textResponse("should not reach this"),
    ]);

    const config = makeConfig({
      provider,
      tools: [noopTool],
      tokenLimit: 500, // First call uses 400+600=1000 > 500
    });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("token_limit");
    expect(result.error).toContain("token limit");
    expect(result.error).toContain("500");
    expect(result.tokenUsage).toEqual({ input: 400, output: 600 });
  });

  it("allows the call that pushes tokens over limit to complete", async () => {
    // tokenLimit = 100, first call uses 60 tokens (under), second call would check 60 >= 100 — no.
    // So the first call (50+10=60) proceeds, then the second iteration checks 60 < 100, proceeds.
    // Second call uses another 60, total = 120 >= 100 on third iteration → token_limit.
    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "noop", input: {} }], 30, 30),
      toolUseResponse([{ id: "tu-2", name: "noop", input: {} }], 30, 30),
      textResponse("unreachable"),
    ]);

    const config = makeConfig({
      provider,
      tools: [noopTool],
      tokenLimit: 100,
    });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("token_limit");
    expect(result.tokenUsage.input + result.tokenUsage.output).toBe(120);
  });
});

// ===========================================================================
// LLM call failure
// ===========================================================================

describe("runAgentLoop — LLM call failure", () => {
  it("returns failed status when provider throws an Error", async () => {
    const provider: LLMProvider = {
      async complete(): Promise<LLMResponse> {
        throw new Error("API rate limited");
      },
    };

    const config = makeConfig({ provider });
    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("LLM call failed");
    expect(result.error).toContain("API rate limited");
  });

  it("returns failed status when provider throws a non-Error", async () => {
    const provider: LLMProvider = {
      async complete(): Promise<LLMResponse> {
        throw "string error"; // eslint-disable-line no-throw-literal
      },
    };

    const config = makeConfig({ provider });
    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("string error");
  });

  it("preserves accumulated tokens from prior successful calls", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");
    let callCount = 0;
    const provider: LLMProvider = {
      async complete(): Promise<LLMResponse> {
        callCount++;
        if (callCount === 1) {
          return toolUseResponse([{ id: "tu-1", name: "noop", input: {} }], 100, 200);
        }
        throw new Error("second call fails");
      },
    };

    const config = makeConfig({ provider, tools: [noopTool] });
    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("failed");
    expect(result.tokenUsage).toEqual({ input: 100, output: 200 });
  });
});

// ===========================================================================
// Max iterations safety
// ===========================================================================

describe("runAgentLoop — max iterations", () => {
  it("returns failed status with max iterations error after 100 loops", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    // Provider that always returns tool_use — never end_turn
    let callCount = 0;
    const provider: LLMProvider = {
      async complete(): Promise<LLMResponse> {
        callCount++;
        return toolUseResponse([{ id: `tu-${String(callCount)}`, name: "noop", input: {} }], 1, 1);
      },
    };

    const config = makeConfig({
      provider,
      tools: [noopTool],
      tokenLimit: 1_000_000, // High limit so we hit iteration cap
      timeout: 600_000,
    });

    const result = await runAgentLoop(config, [{ role: "user", content: "loop forever" }]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("maximum iteration limit");
    expect(result.error).toContain("100");
    expect(callCount).toBe(100);
  });
});

// ===========================================================================
// Token accumulation
// ===========================================================================

describe("runAgentLoop — token accumulation", () => {
  it("accumulates input and output tokens across multiple LLM calls", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "noop", input: {} }], 10, 20),
      toolUseResponse([{ id: "tu-2", name: "noop", input: {} }], 30, 40),
      textResponse("final", 50, 60),
    ]);

    const config = makeConfig({
      provider,
      tools: [noopTool],
      tokenLimit: 1_000_000,
    });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("completed");
    expect(result.tokenUsage).toEqual({ input: 90, output: 120 });
  });
});

// ===========================================================================
// extractTextOutput from conversation
// ===========================================================================

describe("runAgentLoop — extractTextOutput on early exit", () => {
  it("returns last assistant text when loop exits due to timeout", async () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(0) // first iteration check
      .mockReturnValueOnce(99999); // second iteration check — timeout

    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    const response: LLMResponse = {
      content: [
        { type: "text", text: "partial progress" },
        { type: "tool_use", id: "tu-1", name: "noop", input: {} },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 20 },
      model: "mock-model",
    };

    const provider = mockProvider([response]);
    const config = makeConfig({ provider, tools: [noopTool], timeout: 5000 });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("timeout");
    expect(result.output).toBe("partial progress");

    dateNowSpy.mockRestore();
  });

  it("returns empty string when no assistant messages exist", async () => {
    // Timeout on very first iteration before any LLM call
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy
      .mockReturnValueOnce(0) // startTime
      .mockReturnValueOnce(99999); // first iteration check — immediate timeout

    const provider = mockProvider([textResponse("unreachable")]);
    const config = makeConfig({ provider, timeout: 100 });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("timeout");
    expect(result.output).toBe("");

    dateNowSpy.mockRestore();
  });

  it("returns text from the latest assistant message on token_limit exit", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");

    const toolResponse: LLMResponse = {
      content: [
        { type: "text", text: "working on it" },
        { type: "tool_use", id: "tu-1", name: "noop", input: {} },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 500, outputTokens: 500 },
      model: "mock-model",
    };

    const provider = mockProvider([toolResponse]);
    const config = makeConfig({
      provider,
      tools: [noopTool],
      tokenLimit: 100, // 500+500 = 1000 >> 100 → token_limit on next iteration
    });

    const result = await runAgentLoop(config, [{ role: "user", content: "go" }]);

    expect(result.status).toBe("token_limit");
    expect(result.output).toBe("working on it");
  });
});

// ===========================================================================
// Initial messages
// ===========================================================================

describe("runAgentLoop — initial messages", () => {
  it("passes initial messages to the provider", async () => {
    const completeSpy = vi.fn<(params: CompletionParams) => Promise<LLMResponse>>();
    completeSpy.mockResolvedValueOnce(textResponse("reply"));

    const provider: LLMProvider = { complete: completeSpy };
    const config = makeConfig({ provider });

    await runAgentLoop(config, [
      { role: "user", content: "first message" },
      { role: "assistant", content: [{ type: "text", text: "ack" }] },
      { role: "user", content: "second message" },
    ]);

    // The messages array is mutated in-place (assistant response appended),
    // so it has 4 elements by the time we inspect. The first 3 are the
    // initial messages we passed in.
    const params = completeSpy.mock.calls[0]![0];
    expect(params.messages).toHaveLength(4);
    expect(params.messages[0]!.role).toBe("user");
    expect(params.messages[1]!.role).toBe("assistant");
    expect(params.messages[2]!.role).toBe("user");
  });

  it("works with no initial messages", async () => {
    const provider = mockProvider([textResponse("hello")]);
    const config = makeConfig({ provider });

    const result = await runAgentLoop(config);

    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello");
  });

  it("does not mutate the original initialMessages array", async () => {
    const noopTool = mockTool("noop", z.object({}), async () => "ok");
    const provider = mockProvider([
      toolUseResponse([{ id: "tu-1", name: "noop", input: {} }]),
      textResponse("done"),
    ]);
    const config = makeConfig({ provider, tools: [noopTool] });
    const initial = [{ role: "user" as const, content: "start" }];

    await runAgentLoop(config, initial);

    expect(initial).toHaveLength(1);
  });
});

// ===========================================================================
// Completion params
// ===========================================================================

describe("runAgentLoop — completion params", () => {
  it("sends system prompt, model, and tool definitions to provider", async () => {
    const myTool = mockTool("my_tool", z.object({ x: z.string() }), async () => "ok");

    const completeSpy = vi.fn<(params: CompletionParams) => Promise<LLMResponse>>();
    completeSpy.mockResolvedValueOnce(textResponse("done"));

    const provider: LLMProvider = { complete: completeSpy };
    const config = makeConfig({
      provider,
      tools: [myTool],
      systemPrompt: "Custom system prompt",
      model: "claude-test-1",
      maxTokens: 4096,
    });

    await runAgentLoop(config, [{ role: "user", content: "go" }]);

    const params = completeSpy.mock.calls[0]![0];
    expect(params.system).toBe("Custom system prompt");
    expect(params.model).toBe("claude-test-1");
    expect(params.maxTokens).toBe(4096);
    expect(params.tools).toHaveLength(1);
    expect(params.tools![0]!.name).toBe("my_tool");
  });

  it("omits tools from params when no tools are configured", async () => {
    const completeSpy = vi.fn<(params: CompletionParams) => Promise<LLMResponse>>();
    completeSpy.mockResolvedValueOnce(textResponse("done"));

    const provider: LLMProvider = { complete: completeSpy };
    const config = makeConfig({ provider, tools: [] });

    await runAgentLoop(config, [{ role: "user", content: "go" }]);

    const params = completeSpy.mock.calls[0]![0];
    expect(params.tools).toBeUndefined();
  });

  it("omits maxTokens from params when not configured", async () => {
    const completeSpy = vi.fn<(params: CompletionParams) => Promise<LLMResponse>>();
    completeSpy.mockResolvedValueOnce(textResponse("done"));

    const provider: LLMProvider = { complete: completeSpy };
    const config = makeConfig({ provider, maxTokens: undefined });

    await runAgentLoop(config, [{ role: "user", content: "go" }]);

    const params = completeSpy.mock.calls[0]![0];
    expect(params.maxTokens).toBeUndefined();
  });
});
