// ============================================================================
// OpenAI-compatible LLM Provider
//
// Works with any OpenAI-compatible API:
// - OpenAI: baseUrl omitted (default), apiKey = OPENAI_API_KEY
// - Moonshot/Kimi: baseUrl = 'https://api.moonshot.cn/v1', apiKey = MOONSHOT_API_KEY
// - Nvidia NIM: baseUrl = 'https://integrate.api.nvidia.com/v1', apiKey = NVIDIA_API_KEY
// ============================================================================

import OpenAI from "openai";
import type { LLMProvider, ProviderConfig, CompletionParams, LLMMessage } from "./base.js";
import type { ContentBlock, LLMResponse, ToolDefinition } from "../types.js";

const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MODEL = "moonshot-v1-8k";

function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object" as const, ...tool.inputSchema },
    },
  }));
}

function toOpenAIMessages(
  messages: LLMMessage[],
  system: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
  ];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      const textBlocks = msg.content.filter((b) => b.type === "text");
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");

      const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolUseBlocks.map((b) => {
        if (b.type !== "tool_use") throw new Error("Expected tool_use block");
        return {
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        };
      });

      result.push({
        role: "assistant",
        content: textBlocks.map((b) => (b.type === "text" ? b.text : "")).join("") || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      } as OpenAI.Chat.ChatCompletionAssistantMessageParam);
    } else {
      const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");
      const textBlocks = msg.content.filter((b) => b.type === "text");

      for (const b of toolResultBlocks) {
        if (b.type !== "tool_result") continue;
        result.push({
          role: "tool",
          tool_call_id: b.toolUseId,
          content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
        });
      }

      if (textBlocks.length > 0) {
        result.push({
          role: "user",
          content: textBlocks.map((b) => (b.type === "text" ? b.text : "")).join(""),
        });
      }
    }
  }

  return result;
}

function fromOpenAIContent(choice: OpenAI.Chat.ChatCompletion.Choice): ContentBlock[] {
  const result: ContentBlock[] = [];
  const message = choice.message;

  if (message.content) {
    result.push({ type: "text", text: message.content });
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      if (tc.type !== "function") continue;
      result.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      });
    }
  }

  return result;
}

function fromOpenAIFinishReason(reason: string | null): "end_turn" | "tool_use" {
  if (reason === "tool_calls") return "tool_use";
  return "end_turn";
}

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;
  private readonly RETRYABLE_STATUSES: readonly number[] = [429, 500, 503];

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? "",
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(params: CompletionParams): Promise<LLMResponse> {
    const model = params.model || this.defaultModel;
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;
    const maxRetries = 5;
    const messages = toOpenAIMessages(params.messages, params.system);

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages,
      ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create(requestParams);
        const choice = response.choices[0];
        if (!choice) throw new Error("OpenAI API returned no choices");

        return {
          content: fromOpenAIContent(choice),
          stopReason: fromOpenAIFinishReason(choice.finish_reason),
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
          model: response.model,
        };
      } catch (error: unknown) {
        const status = error instanceof OpenAI.APIError ? Number(error.status) : null;

        if (status && this.RETRYABLE_STATUSES.includes(status) && attempt < maxRetries) {
          const BASE_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
          const delay = (BASE_DELAYS_MS[attempt] ?? 16000) + Math.random() * 500;
          console.error(
            `OpenAIProvider: retry ${String(attempt + 1)}/5 after status ${String(status)} — waiting ${String(Math.round(delay))}ms`,
          );
          await new Promise<void>((r) => setTimeout(r, delay));
          continue;
        }

        if (error instanceof OpenAI.APIError) {
          throw new Error(`OpenAI-compat API error (${String(error.status)}): ${error.message}`);
        }
        throw error;
      }
    }

    throw new Error("OpenAI-compat API: max retries exhausted");
  }
}
