# Configuration System (3-Level Merge + Hot Reload)

## What
Three-level config merge (global → project → CLI flags) with Zod validation, level presets, and live hot-reload via FSWatcher.

## Why
Users need project-specific overrides without losing their global defaults. Level presets let beginners pick "level 2" instead of tuning 39 individual fields.

## How

### Merge Order (later wins)
1. **Global**: `~/.loomflo/config.json` — user defaults across all projects
2. **Project**: `.loomflo/config.json` — per-project overrides
3. **CLI flags** — one-off overrides for a single run

All files are partial — only specified fields override. Missing fields inherit from the previous level. Full schema validated via Zod after merge.

### Level Presets
| Field | Level 1 (Minimal) | Level 2 (Standard) | Level 3 (Full) |
|-------|-------------------|---------------------|-----------------|
| reviewer | OFF | ON | ON |
| retries | 0 | 1 | 3 |
| workers | 1 | 2 | unlimited |
| loom model | sonnet | opus | opus |
| looma model | sonnet | opus | opus |

### Hot Reload
`FSWatcher` monitors `.loomflo/config.json`. On change:
1. Re-read and validate the file
2. Merge with global config
3. Emit `config:changed` event via EventEmitter
4. Running components pick up new values on next check

### Key Config Fields (39 total)
Execution: `level`, `reviewerEnabled`, `maxRetriesPerNode`, `retryStrategy`
Timing: `defaultDelay`, `retryDelay`, `agentTimeout`
Cost: `budgetLimit`, `pauseOnBudgetReached`
Models: per-role model assignments
Limits: `maxLoomasPerLoomi`, `agentTokenLimit`, `apiRateLimit`

## Files
- `packages/core/src/config.ts` — Schema, merge logic, FSWatcher, presets

## Gotchas
- Hot reload doesn't affect in-flight nodes — only new node activations see the new config.
- Level presets override individual fields — setting `level: 1` then `reviewerEnabled: true` works (explicit wins).
- Invalid config files are rejected entirely — no partial application of a broken file.
