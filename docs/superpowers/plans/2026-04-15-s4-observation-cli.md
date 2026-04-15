# S4 — Observation CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver six observation commands — `ps`, `watch`, `logs -f`, `nodes`, `inspect`, `tree` — that make the runtime state of one or more loomflo projects visible from the terminal, live and in depth.

**Architecture:** A new `packages/cli/src/observation/` module carries the data-fetch + render helpers (cross-project aggregator, ASCII tree, table columns, live-refresh loop). Each of the six commands is a thin file under `packages/cli/src/commands/` using the observation helpers and the S3 theme. Live commands (`watch`, `logs -f`) use the multiplexed WebSocket protocol delivered in S1 T13. All commands support `--json` / NDJSON.

**Tech Stack:** TypeScript 5.x, Node 20+, `cli-table3` (reused from S3), `ws` (already a CLI dep), `vitest`.

**Spec:** `docs/superpowers/specs/2026-04-15-s4-observation-cli.md`

**Depends on:** S1 (`/projects`, `/projects/:id/*` routes, multiplexed WS), S3 (theme, `withJsonSupport`, `writeJson`, `writeError`, `writeJsonStream`).

---

## Conventions

Run commands from repo root. Test runner = `pnpm --filter @loomflo/cli test`. Commits: `feat(cli): <summary> (T<n>)`.

## Task dependency graph

```
T1 (api helpers) → T2 (ps) ─┐
                              ├→ T6 (watch) ─┐
T3 (nodes) ─────────────────┘                │
T4 (inspect)                                 │
T5 (tree)                                    │
T7 (logs -f) ────────────────────────────────┤
                                              ▼
                                      T8 (integration)
                                              │
                                              ▼
                                      T9 (verification + docs)
```

T2–T5 and T7 are independent and can be executed in any order after T1. T6 depends on T2 and T3 (reuses their renderers).

---

# Phase A — Foundation

## Task 1: Cross-project API helpers + WebSocket client abstraction

**Files:**
- Create: `packages/cli/src/observation/api.ts`
- Create: `packages/cli/src/observation/ws.ts`
- Test: `packages/cli/test/observation/api.test.ts`
- Test: `packages/cli/test/observation/ws.test.ts`

- [ ] **Step 1: Write the failing API test**

```ts
// packages/cli/test/observation/api.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client.js", () => ({
  httpGet: vi.fn(),
}));

import { httpGet } from "../../src/client.js";
import { fetchProjectsRuntime } from "../../src/observation/api.js";

describe("fetchProjectsRuntime", () => {
  it("aggregates /projects + /projects/:id/workflow in parallel", async () => {
    (httpGet as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: "proj_a", name: "alpha", projectPath: "/a" },
        { id: "proj_b", name: "beta",  projectPath: "/b" },
      ])
      .mockResolvedValueOnce({ status: "running", graph: { topology: ["n1", "n2"] }, totalCost: 0.42, startedAt: "2026-04-15T00:00:00Z" })
      .mockResolvedValueOnce({ status: "idle",    graph: { topology: [] },          totalCost: 0,    startedAt: null });

    const daemon = { port: 42000, token: "t" };
    const out = await fetchProjectsRuntime(daemon);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "proj_a", name: "alpha", status: "running", cost: 0.42 });
    expect(out[1]).toMatchObject({ id: "proj_b", name: "beta", status: "idle", cost: 0 });
  });

  it("tolerates a single project's workflow endpoint failing (404) and marks it ? status", async () => {
    (httpGet as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: "proj_a", name: "alpha", projectPath: "/a" },
      ])
      .mockRejectedValueOnce(new Error("404 not found"));
    const out = await fetchProjectsRuntime({ port: 42000, token: "t" });
    expect(out[0]?.status).toBe("unknown");
  });
});
```

- [ ] **Step 2: Write the failing WS test**

```ts
// packages/cli/test/observation/ws.test.ts
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

class FakeSocket extends EventEmitter {
  sent: string[] = [];
  readyState = 1;
  send(m: string): void {
    this.sent.push(m);
  }
  close(): void {
    this.emit("close");
  }
}

vi.mock("ws", () => ({
  default: class {
    constructor() {
      const s = new FakeSocket();
      setTimeout(() => s.emit("open"), 0);
      return s as unknown as never;
    }
  },
}));

import { openSubscription } from "../../src/observation/ws.js";

describe("openSubscription", () => {
  it("sends a subscribe frame on open with { all: true }", async () => {
    const sub = await openSubscription({ port: 42000, token: "t" }, { all: true });
    expect(sub).toBeDefined();
    // The internal socket is exposed for tests via _socket.
    const socket = (sub as unknown as { _socket: FakeSocket })._socket;
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({ type: "subscribe", all: true });
    sub.close();
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `pnpm --filter @loomflo/cli test -- observation/api observation/ws`

- [ ] **Step 4: Implement `api.ts`**

```ts
// packages/cli/src/observation/api.ts
import { httpGet, type DaemonInfo } from "../client.js";

