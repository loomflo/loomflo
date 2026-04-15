# S2 — Onboarding wizard + provider profiles

**Date**: 2026-04-15
**Sub-project**: 2 of 5 (see `2026-04-14-cli-daemon-overview.md`)
**Branch**: `005-onboarding-wizard`
**Status**: Drafted, awaiting user review
**Depends on**: S1 (ProviderProfiles store, resolveProject, init/start refactor)
**Target version**: `0.3.0`

## Goal

Turn `loomflo init` (and `start` on a virgin project) into a guided, TTY-aware wizard that lets the user pick a provider, validates credentials live, and configures the essential workflow parameters before the daemon touches a single node.

Everything required to start a project must be settable in one CLI flow — no hand-editing JSON, no hidden env-var archaeology. On re-run, we confirm the existing setup in one keystroke.

## Non-goals

- Visual theme and spinners → **S3** (this spec assumes `theme.*` exists; without S3, output falls back to plain text)
- Observation commands (`ps`, `watch`, `tree`) → **S4**
- Dashboard wiring → **S5**
- Keychain / OS-secret-manager integration → post-v1
- Multi-user / role-based provider sharing → never

## Inherited decisions (from overview + S1)

- `ProviderProfiles` store lives at `~/.loomflo/credentials.json` (mode `0600`), managed by `packages/core/src/providers/profiles.ts`.
- `ProjectIdentity` lives at `<project>/.loomflo/project.json` and carries `{ id, name, providerProfileId, createdAt }`.
- Daemon is multi-project post-S1 — `init` registers the project via `POST /projects`, then `POST /projects/:id/workflow/init`.

## Architecture

```
packages/cli/src/
├── onboarding/
│   ├── index.ts           # runWizard() — top-level orchestrator
│   ├── prompts.ts         # individual question helpers (provider, level, budget…)
│   ├── validators.ts      # per-provider live-check (HTTP/CLI call)
│   ├── presets.ts         # level → config defaults map
│   └── summary.ts         # render "ready? [Y/n]" recap
├── commands/
│   ├── init.ts            # rewritten: calls runWizard() then registers
│   └── start.ts           # detects missing project.json → delegates to init
```

### Wizard step sequence

1. **Provider selection**
   - List existing profiles from `ProviderProfiles.list()` + `[+ new profile]` + `[use env vars]` entries.
   - On `[+ new profile]`: prompt `type` (anthropic-oauth / anthropic / openai / moonshot / nvidia) → prompt name → type-specific credential flow (see validators below) → `upsert()` to store.
   - On `[use env vars]`: ephemeral profile (not persisted) sourced from env at each request.
   - On existing profile: run its validator to confirm it still works, otherwise offer re-auth.

2. **Workflow level** — `1` (fast/cheap) / `2` (balanced, default) / `3` (deep) / `custom`.

3. **`budgetLimit`** — number prompt, default `0` (unlimited). Accepts `0` or positive float.

4. **`defaultDelay`** — ms between nodes (level default as placeholder).

5. **`retryDelay`** — ms between retries (level default as placeholder).

6. **Advanced?** — if `y` OR level is `custom`: prompt `maxRetriesPerNode`, `maxRetriesPerTask`, `maxLoomasPerLoomi`, `reviewerEnabled`, `agentTimeout`.

7. **Recap screen** — prints all selections (using `theme.kv` once S3 lands) + `Start project? [Y/n]`.

On confirm → write `project.json` (via `ProjectIdentity.write()`) + merge config into `<project>/.loomflo/config.json` + `POST /projects/:id/workflow/init`.

### Per-provider validators

Each returns `{ ok: true }` or `{ ok: false, reason: string, hint?: string }`.

| Type | Check |
|---|---|
| `anthropic-oauth` | `isOAuthTokenValid()` + `readClaudeCodeCredentials()` from `packages/core/src/providers/credentials.ts` — verify `~/.claude/.credentials.json` has `user:inference` scope and a non-expired `accessToken`. Hint: "Run `claude login`". |
| `anthropic` | Env var `ANTHROPIC_API_KEY` first; if absent, prompt (masked). Then `POST /v1/messages` with a 1-token probe. |
| `openai` / `moonshot` / `nvidia` | Env var (`OPENAI_API_KEY` / `MOONSHOT_API_KEY` / `NVIDIA_API_KEY`) first; else prompt. Then `GET {baseUrl}/models`. |

All validators run under an `ora` spinner (from S3 theme). Failure prints the hint and re-enters the credential step (no silent fallback).

## Non-interactive mode

All wizard answers can be supplied via CLI flags:

```
loomflo init \
  --profile my-anth-oauth \
  --level 2 \
  --budget 0 \
  --default-delay 1000 \
  --retry-delay 2000 \
  --yes
```

Also available: `--provider <type>`, `--api-key <key>` (or env var), `--advanced` (include advanced prompts in non-interactive mode too), `--non-interactive` (fail if any required value missing instead of prompting).

**TTY detection**: if `process.stdin.isTTY === false` AND required values are missing AND `--non-interactive` is set (or implicit from CI env `CI=true`), exit with an actionable error listing the missing flags.

## Re-run semantics

When `loomflo start` runs on a project that already has `project.json` + valid workflow config:

1. Load identity + config.
2. Print a summary line: `→ my-todo-app  (anthropic-oauth, level 2, budget ∞, delay 1000ms)`
3. Prompt `Start project? [Y/n]`.
4. `--yes` skips the prompt.

If `project.json` exists but the referenced provider profile is **missing from the credential store**, prompt the user to pick a new one (running the provider step of the wizard only).

## Error handling

- **Corrupt `project.json`**: rename to `project.json.corrupt.<ts>`, fall through to full wizard (matches `ProviderProfiles` behavior).
- **Daemon auto-start fails during init**: print the daemon log path + actionable hint; exit non-zero.
- **Credential validator fails**: print reason + hint, re-prompt (bounded to 3 attempts; then exit).
- **User cancels (Ctrl-C) mid-wizard**: no partial writes. `project.json` is written atomically only at the final confirm.

## Testing strategy

- **Unit** (`packages/cli/test/onboarding/*.test.ts`):
  - `presets.ts` — level → defaults mapping snapshots.
  - `validators.ts` — each validator with `nock`-mocked HTTP + mocked `readClaudeOauth`.
  - `prompts.ts` — wrap `@inquirer/prompts` behind an interface; test with a fake answerer.
- **Integration** (`packages/cli/test/commands/init.test.ts`):
  - Non-interactive flag path end-to-end (no prompts at all).
  - Re-run detects existing project.json + respects `--yes`.
- **Manual smoke**: covered by the plan's final-verification checklist.

## Dependencies added

```json
{ "@inquirer/prompts": "^6.x", "ora": "^8.x" }
```

Both CLI-only. Zero new runtime deps in `@loomflo/core`.

## Success criteria

- `loomflo init` (no flags, TTY) completes a fresh project in under 5 interactive steps with a clear recap.
- `loomflo init --provider anthropic-oauth --level 2 --yes` completes with zero prompts.
- `loomflo start` on a virgin project delegates to `init` and, on a configured project, shows the one-line recap.
- All 5 provider types can be added + validated without hand-editing `credentials.json`.
- `CI=true loomflo init` fails fast with an actionable error if flags are incomplete.
