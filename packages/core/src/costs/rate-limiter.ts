/**
 * Per-agent LLM API rate limiter for Loomflo agent orchestration.
 *
 * Implements a token-bucket algorithm to enforce configurable max calls per
 * minute per agent, preventing infinite loops or runaway costs (Constitution
 * Principle V, FR-052).
 *
 * The rate limiter is fully synchronous — it is a hot-path guard that must
 * not introduce async overhead. Buckets are lazy-initialized on first call
 * for each agent.
 */

// ============================================================================
// Types
// ============================================================================

/** Result when a rate limit acquisition is allowed. */
export interface RateLimitAllowed {
  /** Indicates the call is permitted. */
  allowed: true;
}

/** Result when a rate limit acquisition is rejected. */
export interface RateLimitRejected {
  /** Indicates the call is not permitted. */
  allowed: false;
  /** Milliseconds until the next token becomes available. */
  retryAfterMs: number;
}

/** Result of a rate limit acquisition attempt. */
export type RateLimitResult = RateLimitAllowed | RateLimitRejected;

/** Internal state for a single agent's token bucket. */
interface TokenBucket {
  /** Current number of available tokens. */
  tokens: number;
  /** Timestamp (ms since epoch) of the last token refill. */
  lastRefillTime: number;
}

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Token-bucket rate limiter for per-agent LLM API call enforcement.
 *
 * Each agent gets an independent bucket that starts full and refills at a
 * steady rate of {@link maxCallsPerMinute} / 60 tokens per second. When the
 * bucket is empty, calls are rejected with a structured error containing the
 * estimated retry delay.
 */
export class RateLimiter {
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;
  private readonly buckets: Map<string, TokenBucket> = new Map();

  /**
   * Creates a new RateLimiter instance.
   *
   * @param maxCallsPerMinute - Maximum LLM API calls allowed per minute per agent.
   *   Defaults to 60 (matching config.apiRateLimit default).
   */
  constructor(maxCallsPerMinute: number = 60) {
    this.maxTokens = maxCallsPerMinute;
    // refillRate = maxCallsPerMinute / 60 tokens per second = maxCallsPerMinute / 60_000 per ms
    this.refillRatePerMs = maxCallsPerMinute / 60_000;
  }

  /**
   * Attempts to acquire a rate limit token for the given agent.
   *
   * If the agent's bucket has at least one token, it is consumed and the call
   * is allowed. Otherwise, the call is rejected with an estimated retry delay.
   *
   * Buckets are lazy-initialized on first call for each agent.
   *
   * @param agentId - Unique identifier of the agent requesting a call.
   * @returns An allowed result if a token was consumed, or a rejected result
   *   with `retryAfterMs` indicating when to retry.
   */
  acquireOrReject(agentId: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(agentId);

    if (bucket === undefined) {
      bucket = { tokens: this.maxTokens, lastRefillTime: now };
      this.buckets.set(agentId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefillTime;
    if (elapsed > 0) {
      const refill = elapsed * this.refillRatePerMs;
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill);
      bucket.lastRefillTime = now;
    }

    // Try to consume a token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }

    // Calculate time until one token is available
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillRatePerMs);

    return { allowed: false, retryAfterMs };
  }

  /**
   * Clears rate limit state for a specific agent.
   *
   * Should be called when an agent's lifecycle ends to free resources.
   *
   * @param agentId - Unique identifier of the agent to clear.
   */
  reset(agentId: string): void {
    this.buckets.delete(agentId);
  }

  /**
   * Clears rate limit state for all agents.
   *
   * Should be called when a workflow completes or is reset.
   */
  resetAll(): void {
    this.buckets.clear();
  }
}
