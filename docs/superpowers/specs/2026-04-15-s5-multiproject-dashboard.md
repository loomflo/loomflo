# S5 — Multi-project dashboard + injection fix

**Date**: 2026-04-15
**Sub-project**: 5 of 5 (see `2026-04-14-cli-daemon-overview.md`)
**Branch**: `008-multiproject-dashboard`
**Status**: Drafted, awaiting user review
**Depends on**: S1 (scoped routes `/projects/:id/*`, WS subscribe protocol), S3 (palette tokens for Tailwind)
**Target version**: `0.3.0`

## Goal

Fix the dashboard — which after S1's route refactor is silently broken — and turn it into a multi-project observation surface with an explicit project switcher.

The current bug: frontend still calls legacy routes (`/workflow`, `/nodes`, `/events`) which post-T12 return `410 Gone`. Result: every page loads but every section is empty, no nodes in the GraphView, no events streaming. Root cause is structural (no `projectId` wired anywhere in the frontend), not cosmetic.

## Non-goals

- Major visual redesign beyond palette application → out of scope; keep existing component structure.
- New feature pages (analytics, reports, user management) → out of scope.
- Authentication beyond the daemon token → out of scope.
- SSR / server-side rendering → no; SPA as today.
- Mobile-first responsive → current target remains desktop browsers.

## Inherited from S1 / S3

- All daemon routes live under `/projects/:id/*`. Legacy paths return `410 Gone` with a `newRoute` hint.
- WebSocket at `/ws?token=<daemonToken>` accepts `{ type: "subscribe", all: true | projectIds: [...] }`. Messages broadcast with a `projectId` envelope.
- Palette tokens (Mint) and semantic roles defined in S3.

## Architecture

```
packages/dashboard/src/
├── lib/
│   ├── api.ts             # fetch wrappers — all endpoints now prefixed /projects/:id/
│   ├── ws.ts              # WebSocket with subscribe protocol
│   └── token.ts           # reads #token= from location.hash at boot
├── context/
│   └── ProjectContext.tsx # { projectId, setProjectId, projects[], token }
├── routes.tsx             # React Router tree (see below)
├── pages/
│   ├── LandingPage.tsx    # NEW — grid of project cards at /
│   ├── HomePage.tsx       # existing; now reads projectId from useParams + context
│   ├── GraphPage.tsx      # existing; same
│   └── …                  # node, specs, memory, chat, costs, config — all scoped
├── components/
│   ├── ProjectSwitcher.tsx# NEW — top-bar dropdown (always visible except on /)
│   ├── TopBar.tsx         # existing; adds switcher + breadcrumb
│   └── …
└── tailwind.config.ts     # extended with palette tokens
```

### Route tree

```
/                             → LandingPage (grid of projects)
/projects/:projectId           → HomePage
/projects/:projectId/graph     → GraphPage
/projects/:projectId/node/:id  → NodePage
/projects/:projectId/specs     → SpecsPage
/projects/:projectId/memory    → MemoryPage
/projects/:projectId/chat      → ChatPage
/projects/:projectId/costs     → CostsPage
/projects/:projectId/config    → ConfigPage
*                              → NotFoundPage with link to /
```

A route `<Layout>` guards all `/projects/:projectId/*` children: it reads `:projectId`, fetches project metadata (cached), seeds `ProjectContext`, and renders the `TopBar` with switcher. If the projectId is unknown (404 from `/projects/:id`), redirect to `/`.

### `ProjectContext`

```ts
interface ProjectContextValue {
  projectId: string;               // active project id
  project: ProjectSummary | null;  // from /projects/:id
  allProjects: ProjectSummary[];   // from /projects
  token: string;                   // daemon token
  refreshAllProjects(): Promise<void>;
}
```

Provider lives near the root (above router) so `LandingPage` also has access to `allProjects` + `token`. `projectId` is derived from `useParams()` inside guarded routes; on `/`, it's the empty string.

### API client

`lib/api.ts` exposes typed wrappers:

```ts
// before: getWorkflow(token)
// after:  getWorkflow(projectId, token)
export const api = {
  listProjects(token: string): Promise<ProjectSummary[]>,
  getProject(projectId: string, token: string): Promise<ProjectDetail>,
  getWorkflow(projectId: string, token: string): Promise<Workflow>,
  getNodes(projectId: string, token: string): Promise<Node[]>,
  getNode(projectId: string, nodeId: string, token: string): Promise<NodeDetail>,
  getEvents(projectId: string, token: string, opts?): Promise<EventList>,
  getCosts(projectId: string, token: string): Promise<Costs>,
  getMemory(projectId: string, token: string): Promise<Memory>,
  getSpecs(projectId: string, token: string): Promise<Specs>,
  postChat(projectId: string, token: string, body): Promise<ChatResponse>,
};
```

