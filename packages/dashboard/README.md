# @loomflo/dashboard

The web dashboard for the LoomFlo agent orchestration daemon.

## Stack

- React 19 + Vite 6 + Tailwind CSS 4
- React Router 7
- TypeScript 5 (strict)
- Vitest 3 + @testing-library/react

The dashboard is bundled by Vite and served by the daemon at runtime via
`@fastify/static` (mounted as a SPA — unmatched routes fall back to
`index.html` so React Router owns navigation).

## Development

### Prerequisites

- Node.js >= 20
- pnpm

### Install

From the monorepo root:

```bash
pnpm install
```

### Run with a real daemon

```bash
# Terminal 1 — start the daemon
pnpm --filter @loomflo/core dev

# Terminal 2 — start the dashboard dev server
pnpm --filter @loomflo/dashboard dev
# → http://localhost:5173
```

The Vite dev server proxies `/api`, `/ws`, and the daemon's REST routes
to `127.0.0.1:3000` (the default daemon port).

### Run with mock fixtures (no real agent activity)

The daemon ships a mock surface under `/mock/*`. Start the daemon with
`LOOMFLO_MOCK_API=1` then point the dashboard at it:

```bash
LOOMFLO_MOCK_API=1 pnpm --filter @loomflo/core dev
VITE_USE_MOCK=1 pnpm --filter @loomflo/dashboard dev
```

The `ApiClient.useMock` flag re-routes project-scoped GETs (workflow,
events, projects, runtime availability) to `/mock/*`. Anything else
falls through to the real daemon.

### Auth

Bearer token discovery flow:

1. CLI command `loomflo dashboard` opens the URL with the token in the
   hash: `http://127.0.0.1:3000/#token=<token>`.
2. `lib/token.ts` reads the hash on first mount, persists the token to
   `sessionStorage`, and strips it from the URL so it does not leak
   into history or DevTools.
3. Subsequent reloads pull the token from `sessionStorage`.

In dev mode without the CLI, copy the token from
`~/.loomflo/daemon.json` after the daemon starts.

## Build

```bash
pnpm --filter @loomflo/dashboard build
# → packages/dashboard/dist/
```

The five large pages (Wizard, Brainstorm, Workflow, NodeDetail, Settings)
are lazy-loaded with `React.lazy` so the initial bundle stays small.
Initial JS gzip target: < 200 KB.

## Tests

```bash
# Unit + integration (jsdom)
pnpm --filter @loomflo/dashboard test

# Coverage report (enforces thresholds in vitest.config.ts)
pnpm --filter @loomflo/dashboard test:coverage

# E2E against a live daemon (skipped by default)
LOOMFLO_E2E=1 pnpm --filter @loomflo/dashboard test test/e2e/
```

The dashboard test runner uses a single fork pool to avoid OOM under
heavy page renders. Coverage thresholds (lines 60, statements 60,
functions 55, branches 65) are intentionally pragmatic — lib + hooks +
context land at ~95–100% across all metrics; the dense view code in the
pages is exercised through smoke tests rather than full interaction
coverage.

## Lint

```bash
pnpm --filter @loomflo/dashboard lint            # ESLint
pnpm --filter @loomflo/dashboard lint:no-emoji   # custom emoji check
pnpm --filter @loomflo/dashboard typecheck       # tsc --noEmit
```

The `lint:no-emoji` script enforces the constitution rule that no emoji
characters appear anywhere in `src/`.

## Architecture

```text
src/
  main.tsx              React root + BrowserRouter
  App.tsx               Routes (lazy-loaded heavy pages)
  index.css             Tailwind v4 @theme + design tokens
  context/
    AppContext.tsx      ApiClient + WebSocketClient singletons
    ProjectStoreContext.tsx
    ThemeContext.tsx
  pages/                One file per route
    ProjectsPage.tsx
    WizardPage.tsx
    BrainstormPage.tsx
    WorkflowPage.tsx
    NodeDetailPage.tsx
    SettingsPage.tsx
    NotFoundPage.tsx
  components/
    Icon.tsx            inline-SVG icon set (no emoji)
    loom/LoomChatPanel.tsx
  hooks/                useWorkflow / useNode / useChat / etc.
  lib/
    api.ts              REST client
    ws.ts               WebSocket client
    token.ts            URL-hash → sessionStorage token discovery
    types.ts            mirror types (no @loomflo/core import)
    loomBrain.ts        scripted intent detection for the Loom chat
```

## Conventions

- All imports relative with explicit `.js` extension (ES modules).
- `lib/types.ts` mirrors `@loomflo/core` types; the dashboard never
  imports from `@loomflo/core` so it builds without depending on a
  prior `core` build.
- Tailwind config is inline in `index.css` via `@theme {…}` (Tailwind
  v4 CSS API). No `tailwind.config.js`.
- No emoji anywhere in `src/` — see `scripts/check-no-emoji.mjs`.
- Components must be accessible: focus-visible, ARIA labels, keyboard
  navigation. The a11y suite (`test/integration/a11y.test.tsx`) gates
  critical and serious axe-core violations.

## Routing

| Route | Page | Description |
|---|---|---|
| `/` | redirect | sends to `/projects` |
| `/projects` | Projects | list + project switcher + Cmd+K palette |
| `/projects/new/wizard` | Wizard | 6-step project creation |
| `/projects/:id/brainstorm` | Brainstorm | chat with Loom to clarify the vision |
| `/projects/:id/workflow` | Workflow | live DAG + node detail + Loom chat |
| `/projects/:id/nodes/:nodeId` | NodeDetail | per-node detail + runtime stream |
| `/projects/:id/settings` | Settings | per-project config (8 sections) |
| `*` | NotFound | 404 |

## Env vars

| Var | Default | Effect |
|---|---|---|
| `VITE_API_URL` | `window.location.origin` | Daemon base URL override. |
| `VITE_USE_MOCK` | `0` | When `1`, project-scoped GETs hit `/mock/*`. |

## Troubleshooting

- **Blank page on refresh of `/projects/abc/workflow`** — make sure the
  daemon was started with `LOOMFLO_DASHBOARD_PATH` pointing at
  `dist/`. The static plugin must come before the API routes for the
  SPA fallback to fire.
- **WS won't connect (close code 4001)** — token mismatch. Check
  `~/.loomflo/daemon.json` matches the URL hash you launched with.
- **`token` not found** — open the dashboard via `loomflo dashboard`
  in CLI, or paste the token from `~/.loomflo/daemon.json` into the
  URL hash manually: `http://127.0.0.1:3000/#token=<token>`.
- **Tests crash with OOM** — the runner is already configured for a
  single fork. If you change `pool` in `vitest.config.ts`, expect
  page-test renders to consume ~1.5 GB of RAM each.