export interface ProjectRuntimeRow {
  id: string;
  name: string;
  projectPath: string;
  status: "running" | "idle" | "blocked" | "failed" | "completed" | "unknown";
  currentNodeId: string | null;
  nodeCount: number;
  cost: number;
  uptimeSec: number | null;
}

interface ProjectRow {
  id: string;
  name: string;
  projectPath: string;
}

interface WorkflowSnapshot {
  status: ProjectRuntimeRow["status"];
  graph: { topology: string[] };
  totalCost: number;
  startedAt: string | null;
  currentNodeId?: string | null;
}

export async function fetchProjectsRuntime(daemon: DaemonInfo): Promise<ProjectRuntimeRow[]> {
  const projects = (await httpGet<ProjectRow[]>("/projects", daemon)) ?? [];
  const runtime = await Promise.all(projects.map(async (p) => toRuntime(p, daemon)));
  return runtime;
}

async function toRuntime(p: ProjectRow, daemon: DaemonInfo): Promise<ProjectRuntimeRow> {
  try {
    const wf = await httpGet<WorkflowSnapshot>(`/projects/${p.id}/workflow`, daemon);
    const uptimeSec =
      wf.startedAt !== null ? Math.max(0, Math.floor((Date.now() - new Date(wf.startedAt).getTime()) / 1000)) : null;
    return {
      id: p.id,
      name: p.name,
      projectPath: p.projectPath,
      status: wf.status,
      currentNodeId: wf.currentNodeId ?? null,
      nodeCount: wf.graph.topology.length,
      cost: wf.totalCost,
      uptimeSec,
    };
  } catch {
    return {
      id: p.id,
      name: p.name,
      projectPath: p.projectPath,
      status: "unknown",
      currentNodeId: null,
      nodeCount: 0,
      cost: 0,
      uptimeSec: null,
    };
  }
}
```

(`httpGet` is assumed to exist in `client.ts`; if not, add a thin wrapper around `fetch` that injects the daemon token header.)

- [ ] **Step 5: Implement `ws.ts`**

```ts
// packages/cli/src/observation/ws.ts
import WebSocket from "ws";

import type { DaemonInfo } from "../client.js";

export type SubscribeSpec = { all: true } | { projectIds: string[] };

export interface Subscription {
  onMessage(cb: (frame: Record<string, unknown>) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export async function openSubscription(daemon: DaemonInfo, spec: SubscribeSpec): Promise<Subscription> {
  const url = `ws://127.0.0.1:${String(daemon.port)}/ws?token=${encodeURIComponent(daemon.token)}`;
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });

  socket.send(JSON.stringify({ type: "subscribe", ...spec }));

  const api: Subscription & { _socket: unknown } = {
    onMessage: (cb) => {
      socket.on("message", (raw) => {
        try {
          cb(JSON.parse(raw.toString()) as Record<string, unknown>);
        } catch {
          /* ignore non-JSON */
        }
      });
    },
    onClose: (cb) => {
      socket.on("close", cb);
    },
    close: () => socket.close(),
    _socket: socket,
  };
  return api;
}
```

- [ ] **Step 6: Run tests + pass**

Run: `pnpm --filter @loomflo/cli test -- observation`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/observation/ packages/cli/test/observation/
git commit -m "feat(cli): observation api + ws subscription helpers (T1)"
```

---

# Phase B — Commands

## Task 2: `loomflo ps`

**Files:**
- Create: `packages/cli/src/commands/ps.ts`
- Test: `packages/cli/test/commands/ps.test.ts`
- Modify: `packages/cli/src/index.ts` (register)

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/ps.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/observation/api.js", () => ({
  fetchProjectsRuntime: vi.fn().mockResolvedValue([
    { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", nodeCount: 5, cost: 0.42, uptimeSec: 134 },
    { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, nodeCount: 0, cost: 0, uptimeSec: null },
  ]),
}));

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

