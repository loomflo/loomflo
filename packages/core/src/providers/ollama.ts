/**
 * Ollama LLM provider stub.
 *
 * Placeholder implementation of the LLMProvider interface for locally-hosted
 * models served by Ollama. This provider is not yet functional and will throw
 * on any completion request. It exists to reserve the integration point so
 * that provider selection logic can reference Ollama without runtime errors
 * at import time.
 *
 * A full implementation targeting the Ollama REST API is planned for a future
 * release, enabling fully offline agent execution with local models.
 *
 * @module providers/ollama
 */

import type {
  LLMProvider,
  ProviderConfig,
  CompletionParams,
} from './base.js';
import type { LLMResponse } from '../types.js';

/**
 * Stub LLM provider for locally-hosted Ollama models.
 *
 * Accepts a standard ProviderConfig so it can be instantiated alongside
 * other providers, but throws on every completion request.
 */
export class OllamaProvider implements LLMProvider {
  /**
   * Creates an OllamaProvider instance.
   *
   * @param _config - Provider configuration (accepted but unused).
   */
  constructor(_config: ProviderConfig) {
    // No initialization — this is a placeholder.
  }

  /**
   * Always throws — Ollama support is not yet implemented.
   *
   * @param _params - Completion parameters (accepted but unused).
   * @throws {Error} Always, indicating the provider is not yet supported.
   */
  async complete(_params: CompletionParams): Promise<LLMResponse> {
    throw new Error(
      'Ollama provider is not yet supported. Planned for a future release.',
    );
  }
}
