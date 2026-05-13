# S5 — Multi-Project Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dashboard — silently broken since S1's route refactor — and turn it into a proper multi-project observation surface: a landing page listing every project, a top-bar switcher, and every page wired to `/projects/:id/*` routes with WebSocket subscribe.

**Architecture:** Introduce `ProjectContext` above the router so every page has `{ projectId, token, project, allProjects }`. Rewrite `lib/api.ts` so every endpoint is prefixed `/projects/${projectId}/*` and route tree becomes `/` (Landing) + `/projects/:projectId/<page>`. Refactor `useWebSocket` to send `{ type: "subscribe", projectIds: [...] }` on open. Daemon token is passed as a URL fragment (`#token=`) by `loomflo dashboard` so it is never sent to the server. Tailwind gains the Mint palette tokens from S3.

**Tech Stack:** TypeScript 5.x, React 19, React Router 7 (`react-router-dom`), Tailwind 4 (CSS-first `@theme`), `@xyflow/react`, `vitest`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-04-15-s5-multiproject-dashboard.md`

**Depends on:** S1 (scoped routes `/projects/:id/*`, multiplexed WS subscribe), S3 (Mint palette tokens — same hex values reused in Tailwind).

---

## Conventions

All paths are `packages/dashboard/src/…` unless stated otherwise. Test runner = `pnpm --filter @loomflo/dashboard test`. Lint = `pnpm --filter @loomflo/dashboard lint`. Typecheck = `pnpm --filter @loomflo/dashboard typecheck`. Commits: `feat(dashboard): … (T<n>)` or `refactor(dashboard): …`.

## Task dependency graph

```
T1 (tailwind) ───────────────────────────────┐
T2 (token)    → T4 (ctx) → T5 (ws) → T6 (routing) → T7 (landing) → T8 (switcher)
T3 (api)      ────┘                             │
                                                ▼
                                          T9 (hooks)
                                                │
                                                ▼
                                          T10 (cli dashboard cmd)
                                                │
                                                ▼
                                          T11 (int tests)
                                                │
                                                ▼
                                          T12 (e2e)
                                                │
                                                ▼
                                          T13 (verification)
```

T1, T2, T3 are independent and can ship in any order. T4 depends on T2+T3. Everything downstream of T6 is sequential.

---

# Phase A — Foundation

## Task 1: Tailwind palette tokens

**Files:**
- Modify: `packages/dashboard/src/index.css`

Tailwind 4 uses CSS-first `@theme` directives instead of a JS config. Palette tokens go directly into the CSS file.

- [ ] **Step 1: Add the tokens**

In `packages/dashboard/src/index.css`, locate the `@theme` block (if none, create it at the top under `@import "tailwindcss";`):

```css
@import "tailwindcss";

@theme {
  --color-loom-accent: #8BD1B5;
  --color-loom-muted:  #A7D7C5;
  --color-loom-dim:    #6B7A78;
  --color-loom-warn:   #E6C97A;
  --color-loom-err:    #E8908C;
  --color-loom-bg:     #0d0f11;
  --color-loom-panel:  #161a1d;
  --color-loom-panel-2:#1d2226;
}
```

- [ ] **Step 2: Smoke test**

Run: `pnpm --filter @loomflo/dashboard build`
Expected: build succeeds; the emitted CSS contains `--color-loom-accent`.

Grep proof:

```bash
grep "loom-accent" packages/dashboard/dist/assets/*.css
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/index.css
git commit -m "feat(dashboard): Mint palette CSS variables for Tailwind 4 (T1)"
```

---

## Task 2: Token parsing (URL fragment → sessionStorage)

**Files:**
- Create: `packages/dashboard/src/lib/token.ts`
- Test: `packages/dashboard/test/lib/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dashboard/test/lib/token.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { readToken, clearTokenFromHash } from "../../src/lib/token.js";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("token", () => {
  it("reads from #token= in location.hash and stores in sessionStorage", () => {
    window.history.replaceState({}, "", "/#token=abc123");
    const t = readToken();
    expect(t).toBe("abc123");
    expect(sessionStorage.getItem("loomflo.token")).toBe("abc123");
  });

  it("falls back to sessionStorage when hash is absent", () => {
    sessionStorage.setItem("loomflo.token", "xyz");
    window.history.replaceState({}, "", "/");
    expect(readToken()).toBe("xyz");
  });

  it("returns null when neither source provides a token", () => {
    expect(readToken()).toBeNull();
  });

  it("clearTokenFromHash() removes #token=… but keeps the path", () => {
    window.history.replaceState({}, "", "/graph#token=abc");
    clearTokenFromHash();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/graph");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/dashboard test -- lib/token`

- [ ] **Step 3: Implement**

```ts
// packages/dashboard/src/lib/token.ts
const KEY = "loomflo.token";
const HASH_RE = /(?:^|#|&)token=([^&]+)/;

export function readToken(): string | null {
  const hash = window.location.hash;
  const match = hash.match(HASH_RE);
  if (match && match[1]) {
    const token = decodeURIComponent(match[1]);
    sessionStorage.setItem(KEY, token);
    clearTokenFromHash();
    return token;
  }
  const stored = sessionStorage.getItem(KEY);
  return stored;
}

export function clearTokenFromHash(): void {
  const stripped = window.location.hash.replace(HASH_RE, "").replace(/^#&?/, "").replace(/^#$/, "");
  const newHash = stripped.length > 0 ? `#${stripped.replace(/^&/, "")}` : "";
  const newUrl = `${window.location.pathname}${window.location.search}${newHash}`;
  window.history.replaceState({}, "", newUrl);
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Run + pass**

Run: `pnpm --filter @loomflo/dashboard test -- lib/token`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/token.ts packages/dashboard/test/lib/token.test.ts
git commit -m "feat(dashboard): token parsing — hash fragment + sessionStorage (T2)"
```

---

## Task 3: API client rewrite — scoped under `/projects/:id/*`

**Files:**
- Modify: `packages/dashboard/src/lib/api.ts` (rewrite)
- Test: `packages/dashboard/test/lib/api.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// packages/dashboard/test/lib/api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type ApiClient } from "../../src/lib/api.js";

const makeClient = (): ApiClient =>
  api({ baseUrl: "http://localhost:42000", token: "t" });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("listProjects() hits GET /projects with auth header", async () => {
    await makeClient().listProjects();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:42000/projects");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer t");
  });

  it("getWorkflow(id) scopes URL under /projects/:id/workflow", async () => {
    await makeClient().getWorkflow("proj_x");
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:42000/projects/proj_x/workflow");
  });

  it("getNodes / getNode / getEvents / getCosts / getConfig / getMemory / getSpecs all scope under /projects/:id", async () => {
    const c = makeClient();
    await c.getNodes("proj_x");
    await c.getNode("proj_x", "n1");
    await c.getEvents("proj_x");
    await c.getCosts("proj_x");
    await c.getConfig("proj_x");
    await c.getMemory("proj_x");
    await c.getSpecs("proj_x");
    const urls = fetchSpy.mock.calls.map((call) => call[0] as string);
    for (const u of urls) {
      expect(u).toMatch(/\/projects\/proj_x\//);
    }
  });

  it("throws a DashboardOutdatedError on 410 Gone", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: "gone", newRoute: "/projects/.../nodes" }), { status: 410 }));
    await expect(makeClient().getNodes("proj_x")).rejects.toThrow(/outdated/i);
  });

  it("postChat scopes under /projects/:id/chat and sends body", async () => {
    await makeClient().postChat("proj_x", { messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:42000/projects/proj_x/chat");
    expect(init.method).toBe("POST");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/dashboard test -- lib/api`

- [ ] **Step 3: Rewrite `api.ts`**

Replace the content of `packages/dashboard/src/lib/api.ts` with:

```ts
// packages/dashboard/src/lib/api.ts
import type { Workflow, Node as WorkflowNode, EventList, Costs, Memory, Specs, ChatResponse, ChatBody, ProjectSummary, ProjectDetail } from "./types";

export class DashboardOutdatedError extends Error {
  readonly code = "DASHBOARD_OUTDATED";
  readonly newRoute?: string;
  constructor(message: string, newRoute?: string) {
    super(message);
    this.newRoute = newRoute;
  }
}

export interface ApiOptions {
  baseUrl: string;
  token: string;
}

export interface ApiClient {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(projectId: string): Promise<ProjectDetail>;
  getWorkflow(projectId: string): Promise<Workflow>;
  getNodes(projectId: string): Promise<WorkflowNode[]>;
  getNode(projectId: string, nodeId: string): Promise<WorkflowNode>;
  getEvents(projectId: string, opts?: { type?: string; limit?: number; offset?: number }): Promise<EventList>;
  getCosts(projectId: string): Promise<Costs>;
  getConfig(projectId: string): Promise<Record<string, unknown>>;
  getMemory(projectId: string): Promise<Memory>;
  getSpecs(projectId: string): Promise<Specs>;
  postChat(projectId: string, body: ChatBody): Promise<ChatResponse>;
}

export function api(opts: ApiOptions): ApiClient {
  const headers = { authorization: `Bearer ${opts.token}` };

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${opts.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined), "content-type": "application/json" },
    });
    if (res.status === 410) {
      let newRoute: string | undefined;
      try {
        const body = (await res.json()) as { newRoute?: string };
        newRoute = body.newRoute;
      } catch {
        /* ignore */
      }
      throw new DashboardOutdatedError(
        "Dashboard build is outdated — rebuild or update the daemon.",
        newRoute,
      );
    }
    if (!res.ok) {
      throw new Error(`HTTP ${String(res.status)} on ${path}`);
    }
    return (await res.json()) as T;
  }

  const base = (id: string, sub: string): string => `/projects/${encodeURIComponent(id)}${sub}`;

  return {
    listProjects: () => req<ProjectSummary[]>("/projects"),
    getProject: (id) => req<ProjectDetail>(base(id, "")),
    getWorkflow: (id) => req<Workflow>(base(id, "/workflow")),
    getNodes: (id) => req<WorkflowNode[]>(base(id, "/nodes")),
    getNode: (id, nodeId) => req<WorkflowNode>(base(id, `/nodes/${encodeURIComponent(nodeId)}`)),
    getEvents: (id, o) => {
      const q = new URLSearchParams();
      if (o?.type !== undefined) q.set("type", o.type);
      if (o?.limit !== undefined) q.set("limit", String(o.limit));
      if (o?.offset !== undefined) q.set("offset", String(o.offset));
      const suffix = q.size > 0 ? `?${q.toString()}` : "";
      return req<EventList>(base(id, `/events${suffix}`));
    },
    getCosts: (id) => req<Costs>(base(id, "/costs")),
    getConfig: (id) => req<Record<string, unknown>>(base(id, "/config")),
    getMemory: (id) => req<Memory>(base(id, "/memory")),
    getSpecs: (id) => req<Specs>(base(id, "/specs")),
    postChat: (id, body) => req<ChatResponse>(base(id, "/chat"), { method: "POST", body: JSON.stringify(body) }),
  };
}
```

Update `packages/dashboard/src/lib/types.ts` to include `ProjectSummary` and `ProjectDetail` if not already:

```ts
export interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  status: "idle" | "running" | "blocked" | "failed" | "completed";
  currentNodeId: string | null;
  cost: number;
  startedAt: string | null;
}