describe("loomflo ps", () => {
  it("renders a themed table with NAME + STATUS + COST columns", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createPsCommand } = await import("../../src/commands/ps.js");
    await createPsCommand().parseAsync(["node", "ps"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("PROJECT");
    expect(plain).toContain("alpha");
    expect(plain).toContain("beta");
    expect(plain).toMatch(/\$0\.42/);
  });

  it("--json emits the full runtime array", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createPsCommand } = await import("../../src/commands/ps.js");
    await createPsCommand().parseAsync(["node", "ps", "--json"]);
    const parsed = JSON.parse(writes.join("").trim()) as unknown[];
    expect(parsed).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- commands/ps`

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/ps.ts
import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { fetchProjectsRuntime, type ProjectRuntimeRow } from "../observation/api.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { theme } from "../theme/index.js";

export function createPsCommand(): Command {
  const cmd = new Command("ps")
    .description("List all registered projects with runtime state")
    .action(async (opts: { json?: boolean }): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();
        const rows = await fetchProjectsRuntime(daemon);
        if (isJsonMode(opts)) {
          writeJson(rows);
          return;
        }
        process.stdout.write(`${renderPsTable(rows)}\n`);
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_PS");
        process.exitCode = 1;
      }
    });
  return withJsonSupport(cmd);
}

function renderPsTable(rows: ProjectRuntimeRow[]): string {
  return theme.table(
    ["PROJECT", "ID", "STATUS", "NODE", "UPTIME", "COST"],
    rows,
    [
      { header: "PROJECT", get: (r) => r.name },
      { header: "ID", get: (r) => theme.dim(r.id) },
      { header: "STATUS", get: (r) => statusCell(r.status) },
      { header: "NODE", get: (r) => (r.currentNodeId ? `${r.currentNodeId}` : "—") },
      { header: "UPTIME", get: (r) => formatUptime(r.uptimeSec) },
      { header: "COST", get: (r) => `$${r.cost.toFixed(2)}` },
    ],
  );
}

export function statusCell(s: ProjectRuntimeRow["status"]): string {
  if (s === "running") return `${theme.accent(theme.glyph.dot)} ${s}`;
  if (s === "blocked" || s === "failed") return `${theme.err(theme.glyph.dot)} ${s}`;
  if (s === "completed") return `${theme.accent("✓")} ${s}`;
  if (s === "unknown") return `${theme.warn(theme.glyph.dot)} ${s}`;
  return `${theme.dim(theme.glyph.dot)} ${s}`; // idle
}

export function formatUptime(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${String(s)}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(m)}m ${String(ss).padStart(2, "0")}s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h)}h ${String(m)}m`;
}
```

- [ ] **Step 4: Register in `index.ts`**

In `packages/cli/src/index.ts`, add:

```ts
import { createPsCommand } from "./commands/ps.js";
// …
program.addCommand(createPsCommand());
```

- [ ] **Step 5: Run tests + pass**

Run: `pnpm --filter @loomflo/cli test -- commands/ps`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/ps.ts packages/cli/test/commands/ps.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): loomflo ps — cross-project runtime table (T2)"
```

---

## Task 3: `loomflo nodes`

**Files:**
- Create: `packages/cli/src/commands/nodes.ts`
- Test: `packages/cli/test/commands/nodes.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/nodes.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
  httpGet: vi.fn().mockResolvedValue({
    nodes: [
      { id: "spec-01", title: "Define auth model", status: "completed", cost: 0.12, agentCount: 1, retryCount: 0, startedAt: "2026-04-15T00:00:00Z", completedAt: "2026-04-15T00:00:42Z" },
      { id: "impl-01", title: "auth-middleware",   status: "running",   cost: 0.26, agentCount: 2, retryCount: 1, startedAt: "2026-04-15T00:01:00Z", completedAt: null },
      { id: "impl-02", title: "session-store",     status: "pending",   cost: 0,    agentCount: 0, retryCount: 0, startedAt: null, completedAt: null },
    ],
  }),
}));

vi.mock("../../src/project.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({ id: "proj_x", name: "demo" }),
}));

describe("loomflo nodes", () => {
  it("renders the nodes table with TITLE + STATUS + DUR", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createNodesCommand } = await import("../../src/commands/nodes.js");
    await createNodesCommand().parseAsync(["node", "nodes"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("spec-01");
    expect(plain).toContain("impl-01");
    expect(plain).toContain("auth-middleware");
  });

  it("--json emits the raw nodes array", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createNodesCommand } = await import("../../src/commands/nodes.js");
    await createNodesCommand().parseAsync(["node", "nodes", "--json"]);
    const parsed = JSON.parse(writes.join("").trim()) as unknown[];
    expect(parsed).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/cli test -- commands/nodes`

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/nodes.ts
import { Command } from "commander";

import { httpGet, readDaemonConfig } from "../client.js";
import { resolveProject } from "../project.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { theme } from "../theme/index.js";
import { formatUptime } from "./ps.js";

interface NodeRow {
  id: string;
  title: string;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked";
  cost: number;
  agentCount: number;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

export function createNodesCommand(): Command {
  const cmd = new Command("nodes")
    .description("List nodes for a project")
    .option("--project <id>", "Override the project (defaults to cwd)")
    .option("--all", "Include completed + failed history", false)
    .action(async (opts: { project?: string; all?: boolean; json?: boolean }): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();
        const projectId = opts.project ?? (await resolveProject(process.cwd())).id;
        const body = await httpGet<{ nodes: NodeRow[] }>(`/projects/${projectId}/nodes`, daemon);

        let nodes = body.nodes;
        if (!opts.all) {
          nodes = nodes.filter((n) => n.status !== "completed" && n.status !== "failed");
        }

        if (isJsonMode(opts)) {
          writeJson(nodes);
          return;
        }

        process.stdout.write(`${renderNodesTable(nodes)}\n`);
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_NODES");
        process.exitCode = 1;
      }
    });
  return withJsonSupport(cmd);
}

