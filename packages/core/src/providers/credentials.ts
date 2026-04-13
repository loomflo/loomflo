/**
 * Credential resolution for LLM providers.
 *
 * Discovers authentication credentials from multiple sources in priority order:
 * 1. ANTHROPIC_API_KEY environment variable (standard API key)
 * 2. ANTHROPIC_OAUTH_TOKEN environment variable (explicit OAuth token)
 * 3. Claude Code credential store (~/.claude/.credentials.json)
 *
 * The first valid credential found is used. This allows Loomflo to work
 * seamlessly with both Anthropic API keys and Claude Code OAuth subscriptions.
 *
 * @module providers/credentials
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "./base.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of the claudeAiOauth entry in ~/.claude/.credentials.json. */
interface ClaudeCodeOAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

/** Shape of the Claude Code credentials file. */
interface ClaudeCodeCredentials {
  claudeAiOauth?: ClaudeCodeOAuthData;
}

/** Describes which source provided the resolved credential. */
export type CredentialSource =
  | "env:ANTHROPIC_API_KEY"
  | "env:ANTHROPIC_OAUTH_TOKEN"
  | "claude-code-oauth";

/** Result of credential resolution: the provider config plus metadata. */
export interface ResolvedCredentials {
  /** Provider configuration ready to pass to AnthropicProvider. */
  config: ProviderConfig;
  /** Which source the credential was resolved from. */
  source: CredentialSource;
}

// ============================================================================
// Claude Code Credentials Reader
// ============================================================================

/**
 * Read OAuth tokens from the Claude Code credential store.
 *
 * Claude Code stores OAuth tokens in `~/.claude/.credentials.json`
 * with a `claudeAiOauth` key containing the access token, refresh token,
 * expiration timestamp, and scopes.
 *
 * @param credentialsPath - Override path for testing. Defaults to ~/.claude/.credentials.json.
 * @returns The OAuth data if found and valid, or null.
 */
export async function readClaudeCodeCredentials(
  credentialsPath?: string,
): Promise<ClaudeCodeOAuthData | null> {
  const filePath = credentialsPath ?? join(homedir(), ".claude", ".credentials.json");

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const credentials = parsed as ClaudeCodeCredentials;
  const oauth = credentials.claudeAiOauth;

  if (!oauth || typeof oauth.accessToken !== "string" || oauth.accessToken.length === 0) {
    return null;
  }

  // Check if the token has expired
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt < Date.now()) {
    return null;
  }

  // Verify the token has the inference scope required for LLM calls
  if (Array.isArray(oauth.scopes) && !oauth.scopes.includes("user:inference")) {
    return null;
  }

  return oauth;
}

// ============================================================================
// Credential Resolution
// ============================================================================

/**
 * Resolve LLM provider credentials from available sources.
 *
 * Checks sources in priority order:
 * 1. `ANTHROPIC_API_KEY` environment variable — standard API key auth
 * 2. `ANTHROPIC_OAUTH_TOKEN` environment variable — explicit OAuth token
 * 3. Claude Code credential store (`~/.claude/.credentials.json`) — OAuth token
 *    from a Claude Code / claude.ai subscription
 *
 * @param options - Resolution options.
 * @param options.env - Environment variables to check. Defaults to process.env.
 * @param options.claudeCredentialsPath - Override path for the Claude Code credentials file.
 * @returns The resolved credentials with source metadata.
 * @throws {Error} If no valid credentials are found from any source.
 */
export async function resolveCredentials(options?: {
  env?: Record<string, string | undefined>;
  claudeCredentialsPath?: string;
}): Promise<ResolvedCredentials> {
  const env = options?.env ?? process.env;

  // Source 1: ANTHROPIC_API_KEY environment variable
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey && apiKey.length > 0) {
    return {
      config: { apiKey },
      source: "env:ANTHROPIC_API_KEY",
    };
  }

  // Source 2: ANTHROPIC_OAUTH_TOKEN environment variable
  const oauthToken = env["ANTHROPIC_OAUTH_TOKEN"];
  if (oauthToken && oauthToken.length > 0) {
    return {
      config: { oauthToken },
      source: "env:ANTHROPIC_OAUTH_TOKEN",
    };
  }

  // Source 3: Claude Code credential store
  const claudeOAuth = await readClaudeCodeCredentials(options?.claudeCredentialsPath);
  if (claudeOAuth) {
    return {
      config: { oauthToken: claudeOAuth.accessToken },
      source: "claude-code-oauth",
    };
  }

  throw new Error(
    "No Anthropic credentials found. Provide one of:\n" +
      "  - ANTHROPIC_API_KEY environment variable (API key from console.anthropic.com)\n" +
      "  - ANTHROPIC_OAUTH_TOKEN environment variable (OAuth token)\n" +
      "  - Claude Code login (run `claude` and authenticate with your claude.ai account)",
  );
}

/**
 * Check whether any valid credentials are available without throwing.
 *
 * Useful for pre-flight checks in the CLI before starting expensive operations.
 *
 * @param options - Same options as resolveCredentials.
 * @returns The resolved credentials, or null if none found.
 */
export async function tryResolveCredentials(options?: {
  env?: Record<string, string | undefined>;
  claudeCredentialsPath?: string;
}): Promise<ResolvedCredentials | null> {
  try {
    return await resolveCredentials(options);
  } catch {
    return null;
  }
}

// ============================================================================
// OAuth Token Validity Check
// ============================================================================

/**
 * Minimum buffer before token expiry to consider it still valid (5 minutes).
 * Ensures we don't start an agent loop with a token that will expire mid-call.
 */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Checks whether the Claude Code OAuth token stored on disk is still valid
 * with at least a 5-minute safety buffer before expiry.
 *
 * Reads `~/.claude/.credentials.json`, parses the `claudeAiOauth.expiresAt`
 * timestamp, and compares it against the current time plus the safety buffer.
 *
 * Returns `false` (rather than throwing) when the file is absent, malformed,
 * or contains no expiry timestamp — treating all unknown states as invalid.
 *
 * @param credentialsPath - Override path for testing. Defaults to ~/.claude/.credentials.json.
 * @returns `true` if the token expires more than 5 minutes in the future, `false` otherwise.
 */
export async function isOAuthTokenValid(credentialsPath?: string): Promise<boolean> {
  const filePath = credentialsPath ?? join(homedir(), ".claude", ".credentials.json");

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }

  const creds = parsed as ClaudeCodeCredentials;
  const expiresAt = creds.claudeAiOauth?.expiresAt;

  if (typeof expiresAt !== "number") {
    return false;
  }

  return expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
}
