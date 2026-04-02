import { z } from "zod";
import { ContentBlockSchema, ToolDefinitionSchema, LLMResponseSchema } from "../types.js";

// Re-export LLM-related types from types.ts for provider consumers.
export type { ContentBlock, ToolDefinition, LLMResponse } from "../types.js";
export { ContentBlockSchema, ToolDefinitionSchema, LLMResponseSchema } from "../types.js";

// ============================================================================
// LLMMessage
// ============================================================================

/** Zod schema for the role field of an LLM conversation message. */
export const LLMMessageRoleSchema = z.enum(["user", "assistant"]);

/** Role of an LLM conversation message. */
export type LLMMessageRole = z.infer<typeof LLMMessageRoleSchema>;

/**
 * Zod schema for a single message in an LLM conversation.
 *
 * Content can be a plain string (convenience for simple text messages)
 * or an array of ContentBlock for structured content including tool
 * invocations and results.
 */
export const LLMMessageSchema = z.object({
  /** Message author: 'user' for human/system input, 'assistant' for LLM output. */
  role: LLMMessageRoleSchema,
  /** Message content: plain string or structured content blocks. */
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});

/** A single message in an LLM conversation history. */
export type LLMMessage = z.infer<typeof LLMMessageSchema>;

// ============================================================================
// ProviderConfig
// ============================================================================

/**
 * Zod schema for provider-specific configuration.
 *
 * Contains connection details needed to initialize an LLM provider.
 * Each provider implementation reads only the fields it needs;
 * unknown fields are passed through to support provider-specific options.
 *
 * Authentication modes (exactly one must be provided):
 * - apiKey: Standard Anthropic API key (sk-ant-api...) from console.anthropic.com
 * - oauthToken: OAuth Bearer token (sk-ant-o...) from Claude.ai OAuth flow,
 *   used with the anthropic-beta: oauth-2025-04-20 header.
 */
export const ProviderConfigSchema = z
  .object({
    /** API key for authentication (e.g., ANTHROPIC_API_KEY value). Mutually exclusive with oauthToken. */
    apiKey: z.string().min(1).optional(),
    /** OAuth Bearer token or async getter function for authentication (e.g., from Claude.ai OAuth). Mutually exclusive with apiKey. */
    oauthToken: z.union([z.string().min(1), z.custom<() => string | Promise<string>>((v) => typeof v === 'function')]).optional(),
    /** Base URL override for the provider API (e.g., custom proxy or local endpoint). */
    baseUrl: z.string().url().optional(),
    /** Default model identifier (e.g., "claude-sonnet-4-6", "gpt-4o"). */
    defaultModel: z.string().optional(),
    /** Default maximum tokens for completions. */
    defaultMaxTokens: z.number().int().positive().optional(),
    /** Additional provider-specific options passed through without validation. */
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((cfg) => cfg.apiKey !== undefined || cfg.oauthToken !== undefined, {
    message: "Either apiKey or oauthToken must be provided in ProviderConfig",
  });

/** Configuration for initializing an LLM provider. */
export type ProviderConfig = Omit<z.infer<typeof ProviderConfigSchema>, 'oauthToken'> & {
  /** OAuth Bearer token OR an async getter that returns a fresh token on each call. */
  oauthToken?: string | (() => string | Promise<string>);
};

// ============================================================================
// CompletionParams
// ============================================================================

/**
 * Zod schema for the parameters accepted by LLMProvider.complete().
 *
 * Defines a provider-agnostic completion request. Each provider
 * implementation translates these params into its native API format.
 */
export const CompletionParamsSchema = z.object({
  /** Conversation message history sent to the LLM. */
  messages: z.array(LLMMessageSchema),
  /** System prompt providing instructions and context for the LLM. */
  system: z.string(),
  /** Tool definitions available for the LLM to invoke. */
  tools: z.array(ToolDefinitionSchema).optional(),
  /** Model identifier to use for this completion (e.g., "claude-sonnet-4-6"). */
  model: z.string(),
  /** Maximum tokens the LLM may generate in its response. */
  maxTokens: z.number().int().positive().optional(),
});

/** Parameters for a single LLM completion request. */
export type CompletionParams = z.infer<typeof CompletionParamsSchema>;

// ============================================================================
// LLMProvider Interface
// ============================================================================

/**
 * Abstract interface for LLM providers.
 *
 * All agent code interacts with LLMs exclusively through this interface.
 * Provider-specific SDK imports (e.g., @anthropic-ai/sdk, openai) are
 * confined to the concrete implementation files. Swapping providers
 * requires only a configuration change, not code modifications.
 *
 * Implementations must:
 * - Translate CompletionParams into the provider's native API format.
 * - Translate the provider's native response into a normalized LLMResponse.
 * - Propagate API errors as thrown exceptions (the agent loop handles them).
 *
 * @see AnthropicProvider for the reference implementation.
 */
export interface LLMProvider {
  /**
   * Send a completion request to the LLM and return its response.
   *
   * @param params - Provider-agnostic completion parameters including
   *   conversation messages, system prompt, optional tool definitions,
   *   model identifier, and optional token limit.
   * @returns A normalized LLM response with content blocks, stop reason,
   *   token usage, and the model that produced the response.
   */
  complete(params: CompletionParams): Promise<z.infer<typeof LLMResponseSchema>>;
}