function renderNodesTable(rows: NodeRow[]): string {
  return theme.table(
    ["ID", "TITLE", "STATUS", "DUR", "COST", "RETRIES"],
    rows,
    [
      { header: "ID", get: (r) => r.id },
      { header: "TITLE", get: (r) => r.title },
      { header: "STATUS", get: (r) => r.status },
      { header: "DUR", get: (r) => durationOf(r) },
      { header: "COST", get: (r) => `$${r.cost.toFixed(2)}` },
      { header: "RETRIES", get: (r) => (r.retryCount > 0 ? `${String(r.retryCount)}/3` : "0") },
    ],
  );
}

function durationOf(r: NodeRow): string {
  if (!r.startedAt) return "—";
  const end = r.completedAt ? new Date(r.completedAt).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((end - new Date(r.startedAt).getTime()) / 1000));
  return formatUptime(sec);
}
```

- [ ] **Step 4: Register + pass test**

Add to `index.ts`: `program.addCommand(createNodesCommand());`.

Run: `pnpm --filter @loomflo/cli test -- commands/nodes`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/nodes.ts packages/cli/test/commands/nodes.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): loomflo nodes — per-project node table with --all (T3)"
```

---

## Task 4: `loomflo inspect <nodeId>`

**Files:**
- Create: `packages/cli/src/commands/inspect.ts`
- Test: `packages/cli/test/commands/inspect.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/inspect.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
  httpGet: vi.fn().mockResolvedValue({
    id: "impl-01",
    title: "auth-middleware",
    status: "running",
    agents: [
      { id: "a1", role: "loomex", status: "running", tokens: 4321 },
      { id: "a2", role: "reviewer", status: "idle", tokens: 0 },
    ],
    fileOwnership: ["src/auth/middleware.ts"],
    retryCount: 1,
    maxRetries: 3,
    reviewReport: null,
    cost: 0.26,
    startedAt: "2026-04-15T00:01:00Z",
    completedAt: null,
  }),
}));

vi.mock("../../src/project.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({ id: "proj_x", name: "demo" }),
}));

describe("loomflo inspect", () => {
  it("renders a multi-section detail view", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createInspectCommand } = await import("../../src/commands/inspect.js");
    await createInspectCommand().parseAsync(["node", "inspect", "impl-01"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("impl-01");
    expect(plain).toContain("auth-middleware");
    expect(plain).toContain("Agents");
    expect(plain).toContain("loomex");
    expect(plain).toContain("Files");
    expect(plain).toContain("src/auth/middleware.ts");
  });

  it("--json emits the raw detail object", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createInspectCommand } = await import("../../src/commands/inspect.js");
    await createInspectCommand().parseAsync(["node", "inspect", "impl-01", "--json"]);
    const parsed = JSON.parse(writes.join("").trim()) as { id: string };
    expect(parsed.id).toBe("impl-01");
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/cli test -- commands/inspect`

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/inspect.ts
import { Command } from "commander";

import { httpGet, readDaemonConfig } from "../client.js";
import { resolveProject } from "../project.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { theme } from "../theme/index.js";

interface NodeDetail {
  id: string;
  title: string;
  status: string;
  agents: Array<{ id: string; role: string; status: string; tokens: number }>;
  fileOwnership: string[];
  retryCount: number;
  maxRetries: number;
  reviewReport: unknown;
  cost: number;
  startedAt: string | null;
  completedAt: string | null;
}

export function createInspectCommand(): Command {
  const cmd = new Command("inspect")
    .description("Show detailed information for a node")
    .argument("<nodeId>")
    .option("--project <id>", "Override the project (defaults to cwd)")
    .action(async (nodeId: string, opts: { project?: string; json?: boolean }): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();
        const projectId = opts.project ?? (await resolveProject(process.cwd())).id;
        const detail = await httpGet<NodeDetail>(`/projects/${projectId}/nodes/${nodeId}`, daemon);

        if (isJsonMode(opts)) {
          writeJson(detail);
          return;
        }

        renderDetail(detail);
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_INSPECT");
        process.exitCode = 1;
      }
    });
  return withJsonSupport(cmd);
}

