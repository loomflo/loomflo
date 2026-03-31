/**
 * Anthropic LLM provider implementation.
 *
 * This is the ONLY file in the codebase that imports @anthropic-ai/sdk.
 * All other code interacts with LLMs through the abstract LLMProvider
 * interface defined in base.ts. This isolation is mandated by
 * Constitution Principle IV (Provider Abstraction).
 *
 * @module providers/anthropic
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, ProviderConfig, CompletionParams, LLMMessage } from "./base.js";
import type { ContentBlock, LLMResponse, ToolDefinition } from "../types.js";

/** Default maximum tokens when not specified in params or config. */
const DEFAULT_MAX_TOKENS = 8192;

/** Default model when not specified in config. */
const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Translates our ToolDefinition[] to the Anthropic tool format.
 *
 * @param tools - Provider-agnostic tool definitions.
 * @returns Tools in Anthropic API format with input_schema.
 */
function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      ...tool.inputSchema,
    },
  }));
}

/**
 * Translates a single LLMMessage content to the Anthropic ContentBlockParam format.
 *
 * Handles three cases:
 * - Plain string content: passed through as-is (Anthropic accepts strings).
 * - ContentBlock[] with tool_result blocks: translates toolUseId to tool_use_id.
 * - ContentBlock[] without tool_result: passes text and tool_use blocks through.
 *
 * @param content - Message content as string or ContentBlock array.
 * @returns Content in Anthropic API format.
 */
function toAnthropicContent(
  content: string | ContentBlock[],
): string | Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === "string") {
    return content;
  }

  return content.map((block): Anthropic.Messages.ContentBlockParam => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
        };
    }
  });
}

/**
 * Translates LLMMessage[] to Anthropic MessageParam[].
 *
 * @param messages - Provider-agnostic conversation messages.
 * @returns Messages in Anthropic API format.
 */
function toAnthropicMessages(messages: LLMMessage[]): Anthropic.Messages.MessageParam[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: toAnthropicContent(msg.content),
  }));
}

/**
 * Translates Anthropic response content blocks to our ContentBlock format.
 *
 * Maps tool_use blocks from Anthropic format (id, type, name, input) to our
 * normalized format. Text blocks pass through directly. Thinking blocks are
 * skipped as they are not part of our content model.
 *
 * @param blocks - Anthropic response content blocks.
 * @returns Provider-agnostic content blocks.
 */
function fromAnthropicContent(blocks: Anthropic.Messages.ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        result.push({ type: "text", text: block.text });
        break;
      case "tool_use":
        result.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        break;
      // Thinking blocks (thinking, redacted_thinking) are internal to
      // Anthropic's extended thinking feature and not part of our
      // content model. They are intentionally skipped.
    }
  }
  return result;
}

/**
 * Maps the Anthropic stop_reason to our normalized stopReason enum.
 *
 * Our LLMResponse schema supports 'end_turn' and 'tool_use'. Anthropic may
 * also return 'max_tokens' or 'stop_sequence', which we map to 'end_turn'
 * since the model stopped generating in both cases.
 *
 * @param stopReason - Anthropic stop_reason value.
 * @returns Normalized stop reason.
 */
function fromAnthropicStopReason(stopReason: string | null): "end_turn" | "tool_use" {
  if (stopReason === "tool_use") {
    return "tool_use";
  }
  return "end_turn";
}

/**
 * LLM provider implementation for Anthropic's Claude models.
 *
 * Wraps the @anthropic-ai/sdk to translate between the provider-agnostic
 * CompletionParams/LLMResponse types and the Anthropic Messages API format.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   defaultModel: 'claude-sonnet-4-6',
 * });
 *
 * const response = await provider.complete({
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   system: 'You are a helpful assistant.',
 *   model: 'claude-sonnet-4-6',
 * });
 * ```
 */
export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;

  /** HTTP status codes eligible for exponential backoff retry. */
  private readonly RETRYABLE_STATUSES: readonly number[] = [429, 529];

  /**
   * Creates an AnthropicProvider instance.
   *
   * @param config - Provider configuration. apiKey is required.
   *   Optional baseUrl overrides the API endpoint.
   *   Optional defaultModel sets the fallback model identifier.
   *   Optional defaultMaxTokens sets the fallback token limit.
   */
  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * Waits for an exponentially increasing delay before a retry attempt.
   *
   * Uses a base delay sequence of [1s, 2s, 4s, 8s, 16s] indexed by the
   * 0-based attempt number, plus random jitter in the range [0, 500) ms
   * to avoid thundering-herd effects when multiple callers retry
   * simultaneously.
   *
   * @param attempt - Zero-indexed retry attempt (0 = first retry, 4 = fifth/last).
   * @returns A promise that resolves after the computed delay.
   */
  private async retryDelay(attempt: number): Promise<void> {
    const BASE_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000];
    const delay = (BASE_DELAYS_MS[attempt] ?? 16000) + Math.random() * 500;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Sends a completion request to the Anthropic Messages API.
   *
   * Translates provider-agnostic CompletionParams into Anthropic's native
   * format, executes the API call, and normalizes the response into an
   * LLMResponse.
   *
   * On retryable errors (HTTP 429 rate-limit or 529 overloaded), retries
   * up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s) plus
   * random jitter. Client errors (400, 401, 403) and other non-retryable
   * errors are thrown immediately without retry.
   *
   * @param params - Provider-agnostic completion parameters.
   * @returns Normalized LLM response with content blocks, stop reason,
   *   token usage, and model identifier.
   * @throws {Error} If the Anthropic API returns a non-retryable error,
   *   or if all 5 retry attempts are exhausted on a retryable error.
   */
  async complete(params: CompletionParams): Promise<LLMResponse> {
    const model = params.model || this.defaultModel;
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;
    const maxRetries = 5;

    const requestParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      ...(params.tools?.length ? { tools: toAnthropicTools(params.tools) } : {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(requestParams);

        return {
          content: fromAnthropicContent(response.content),
          stopReason: fromAnthropicStopReason(response.stop_reason),
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
          model: response.model,
        };
      } catch (error: unknown) {
        if (error instanceof Anthropic.APIError) {
          const status = Number(error.status);

          if (this.RETRYABLE_STATUSES.includes(status) && attempt < maxRetries) {
            const delayMs =
              ([1000, 2000, 4000, 8000, 16000][attempt] ?? 16000) + Math.round(Math.random() * 500);
            console.error(
              `AnthropicProvider: retry ${String(attempt + 1)}/5 after status ${String(status)} — waiting ${String(delayMs)}ms`,
            );
            await this.retryDelay(attempt);
            continue;
          }

          if (this.RETRYABLE_STATUSES.includes(status) && attempt >= maxRetries) {
            throw new Error(
              "Anthropic API overloaded after 5 retries — check https://status.anthropic.com",
            );
          }

          throw new Error(`Anthropic API error (${String(status)}): ${error.message}`);
        }
        throw error;
      }
    }

    throw new Error(
      "Anthropic API overloaded after 5 retries — check https://status.anthropic.com",
    );
  }
}
