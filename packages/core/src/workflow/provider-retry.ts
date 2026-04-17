/**
 * Adaptive provider retry mechanism with progressive backoff.
 *
 * When a provider API call returns a rate-limit (HTTP 429) or credit
 * exhaustion error, this module manages long-duration retries with a
 * configurable backoff schedule (up to ~41 hours across 9 retries).
 *
 * This is distinct from the existing short-delay retry in the provider
 * implementations (AnthropicProvider, OpenAIProvider) which handles
 * transient overloads with a few seconds of backoff. This module handles
 * persistent rate-limiting / credit exhaustion at the workflow engine level.
 *
 * @module workflow/provider-retry
 */

import type { ProviderRetryState } from "../types.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Progressive backoff schedule in milliseconds.
 *
 * Each entry is the wait duration AFTER the N-th failed attempt before retrying.
 * After the 10th attempt (index 9 = last retry), the node is marked exhausted.
 *
 * | Attempt | Wait       | Cumulative |
 * |---------|------------|------------|
 * | 1       | 5 min      | 5 min      |
 * | 2       | 10 min     | 15 min     |
 * | 3       | 30 min     | 45 min     |
 * | 4       | 1h         | 1h45       |
 * | 5       | 1h30       | 3h15       |
 * | 6       | 2h         | 5h15       |
 * | 7       | 4h         | 9h15       |
 * | 8       | 8h         | 17h15      |
 * | 9       | 24h        | 41h15      |
 * | 10      | -- STOP -- |            |
 */
export const PROVIDER_BACKOFF_SCHEDULE_MS: readonly number[] = [
  5 * 60 * 1000, //  5 min
  10 * 60 * 1000, // 10 min
  30 * 60 * 1000, // 30 min
  60 * 60 * 1000, //  1 h
  90 * 60 * 1000, //  1h30
  2 * 60 * 60 * 1000, //  2 h
  4 * 60 * 60 * 1000, //  4 h
  8 * 60 * 60 * 1000, //  8 h
  24 * 60 * 60 * 1000, // 24 h
] as const;

/** Maximum number of provider retry attempts before exhaustion. */
export const MAX_PROVIDER_RETRY_ATTEMPTS = PROVIDER_BACKOFF_SCHEDULE_MS.length + 1; // 10

// ============================================================================
// Error Classification
// ============================================================================

/**
 * HTTP status codes that indicate a rate-limit or credit exhaustion error,
 * and are eligible for long-duration provider retry.
 *
 * - 429: Too Many Requests (standard rate limit)
 * - 529: Overloaded (Anthropic-specific)
 */
const RATE_LIMIT_STATUS_CODES: ReadonlySet<number> = new Set([429, 529]);

/**
 * Error message patterns that indicate rate-limiting or credit exhaustion,
 * even when the HTTP status code is not directly available (e.g., wrapped errors).
 */
const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /rate.?limit/i,
  /too many requests/i,
  /overloaded/i,
  /credit/i,
  /quota/i,
  /capacity/i,
  /billing/i,
  /insufficient.?funds/i,
];

/**
 * Determines whether an error is a provider rate-limit or credit exhaustion error
 * that should trigger the adaptive provider retry mechanism.
 *
 * @param error - The error from a provider call (thrown or caught).
 * @returns An object with `isRateLimit` flag and extracted `statusCode` / `retryAfterMs`.
 */
export function classifyProviderError(error: unknown): ProviderErrorClassification {
  // Extract HTTP status code from common error shapes
  const statusCode = extractStatusCode(error);
  const retryAfterMs = extractRetryAfter(error);
  const message = error instanceof Error ? error.message : String(error);

  // Check by status code first (most reliable)
  if (statusCode !== null && RATE_LIMIT_STATUS_CODES.has(statusCode)) {
    return { isRateLimit: true, statusCode, retryAfterMs, message };
  }

  // Check by error message patterns (fallback for wrapped errors)
  const matchesPattern = RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
  if (matchesPattern) {
    return { isRateLimit: true, statusCode, retryAfterMs, message };
  }

  return { isRateLimit: false, statusCode, retryAfterMs: null, message };
}

