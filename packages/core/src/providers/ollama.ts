// ============================================================================
// Ollama LLM Provider (Stub)
//
// Placeholder provider for future Ollama (local model) support.
// Currently throws on any completion attempt.
// ============================================================================

import type { LLMProvider } from './base.js';

/**
 * Stub Ollama provider.
 *
 * Accepts the standard {@link ProviderConfig} but does not use it —
 * Ollama integration is planned for a future release.
 */
export class OllamaProvider implements LLMProvider {
  /**
   * Always throws — Ollama support is not yet implemented.
   *
   * @throws {Error} Always, indicating the provider is not yet supported.
   */
  complete(): never {
    throw new Error(
      'Ollama provider is not yet supported. Planned for a future release.',
    );
  }
}