All paths prefixed `/projects/${projectId}/*`. 410 responses are surfaced as actionable errors ("This dashboard build targets an older daemon version — rebuild or update").

### WebSocket

`lib/ws.ts` opens `ws://host:port/ws?token=<token>` once per app lifetime. On open, sends `{ type: "subscribe", all: true }` when on `/` (landing), or `{ type: "subscribe", projectIds: [currentProjectId] }` when scoped. On route change, sends a replacement subscription.

Events arrive as `{ projectId, ...payload }`. Hooks like `useWorkflow(projectId)` filter the incoming stream by matching `projectId`. Reconnect with exponential backoff on close.

### Landing page

- `GET /projects` → `allProjects`.
- Render cards: name, status dot (accent/warn/dim), current node title + index, cost, uptime.
- Click card → `navigate(`/projects/${id}`)`.
- If `allProjects.length === 1` → `Navigate` to `/projects/<only-id>` on mount (with a "Back to all projects" link in the TopBar for consistency once 2+ projects exist).
- If `allProjects.length === 0` → empty state with CLI hint: `Run \`loomflo start\` in a project directory to register it here.`

### Top-bar project switcher

- Dropdown `ProjectSwitcher` opens a list of `allProjects` with the active one marked.
- Select → `navigate(`/projects/${newId}${samePageTrailing}`)` — preserves sub-path when possible (e.g., from `/projects/A/graph` → `/projects/B/graph`).
- Left of the switcher: breadcrumb `loomflo / <project-name>` (accent for `loomflo`, muted for name).

### Token passing

`loomflo dashboard` updates to open `http://127.0.0.1:{port}/#token=<daemonToken>`. The fragment is never sent to the server (browser spec) → no server-side logging of tokens. Frontend reads `location.hash` once at boot (`lib/token.ts`), stores in memory (`ProjectContext`), then strips the hash with `history.replaceState({}, "", "/")` so it doesn't linger in the URL bar.

Fallback: if no hash token on first load, check `sessionStorage` for a previously-read token; if still absent, render a "paste your daemon token" one-shot form (rare — covers devs loading the dashboard URL manually without opening via CLI).

### Tailwind tokens

```ts
// tailwind.config.ts (extension)
theme: {
  extend: {
    colors: {
      loom: {
        accent: "#8BD1B5",
        muted:  "#A7D7C5",
        dim:    "#6B7A78",
        warn:   "#E6C97A",
        err:    "#E8908C",
        bg:     "#0d0f11",   // for dark surfaces
        panel:  "#161a1d",
      },
    },
  },
}
```

Existing components are re-tinted to use `text-loom-accent`, `bg-loom-panel`, etc. — no new design system, just swapping the current greys/greens.

## Error handling

- **API 410**: single toast ("Dashboard is outdated") + reload link.
- **API 404 on `/projects/:id`**: redirect to `/` with a flash message.
- **WS disconnected > 10s**: show a subtle banner "Reconnecting…". Auto-reconnects.
- **Empty project list**: dedicated empty state (see Landing).
- **Missing token**: one-shot paste form → stored in sessionStorage → reload.

## Testing strategy

- **Unit** (`packages/dashboard/test/api.test.ts`): mock fetch, assert scoped URL construction for every method.
- **Unit** (`packages/dashboard/test/token.test.ts`): hash parsing + strip + fallback to sessionStorage.
- **Component** (`packages/dashboard/test/ProjectSwitcher.test.tsx`): dropdown renders all projects, click navigates.
- **Integration** (`packages/dashboard/test/routing.test.tsx`): navigate `/` → landing renders cards; click → home; refresh on home → still works; unknown `projectId` → redirect to `/`.
- **E2E smoke** (extend `tests/e2e/multi-project.e2e.test.ts`): start 2 projects, open dashboard, assert landing shows 2 cards, switcher works.

## Migration notes

- Existing pages keep the same components; only data-fetching call sites change (pass `projectId`).
- Old hooks (`useWorkflow`, `useNodes`) gain a `projectId` parameter. Call-sites inside scoped routes read it from `useProject()`.
- No user-facing URL changes for the landing (`/` stays `/`), but sub-page URLs get the `/projects/:id` prefix — update any hard-coded links (search for `href="/graph"` etc.).

## Success criteria

- `loomflo dashboard` on a single-project daemon opens directly on that project's Home (auto-redirect).
- `loomflo dashboard` on a 2+ project daemon opens the landing with one card per project.
- Project switcher changes the displayed project in < 300 ms (from cached `allProjects`, no extra fetch for the list).
- Graph, Home, Nodes, Costs pages all populate from live data (no empty states when the project is running).
- `location.hash` is cleared after token read.
- Switching from `/projects/A/graph` to project B lands on `/projects/B/graph`.
- Regression: none of S1's core tests need to change.