/** Result of classifying a provider error. */
export interface ProviderErrorClassification {
  /** Whether the error is a rate-limit / credit exhaustion error. */
  isRateLimit: boolean;
  /** The HTTP status code, or null if not available. */
  statusCode: number | null;
  /** The Retry-After duration in milliseconds (from header), or null. */
  retryAfterMs: number | null;
  /** The error message string. */
  message: string;
}

/**
 * Extracts an HTTP status code from an error object.
 *
 * Supports:
 * - `error.status` (Anthropic SDK, OpenAI SDK)
 * - `error.statusCode` (node-fetch, got)
 * - Parsing from message like "API error (429): ..."
 *
 * @param error - The error to inspect.
 * @returns The HTTP status code, or null if not found.
 */
function extractStatusCode(error: unknown): number | null {
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;

    if (typeof obj["status"] === "number" && obj["status"] > 0) {
      return obj["status"];
    }
    if (typeof obj["statusCode"] === "number" && obj["statusCode"] > 0) {
      return obj["statusCode"];
    }
  }

  // Try to parse from error message: "API error (429): ..."
  if (error instanceof Error) {
    const match = /\((\d{3})\)/.exec(error.message);
    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return null;
}

/**
 * Extracts a Retry-After value from an error object's headers.
 *
 * The Retry-After header can be:
 * - A number of seconds (e.g., "120")
 * - An HTTP-date (e.g., "Fri, 17 Apr 2026 12:00:00 GMT")
 *
 * @param error - The error to inspect.
 * @returns The retry-after duration in milliseconds, or null if not found.
 */
function extractRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  const obj = error as Record<string, unknown>;

  // Check error.headers (Anthropic SDK, OpenAI SDK)
  let headers: Record<string, unknown> | null = null;
  if (obj["headers"] && typeof obj["headers"] === "object") {
    headers = obj["headers"] as Record<string, unknown>;
  }

  if (!headers) return null;

  // Look for retry-after or Retry-After
  const retryAfterRaw =
    headers["retry-after"] ?? headers["Retry-After"] ?? headers["Retry-after"];

  if (retryAfterRaw === undefined || retryAfterRaw === null) return null;

  // Coerce to string: Retry-After values are always strings or numbers.
  const retryAfterStr =
    typeof retryAfterRaw === "string"
      ? retryAfterRaw
      : typeof retryAfterRaw === "number"
        ? String(retryAfterRaw)
        : null;

  if (retryAfterStr === null) return null;

  // Try parsing as number of seconds
  const seconds = Number(retryAfterStr);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const dateMs = Date.parse(retryAfterStr);
  if (!isNaN(dateMs)) {
    const remaining = dateMs - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  return null;
}

// ============================================================================
// Wait Logic
// ============================================================================

/**
 * Computes the wait duration for a given provider retry attempt.
 *
 * If `retryAfterMs` is provided (from Retry-After header), that value is used.
 * Otherwise, the progressive backoff schedule is consulted.
 *
 * @param attempt - The current attempt number (1-based, after the first failure).
 * @param retryAfterMs - Optional Retry-After value from the provider in milliseconds.
 * @returns The wait duration in milliseconds, or null if max attempts exceeded.
 */
export function getProviderRetryDelay(
  attempt: number,
  retryAfterMs: number | null,
): number | null {
  // If we've exceeded max attempts, signal exhaustion
  if (attempt >= MAX_PROVIDER_RETRY_ATTEMPTS) {
    return null;
  }

  // Use Retry-After header value if available
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return retryAfterMs;
  }

  // Use progressive backoff schedule (0-indexed)
  const scheduleIndex = attempt - 1;
  return PROVIDER_BACKOFF_SCHEDULE_MS[scheduleIndex] ?? null;
}

