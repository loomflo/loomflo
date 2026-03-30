// ============================================================================
// OpenAI LLM Provider (Stub)
//
// Placeholder provider for future OpenAI support.
// Currently throws on any completion attempt.
// ============================================================================

import type { LLMProvider } from './base.js';

/**
 * Stub OpenAI provider.
 *
 * Accepts the standard {@link ProviderConfig} but does not use it —
 * OpenAI integration is planned for a future release.
 */
export class OpenAIProvider implements LLMProvider {
  /**
   * Always throws — OpenAI support is not yet implemented.
   *
   * @throws {Error} Always, indicating the provider is not yet supported.
   */
  complete(): never {
    throw new Error(
      'OpenAI provider is not yet supported. Planned for a future release.',
    );
  }
}
