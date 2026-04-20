# S1 — Multi-project daemon + auto-start

**Date**: 2026-04-14
**Sub-project**: 1 of 5 (see `2026-04-14-cli-daemon-overview.md`)
**Branch**: `004-multi-project-daemon`
**Status**: Drafted, awaiting user review
**Version bump**: `0.1.0` → `0.2.0` (breaking)

## Goal

Convert the daemon from mono-project to multi-project, and make `loomflo start` in a project directory the single entry point users need: it auto-starts the daemon if necessary, registers the project, and launches its workflow.

This sub-project delivers the **architecture and wiring** only. The interactive onboarding wizard (provider selection, credential input, live API validation, per-project parameters) is **S2** — S1 stubs those steps with minimal prompts sufficient for tests.

## Non-goals (deferred to later sub-projects)

- Rich wizard UX, provider live-check, environment-variable sniffing → **S2**
- Pastel-green CLI theme, spinners, fancy tables → **S3**
- `loomflo ps`, `watch`, `nodes`, throughput/uptime tables → **S4**
- Dashboard multi-project switcher and workflow-injection fix → **S5**
- Keychain/OS-secret-manager integration → post-v1
- Telemetry off the machine → never (principle)

## Architecture overview

```
             ┌──────────────────────────────────────────────┐
             │   Daemon (Fastify, one process per machine)  │
             │                                              │
             │   registry: Map<projectId, ProjectRuntime>   │
             │                                              │
             │   ┌───────────────┐  ┌───────────────┐       │
             │   │ proj_a3f2k9c1 │  │ proj_7b1e2d0f │  ...  │
             │   │ workflow      │  │ workflow      │       │
             │   │ provider      │  │ provider      │       │
             │   │ config        │  │ config        │       │
             │   │ costTracker   │  │ costTracker   │       │
             │   │ messageBus    │  │ messageBus    │       │
             │   │ sharedMemory  │  │ sharedMemory  │       │
             │   └───────────────┘  └───────────────┘       │
             └─────────┬──────────────────────┬─────────────┘
                       │                      │
                       ▼                      ▼
        ~/.loomflo/daemon.json   ~/.loomflo/projects.json
        ~/.loomflo/credentials.json  (profiles)
                       ▲                      ▲
                       │                      │
          ┌────────────┴─────────┐  ┌─────────┴────────────┐
          │ CLI run in project A │  │ CLI run in project B │
          │ reads .loomflo/      │  │ reads .loomflo/      │
          │   project.json       │  │   project.json       │
          └──────────────────────┘  └──────────────────────┘
```

### Key data structures

```ts
// daemon.ts
interface ProjectRuntime {
  id: string;                  // e.g. "proj_a3f2k9c1"
  name: string;                // human label
  projectPath: string;         // absolute path
  providerProfileId: string;
  workflow: Workflow | null;
  provider: LLMProvider;
  config: LoomfloConfig;
  costTracker: CostTracker;
  messageBus: MessageBus;
  sharedMemory: SharedMemoryManager;
  startedAt: string;           // ISO-8601
  status: "idle" | "running" | "blocked" | "failed" | "completed";
}
```

### Persistence layout

| Path | Content | New in S1? |
|---|---|---|
| `~/.loomflo/daemon.json` | `{ port, token, pid, version }` | extended (added `version`) |
| `~/.loomflo/projects.json` | `Array<{ id, name, projectPath, providerProfileId }>` | **new** |
| `~/.loomflo/credentials.json` | `{ profiles: Record<string, ProviderProfile> }` | **new (stub in S1)** |
| `~/.loomflo/daemon.lock` | empty, used as file lock during auto-start | **new** |
| `<project>/.loomflo/project.json` | `{ id, name, providerProfileId, createdAt }` | **new** |
| `<project>/.loomflo/state.json` | workflow state (unchanged) | — |
| `<project>/.loomflo/config.json` | per-project config overrides (unchanged) | — |

`credentials.json` is touched by S1 only as a stub: a single profile named `default` is created when the daemon starts and no profiles exist yet, using the same env-var resolution the code does today. S2 owns the real profile management.

## API endpoints