/**
 * Creates a cancellable sleep promise for provider retry waits.
 *
 * The returned object contains:
 * - `promise`: A Promise that resolves to `true` when the timer completes,
 *   or `false` if cancelled.
 * - `cancel()`: A function to cancel the sleep early (resolves the promise with `false`).
 * - `resumeAt`: The ISO 8601 timestamp when the sleep will complete.
 *
 * @param durationMs - How long to sleep in milliseconds.
 * @returns An object with the sleep promise, cancel function, and resumeAt timestamp.
 */
export function createCancellableSleep(durationMs: number): CancellableSleep {
  const resumeAt = new Date(Date.now() + durationMs).toISOString();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveFn: ((completed: boolean) => void) | null = null;

  const promise = new Promise<boolean>((resolve) => {
    resolveFn = resolve;
    timer = setTimeout(() => {
      timer = null;
      resolve(true);
    }, durationMs);
  });

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (resolveFn !== null) {
      resolveFn(false);
    }
  };

  return { promise, cancel, resumeAt };
}

/** A cancellable sleep for provider retry waits. */
export interface CancellableSleep {
  /** Promise that resolves to `true` on completion, `false` if cancelled. */
  promise: Promise<boolean>;
  /** Cancels the sleep, resolving the promise with `false`. */
  cancel: () => void;
  /** ISO 8601 timestamp when the sleep is scheduled to complete. */
  resumeAt: string;
}

// ============================================================================
// State Management
// ============================================================================

/**
 * Creates an initial provider retry state after the first rate-limit error.
 *
 * @param statusCode - The HTTP status code that triggered the retry.
 * @param reason - Human-readable reason for the rate-limit event.
 * @returns A new ProviderRetryState with attempt=1.
 */
export function createProviderRetryState(
  statusCode: number | null,
  reason: string,
): NonNullable<ProviderRetryState> {
  return {
    attempt: 1,
    resumeAt: null,
    lastStatusCode: statusCode,
    lastReason: reason,
  };
}

/**
 * Advances the provider retry state to the next attempt.
 *
 * @param state - The current provider retry state.
 * @param statusCode - The HTTP status code from the latest failure.
 * @param reason - Human-readable reason for the latest failure.
 * @returns The updated provider retry state with incremented attempt.
 */
export function advanceProviderRetryState(
  state: NonNullable<ProviderRetryState>,
  statusCode: number | null,
  reason: string,
): NonNullable<ProviderRetryState> {
  return {
    attempt: state.attempt + 1,
    resumeAt: null,
    lastStatusCode: statusCode,
    lastReason: reason,
  };
}

/**
 * Formats a human-readable message describing a provider retry wait.
 *
 * @param nodeId - The node ID waiting for retry.
 * @param attempt - The current attempt number.
 * @param resumeAt - ISO 8601 timestamp when the retry will happen.
 * @param reason - The reason for the rate-limit.
 * @returns A formatted log message.
 */
export function formatRetryMessage(
  nodeId: string,
  attempt: number,
  resumeAt: string,
  reason: string,
): string {
  const waitMs = new Date(resumeAt).getTime() - Date.now();
  const waitMin = Math.ceil(waitMs / 60_000);
  const waitHours = Math.floor(waitMin / 60);
  const remainMin = waitMin % 60;

  let waitStr: string;
  if (waitHours > 0) {
    waitStr =
      remainMin > 0
        ? `${String(waitHours)}h${String(remainMin)}m`
        : `${String(waitHours)}h`;
  } else {
    waitStr = `${String(waitMin)}m`;
  }

  return (
    `[provider-retry] Node "${nodeId}" rate-limited (attempt ${String(attempt)}/${String(MAX_PROVIDER_RETRY_ATTEMPTS)}). ` +
    `Waiting ${waitStr} until ${resumeAt}. Reason: ${reason}`
  );
}