export type ProjectDetail = ProjectSummary & {
  workflow: { id: string; status: string };
};
```

- [ ] **Step 4: Run tests + pass**

Run: `pnpm --filter @loomflo/dashboard test -- lib/api`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/api.ts packages/dashboard/src/lib/types.ts packages/dashboard/test/lib/api.test.ts
git commit -m "feat(dashboard): scoped api client under /projects/:id/* (T3)"
```

---

## Task 4: ProjectContext

**Files:**
- Create: `packages/dashboard/src/context/ProjectContext.tsx`
- Test: `packages/dashboard/test/context/ProjectContext.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/dashboard/test/context/ProjectContext.test.tsx
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/api.js", () => ({
  api: () => ({
    listProjects: vi.fn().mockResolvedValue([
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: null, cost: 0, startedAt: null },
    ]),
  }),
  DashboardOutdatedError: class extends Error {},
}));

import { ProjectProvider, useProject } from "../../src/context/ProjectContext.js";

function Probe(): JSX.Element {
  const ctx = useProject();
  return <div data-testid="probe">{ctx.allProjects.map((p) => p.name).join(",")}</div>;
}

describe("ProjectContext", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("loomflo.token", "t");
  });

  it("loads the project list on mount and exposes it via useProject", async () => {
    render(
      <ProjectProvider baseUrl="http://localhost:42000">
        <Probe />
      </ProjectProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByTestId("probe").textContent).toContain("alpha");
  });

  it("throws a helpful error when useProject is called outside the provider", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ProjectProvider/);
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/dashboard test -- context/ProjectContext`