function renderDetail(d: NodeDetail): void {
  const out: string[] = [];
  out.push(theme.heading(`${d.id}  —  ${d.title}`));
  out.push("");
  out.push(theme.kv("status", d.status));
  out.push(theme.kv("retries", `${String(d.retryCount)}/${String(d.maxRetries)}`));
  out.push(theme.kv("cost", `$${d.cost.toFixed(2)}`));
  out.push(theme.kv("startedAt", d.startedAt ?? "—"));
  out.push(theme.kv("completedAt", d.completedAt ?? "—"));
  out.push("");

  out.push(theme.muted("Agents"));
  for (const a of d.agents) {
    out.push(`  ${theme.accent(a.role)}  ${theme.dim(a.id)}  ${a.status}  ${theme.dim(`${String(a.tokens)} tok`)}`);
  }
  out.push("");

  out.push(theme.muted("Files"));
  for (const f of d.fileOwnership) {
    out.push(`  ${f}`);
  }
  out.push("");

  if (d.reviewReport !== null && typeof d.reviewReport === "object") {
    out.push(theme.muted("Review"));
    out.push(`  ${JSON.stringify(d.reviewReport, null, 2).split("\n").join("\n  ")}`);
  }
  process.stdout.write(`${out.join("\n")}\n`);
}
```

- [ ] **Step 4: Register + pass**

Add `program.addCommand(createInspectCommand());` in `index.ts`.
Run: `pnpm --filter @loomflo/cli test -- commands/inspect`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/inspect.ts packages/cli/test/commands/inspect.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): loomflo inspect — per-node detail view (T4)"
```

---

## Task 5: `loomflo tree` — ASCII DAG

**Files:**
- Create: `packages/cli/src/observation/tree.ts`
- Create: `packages/cli/src/commands/tree.ts`
- Test: `packages/cli/test/observation/tree.test.ts`
- Test: `packages/cli/test/commands/tree.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing renderer test**

```ts
// packages/cli/test/observation/tree.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { renderTree } from "../../src/observation/tree.js";

describe("renderTree", () => {
  it("renders a simple chain", () => {
    const graph = {
      nodes: {
        a: { id: "a", title: "root", status: "completed" },
        b: { id: "b", title: "mid",  status: "running"   },
        c: { id: "c", title: "leaf", status: "pending"   },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      topology: ["a", "b", "c"],
    };
    const out = stripAnsi(renderTree("demo", graph));
    expect(out).toContain("demo");
    expect(out).toContain("a  root");
    expect(out).toContain("├── b  mid");
    expect(out).toContain("    └── c  leaf");
  });

  it("renders a branching DAG with shared children only once per parent", () => {
    const graph = {
      nodes: {
        a: { id: "a", title: "r", status: "done" },
        b: { id: "b", title: "L", status: "done" },
        c: { id: "c", title: "R", status: "done" },
        d: { id: "d", title: "X", status: "pend" },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
      topology: ["a", "b", "c", "d"],
    };
    const out = stripAnsi(renderTree("demo", graph));
    expect(out.match(/X/g)?.length).toBe(2); // appears under b and under c
  });
});
```

- [ ] **Step 2: Implement renderer**

```ts
// packages/cli/src/observation/tree.ts
import { theme } from "../theme/index.js";

interface Node {
  id: string;
  title: string;
  status: string;
}

interface Graph {
  nodes: Record<string, Node>;
  edges: Array<{ from: string; to: string }>;
  topology: string[];
}

const UNICODE = { branch: "├── ", last: "└── ", vertical: "│   ", space: "    " };

export function renderTree(projectName: string, g: Graph): string {
  const children = new Map<string, string[]>();
  for (const e of g.edges) {
    const arr = children.get(e.from) ?? [];
    arr.push(e.to);
    children.set(e.from, arr);
  }
  const hasParent = new Set(g.edges.map((e) => e.to));
  const roots = g.topology.filter((id) => !hasParent.has(id));

  const lines: string[] = [theme.heading(projectName)];
  for (const root of roots) {
    walk(root, "", true, lines, g, children);
  }
  return lines.join("\n");
}

function walk(
  id: string,
  prefix: string,
  isLast: boolean,
  out: string[],
  g: Graph,
  children: Map<string, string[]>,
): void {
  const node = g.nodes[id];
  if (!node) return;
  const line = prefix === "" ? formatNode(node) : `${prefix}${isLast ? UNICODE.last : UNICODE.branch}${formatNode(node)}`;
  out.push(line);
  const kids = children.get(id) ?? [];
  const nextPrefix = prefix === "" ? "" : `${prefix}${isLast ? UNICODE.space : UNICODE.vertical}`;
  const childPrefix = prefix === "" ? UNICODE.space.slice(0, 0) : nextPrefix;
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i] as string;
    const last = i === kids.length - 1;
    walk(kid, prefix === "" ? UNICODE.space.slice(0, 0) : childPrefix, last, out, g, children);
  }
}

