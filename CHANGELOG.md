# Changelog

## 0.3.0 — 2026-04-16

Five sub-projects shipping together: S1 multi-project daemon (finalised from
v0.2.0), S2 onboarding wizard, S3 visual CLI theme, S4 observation CLI, and
S5 multi-project dashboard.

### Breaking changes

- **WebSocket authentication migrated from query string to Sec-WebSocket-Protocol.**
  The daemon no longer accepts `?token=<value>` on the `/ws` endpoint. Clients
  must pass the token via the `Sec-WebSocket-Protocol` upgrade header using the
  `loomflo.bearer` subprotocol. Old clients connecting with `?token=` will be
  rejected with WebSocket close code **4001** (Unauthorized).

  **Migration**: update your WebSocket constructor from:

  ```js
  new WebSocket(`ws://host:port/ws?token=${token}`)
  ```

  to:

  ```js
  new WebSocket(`ws://host:port/ws`, ["loomflo.bearer", token])
  ```

  All official clients (`@loomflo/cli`, `@loomflo/sdk`, `@loomflo/dashboard`)
  are already updated. Only custom or third-party WebSocket clients need manual
  migration.

### Added

#### S3 — Visual CLI theme
- Pastel-green CLI theme (Mint palette) with truecolor + 256-color fallback.
- `--json` flag on every user-facing command for machine-readable output.
- `loomflo theme:preview` manual QA script (dev-only).

#### S2 — Onboarding wizard
- Interactive onboarding wizard: provider selection (with live validation), workflow preset, budget, delays, advanced tuning.
- Non-interactive flag path for CI (`--non-interactive`, implicit when no TTY / CI=true).
- Re-run recap line on already-configured projects.
- `start` delegates to `init` on virgin projects (no `.loomflo/project.json`).

#### S4 — Observation CLI
- `loomflo ps` — list all registered projects with runtime state.
- `loomflo watch` — live auto-refresh of `ps` (or single-project nodes) via WebSocket subscribe.
- `loomflo nodes` / `loomflo inspect <id>` — per-project node table + detail.
- `loomflo tree` — ASCII workflow DAG.
- `loomflo logs -f` now streams events over WebSocket (previously stubbed).

#### S5 — Multi-project dashboard
- Landing page at `/` listing all registered projects as cards.
- Top-bar project switcher preserving the current sub-page when switching.
- Daemon token passed via URL fragment; cleared from the address bar on load.
- Mint palette applied to the dashboard (Tailwind 4 CSS-first `@theme`).
- `ProjectContext` provides `{ token, projectId, allProjects, client }` to all pages.
- WebSocket subscribe protocol sends `{ projectIds }` or `{ all }` on open.

### Fixed

- Dashboard: all pages were silently empty after S1's route refactor because
  the frontend still called `/workflow`, `/nodes`, `/events`. Every endpoint
  is now scoped under `/projects/:id/*`. (S5)

### Changed

- All CLI output routed through the shared `theme` module; `console.log` is
  no longer allowed inside `src/commands/` (enforced by ESLint). (S3)

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
