# CLI & Daemon Improvements — Overview

**Date**: 2026-04-14
**Branch**: `004-multi-project-daemon` (first in the series)
**Status**: Drafted, awaiting user review

## Context

Loomflo currently runs as a single-project daemon: starting the daemon binds it to one `projectPath`, and the daemon holds at most one `activeWorkflow`. The user wants to evolve the CLI and daemon into a cohesive multi-project tool with a polished onboarding experience and richer observability.

This document is the shared overview for five sub-projects. Each sub-project has (or will have) its own detailed design doc and implementation plan; this file captures the cross-cutting decisions so every later spec stays consistent.

## Goals

1. **One daemon per machine, many projects in parallel.** Working on two codebases should not require juggling two daemons, two ports, or separate sessions.
2. **Auto-start from the user's point of view.** The user runs `loomflo start` in a project directory; they never have to remember whether the daemon is running.
3. **Mandatory interactive onboarding on first use.** A project cannot start its flow until provider credentials and runtime parameters are confirmed.
4. **Per-project provider credentials.** Project A can use Anthropic OAuth while Project B uses OpenAI, with credentials isolated per project but reusable across projects as named profiles.
5. **Distinctive CLI UX.** Pastel green theme (matching the Loomflo logo), spinners, tables, clear error messages, and rich `--help` output.
6. **Rich observation commands.** Inspect running nodes, per-project progress, uptime, cost, and throughput from the CLI.
7. **Multi-project dashboard.** The existing dashboard must show the currently selected project, let the user switch, and (fix) correctly inject the active workflow into its pages.

## Sub-projects

| # | Name | Depends on | Size | Branch |
|---|---|---|---|---|
| **S1** | Multi-project daemon + auto-start | — | M | `004-multi-project-daemon` |
| **S2** | Interactive onboarding wizard + provider profiles | S1 | M | `005-onboarding-wizard` |
| **S3** | Visual CLI theme (pastel green + UX) | — (parallelisable with S2) | S | `006-cli-theme` |
| **S4** | Observation commands (`ps`, `watch`, nodes) | S1 | S-M | `007-observation-cli` |
| **S5** | Multi-project dashboard + fix injection bug | S1 | M | `008-multiproject-dashboard` |

**Execution order**: S1 → S2 (and S3 in parallel if resources allow) → S4 → S5.

S1 is the foundation; without it, S2/S4/S5 are ill-specified. S3 is purely cosmetic/UX and has no dependency, so it can be worked on in parallel.

Each sub-project is its own spec → plan → code → merge cycle. This document does not replace those specs — it only records the decisions that span them.

## Cross-cutting decisions (binding for all sub-projects)

### Project identity

A project is identified internally by a stable ID stored in `.loomflo/project.json` at the project root. The ID is generated once, on the first `loomflo start`, and persists through directory renames.

```jsonc
// .loomflo/project.json
{
  "id": "proj_a3f2k9c1",        // prefix + 8 hex chars
  "name": "my-todo-app",         // human-visible, from wizard
  "providerProfileId": "claude-oauth-default",
  "createdAt": "2026-04-14T12:00:00Z"
}
```

The `name` defaults to the basename of the project directory and is user-editable. The `providerProfileId` points to an entry in the global credential store (see below).

### Global daemon state

Kept in the user's home directory under `~/.loomflo/`:

| File | Purpose | Mode |
|---|---|---|
| `daemon.json` | `{ port, token, pid, version }` for the running daemon | 0600 |
| `projects.json` | Registry of projects known to the daemon across restarts | 0600 |
| `credentials.json` | Provider credential profiles (API keys, OAuth tokens) | 0600 |
| `daemon.lock` | File lock to serialise concurrent auto-start attempts | 0600 |

Secrets **never** live under the project directory (avoids leaking into git, into project tarballs, into CI uploads, etc.).

### Provider profiles

A profile is a named bundle of credentials that can be referenced by multiple projects:

```jsonc
// ~/.loomflo/credentials.json
{
  "profiles": {
    "claude-oauth-default":  { "type": "anthropic-oauth" },
    "openai-personal":       { "type": "openai",   "apiKey": "sk-...", "defaultModel": "gpt-4" },
    "moonshot-work":         { "type": "moonshot", "apiKey": "...", "baseUrl": "https://..." }
  }
}
```

`anthropic-oauth` carries no secret — the credentials are read dynamically from `~/.claude/credentials.json` on every request (see `packages/core/src/providers/credentials.ts`).

When the onboarding wizard runs in a project, it shows the list of existing profiles with a "configure a new provider" option at the bottom.

### API versioning

The daemon exposes a version in `GET /health` and in `daemon.json`. The CLI validates version compatibility before talking to the daemon and bails out with a clear upgrade message on mismatch. Version bump `0.1.0` → `0.2.0` accompanies S1 (breaking change: all routes now under `/projects/:id/...`).

### CLI command taxonomy

| Scope | Commands |
|---|---|
| Project (default) | `start`, `stop`, `status`, `chat`, `logs`, `resume`, `config`, `dashboard`, `init` |
| Daemon namespace | `daemon start`, `daemon stop`, `daemon status`, `daemon restart` |
| Observation (S4) | `ps`, `watch`, `nodes` (working names) |
| Project admin | `project list`, `project remove`, `project prune` |

`loomflo start` without arguments, run in a project directory, does the right thing: resolve/create `project.json`, ensure the daemon is up, run the wizard if credentials are missing, and start the workflow.

## Out of scope (whole initiative)

- **Keychain / OS secret manager integration** — `credentials.json` with 0600 is enough for v1.
- **Multi-machine daemon** — everything is local to `127.0.0.1`.
- **Per-project daemon auth tokens** — a single shared token is sufficient on localhost.
- **Load testing at N > 10 projects** — design handles it, but we only soft-warn at 5.
- **Plugin system / user-defined agents** — separate initiative.
- **Telemetry / external metrics sinks** — S4 exposes what the CLI displays; nothing is shipped off-machine.

## Success criteria (end of all five sub-projects)

1. A user can `loomflo start` in a new project without knowing the daemon exists.
2. A second `loomflo start` in a different directory adds a second parallel workflow without restarting the daemon.
3. The wizard validates provider credentials (live API check) before declaring a project ready.
4. `loomflo ps` lists every active project with uptime and current node.
5. The dashboard has a project switcher and renders the correct workflow for the selected project.
6. The CLI uses a consistent pastel-green theme with spinners and coloured status icons.
7. All tests pass; the old v0.1.0 routes are gone.

## Document map

- **This file** — overview (you are here).
- `2026-04-14-s1-multi-project-daemon.md` — S1 detailed spec.
- `2026-xx-xx-s2-onboarding-wizard.md` — to be written before S2 starts.
- `2026-xx-xx-s3-cli-theme.md` — to be written before S3 starts.
- `2026-xx-xx-s4-observation-commands.md` — to be written before S4 starts.
- `2026-xx-xx-s5-multiproject-dashboard.md` — to be written before S5 starts.