function formatNode(n: Node): string {
  const tone = n.status === "completed" || n.status === "done" ? "accent" : n.status === "failed" ? "err" : n.status === "running" ? "muted" : "dim";
  return `${theme.dim(n.id)}  ${(theme[tone] as (s: string) => string)(n.title)}  ${theme.dim(`[${n.status}]`)}`;
}
```

- [ ] **Step 3: Run renderer test + pass**

Run: `pnpm --filter @loomflo/cli test -- observation/tree`
Expected: PASS, 2 tests.

- [ ] **Step 4: Write the failing command test**

```ts
// packages/cli/test/commands/tree.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
  httpGet: vi.fn().mockResolvedValue({
    graph: {
      nodes: {
        a: { id: "a", title: "root", status: "completed" },
        b: { id: "b", title: "mid",  status: "running"   },
      },
      edges: [{ from: "a", to: "b" }],
      topology: ["a", "b"],
    },
  }),
}));

vi.mock("../../src/project.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({ id: "proj_x", name: "demo" }),
}));

describe("loomflo tree", () => {
  it("renders the ASCII graph", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createTreeCommand } = await import("../../src/commands/tree.js");
    await createTreeCommand().parseAsync(["node", "tree"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("a  root");
    expect(plain).toContain("└── b  mid");
  });
});
```

- [ ] **Step 5: Implement command**

```ts
// packages/cli/src/commands/tree.ts
import { Command } from "commander";

import { httpGet, readDaemonConfig } from "../client.js";
import { renderTree } from "../observation/tree.js";
import { resolveProject } from "../project.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";

export function createTreeCommand(): Command {
  const cmd = new Command("tree")
    .description("Print the workflow DAG for a project")
    .option("--project <id>", "Override the project (defaults to cwd)")
    .action(async (opts: { project?: string; json?: boolean }): Promise<void> => {
      try {
        const daemon = await readDaemonConfig();
        const project = opts.project
          ? { id: opts.project, name: opts.project }
          : await resolveProject(process.cwd());
        const wf = await httpGet<{ graph: Parameters<typeof renderTree>[1] }>(`/projects/${project.id}/workflow`, daemon);

        if (isJsonMode(opts)) {
          writeJson(wf.graph);
          return;
        }
        process.stdout.write(`${renderTree(project.name, wf.graph)}\n`);
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_TREE");
        process.exitCode = 1;
      }
    });
  return withJsonSupport(cmd);
}
```

Register in `index.ts`.

- [ ] **Step 6: Run + pass**

Run: `pnpm --filter @loomflo/cli test -- tree`
Expected: PASS, 3 tests (2 renderer + 1 command).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/observation/tree.ts packages/cli/src/commands/tree.ts packages/cli/test/observation/tree.test.ts packages/cli/test/commands/tree.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): loomflo tree — ASCII workflow DAG (T5)"
```

---

## Task 6: `loomflo watch [projectId]`

**Files:**
- Create: `packages/cli/src/commands/watch.ts`
- Test: `packages/cli/test/commands/watch.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/watch.test.ts
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

class FakeSubscription extends EventEmitter {
  closed = false;
  onMessage(cb: (m: Record<string, unknown>) => void): void {
    this.on("msg", cb);
  }
  onClose(cb: () => void): void {
    this.on("close", cb);
  }
  close(): void {
    this.closed = true;
    this.emit("close");
  }
}

vi.mock("../../src/observation/ws.js", () => {
  const sub = new FakeSubscription();
  return {
    openSubscription: vi.fn().mockResolvedValue(sub),
    __sub: sub,
  };
});

vi.mock("../../src/observation/api.js", () => ({
  fetchProjectsRuntime: vi.fn().mockResolvedValue([
    { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", nodeCount: 5, cost: 0.42, uptimeSec: 10 },
  ]),
}));

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

describe("loomflo watch (cross-project)", () => {
  it("writes an initial frame and unsubscribes on SIGINT", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });

    const { createWatchCommand } = await import("../../src/commands/watch.js");
    const ws = await import("../../src/observation/ws.js");
    const cmd = createWatchCommand();

    // Run and immediately request shutdown.
    const done = cmd.parseAsync(["node", "watch", "-n", "1"]);
    setTimeout(() => process.emit("SIGINT"), 10);
    await done;

    expect(writes.join("")).toContain("alpha");
    expect((ws as unknown as { __sub: FakeSubscription }).__sub.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/cli test -- commands/watch`

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/watch.ts
import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { fetchProjectsRuntime } from "../observation/api.js";
import { openSubscription } from "../observation/ws.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { theme } from "../theme/index.js";

import { formatUptime, statusCell } from "./ps.js";