- [ ] **Step 3: Implement**

```tsx
// packages/dashboard/src/context/ProjectContext.tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, type ApiClient } from "../lib/api";
import { readToken } from "../lib/token";
import type { ProjectSummary } from "../lib/types";

export interface ProjectContextValue {
  token: string;
  baseUrl: string;
  client: ApiClient;
  projectId: string | null;
  setProjectId(id: string | null): void;
  allProjects: ProjectSummary[];
  refresh(): Promise<void>;
  error: Error | null;
}

const ProjectCtx = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectCtx);
  if (ctx === null) {
    throw new Error("useProject must be used inside a <ProjectProvider>");
  }
  return ctx;
}

export interface ProjectProviderProps {
  baseUrl: string;
  children: ReactNode;
}

export function ProjectProvider(props: ProjectProviderProps): JSX.Element {
  const token = readToken();
  if (token === null) {
    return <MissingTokenGate baseUrl={props.baseUrl}>{props.children}</MissingTokenGate>;
  }

  const client = useMemo(() => api({ baseUrl: props.baseUrl, token }), [props.baseUrl, token]);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const list = await client.listProjects();
      setAllProjects(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  useEffect(() => {
    void refresh();
  }, [client]);

  const value: ProjectContextValue = {
    token,
    baseUrl: props.baseUrl,
    client,
    projectId,
    setProjectId,
    allProjects,
    refresh,
    error,
  };

  return <ProjectCtx.Provider value={value}>{props.children}</ProjectCtx.Provider>;
}

function MissingTokenGate(props: { baseUrl: string; children: ReactNode }): JSX.Element {
  const [pasted, setPasted] = useState("");
  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    sessionStorage.setItem("loomflo.token", pasted);
    window.location.reload();
  };
  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted flex items-center justify-center p-8">
      <form onSubmit={onSubmit} className="bg-loom-panel p-6 rounded-md max-w-md w-full space-y-4">
        <h2 className="text-loom-accent text-lg">Daemon token required</h2>
        <p className="text-sm text-loom-dim">
          Open the dashboard via <code>loomflo dashboard</code> so the token is passed automatically, or paste it here:
        </p>
        <input
          type="password"
          className="w-full bg-loom-panel-2 text-loom-muted p-2 rounded"
          placeholder="daemon token"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <button className="bg-loom-accent text-loom-bg px-4 py-2 rounded" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run + pass**

Run: `pnpm --filter @loomflo/dashboard test -- context/ProjectContext`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/context/ProjectContext.tsx packages/dashboard/test/context/ProjectContext.test.tsx
git commit -m "feat(dashboard): ProjectContext — token + allProjects + per-route projectId (T4)"
```

