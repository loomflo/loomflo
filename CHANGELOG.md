# Changelog

## 0.3.0 — Unreleased

### Added

- Interactive onboarding wizard: provider selection (with live validation), workflow preset, budget, delays, advanced tuning.
- Non-interactive flag path for CI (`--non-interactive`, implicit when no TTY / CI=true).
- Re-run recap line on already-configured projects.
- `start` delegates to `init` on virgin projects (no `.loomflo/project.json`).
- Pastel-green CLI theme (Mint palette) with truecolor + 256-color fallback.
- `--json` flag on every user-facing command for machine-readable output.
- `loomflo theme:preview` manual QA script (dev-only).

### Changed

- All CLI output routed through the shared `theme` module; `console.log` is
  no longer allowed inside `src/commands/` (enforced by ESLint).

## 0.2.0 — 2026-04-14

### Breaking changes

- All daemon routes are now scoped under `/projects/:id/…`. The v0.1.0 paths
  (`/workflow/*`, `/events`, `/nodes`, `/chat`, `/config`) return `410 Gone`
  with a JSON hint pointing at the new route.
- `loomflo start` now means "start this project" (auto-starts the daemon if
  needed). Use `loomflo daemon start` for the daemon-only behaviour.
- `loomflo stop` stops this project's workflow; the daemon keeps running. Use
  `loomflo daemon stop` to stop the daemon process itself.
- The dashboard is not yet multi-project-aware; it will be in S5.

### New

- Multi-project daemon: one daemon per machine, N parallel workflows.
- `.loomflo/project.json` per project, stable `proj_<hex>` ID, walk-up
  resolution from any subdirectory.
- `~/.loomflo/projects.json` persists the registry across daemon restarts.
- `~/.loomflo/credentials.json` holds named provider profiles (0600 perms,
  atomic writes).
- `loomflo daemon start|stop|status|restart` subcommands.
- `loomflo project list|remove|prune` subcommands.
- Concurrent `loomflo start` from two project directories is safe — serialised
  by a file lock on `~/.loomflo/daemon.lock`.
- Multiplexed per-project WebSocket with a subscribe/unsubscribe protocol.