export function createWatchCommand(): Command {
  const cmd = new Command("watch")
    .description("Auto-refresh runtime view (all projects or a single one)")
    .argument("[projectId]")
    .option("-n, --interval <seconds>", "Refresh interval in seconds", "2")
    .action(async (projectId: string | undefined, opts: { interval: string; json?: boolean }): Promise<void> => {
      const interval = Math.max(1, parseInt(opts.interval, 10) || 2);
      const daemon = await readDaemonConfig();

      let rows = await fetchProjectsRuntime(daemon);
      if (projectId) rows = rows.filter((r) => r.id === projectId);

      let dirty = true;
      const markDirty = (): void => {
        dirty = true;
      };

      let sub;
      try {
        sub = await openSubscription(
          daemon,
          projectId === undefined ? { all: true } : { projectIds: [projectId] },
        );
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_WATCH_WS");
        process.exitCode = 1;
        return;
      }

      sub.onMessage(() => markDirty());

      const timer = setInterval(async () => {
        if (!dirty) return;
        dirty = false;
        try {
          rows = await fetchProjectsRuntime(daemon);
          if (projectId) rows = rows.filter((r) => r.id === projectId);
          if (isJsonMode(opts)) {
            writeJson(rows);
            return;
          }
          clearScreen();
          process.stdout.write(`${renderFrame(rows, interval)}\n`);
        } catch {
          /* transient — try again on next tick */
        }
      }, interval * 1000);

      const cleanup = (): void => {
        clearInterval(timer);
        sub.close();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      // initial paint
      if (!isJsonMode(opts)) {
        clearScreen();
        process.stdout.write(`${renderFrame(rows, interval)}\n`);
      } else {
        writeJson(rows);
      }
    });
  return withJsonSupport(cmd);
}

function clearScreen(): void {
  process.stdout.write("\x1Bc");
}

function renderFrame(rows: import("../observation/api.js").ProjectRuntimeRow[], interval: number): string {
  const header = `${theme.accent("loomflo watch")}  ${theme.dim(`(every ${String(interval)}s — Ctrl-C to quit)`)}`;
  const table = theme.table(
    ["PROJECT", "STATUS", "NODE", "UPTIME", "COST"],
    rows,
    [
      { header: "PROJECT", get: (r) => r.name },
      { header: "STATUS", get: (r) => statusCell(r.status) },
      { header: "NODE", get: (r) => r.currentNodeId ?? "—" },
      { header: "UPTIME", get: (r) => formatUptime(r.uptimeSec) },
      { header: "COST", get: (r) => `$${r.cost.toFixed(2)}` },
    ],
  );
  return `${header}\n\n${table}`;
}
```

Register in `index.ts`.

- [ ] **Step 4: Run test**

Run: `pnpm --filter @loomflo/cli test -- commands/watch`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/watch.ts packages/cli/test/commands/watch.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): loomflo watch — live multi-project view via WS (T6)"
```

---

## Task 7: Re-enable `logs -f`

**Files:**
- Modify: `packages/cli/src/commands/logs.ts`
- Test: `packages/cli/test/commands/logs.follow.test.ts`

After S1 T13 the WebSocket is multiplexed. The `-f` flag that was stubbed in earlier iterations is now wired to a real subscription.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/logs.follow.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

class FakeSubscription extends EventEmitter {
  onMessage(cb: (m: Record<string, unknown>) => void): void {
    this.on("msg", cb);
  }
  onClose(cb: () => void): void {
    this.on("close", cb);
  }
  close(): void {
    this.emit("close");
  }
}

vi.mock("../../src/observation/ws.js", () => {
  const sub = new FakeSubscription();
  return {
    openSubscription: vi.fn().mockResolvedValue(sub),
    __sub: sub,
  };
});

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
}));

vi.mock("../../src/project.js", () => ({
  resolveProject: vi.fn().mockResolvedValue({ id: "proj_x", name: "demo" }),
}));

