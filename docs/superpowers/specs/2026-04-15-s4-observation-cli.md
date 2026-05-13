# S4 — Observation commands

**Date**: 2026-04-15
**Sub-project**: 4 of 5 (see `2026-04-14-cli-daemon-overview.md`)
**Branch**: `007-observation-cli`
**Status**: Drafted, awaiting user review
**Depends on**: S1 (multi-project registry, multiplexed WS), S3 (`theme.table`, `theme.line`, `--json` wrapper)
**Target version**: `0.3.0`

## Goal

Make the running state of one or more loomflo projects observable from the terminal — at a glance (`ps`, `nodes`, `tree`), live (`watch`, `logs -f`), and in depth (`inspect`). Inspired by `docker ps` / `kubectl get pods` / `htop` in spirit: tight columns, live refresh, drill-down.

## Non-goals

- Profiling / flamegraphs / CPU-memory introspection → out of scope.
- Cross-machine aggregation → out of scope (single daemon = single machine).
- Interactive TUI with keyboard navigation (scrolling, filtering via hotkeys) → out of scope; `watch` just re-renders a static frame.
- Historical analytics / retention policy / long-term event store → out of scope; we read what the daemon currently exposes.

## Inherited from S1

- `GET /projects` — list of registered projects.
- `GET /projects/:id/workflow` — workflow state, graph, costs.
- `GET /projects/:id/nodes` + `/nodes/:nodeId` — node list + detail.
- `GET /projects/:id/events` — event log, paginated.
- WebSocket `/ws?token=` with subscribe protocol: `{ type: "subscribe", all: true | projectIds: [...] }`.

## Commands

| Command | Purpose | Data source |
|---|---|---|
| `loomflo ps` | Table: all registered projects — id / name / status / current-node / uptime / cost-so-far | `GET /projects` + parallel `GET /projects/:id/workflow` |
| `loomflo watch [projectId]` | Auto-refresh every N seconds (default 2). No arg → `ps` live. With arg → that project's `nodes` live. | WS subscribe for push + initial REST fetch |
| `loomflo logs -f [--project <id>]` | Stream events via WS. Unblocks the stubbed `-f` flag. | WS subscribe + event filter |
| `loomflo nodes [--project <id>] [--all]` | Columnar list of a project's nodes with status/duration/cost/retries. `--all` includes historical (completed + failed). | `GET /projects/:id/nodes` |
| `loomflo inspect <nodeId> [--project <id>]` | Detailed view of one node: agents, file ownership, retries, review report, timeline. | `GET /projects/:id/nodes/:nodeId` |
| `loomflo tree [--project <id>]` | ASCII tree of the node DAG (topological). | `GET /projects/:id/workflow` → `graph.nodes` + `edges` |

### Project resolution

Commands that take `[--project <id>]` default to the project resolved from `cwd` (via the same `resolveProject()` helper S1 added). If cwd is not inside a project and no `--project` flag is provided, they fail with an actionable hint (`--project` list from `ps`).

`ps` and `logs -f` (without filter) work even outside any project.

### Column layouts

```
# loomflo ps
PROJECT         ID              STATUS     NODE            UPTIME   COST
my-todo-app     proj_a3f2k9c1   ● running  3/7 auth-mw     2m 14s   $0.42
billing-svc     proj_7b1e2d0f   ⚠ retry    2/5 stripe-int  12m 01s  $1.08
docs-site       proj_c8d99a02   ○ idle     —               —        $0.00

# loomflo nodes
ID              TITLE                 STATUS     DUR    COST   RETRIES
spec-01         Define auth model     ✓ done     42s    $0.12  0
plan-01         Plan middleware       ✓ done     18s    $0.04  0
impl-01         auth-middleware       ⚠ retry    2m 14s $0.26  1/3
impl-02         session-store         ○ pending  —      —      0

# loomflo tree
my-todo-app
├── spec-01  ✓
│   ├── plan-01  ✓
│   │   ├── impl-01  ⚠
│   │   └── impl-02  ○
│   └── plan-02  ○
└── spec-02  ○
```

Renders use `theme.table` (S3) with `cli-table3` backing. `tree` uses Unicode box-drawing chars (`├── │ └──`) with ASCII fallback when `NO_COLOR` or non-TTY.

### `watch` implementation

- **Initial render**: REST fetch for the relevant data (`/projects` or `/projects/:id/nodes`).
- **Live updates**: WS subscribe (`{ all: true }` without arg, `{ projectIds: [id] }` with arg). Each event (`node_status`, `cost_update`, `graph_modified`, etc.) mutates the in-memory frame.
- **Re-render cadence**: throttled to max once per `-n <seconds>` interval (default 2s) to avoid flicker. Full re-render via `process.stdout.write('\x1Bc')` + fresh frame. No diff rendering.
- **Shutdown**: `Ctrl-C` unsubscribes and closes socket cleanly.

### `logs -f` implementation

- Subscribes to WS.
- Filters events by `nodeId` / `type` if flags present.
- Formats each event through `theme.line(...)` using the event's severity to pick tone (`agent_message` → muted, `node_status: failed` → err, etc.).
- On disconnect, reconnects with exponential backoff (max 30s).

### Refresh-rate flag

`-n <seconds>` / `--interval <seconds>` — validated `>= 1` (prevents thrashing). Applies to `watch` and (re-)subscribe reconnect jitter for `logs -f`.

## `--json` mode

Every command supports `--json` (from S3 `withJsonSupport`):
- `ps` → `[{ id, name, status, currentNodeId, uptimeSec, cost }, ...]`
- `watch --json` → NDJSON stream, one project-state object per refresh tick.
- `logs -f --json` → NDJSON stream of raw WS events.
- `nodes`, `inspect`, `tree` → one JSON object.

## Error handling

- **Daemon not running**: actionable error `Daemon not running. Start with: loomflo daemon start` (exit 2).
- **Project not found** (flag `--project nonexistent`): error listing known project IDs from `ps` (exit 3).
- **WS disconnect during `watch`/`logs -f`**: reconnect with backoff; print a dim `[reconnecting…]` line in status row (no stderr spam).
- **Terminal too narrow** (`process.stdout.columns < 60`): columns degrade — drop `COST` / `RETRIES` columns in `ps`/`nodes`; never truncate mid-column.

## Testing strategy

- **Unit** (`packages/cli/test/observation/*.test.ts`):
  - Table layout snapshots for `ps`/`nodes`/`tree` across various widths.
  - `tree` ASCII for a branching DAG with 3 levels.
  - Project resolution fallbacks (cwd inside / outside project).
- **Integration** (`packages/cli/test/commands/watch.test.ts`):
  - `watch` against a mock daemon: subscribes, receives 3 events, re-renders 3 times, Ctrl-C unsubscribes.
  - `logs -f` against mock daemon: reconnect on forced disconnect.
- **Manual smoke**: 2 projects running → `loomflo watch` shows both; pause one → status flips to `idle` live.

## Dependencies added

None beyond those in S3 (`cli-table3` reused). Uses standard `ws` client already in CLI deps.

## Success criteria

- `loomflo ps` runs in < 500 ms against 3 projects.
- `loomflo watch` shows updates within 1 refresh tick of a node changing status.
- `loomflo logs -f --project X` streams events with < 300 ms p95 latency from daemon event emission.
- `loomflo tree` renders a 20-node DAG legibly on an 80-column terminal.
- All commands emit parseable JSON under `--json` (smoke: pipe to `jq`, exit 0).