---

## Task 5: WebSocket hook with subscribe protocol

**Files:**
- Modify: `packages/dashboard/src/hooks/useWebSocket.ts`
- Create: `packages/dashboard/src/lib/ws.ts`
- Test: `packages/dashboard/test/hooks/useWebSocket.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dashboard/test/hooks/useWebSocket.test.ts
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) {
    FakeSocket.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.onclose?.();
  }
}

vi.stubGlobal("WebSocket", FakeSocket);

import { useWebSocket } from "../../src/hooks/useWebSocket.js";

describe("useWebSocket", () => {
  it("sends a subscribe frame with projectIds on open", async () => {
    const { result } = renderHook(() =>
      useWebSocket({ baseUrl: "http://localhost:42000", token: "t", subscribe: { projectIds: ["proj_a"] } }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(FakeSocket.last.sent[0]).toContain(`"projectIds":["proj_a"]`);
    expect(result.current.connected).toBe(true);
  });

  it("sends { all: true } when subscribe.all is set", async () => {
    renderHook(() =>
      useWebSocket({ baseUrl: "http://localhost:42000", token: "t", subscribe: { all: true } }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(FakeSocket.last.sent[0]).toContain(`"all":true`);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/dashboard test -- hooks/useWebSocket`

- [ ] **Step 3: Implement**

```ts
// packages/dashboard/src/lib/ws.ts
export type SubscribeSpec = { all: true } | { projectIds: string[] };

export function wsUrl(baseUrl: string, token: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.searchParams.set("token", token);
  return u.toString();
}
```

```ts
// packages/dashboard/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState } from "react";

import { wsUrl, type SubscribeSpec } from "../lib/ws";

export interface UseWebSocketOptions {
  baseUrl: string;
  token: string;
  subscribe: SubscribeSpec;
  onMessage?: (frame: Record<string, unknown>) => void;
}

export interface UseWebSocketReturn {
  connected: boolean;
  lastError: Error | null;
}

export function useWebSocket(opts: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const onMessageRef = useRef(opts.onMessage);
  onMessageRef.current = opts.onMessage;

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let socket: WebSocket | null = null;

    const connect = (): void => {
      socket = new WebSocket(wsUrl(opts.baseUrl, opts.token));
      socket.onopen = (): void => {
        retry = 0;
        setConnected(true);
        socket?.send(JSON.stringify({ type: "subscribe", ...opts.subscribe }));
      };
      socket.onmessage = (e): void => {
        try {
          onMessageRef.current?.(JSON.parse(e.data) as Record<string, unknown>);
        } catch {
          /* ignore non-JSON frame */
        }
      };
      socket.onerror = (): void => {
        setLastError(new Error("WebSocket error"));
      };
      socket.onclose = (): void => {
        setConnected(false);
        if (closed) return;
        retry++;
        const delay = Math.min(30_000, 2 ** retry * 500);
        setTimeout(connect, delay);
      };
    };

    connect();

    return (): void => {
      closed = true;
      socket?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.baseUrl, opts.token, JSON.stringify(opts.subscribe)]);

  return { connected, lastError };
}
```

- [ ] **Step 4: Run + pass**