describe("loomflo logs -f", () => {
  it("streams events received over the subscription", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const ws = await import("../../src/observation/ws.js");
    const { createLogsCommand } = await import("../../src/commands/logs.js");
    const done = createLogsCommand().parseAsync(["node", "logs", "-f"]);

    setTimeout(() => {
      (ws as unknown as { __sub: FakeSubscription }).__sub.emit("msg", {
        projectId: "proj_x",
        type: "node_status",
        nodeId: "impl-01",
        timestamp: "2026-04-15T00:00:00Z",
        status: "running",
      });
    }, 5);
    setTimeout(() => process.emit("SIGINT"), 20);
    await done;

    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("node_status");
    expect(plain).toContain("impl-01");
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @loomflo/cli test -- commands/logs.follow`

- [ ] **Step 3: Modify `logs.ts`**

In `logs.ts`, the existing `-f` branch currently returns an "unsupported" error. Replace that branch with a subscription:

```ts
// … inside the command action, inside the if (opts.follow) branch:
import { openSubscription } from "../observation/ws.js";
import { renderEvent } from "./start.js"; // shared renderer from S3 T6

if (opts.follow) {
  const daemon = await readDaemonConfig();
  const project = await resolveProject(process.cwd());
  const sub = await openSubscription(daemon, { projectIds: [project.id] });
  const cleanup = (): void => {
    sub.close();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  sub.onMessage((frame) => {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(frame)}\n`);
      return;
    }
    process.stdout.write(`${renderEvent(frame as { type: string; timestamp: string; nodeId?: string })}\n`);
  });

  await new Promise<void>((resolve) => sub.onClose(() => resolve()));
  return;
}
```

- [ ] **Step 4: Run + pass**

Run: `pnpm --filter @loomflo/cli test -- commands/logs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/logs.ts packages/cli/test/commands/logs.follow.test.ts
git commit -m "feat(cli): loomflo logs -f — wire WS subscription (T7)"
```

---

# Phase C — Integration & docs

## Task 8: End-to-end integration behind `LOOMFLO_E2E=1`

**Files:**
- Modify: `tests/e2e/multi-project.e2e.test.ts` (extend)

Add a block to the existing E2E smoke test (from S1 T25) that exercises `ps`, `nodes`, and `tree` against the live daemon.

- [ ] **Step 1: Extend the test**

```ts
// tests/e2e/multi-project.e2e.test.ts (append)
describe("S4 observation — against a real daemon", () => {
  it("loomflo ps lists both projects with live cost + uptime", async () => {
    const out = await cli(["ps", "--json"]);
    const parsed = JSON.parse(out.stdout) as Array<{ id: string; status: string }>;
    expect(parsed).toHaveLength(2);
  });

  it("loomflo nodes returns at least one node for project A", async () => {
    const out = await cli(["nodes", "--project", projectAId, "--all", "--json"]);
    const parsed = JSON.parse(out.stdout) as unknown[];
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("loomflo tree prints a non-empty graph for project A", async () => {
    const out = await cli(["tree", "--project", projectAId]);
    expect(out.stdout).toContain(projectAId);
  });
});
```

(`cli(...)` and `projectAId` are assumed to already exist from S1's test harness; if not, replicate the harness pattern.)

- [ ] **Step 2: Run**

```bash
LOOMFLO_E2E=1 pnpm test:e2e -- multi-project
```

Expected: PASS on a machine where the daemon binary is built.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/multi-project.e2e.test.ts
git commit -m "test(e2e): exercise ps/nodes/tree against real daemon (T8)"
```

---

## Task 9: Verification + README/CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run full suite**

```bash
pnpm --filter @loomflo/cli test
pnpm --filter @loomflo/cli lint
pnpm --filter @loomflo/cli typecheck
pnpm --filter @loomflo/cli build
```

All green.

- [ ] **Step 2: README — Observation section**

Append:

```markdown
## Observing projects

- `loomflo ps` — table of every registered project: status, current node, uptime, cost
- `loomflo watch [projectId]` — same data, auto-refresh every 2s (configurable with `-n`)
- `loomflo logs -f [--project <id>]` — follow events via WebSocket
- `loomflo nodes [--project <id>] [--all]` — per-project node table
- `loomflo inspect <nodeId>` — detail view of a node (agents, files, review, cost)
- `loomflo tree [--project <id>]` — ASCII view of the workflow DAG

Every command supports `--json` for machine-readable output.
```

- [ ] **Step 3: CHANGELOG — 0.3.0 additions**

```markdown
### Added (S4)

- `loomflo ps` — list all registered projects with runtime state.
- `loomflo watch` — live auto-refresh of `ps` (or single-project nodes) via WebSocket subscribe.
- `loomflo nodes` / `loomflo inspect <id>` — per-project node table + detail.
- `loomflo tree` — ASCII workflow DAG.
- `loomflo logs -f` now streams events over WebSocket (previously stubbed).
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(cli): S4 observation commands — README + CHANGELOG (T9)"
```

---

# Final verification

- [ ] `pnpm --filter @loomflo/cli test` — green.
- [ ] `pnpm --filter @loomflo/cli lint` + `typecheck` — green.
- [ ] `LOOMFLO_E2E=1 pnpm test:e2e` — green.
- [ ] Manual smoke: 2 projects running, `loomflo watch` shows both live; pause one → its status flips to `idle` within 2 s; `logs -f` on project A streams events as the daemon emits them.
- [ ] PR:

```bash
gh pr create --title "S4: observation commands (v0.3.0)" \
  --body "$(cat <<'EOF'
## Summary

- Adds `ps`, `watch`, `nodes`, `inspect`, `tree` commands; unblocks `logs -f`.
- Reuses S1's multiplexed WS for live commands; all commands support `--json` / NDJSON.

Spec: `docs/superpowers/specs/2026-04-15-s4-observation-cli.md`
Depends on: S1 (merged), S3 (merged).

## Test plan

- [x] Unit tests
- [x] Integration test on the live daemon (`LOOMFLO_E2E=1`)
- [x] Manual: 2 projects, `watch` + `logs -f`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
