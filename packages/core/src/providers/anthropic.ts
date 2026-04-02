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

/** Claude Code version string used in OAuth user-agent header (must match deployed CLI). */
const CLAUDE_CODE_VERSION = "2.1.75";

/**
 * System prompt identity block required by Anthropic for OAuth token auth.
 * Must be the first system block — the API rejects requests without it.
 * Source: reverse-engineered from @mariozechner/pi-ai (OpenClaw's LLM engine).
 */
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

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
  /** True when using OAuth token auth — requires Claude Code identity headers + system block. */
  /** True when using OAuth token auth — readable by consumers to adapt 401 handling. */
  public readonly isOAuthMode: boolean;
  /** Static token string or getter function that returns a fresh token on each call. */
  private readonly oauthTokenSource?: string | (() => string | Promise<string>);

  /** HTTP status codes eligible for exponential backoff retry. */
  private readonly RETRYABLE_STATUSES: readonly number[] = [429, 529];

  /**
   * Resolves the current OAuth token from the stored source.
   *
   * If the source is a function (getter), it is called and awaited to obtain
   * a fresh token. This enables external token-refresh logic to supply an
   * up-to-date token before every API call. If the source is a static string,
   * it is returned directly.
   *
   * @returns The resolved OAuth Bearer token string.
   */
  private async resolveOAuthToken(): Promise<string> {
    if (typeof this.oauthTokenSource === "function") {
      return await this.oauthTokenSource();
    }
    return this.oauthTokenSource ?? "";
  }

  /**
   * Creates an AnthropicProvider instance.
   *
   * Supports two authentication modes — exactly one must be provided:
   * - **apiKey** (standard): A `sk-ant-api...` key from console.anthropic.com.
   *   Used via the `x-api-key` header.
   * - **oauthToken** (OAuth): A `sk-ant-o...` Bearer token from the Claude.ai
   *   OAuth flow. Injected via `Authorization: Bearer <token>` with the
   *   `anthropic-beta: oauth-2025-04-20` header automatically added.
   *   Can be a static string or a getter function that returns a fresh token.
   *
   * @param config - Provider configuration. Either apiKey or oauthToken is required.
   *   Optional baseUrl overrides the API endpoint.
   *   Optional defaultModel sets the fallback model identifier.
   *   Optional defaultMaxTokens sets the fallback token limit.
   */
  constructor(config: ProviderConfig) {
    if (config.oauthToken) {
      // Store the token source (string or getter) for dynamic resolution in complete().
      this.oauthTokenSource = config.oauthToken;

      // OAuth mode: authToken → Authorization: Bearer (NOT x-api-key).
      // Anthropic requires the claude-code-20250219 beta, CLI user-agent, and x-app: cli.
      // Without these headers + the Claude Code system identity, the API rejects the request.
      // Source: reverse-engineered from @mariozechner/pi-ai (OpenClaw's LLM engine).
      // A placeholder authToken is used here; it is overwritten dynamically in
      // complete() via resolveOAuthToken() before every API call.
      this.client = new Anthropic({
        apiKey: null,
        authToken: "placeholder",
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
          "accept": "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
          "anthropic-beta":
            "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
          "user-agent": `claude-cli/${CLAUDE_CODE_VERSION}`,
          "x-app": "cli",
        },
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      this.isOAuthMode = true;
    } else {
      this.client = new Anthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      this.isOAuthMode = false;
    }
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

    // OAuth mode requires the Claude Code identity as the first system block.
    // Without it, Anthropic returns invalid_request_error even with a valid token.
    const systemParam: Anthropic.Messages.MessageCreateParamsNonStreaming["system"] =
      this.isOAuthMode
        ? [
            { type: "text", text: CLAUDE_CODE_IDENTITY },
            { type: "text", text: params.system },
          ]
        : params.system;

    const requestParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      system: systemParam,
      messages: toAnthropicMessages(params.messages),
      ...(params.tools?.length ? { tools: toAnthropicTools(params.tools) } : {}),
    };

    // In OAuth mode, resolve a fresh token before every call. The SDK reads
    // this.client.authToken inside its authHeaders() method when building the
    // request, so updating the public property is sufficient.
    if (this.isOAuthMode) {
      this.client.authToken = await this.resolveOAuthToken();
    }

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