Run: `pnpm --filter @loomflo/dashboard test -- useWebSocket`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/ws.ts packages/dashboard/src/hooks/useWebSocket.ts packages/dashboard/test/hooks/useWebSocket.test.ts
git commit -m "refactor(dashboard): useWebSocket subscribes with {projectIds|all} (T5)"
```

---

# Phase B — Route restructure

## Task 6: Routing — `/projects/:projectId/*` + `/` landing

**Files:**
- Modify: `packages/dashboard/src/App.tsx`
- Modify: `packages/dashboard/src/main.tsx`
- Create: `packages/dashboard/src/pages/NotFound.tsx`

- [ ] **Step 1: Rewrite `App.tsx`**

```tsx
// packages/dashboard/src/App.tsx
import { Routes, Route, useParams, Navigate, Outlet } from "react-router-dom";

import { useProject } from "./context/ProjectContext";
import { HomePage } from "./pages/Home";
import { Graph } from "./pages/Graph";
import { NodePage } from "./pages/Node";
import { SpecsPage } from "./pages/Specs";
import { MemoryPage } from "./pages/Memory";
import { ChatPage } from "./pages/Chat";
import { CostsPage } from "./pages/Costs";
import { ConfigPage } from "./pages/Config";
import { LandingPage } from "./pages/Landing";
import { NotFoundPage } from "./pages/NotFound";
import { Layout } from "./components/Layout";

function ProjectGuard(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const ctx = useProject();
  if (projectId === undefined) return <Navigate to="/" replace />;
  if (ctx.allProjects.length > 0 && !ctx.allProjects.some((p) => p.id === projectId)) {
    return <Navigate to="/" replace />;
  }
  if (projectId !== ctx.projectId) {
    ctx.setProjectId(projectId);
  }
  return <Outlet />;
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<ProjectGuard />}>
        <Route path="/projects/:projectId" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="graph" element={<Graph />} />
          <Route path="node/:id" element={<NodePage />} />
          <Route path="specs" element={<SpecsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="config" element={<ConfigPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
```

- [ ] **Step 2: Wrap `main.tsx` with the provider**

```tsx
// packages/dashboard/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { ProjectProvider } from "./context/ProjectContext";
import "./index.css";

const baseUrl = window.location.origin; // daemon serves the dashboard, so same origin

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <BrowserRouter>
      <ProjectProvider baseUrl={baseUrl}>
        <App />
      </ProjectProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: Create `NotFound.tsx`**

```tsx
// packages/dashboard/src/pages/NotFound.tsx
import { Link } from "react-router-dom";

export function NotFoundPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted flex flex-col items-center justify-center gap-4">
      <h1 className="text-loom-accent text-xl">404 — not here</h1>
      <Link to="/" className="text-loom-accent underline">
        back to project list
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @loomflo/dashboard typecheck`
Expected: PASS (pages referenced may have stale types — fix import names in next tasks).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/App.tsx packages/dashboard/src/main.tsx packages/dashboard/src/pages/NotFound.tsx
git commit -m "refactor(dashboard): route tree — /projects/:projectId/* + landing at / (T6)"
```

---

## Task 7: Landing page

**Files:**
- Create: `packages/dashboard/src/pages/Landing.tsx`
- Test: `packages/dashboard/test/pages/Landing.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/dashboard/test/pages/Landing.test.tsx
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/ProjectContext.js", () => ({
  useProject: () => ({
    allProjects: [
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", cost: 0.42, startedAt: "2026-04-15T00:00:00Z" },
      { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, cost: 0, startedAt: null },
    ],
    client: { listProjects: vi.fn() },
    error: null,
  }),
}));

import { LandingPage } from "../../src/pages/Landing.js";

describe("LandingPage", () => {
  it("renders one card per registered project", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("auto-redirects to /projects/:id when only one project is registered", () => {
    // Override the context mock inline
    vi.doMock("../../src/context/ProjectContext.js", () => ({
      useProject: () => ({
        allProjects: [{ id: "solo", name: "only", projectPath: "/x", status: "idle", currentNodeId: null, cost: 0, startedAt: null }],
        client: { listProjects: vi.fn() },
        error: null,
      }),
    }));
    // Re-import LandingPage after mock override
    void import("../../src/pages/Landing.js").then(({ LandingPage: Fresh }) => {
      const { container } = render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<Fresh />} />
            <Route path="/projects/:id" element={<div data-testid="home">ok</div>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(container.querySelector('[data-testid="home"]')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/dashboard test -- pages/Landing`

- [ ] **Step 3: Implement**

```tsx
// packages/dashboard/src/pages/Landing.tsx
import { Link, Navigate } from "react-router-dom";

import { useProject } from "../context/ProjectContext";
import type { ProjectSummary } from "../lib/types";

export function LandingPage(): JSX.Element {
  const { allProjects, error } = useProject();

  if (error !== null) {
    return (
      <div className="p-8 text-loom-err">Failed to load projects: {error.message}</div>
    );
  }

  if (allProjects.length === 1) {
    const only = allProjects[0] as ProjectSummary;
    return <Navigate to={`/projects/${only.id}`} replace />;
  }

  if (allProjects.length === 0) {
    return (
      <div className="min-h-screen bg-loom-bg text-loom-muted p-10">
        <h1 className="text-loom-accent text-lg">No projects yet</h1>
        <p className="text-loom-dim mt-2">
          Run <code className="text-loom-accent">loomflo start</code> inside a project directory to register it here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted p-8">
      <h1 className="text-loom-accent text-xl mb-6">Projects</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allProjects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }): JSX.Element {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="bg-loom-panel rounded-md p-4 hover:bg-loom-panel-2 block"
    >
      <div className="flex items-center justify-between">
        <div className="text-loom-accent font-semibold">{project.name}</div>
        <StatusDot status={project.status} />
      </div>
      <div className="text-loom-dim text-sm mt-2 space-y-1">
        <div>{project.currentNodeId ?? "—"}</div>
        <div>${project.cost.toFixed(2)}</div>
      </div>
    </Link>
  );
}

function StatusDot({ status }: { status: ProjectSummary["status"] }): JSX.Element {
  const cls =
    status === "running"
      ? "bg-loom-accent"
      : status === "blocked" || status === "failed"
        ? "bg-loom-err"
        : "bg-loom-dim";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}
```

- [ ] **Step 4: Run + pass**

Run: `pnpm --filter @loomflo/dashboard test -- pages/Landing`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/pages/Landing.tsx packages/dashboard/test/pages/Landing.test.tsx
git commit -m "feat(dashboard): Landing page with project cards + solo-auto-redirect (T7)"
```

---

## Task 8: TopBar + ProjectSwitcher

**Files:**
- Create: `packages/dashboard/src/components/TopBar.tsx`
- Create: `packages/dashboard/src/components/ProjectSwitcher.tsx`
- Create: `packages/dashboard/src/components/Layout.tsx`
- Test: `packages/dashboard/test/components/ProjectSwitcher.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/dashboard/test/components/ProjectSwitcher.test.tsx
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/ProjectContext.js", () => ({
  useProject: () => ({
    allProjects: [
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: null, cost: 0, startedAt: null },
      { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, cost: 0, startedAt: null },
    ],
    projectId: "proj_a",
    setProjectId: vi.fn(),
  }),
}));

import { ProjectSwitcher } from "../../src/components/ProjectSwitcher.js";

describe("ProjectSwitcher", () => {
  it("renders the active project label", () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj_a/graph"]}>
        <Routes>
          <Route path="/projects/:projectId/*" element={<ProjectSwitcher />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("navigates to the same sub-page on another project when an option is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj_a/graph"]}>
        <Routes>
          <Route path="/projects/:projectId/*" element={<ProjectSwitcher />} />
          <Route path="/projects/proj_b/graph" element={<div data-testid="graph-b">B graph</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /alpha/ }));
    fireEvent.click(screen.getByText("beta"));
    expect(screen.getByTestId("graph-b")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/dashboard test -- components/ProjectSwitcher`

- [ ] **Step 3: Implement `ProjectSwitcher`**

```tsx
// packages/dashboard/src/components/ProjectSwitcher.tsx
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useProject } from "../context/ProjectContext";

export function ProjectSwitcher(): JSX.Element {
  const { allProjects } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const current = allProjects.find((p) => p.id === projectId);

  const onPick = (id: string): void => {
    setOpen(false);
    const subPath = location.pathname.replace(/^\/projects\/[^/]+/, "");
    navigate(`/projects/${id}${subPath}`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="bg-loom-panel-2 text-loom-accent px-3 py-1 rounded flex items-center gap-2"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.name ?? projectId ?? "select"}</span>
        <span className="text-loom-muted text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-loom-panel border border-loom-dim/30 rounded shadow-md min-w-[200px] z-10">
          {allProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => onPick(p.id)}
              className={`px-3 py-2 cursor-pointer hover:bg-loom-panel-2 ${p.id === projectId ? "text-loom-accent" : "text-loom-muted"}`}
            >
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement `TopBar` + `Layout`**

```tsx
// packages/dashboard/src/components/TopBar.tsx
import { Link, useParams } from "react-router-dom";

import { useProject } from "../context/ProjectContext";
import { ProjectSwitcher } from "./ProjectSwitcher";

export function TopBar(): JSX.Element {
  const { allProjects } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const current = allProjects.find((p) => p.id === projectId);

  return (
    <div className="flex items-center justify-between bg-loom-panel border-b border-loom-dim/20 px-4 py-2">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-loom-accent font-bold">
          loomflo
        </Link>
        <span className="text-loom-dim">/</span>
        <span className="text-loom-muted">{current?.name ?? projectId}</span>
      </div>
      <ProjectSwitcher />
    </div>
  );
}
```

```tsx
// packages/dashboard/src/components/Layout.tsx
import { Outlet } from "react-router-dom";

import { TopBar } from "./TopBar";

export function Layout(): JSX.Element {
  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted">
      <TopBar />
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Run + pass**

Run: `pnpm --filter @loomflo/dashboard test -- components/ProjectSwitcher`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/TopBar.tsx packages/dashboard/src/components/ProjectSwitcher.tsx packages/dashboard/src/components/Layout.tsx packages/dashboard/test/components/ProjectSwitcher.test.tsx
git commit -m "feat(dashboard): TopBar + ProjectSwitcher + Layout (T8)"
```

---

## Task 9: Migrate hooks to pass `projectId`

**Files:**
- Modify: `packages/dashboard/src/hooks/useWorkflow.ts`
- Modify: `packages/dashboard/src/hooks/useCosts.ts`
- Modify: `packages/dashboard/src/hooks/useChat.ts`
- Modify: `packages/dashboard/src/pages/Home.tsx`, `Graph.tsx`, `Node.tsx`, `Chat.tsx`, `Costs.tsx`, `Config.tsx`, `Specs.tsx`, `Memory.tsx`

Every hook that fetches scoped data now requires a `projectId`, read from `useParams()` inside each page.

- [ ] **Step 1: Rewrite `useWorkflow`**

```ts
// packages/dashboard/src/hooks/useWorkflow.ts
import { useEffect, useState } from "react";

import { useProject } from "../context/ProjectContext";
import { useWebSocket } from "./useWebSocket";
import type { Workflow } from "../lib/types";

export function useWorkflow(projectId: string): Workflow | null {
  const { client, baseUrl, token } = useProject();
  const [wf, setWf] = useState<Workflow | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client
      .getWorkflow(projectId)
      .then((w) => {
        if (!cancelled) setWf(w);
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [client, projectId]);

  useWebSocket({
    baseUrl,
    token,
    subscribe: { projectIds: [projectId] },
    onMessage: (frame) => {
      const fp = frame["projectId"];
      if (fp !== projectId) return;
      // Trigger a fresh fetch on relevant events.
      if (["node_status", "graph_modified", "cost_update", "workflow_status"].includes(frame["type"] as string)) {
        void client.getWorkflow(projectId).then((w) => setWf(w));
      }
    },
  });

  return wf;
}
```

Apply the same pattern to `useCosts.ts` and `useChat.ts`. Inside each page, replace the parameterless call with:

```ts
const { projectId } = useParams<{ projectId: string }>();
if (projectId === undefined) return null;
const wf = useWorkflow(projectId);
```

- [ ] **Step 2: Update all page imports**

For each page under `packages/dashboard/src/pages/`, add `import { useParams } from "react-router-dom";` at the top and pull `projectId` from `useParams<{ projectId: string }>()`. Pass it into the relevant hook.

- [ ] **Step 3: Run typecheck + existing tests**

```bash
pnpm --filter @loomflo/dashboard typecheck
pnpm --filter @loomflo/dashboard test
```

Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/hooks/ packages/dashboard/src/pages/
git commit -m "refactor(dashboard): hooks + pages scoped to projectId (T9)"
```

---

## Task 10: `loomflo dashboard` passes token via URL fragment

**Files:**
- Modify: `packages/cli/src/commands/dashboard.ts`
- Test: `packages/cli/test/commands/dashboard.fragment.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/dashboard.fragment.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  exec: vi.fn((_cmd: string, cb: (err: Error | null) => void): void => cb(null)),
}));

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 41234, token: "tok-abc" }),
}));

describe("loomflo dashboard — token fragment", () => {
  it("prints a URL containing #token=<token>", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createDashboardCommand } = await import("../../src/commands/dashboard.js");
    await createDashboardCommand().parseAsync(["node", "dashboard", "--no-open"]);
    expect(writes.join("")).toContain("http://127.0.0.1:41234/#token=tok-abc");
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/cli test -- commands/dashboard.fragment`

- [ ] **Step 3: Modify `dashboard.ts`**

In `packages/cli/src/commands/dashboard.ts`, inside the action after reading `port`/`token`:

```ts
const token = options.port !== undefined ? undefined : (await readDaemonConfig()).token;
const url = token === undefined ? `http://127.0.0.1:${String(port)}` : `http://127.0.0.1:${String(port)}/#token=${encodeURIComponent(token)}`;
```

And flow it through the existing `console.log(url)` path.

- [ ] **Step 4: Run + pass**

Run: `pnpm --filter @loomflo/cli test -- commands/dashboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/dashboard.ts packages/cli/test/commands/dashboard.fragment.test.ts
git commit -m "feat(cli): dashboard command passes daemon token via URL fragment (T10)"
```

---

# Phase C — Integration & docs

## Task 11: Routing integration test

**Files:**
- Create: `packages/dashboard/test/integration/routing.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// packages/dashboard/test/integration/routing.test.tsx
import { MemoryRouter } from "react-router-dom";
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/token.js", () => ({
  readToken: () => "t",
  clearTokenFromHash: vi.fn(),
}));

vi.mock("../../src/lib/api.js", () => ({
  api: () => ({
    listProjects: vi.fn().mockResolvedValue([
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", cost: 0.42, startedAt: null },
      { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, cost: 0, startedAt: null },
    ]),
    getWorkflow: vi.fn().mockResolvedValue({ id: "wf", status: "running", graph: { nodes: {}, edges: [], topology: [] } }),
    getNodes: vi.fn().mockResolvedValue([]),
    getCosts: vi.fn().mockResolvedValue({ total: 0, budgetLimit: 0, budgetRemaining: 0, nodes: [], loomCost: 0 }),
  }),
  DashboardOutdatedError: class extends Error {},
}));

vi.mock("../../src/hooks/useWebSocket.js", () => ({
  useWebSocket: () => ({ connected: true, lastError: null }),
}));

import { App } from "../../src/App";
import { ProjectProvider } from "../../src/context/ProjectContext";

describe("routing", () => {
  it("/ renders the landing with both project cards", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ProjectProvider baseUrl="http://localhost:42000">
          <App />
        </ProjectProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("/projects/proj_a renders the Home page inside the layout", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj_a"]}>
        <ProjectProvider baseUrl="http://localhost:42000">
          <App />
        </ProjectProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("loomflo")).toBeInTheDocument();
  });

  it("/projects/unknown redirects to /", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/unknown"]}>
        <ProjectProvider baseUrl="http://localhost:42000">
          <App />
        </ProjectProvider>
      </MemoryRouter>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + pass**

Run: `pnpm --filter @loomflo/dashboard test -- integration/routing`
Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/test/integration/routing.test.tsx
git commit -m "test(dashboard): routing integration — landing + scoped + 404 (T11)"
```

---

## Task 12: E2E extension

**Files:**
- Modify: `tests/e2e/multi-project.e2e.test.ts`

- [ ] **Step 1: Extend**

Add after the S4 block:

```ts
describe("S5 dashboard — against a real daemon", () => {
  it("GET / returns the SPA shell", async () => {
    const res = await fetch(`http://127.0.0.1:${String(daemonPort)}/`);
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain("loomflo");
  });

  it("GET /projects returns at least 2 projects", async () => {
    const res = await fetch(`http://127.0.0.1:${String(daemonPort)}/projects`, {
      headers: { authorization: `Bearer ${daemonToken}` },
    });
    const body = (await res.json()) as unknown[];
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /projects/:id/workflow returns a workflow, not 410", async () => {
    const res = await fetch(`http://127.0.0.1:${String(daemonPort)}/projects/${projectAId}/workflow`, {
      headers: { authorization: `Bearer ${daemonToken}` },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run**

```bash
LOOMFLO_E2E=1 pnpm test:e2e -- multi-project
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/multi-project.e2e.test.ts
git commit -m "test(e2e): dashboard SPA + scoped routes smoke (T12)"
```

---

## Task 13: Verification + README + CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full suite**

```bash
pnpm --filter @loomflo/dashboard test
pnpm --filter @loomflo/dashboard lint
pnpm --filter @loomflo/dashboard typecheck
pnpm --filter @loomflo/dashboard build
pnpm --filter @loomflo/cli test
pnpm --filter @loomflo/cli build
```

All green.

- [ ] **Step 2: Manual smoke**

```bash
# From the repo root
rm -rf ~/.loomflo/{daemon.json,projects.json}
cd /tmp && rm -rf projA projB && mkdir projA projB

# Register two projects (assumes S2 wizard merged, fallback: force-init with flags)
(cd projA && node <repo>/packages/cli/dist/index.js start --yes &)
(cd projB && node <repo>/packages/cli/dist/index.js start --yes &)
sleep 5

# Open the dashboard
node <repo>/packages/cli/dist/index.js dashboard --no-open
# copy URL → open in browser → verify:
#   - Landing shows 2 cards (alpha + beta)
#   - Click alpha → lands on /projects/<id> with TopBar + dropdown
#   - Switch via dropdown to beta → lands on /projects/<id>
#   - Graph + Costs populate (no empty states)
#   - URL fragment #token=… has been stripped from the address bar
```

- [ ] **Step 3: README — Dashboard section**

Append:

```markdown
## Dashboard

```bash
loomflo dashboard
```

Opens the web dashboard. On a single-project daemon it jumps straight into that project; with multiple projects it shows a landing grid and a top-bar switcher to move between them. Every page is scoped under `/projects/:id/*`.

The daemon token is passed via URL fragment (`#token=…`), never sent to the server; the fragment is cleared from the address bar at load.
```

- [ ] **Step 4: CHANGELOG**

```markdown
### Fixed (S5)

- Dashboard: all pages were silently empty after S1's route refactor because the frontend still called `/workflow`, `/nodes`, `/events`. Every endpoint is now scoped under `/projects/:id/*`.

### Added (S5)

- Landing page at `/` listing all registered projects as cards.
- Top-bar project switcher preserving the current sub-page when possible.
- Daemon token passed via URL fragment; cleared from the address bar on load.
- Mint palette applied to the dashboard.
```

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(dashboard): S5 multi-project + fix — README + CHANGELOG (T13)"
```

---

# Final verification

- [ ] `pnpm --filter @loomflo/dashboard test` — green.
- [ ] `pnpm --filter @loomflo/dashboard lint` + `typecheck` + `build` — green.
- [ ] `LOOMFLO_E2E=1 pnpm test:e2e` — green.
- [ ] Manual: 2 projects running, landing shows both, switcher works, pages populate, graph is non-empty.
- [ ] Manual: token fragment is stripped from the URL after load.
- [ ] Manual: closing the dashboard and reopening via stored sessionStorage still works within the same browser session.
- [ ] PR:

```bash
gh pr create --title "S5: multi-project dashboard + injection fix (v0.3.0)" \
  --body "$(cat <<'EOF'
## Summary

- Fixes the silent regression where every dashboard page was empty (legacy routes returning 410 after S1).
- Introduces a project-aware route tree (`/` landing + `/projects/:id/*`), a top-bar switcher, and the Mint palette.
- Token is carried via URL fragment and stripped from the address bar.

Spec: `docs/superpowers/specs/2026-04-15-s5-multiproject-dashboard.md`
Depends on: S1 (merged), S3 (merged for Tailwind tokens).

## Test plan

- [x] Unit + integration tests
- [x] E2E smoke against real daemon
- [x] Manual: 2-project landing → click → switcher → pages populate

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
