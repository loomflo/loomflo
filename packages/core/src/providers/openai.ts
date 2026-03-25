/**
 * OpenAI LLM provider stub.
 *
 * Placeholder implementation of the LLMProvider interface for OpenAI models.
 * This provider is not yet functional and will throw on any completion
 * request. It exists to reserve the integration point so that provider
 * selection logic (e.g., config parsing and factory functions) can
 * reference OpenAI without runtime errors at import time.
 *
 * A full implementation wrapping the openai SDK is planned for a future
 * release.
 *
 * @module providers/openai
 */

import type {
  LLMProvider,
  ProviderConfig,
  CompletionParams,
} from './base.js';
import type { LLMResponse } from '../types.js';

/**
 * Stub LLM provider for OpenAI models.
 *
 * Accepts a standard ProviderConfig so it can be instantiated alongside
 * other providers, but throws on every completion request.
 */
export class OpenAIProvider implements LLMProvider {
  /**
   * Creates an OpenAIProvider instance.
   *
   * @param _config - Provider configuration (accepted but unused).
   */
  constructor(_config: ProviderConfig) {
    // No initialization — this is a placeholder.
  }

  /**
   * Always throws — OpenAI support is not yet implemented.
   *
   * @param _params - Completion parameters (accepted but unused).
   * @throws {Error} Always, indicating the provider is not yet supported.
   */
  async complete(_params: CompletionParams): Promise<LLMResponse> {
    throw new Error(
      'OpenAI provider is not yet supported. Planned for a future release.',
    );
  }
}