All project-scoped routes require `Authorization: Bearer <token>` (token from `daemon.json`). The token is per-daemon, not per-project (see overview's out-of-scope).

### Daemon-level

```
GET    /health                          → { status: "ok", version }
GET    /daemon/status                   → { port, pid, version, uptimeMs, projectCount }
GET    /projects                        → [{ id, name, projectPath, status, startedAt }]
POST   /projects                        → register & start a project
DELETE /projects/:id                    → deregister + stop that project's workflow
GET    /ws                              → websocket (multiplexed events, each tagged with projectId)
```

**`POST /projects` body**:
```jsonc
{
  "projectPath": "/abs/path",
  "name": "my-todo-app",
  "providerProfileId": "default",
  "configOverrides": { "retries": 3, "defaultDelay": 500 }   // optional
}
```
Response `201`: `{ id: "proj_a3f2k9c1", ...ProjectRuntime summary }`.
Response `409`: `{ error: "project_already_registered", id }` if that `projectPath` is already present.

### Project-scoped

```
GET    /projects/:id                    → full runtime summary
POST   /projects/:id/workflow/start     → launch or relaunch workflow
POST   /projects/:id/workflow/stop      → graceful stop for this project only
POST   /projects/:id/workflow/resume    → resume from persisted state
GET    /projects/:id/workflow           → current workflow state
GET    /projects/:id/events             → filtered events (existing API, now scoped)
POST   /projects/:id/chat               → message to Architect (Loom)
```

### WebSocket protocol

Single endpoint `/ws`. On connect, the client sends:
```jsonc
{ "type": "subscribe", "projectIds": ["proj_a3f2k9c1"] }   // or { "all": true }
```
Every event pushed by the server carries `projectId`:
```jsonc
{ "projectId": "proj_a3f2k9c1", "type": "node.completed", "nodeId": "n3", ... }
```

### Error codes

| Case | HTTP | Body |
|---|---|---|
| Missing/invalid token | 401 | `{ "error": "unauthorized" }` |
| Project not registered | 404 | `{ "error": "project_not_registered", "id": "..." }` |
| Workflow already running | 409 | `{ "error": "workflow_already_running" }` |
| Provider credentials missing | 400 | `{ "error": "provider_missing_credentials", "providerProfileId": "..." }` |
| Daemon shutting down | 503 | `{ "error": "daemon_shutting_down" }` |
| v0.1.0 route requested | 410 | `{ "error": "route_moved", "newRoute": "/projects/:id/workflow/start" }` |

`410 Gone` is returned for the legacy `/workflow/*` paths so the old dashboard shows an informative error rather than a blank page.

## CLI commands & lifecycle

### Project-scoped (no subcommand = current project)

```
loomflo start [--project-path <path>]
```

Steps:
1. Resolve project path (explicit flag, else CWD-walk-up looking for `.loomflo/project.json`, else CWD).
2. Read/create `.loomflo/project.json` (generate ID + name = dir basename if absent). If an existing `.loomflo/state.json` is found without `project.json`, perform the v0.1.0 → v0.2.0 migration (log one line, continue).
3. Check `~/.loomflo/daemon.json`. If missing or stale PID, call `ensureDaemonRunning()`.
4. `GET /projects/:id`. If 404, run **wizard stub** (S1): prompt only for `providerProfileId` (list from `credentials.json`, or create `default` stub), no real validation. S2 replaces this with the full wizard.
5. `POST /projects` to register + start.
6. Open WebSocket, subscribe to this `projectId`, print events to stdout until the workflow reaches a terminal state or the user hits Ctrl+C.

```
loomflo stop
```

Resolves current project (same walk-up as `start`), calls `POST /projects/:id/workflow/stop`. Prints confirmation. Does **not** stop the daemon.

```
loomflo status
```

`GET /projects/:id` for the current project; prints status, current node, uptime, cost. (Rich formatting is S3/S4.)

### Daemon namespace

```
loomflo daemon start           # spawn daemon, exit after daemon.json is written
loomflo daemon stop [--force]  # graceful stop; --force = SIGKILL + bypass active-project warning
loomflo daemon status          # port, pid, version, uptimeMs, projectCount
loomflo daemon restart         # stop + start, reloads projects.json
```

`daemon stop` without `--force`:
- Lists active projects (status != `idle`).
- Prompts "N projet(s) actif(s). Arrêter le daemon ? [y/N]" if at least one is active.
- `--force` skips the prompt **and** sends SIGKILL.

### Project admin

```
loomflo project list            # ~/.loomflo/projects.json entries, with "alive" flag
loomflo project remove <id>     # deregister from daemon + remove from projects.json
loomflo project prune           # remove entries whose projectPath no longer exists
```

## Auto-start & concurrency

### `ensureDaemonRunning()` (CLI helper)

```ts
async function ensureDaemonRunning(): Promise<DaemonInfo> {
  const existing = await getRunningDaemon();     // reads daemon.json, checks pid alive
  if (existing) return existing;

  await withFileLock("~/.loomflo/daemon.lock", async () => {
    // Re-check inside the lock — another process may have spawned it.
    const again = await getRunningDaemon();
    if (again) return;

    spawnDaemonDetached();
    await waitForDaemonFile(STARTUP_TIMEOUT_MS);
  });

  return (await getRunningDaemon())!;
}
```

The lock is a POSIX `flock` on `~/.loomflo/daemon.lock`. On Windows, a fallback using atomic `O_CREAT | O_EXCL` on a `.lock.tmp` file is used. Timeout for acquiring the lock: 10 seconds (matches `STARTUP_TIMEOUT_MS`).

### Shutdown semantics

| Signal / command | Behaviour |
|---|---|
| `SIGTERM` to daemon | For each active project in parallel: `stopDispatching → waitForActiveCalls → markNodesInterrupted → saveStateImmediate`. Then close Fastify. Keep `projects.json`. |
| `SIGINT` (Ctrl+C) | Same as SIGTERM. |
| `SIGKILL` / `daemon stop --force` | No graceful work. Next startup reloads `projects.json`; workflows resume from their `state.json`. |
| `loomflo daemon stop` | Sends SIGTERM. Timeout `GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000` (existing). Timeout per project, parallel. |

### Project start (from daemon side)

`POST /projects`:
1. Validate `projectPath` exists and is absolute.
2. Validate `providerProfileId` exists in `credentials.json`.
3. Resolve credentials for that profile; instantiate provider.
4. Run an **internal liveness call** (single cheap API call, e.g. `messages.create` with 1-token limit) **only** if `validateProvider: true` is sent — S1 defaults this to `false`; S2 flips it to `true` as part of the wizard.
5. Build `ProjectRuntime`, add to registry, write `projects.json`.
6. Optionally kick off the workflow if one already exists in `state.json` or if the request carries `start: true`.

### Isolation between projects

- Each project has its own `provider` instance, even when two projects share the same `providerProfileId`. (Pooling by profile is a future optimisation; YAGNI in S1.)
- A runtime error inside one project's workflow executor must not kill the daemon. Every call into a project's engine is wrapped in `try/catch` at the route handler level; exceptions mark that project as `failed` and are surfaced through the WebSocket event stream.
- Tools written by one project's agents land in that project's directory; the `workerTools` receive `workspacePath = projectRuntime.projectPath`.

## Migration from v0.1.0

1. **Version detection**: CLI reads `~/.loomflo/daemon.json`; if `version` is missing or `< 0.2.0`, it refuses to call any route and prints:
   ```
   ✖ Un ancien daemon (v0.1.0) tourne déjà.
     Arrête-le : loomflo daemon stop --force
     Puis relance ta commande.
   ```
2. **Project migration**: `loomflo start` in a directory with `.loomflo/state.json` but no `project.json` creates `project.json` with a fresh ID, `name = basename(dir)`, and logs:
   ```
   ⚙ Projet existant détecté (layout v0.1.0). Migration...
     → ID assigné : proj_8f2a1b70
     → Nom : my-todo-app
   ✓ Migration réussie.
   ```
3. **Legacy routes**: `/workflow/*` and `/events` (non-scoped) return `410 Gone` with a JSON body pointing at the new route.
4. **Dashboard**: untouched in S1 — expected to break until S5. The `410` responses make the breakage loud and diagnosable instead of silent.
5. **Existing tests**: all tests that hit v0.1.0 routes are rewritten for the new scoped routes. No `skipped` tests, no `xit` markers.

## Testing strategy

### Unit (vitest)

- `packages/core/src/persistence/projects.ts` (new): read/write `projects.json`; atomic writes via `rename` from tmp; tolerant of corrupt JSON (rename to `projects.corrupt.<ts>.json`, start empty).
- `packages/core/src/api/routes/projects.ts` (new): CRUD handlers; 401/404/409/410 paths; token auth.
- `packages/core/src/providers/profiles.ts` (new): profile lookup, stub-`default` creation, missing-profile error.
- `packages/cli/src/project-resolver.ts` (new): walk-up to find `project.json`; create-on-miss; migration branch.
- `packages/cli/src/daemon-control.ts` (new): `ensureDaemonRunning`, version check, file lock.
- `packages/cli/src/commands/daemon.ts` (new): start/stop/status/restart; confirm-prompt on active projects.

### Integration (vitest + real Fastify in-memory)

- Two tmp project dirs, one daemon: start both, verify isolated events, state, costs.
- Daemon restart: start project A, kill daemon, restart → project A in `projects.json` but `status = idle`, workflow resume loads correctly.
- Concurrent auto-start: fork two CLI processes in parallel, each in its own tmp project, both invoking `start`; assert exactly one daemon was spawned (pid stable, log lines confirm lock was held by one).
- Migration: seed a tmp dir with a v0.1.0 `state.json`, call CLI `start`, assert `project.json` appears and workflow registers.
- Legacy route: `POST /workflow/start` returns 410 with JSON body.

### End-to-end (single smoke test, run via child_process.spawn)

`tests/e2e/multi-project.e2e.test.ts`:
1. `loomflo start` in dir A → expect daemon up, project A registered.
2. `loomflo start` in dir B → expect same daemon, project B registered, `GET /projects` returns both.
3. `loomflo stop` in dir A → project A removed from running set.
4. `loomflo daemon stop` → graceful exit, `projects.json` preserved.

Runs with generous timeouts; gated behind `pnpm test:e2e` (not in default `pnpm test`).

### What we explicitly don't test (YAGNI)

- Fuzzing the REST API.
- N > 5 projects simultaneously (design holds, but we only soft-warn).
- Dashboard interaction (it's S5's job).

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider credentials leak via `credentials.json` | Compromised machine reveals keys | File mode 0600; documented in README; keychain integration flagged as future. |
| Concurrent `loomflo start` spawns two daemons | Port conflict, corrupted `daemon.json` | File lock on `daemon.lock`; re-check inside the critical section. |
| `projects.json` corrupt after crash | Daemon refuses to start | Parse tolerantly; rename corrupt file to `projects.corrupt.<ts>.json`; daemon starts with empty registry; log warning. |
| One project's exception crashes the daemon | All projects fail simultaneously | `try/catch` around every project-scoped route handler; exception surfaces as `status: "failed"` on that project only. |
| Renamed/moved project directory | `projectPath` stale in `projects.json` | On daemon startup, verify each `projectPath` exists; mark missing ones `orphan`; `loomflo project prune` cleans up. |
| RAM pressure with many concurrent providers | Daemon OOM | No pooling in S1; soft-warn at 5 active projects in `daemon status`; monitoring added in S4. |
| Breaking the dashboard silently | User confused by blank UI | `410 Gone` with JSON body instead of silent 404. README and changelog call out the break until S5. |
| Legacy `.provider-state.json` at repo root | Confusion, stale data | Left untouched in S1; S2 will clean it up as part of wizard migration. |

## Deliverables

### New files

- `packages/core/src/persistence/projects.ts` — `ProjectsRegistry` (read/write `projects.json`).
- `packages/core/src/providers/profiles.ts` — profile lookup, `default` stub.
- `packages/core/src/api/routes/projects.ts` — all `/projects*` handlers.
- `packages/core/src/api/routes/legacy-gone.ts` — `410` responders for v0.1.0 routes.
- `packages/cli/src/project-resolver.ts` — walk-up + create + migrate.
- `packages/cli/src/daemon-control.ts` — `ensureDaemonRunning`, version check, file lock.
- `packages/cli/src/commands/daemon.ts` — `daemon start|stop|status|restart` subcommands.
- `packages/cli/src/commands/project.ts` — `project list|remove|prune`.
- `tests/e2e/multi-project.e2e.test.ts` — single smoke test.

### Modified files

- `packages/core/src/daemon.ts` — registry map, per-project runtime, graceful shutdown across projects.
- `packages/core/src/api/server.ts` — mount scoped routes, multiplexed WebSocket, 410 responders.
- `packages/core/src/api/ws.ts` (if exists) / ws handler — add subscription protocol.
- `packages/cli/src/commands/start.ts` — project-scoped flow (steps 1–6 above).
- `packages/cli/src/commands/stop.ts` — project-scoped stop.
- `packages/cli/src/commands/status.ts` — project-scoped status.
- `packages/cli/src/commands/resume.ts` — project-scoped resume.
- `packages/cli/src/commands/chat.ts` — project-scoped chat.
- `packages/cli/src/commands/logs.ts` — project-scoped logs.
- `packages/cli/src/commands/init.ts` — creates `project.json` + spec gen (non-interactive path preserved for CI).
- `packages/cli/src/commands/dashboard.ts` — still opens browser; routing updates deferred to S5.
- `packages/cli/src/index.ts` — register `daemon` and `project` subcommand groups.
- `packages/cli/src/client.ts` — all HTTP calls now take `projectId`.
- `package.json` (root + packages) — version bump to `0.2.0`.
- `README.md` — Quickstart updated; new "Multi-project" section.

### Tests rewritten (not kept)

- All `tests/**/*workflow*.test.ts` that hit legacy routes → scoped routes.
- Daemon lifecycle tests → multi-project lifecycle tests.

## Out of scope for S1 (explicit pointers)

| Topic | Sub-project | Note |
|---|---|---|
| Interactive wizard (provider list, env sniffing, live validation, param tuning) | S2 | S1 ships a minimal non-interactive stub |
| Pastel-green theme, spinners, tables, rich `--help` | S3 | S1 uses plain console output |
| `ps`, `watch`, `nodes`, throughput dashboards | S4 | S1 ships plain `status` |
| Dashboard project switcher + injection fix | S5 | S1 leaves dashboard broken behind `410` responses |
| Keychain integration | post-v1 | `credentials.json` + 0600 is enough |
| Multi-machine daemon | never | Loopback only |
| Per-project daemon auth tokens | never | Local-only, shared daemon token suffices |

## Open questions

None remaining after brainstorming. Ready for user review.

## Review history

- 2026-04-14 — initial draft after brainstorming session with user.
