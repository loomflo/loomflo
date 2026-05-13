# Runtimes — multi-runtime orchestration layer

LoomFlo orchestrates agentic CLI runtimes behind a single `AgentRuntime`
interface. Each adapter wraps an external SDK and translates its lifecycle
into our normalised `SessionEvent` stream.

See `specs/003-multi-runtime-orchestration/spec-v2.md` for the full design.

## Available runtimes

| `node.runtime` | Backed by | Auth path | Models |
|---|---|---|---|
| `loomi-native` (default) | Legacy `runLoomi` multi-agent loop | Anthropic API key / Claude.ai OAuth (auto-pickup) | Claude family |
| `claude-agent` | `@anthropic-ai/claude-agent-sdk` | Same as above + ANTHROPIC_API_KEY env | Claude family |
| `copilot` | `@github/copilot-sdk` | Copilot CLI login (default) or BYOK provider | gpt-5, gpt-4.1, claude-sonnet-4.5, gemini-2.5-pro, etc. |
| `mock` | Scripted scenarios (no API call) | None | n/a |

To pick a runtime per node:

```ts
const node = {
  // ...
  runtime: "claude-agent", // or "copilot", "mock", or omit for "loomi-native"
};
```

## Setup — `claude-agent`

The Claude Agent SDK depends on a `claude` binary. Two paths:

1. **Bundled binary** — installed automatically as an optional dep of
   `@anthropic-ai/claude-agent-sdk-linux-x64-musl` (or your platform). Some
   monorepo configs skip optional deps; if so, install
   `@anthropic-ai/claude-code` to get the `claude` postinstall.
2. **Existing `claude` install** — if you already have Claude Code installed
   globally, set `LOOMFLO_CLAUDE_CODE_PATH=$(which claude)` and the runtime
   will use it.

**Auth** — the runtime reads in this order:

1. `ANTHROPIC_API_KEY` env var (recommended for team / production / CI)
2. `~/.claude/.credentials.json` (Claude.ai OAuth, personal use only)

Per Anthropic's TOS, OAuth is for personal individual use; team / SaaS
deployments must use API key auth.

## Setup — `copilot`

The Copilot SDK depends on the `copilot` CLI binary. Install with:

```bash
npm install -g @github/copilot
copilot login
```

The CLI handles the OAuth flow — log in with your GitHub account that has
an active Copilot subscription (Pro / Business / Enterprise).

**BYOK alternative** — to bypass Copilot billing and route requests to your
own Anthropic / OpenAI account:

```ts
const credentials: ResolvedCredentials = {
  kind: "api-key-anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
};
```

CopilotRuntime will populate `provider.type: "anthropic"` and use your key.

**CLI path override** — if `copilot` is not on `$PATH`, set
`LOOMFLO_COPILOT_CLI_PATH=/path/to/copilot`.

## Setup — `mock`

No setup. Pick a scenario by `forceScenario` or seed for deterministic
event streams. See `mock.ts` for the scenario list.

## File ownership

Phase 2 introduces `canUseTool` enforcement in `claude-agent`: the runtime
denies write_file / edit_file invocations whose `path` lies outside the
agent's allowed glob patterns. The scope is derived from
`node.fileOwnership[agentId]`.

`copilot` does not expose a `canUseTool` equivalent — the loomflo tool
implementations themselves (writeFileTool, editFileTool) are the sole gate.

## Cost tracking

Both `claude-agent` and `copilot` (when usage payload is available) emit
`cost_update` events that flow into `CostTracker.recordCall(model, input,
output, agentId, nodeId)`. This is the same accounting path as the legacy
`loomi-native` runtime.

## Testing

- **Unit tests** in `tests/unit/` cover the option builders, provider
  mapping, tool selection, registry, and event translation.
- **Mock E2E** — use `MockAgentRuntime` to drive `runNodeWithRuntime`
  end-to-end without API cost.
- **Live smoke** — opt-in via env var:

  ```bash
  # Claude Agent
  LOOMFLO_RUN_LIVE_CLAUDE_AGENT=1 LOOMFLO_CLAUDE_CODE_PATH=$(which claude) \
    pnpm --filter @loomflo/core exec vitest run --config ../../vitest.e2e.config.ts

  # Copilot (requires `copilot login` first)
  LOOMFLO_RUN_LIVE_COPILOT=1 \
    pnpm --filter @loomflo/core exec vitest run --config ../../vitest.e2e.config.ts \
      tests/e2e/copilot-runtime.e2e.test.ts
  ```

## When to pick which

- **Per-node multi-runtime** in a workflow — mix runtimes when one model
  fits a node better. Example: spec node on Opus via `claude-agent`,
  worker nodes on Sonnet via `copilot` to use a Copilot subscription.
- **`mock`** for tests, demos, dashboard previews — never in production.
- **`loomi-native`** when you need the strict multi-agent isolation
  (file scope per Looma) that the SDK runtimes don't yet enforce
  per-subagent.
