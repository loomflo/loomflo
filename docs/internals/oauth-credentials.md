# OAuth & Credential Resolution

## What
Three-source credential chain that resolves API authentication, with seamless Claude Code OAuth token integration.

## Why
Users may have an API key, an explicit OAuth token, or just Claude Code installed. The resolver tries all three so the user doesn't have to configure anything manually.

## How

### Resolution Order (first match wins)
1. `ANTHROPIC_API_KEY` env var → standard API key mode
2. `ANTHROPIC_OAUTH_TOKEN` env var → explicit OAuth Bearer token
3. Claude Code credential store at `~/.claude/.credentials.json`:
   - Reads `claudeAiOauth.accessToken`
   - Validates `expiresAt` (rejects expired tokens)
   - Checks `scope` includes `user:inference`

### OAuth Mode Behavior
When using OAuth (sources 2 or 3), the Anthropic provider:
- Sets `Authorization: Bearer <token>` (not `x-api-key`)
- Adds required headers: `anthropic-beta: claude-code-20250219,oauth-2025-04-20`, `user-agent: claude-cli/<version>`, `x-app: cli`
- Prepends Claude Code identity as first system block (API rejects without it)
- Supports async token getter `() => Promise<string>` for dynamic refresh

### Token Refresh
OAuth tokens expire (~7h). When a 401 is returned, `base-agent.ts` detects `isOAuthMode` and returns a `token_expired` error with instructions to refresh via `claude --print`.

## Files
- `packages/core/src/providers/credentials.ts` — Resolution chain
- `packages/core/src/providers/anthropic.ts:217-252` — OAuth client setup
- `packages/core/src/agents/base-agent.ts:156-174` — 401 handling

## Gotchas
- OAuth tokens are not auto-refreshed — user must run `claude --print` manually.
- The Claude Code credential file path is hardcoded to `~/.claude/.credentials.json`.
- OAuth mode bills to the user's Claude.ai subscription, not a separate API account.
