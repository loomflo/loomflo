# S1 — Multi-project daemon + auto-start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Loomflo daemon from mono-project to multi-project with auto-start, so `loomflo start` in any project directory does the right thing with zero daemon-awareness from the user.

**Architecture:** Daemon holds a `Map<projectId, ProjectRuntime>`; every API route is scoped under `/projects/:id/*`; CLI resolves the current project via `.loomflo/project.json` (walk-up) and auto-starts the daemon behind a file lock. Provider credentials live in `~/.loomflo/credentials.json` as named profiles referenced by each project.

**Tech Stack:** TypeScript 5.x strict, Node 20+, Fastify 5, @fastify/websocket, vitest, commander, zod, `proper-lockfile` (new dep for file lock).

**Spec:** `docs/superpowers/specs/2026-04-14-s1-multi-project-daemon.md`

---

## Conventions

- **Tests first.** Every task starts with a failing test, then minimal impl, then passing test, then commit.
- **Commit per task.** Message format: `feat(scope): summary (T<N>)` — e.g. `feat(core): add ProjectsRegistry (T1)`.
- **Paths are absolute from repo root**: `packages/core/src/...`, `packages/cli/src/...`, `tests/e2e/...`.
- **Run commands from repo root** unless stated otherwise. Per-package: `pnpm --filter @loomflo/core test`, `pnpm --filter @loomflo/cli test`.
- **No skipped tests.** If the test doesn't apply to a task, don't write it.
- **Exactly `- [ ]` checkboxes.** Never render done ones.
- **Version bump lives in Task 8.** Don't bump elsewhere.

## Task dependency graph

```
A: foundation (Tasks 1-4)  ─┐
                            ├──▶ B: daemon registry (5-7) ──┐
                                                            ├──▶ C: API routes (8-13) ──┐
                                                                                        ├──▶ D: CLI infra (14-15) ──┐
                                                                                                                    ├──▶ E: commands (16-20)
                                                                                                                    │
                                                                                                                    └──▶ F: integration & E2E (21-25)

                                                                                                                         G: docs (26)
```

Tasks are numbered but Phase B cannot start before Phase A is entirely done (B relies on the new types/persistence). Within each phase, tasks share files, so execute them in order.

---

# Phase A — Foundation: persistence & identity

## Task 1: ProjectsRegistry

**Files:**

- Create: `packages/core/src/persistence/projects.ts`
- Test: `packages/core/tests/unit/projects-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/projects-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectsRegistry, type ProjectEntry } from "../../src/persistence/projects.js";

describe("ProjectsRegistry", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-projects-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns empty list when file is absent", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    expect(await reg.list()).toEqual([]);
  });

  it("round-trips entries via upsert + list", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    const entry: ProjectEntry = {
      id: "proj_a1",
      name: "app",
      projectPath: "/tmp/app",
      providerProfileId: "default",
    };
    await reg.upsert(entry);
    expect(await reg.list()).toEqual([entry]);
  });

  it("overwrites an existing entry with the same id", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    await reg.upsert({
      id: "proj_a1",
      name: "v1",
      projectPath: "/a",
      providerProfileId: "default",
    });
    await reg.upsert({
      id: "proj_a1",
      name: "v2",
      projectPath: "/a",
      providerProfileId: "default",
    });
    const list = await reg.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("v2");
  });

  it("removes an entry by id", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    await reg.upsert({ id: "proj_a1", name: "a", projectPath: "/a", providerProfileId: "default" });
    await reg.upsert({ id: "proj_b2", name: "b", projectPath: "/b", providerProfileId: "default" });
    await reg.remove("proj_a1");
    const list = await reg.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("proj_b2");
  });

  it("recovers from a corrupt file by renaming it and starting empty", async () => {
    const path = join(tmp, "projects.json");
    await writeFile(path, "{not json");
    const reg = new ProjectsRegistry(path);
    expect(await reg.list()).toEqual([]);
    const raw = await readFile(path, "utf-8").catch(() => null);
    // new empty array persisted
    expect(raw).toBe("[]");
  });

  it("writes 0600 permissions", async () => {
    const reg = new ProjectsRegistry(join(tmp, "projects.json"));
    await reg.upsert({
      id: "proj_a1",
      name: "app",
      projectPath: "/a",
      providerProfileId: "default",
    });
    const { stat } = await import("node:fs/promises");
    const s = await stat(join(tmp, "projects.json"));
    // 0o600 = owner read/write only
    expect(s.mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm --filter @loomflo/core test projects-registry
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/persistence/projects.ts
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

/** One registered project known to the daemon. */
export interface ProjectEntry {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
}

/** File mode for the registry file — owner read/write only. */
const REGISTRY_MODE = 0o600;

/** Read / write `~/.loomflo/projects.json` atomically, tolerant of corruption. */
export class ProjectsRegistry {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ProjectEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ProjectEntry[];
      throw new Error("projects.json is not an array");
    } catch {
      // Corrupt — quarantine and start empty.
      const quarantine = `${this.filePath}.corrupt.${Date.now()}`;
      await rename(this.filePath, quarantine).catch(() => undefined);
      await this.writeRaw([]);
      return [];
    }
  }

  async upsert(entry: ProjectEntry): Promise<void> {
    const list = await this.list();
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx === -1) list.push(entry);
    else list[idx] = entry;
    await this.writeRaw(list);
  }

  async remove(id: string): Promise<void> {
    const list = await this.list();
    const filtered = list.filter((e) => e.id !== id);
    await this.writeRaw(filtered);
  }

  async get(id: string): Promise<ProjectEntry | null> {
    const list = await this.list();
    return list.find((e) => e.id === id) ?? null;
  }

  private async writeRaw(list: ProjectEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(list, null, 2), { mode: REGISTRY_MODE });
    await rename(tmp, this.filePath);
    // ensure mode even if the file pre-existed with different mode
    await chmod(this.filePath, REGISTRY_MODE);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```
pnpm --filter @loomflo/core test projects-registry
```

Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/persistence/projects.ts packages/core/tests/unit/projects-registry.test.ts
git commit -m "feat(core): add ProjectsRegistry — atomic read/write of ~/.loomflo/projects.json (T1)"
```

---

## Task 2: ProviderProfiles store

**Files:**

- Create: `packages/core/src/providers/profiles.ts`
- Test: `packages/core/tests/unit/provider-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/provider-profiles.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderProfiles, type ProviderProfile } from "../../src/providers/profiles.js";

describe("ProviderProfiles", () => {
  let tmp: string;
  let file: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-profiles-"));
    file = join(tmp, "credentials.json");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns empty object when file is absent", async () => {
    const p = new ProviderProfiles(file);
    expect(await p.list()).toEqual({});
  });

  it("upserts and retrieves a profile", async () => {
    const p = new ProviderProfiles(file);
    const prof: ProviderProfile = { type: "openai", apiKey: "sk-x", defaultModel: "gpt-4" };
    await p.upsert("openai-personal", prof);
    expect(await p.get("openai-personal")).toEqual(prof);
  });

  it("removes a profile", async () => {
    const p = new ProviderProfiles(file);
    await p.upsert("a", { type: "openai", apiKey: "x" });
    await p.upsert("b", { type: "openai", apiKey: "y" });
    await p.remove("a");
    expect(await p.get("a")).toBeNull();
    expect(await p.get("b")).not.toBeNull();
  });

  it("writes 0600 permissions", async () => {
    const p = new ProviderProfiles(file);
    await p.upsert("a", { type: "openai", apiKey: "x" });
    const s = await stat(file);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("recovers from corrupt JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "not json at all");
    const p = new ProviderProfiles(file);
    expect(await p.list()).toEqual({});
    const raw = await readFile(file, "utf-8");
    expect(JSON.parse(raw)).toEqual({ profiles: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter @loomflo/core test provider-profiles
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/providers/profiles.ts
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A named bundle of provider credentials. */
export type ProviderProfile =
  | { type: "anthropic-oauth" }
  | { type: "anthropic"; apiKey: string }
  | { type: "openai"; apiKey: string; baseUrl?: string; defaultModel?: string }
  | { type: "moonshot"; apiKey: string; baseUrl?: string; defaultModel?: string }
  | { type: "nvidia"; apiKey: string; baseUrl?: string; defaultModel?: string };

interface CredentialsFile {
  profiles: Record<string, ProviderProfile>;
}

const FILE_MODE = 0o600;

/** Read / write `~/.loomflo/credentials.json` with atomic writes and 0600 perms. */
export class ProviderProfiles {
  constructor(private readonly filePath: string) {}

  async list(): Promise<Record<string, ProviderProfile>> {
    const file = await this.read();
    return file.profiles;
  }

  async get(name: string): Promise<ProviderProfile | null> {
    const file = await this.read();
    return file.profiles[name] ?? null;
  }

  async upsert(name: string, profile: ProviderProfile): Promise<void> {
    const file = await this.read();
    file.profiles[name] = profile;
    await this.writeRaw(file);
  }

  async remove(name: string): Promise<void> {
    const file = await this.read();
    delete file.profiles[name];
    await this.writeRaw(file);
  }

  private async read(): Promise<CredentialsFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} };
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "profiles" in parsed &&
        typeof (parsed as CredentialsFile).profiles === "object"
      ) {
        return parsed as CredentialsFile;
      }
    } catch {
      /* fall through */
    }
    // Corrupt — quarantine and start empty.
    const quarantine = `${this.filePath}.corrupt.${Date.now()}`;
    await rename(this.filePath, quarantine).catch(() => undefined);
    const empty: CredentialsFile = { profiles: {} };
    await this.writeRaw(empty);
    return empty;
  }

  private async writeRaw(file: CredentialsFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: FILE_MODE });
    await rename(tmp, this.filePath);
    await chmod(this.filePath, FILE_MODE);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm --filter @loomflo/core test provider-profiles
```

Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/profiles.ts packages/core/tests/unit/provider-profiles.test.ts
git commit -m "feat(core): add ProviderProfiles store for ~/.loomflo/credentials.json (T2)"
```

---

## Task 3: Project identity helper

**Files:**

- Create: `packages/core/src/persistence/project-identity.ts`
- Test: `packages/core/tests/unit/project-identity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/project-identity.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readProjectIdentity,
  createProjectIdentity,
  ensureProjectIdentity,
  generateProjectId,
} from "../../src/persistence/project-identity.js";

describe("project-identity", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-ident-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("generateProjectId returns 'proj_<8 hex>'", () => {
    const id = generateProjectId();
    expect(id).toMatch(/^proj_[0-9a-f]{8}$/);
  });

  it("createProjectIdentity writes .loomflo/project.json with the expected shape", async () => {
    const ident = await createProjectIdentity(tmp, { name: "my-app" });
    expect(ident.id).toMatch(/^proj_[0-9a-f]{8}$/);
    expect(ident.name).toBe("my-app");
    expect(ident.providerProfileId).toBe("default");
    expect(ident.createdAt).toBeDefined();

    const raw = await readFile(join(tmp, ".loomflo", "project.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(ident);
  });

  it("createProjectIdentity defaults name to directory basename", async () => {
    const ident = await createProjectIdentity(tmp);
    expect(ident.name).toBe(tmp.split("/").pop());
  });

  it("readProjectIdentity finds the file by walking up", async () => {
    const ident = await createProjectIdentity(tmp, { name: "walkup" });
    const nested = join(tmp, "src", "deep", "nested");
    await mkdir(nested, { recursive: true });
    const found = await readProjectIdentity(nested);
    expect(found).toEqual(ident);
  });

  it("readProjectIdentity returns null when no project.json exists up-tree", async () => {
    const found = await readProjectIdentity(tmp);
    expect(found).toBeNull();
  });

  it("ensureProjectIdentity creates when absent and returns existing when present", async () => {
    const first = await ensureProjectIdentity(tmp, { name: "ensure" });
    const second = await ensureProjectIdentity(tmp);
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("ensure");
  });

  it("ensureProjectIdentity migrates a legacy layout (state.json without project.json)", async () => {
    // Seed legacy layout
    await mkdir(join(tmp, ".loomflo"), { recursive: true });
    await writeFile(
      join(tmp, ".loomflo", "state.json"),
      JSON.stringify({ id: "wf_old", status: "running" }),
    );
    const ident = await ensureProjectIdentity(tmp);
    expect(ident.id).toMatch(/^proj_[0-9a-f]{8}$/);
    expect(ident.name).toBe(tmp.split("/").pop());
    // project.json is now created
    const raw = await readFile(join(tmp, ".loomflo", "project.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(ident);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter @loomflo/core test project-identity
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/persistence/project-identity.ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, parse } from "node:path";

/** Stable identity of a project on this machine. */
export interface ProjectIdentity {
  id: string;
  name: string;
  providerProfileId: string;
  createdAt: string;
}

/** Generate a new project id of the form `proj_<8 hex>`. */
export function generateProjectId(): string {
  return `proj_${randomBytes(4).toString("hex")}`;
}

/** Read `.loomflo/project.json` walking up from `dir`. Returns `null` if not found. */
export async function readProjectIdentity(dir: string): Promise<ProjectIdentity | null> {
  const root = parse(dir).root;
  let current = dir;
  while (true) {
    const candidate = join(current, ".loomflo", "project.json");
    try {
      const raw = await readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (isIdentity(parsed)) return parsed;
    } catch {
      /* not this level */
    }
    if (current === root) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Create a fresh identity and write `.loomflo/project.json` in `dir`. */
export async function createProjectIdentity(
  dir: string,
  options?: { name?: string; providerProfileId?: string },
): Promise<ProjectIdentity> {
  const ident: ProjectIdentity = {
    id: generateProjectId(),
    name: options?.name ?? basename(dir),
    providerProfileId: options?.providerProfileId ?? "default",
    createdAt: new Date().toISOString(),
  };
  const outDir = join(dir, ".loomflo");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "project.json"), JSON.stringify(ident, null, 2));
  return ident;
}

/** Return existing identity at `dir`, or create one (migrating legacy layouts transparently). */
export async function ensureProjectIdentity(
  dir: string,
  options?: { name?: string; providerProfileId?: string },
): Promise<ProjectIdentity> {
  const existing = await readProjectIdentity(dir);
  if (existing) return existing;

  // Detect legacy layout (state.json present, project.json absent)
  const legacyState = join(dir, ".loomflo", "state.json");
  const legacy = await stat(legacyState)
    .then(() => true)
    .catch(() => false);
  if (legacy) {
    // Log a breadcrumb to stderr so CLI callers can notice — CLI layer decides UX.
    console.warn(`[loomflo] migrating legacy project at ${dir} to multi-project layout`);
  }

  return await createProjectIdentity(dir, options);
}

function isIdentity(value: unknown): value is ProjectIdentity {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.providerProfileId === "string" &&
    typeof v.createdAt === "string"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm --filter @loomflo/core test project-identity
```

Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/persistence/project-identity.ts packages/core/tests/unit/project-identity.test.ts
git commit -m "feat(core): add project identity helper — read/create/migrate .loomflo/project.json (T3)"
```

---

## Task 4: File lock utility

**Files:**

- Modify: `packages/core/package.json` (add dep `proper-lockfile`)
- Create: `packages/core/src/persistence/file-lock.ts`
- Test: `packages/core/tests/unit/file-lock.test.ts`

- [ ] **Step 1: Add the dependency**

Run from repo root:

```
pnpm --filter @loomflo/core add proper-lockfile@^4
pnpm --filter @loomflo/core add -D @types/proper-lockfile@^4
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/core/tests/unit/file-lock.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock, FileLockTimeoutError } from "../../src/persistence/file-lock.js";

describe("withFileLock", () => {
  let tmp: string;
  let lockFile: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-lock-"));
    lockFile = join(tmp, "daemon.lock");
    await writeFile(lockFile, "");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("runs the critical section and returns its value", async () => {
    const result = await withFileLock(lockFile, async () => 42, { timeoutMs: 1000 });
    expect(result).toBe(42);
  });

  it("serialises two concurrent critical sections", async () => {
    const log: string[] = [];
    const p1 = withFileLock(
      lockFile,
      async () => {
        log.push("p1:start");
        await new Promise((r) => setTimeout(r, 30));
        log.push("p1:end");
        return "a";
      },
      { timeoutMs: 2000 },
    );
    const p2 = withFileLock(
      lockFile,
      async () => {
        log.push("p2:start");
        await new Promise((r) => setTimeout(r, 10));
        log.push("p2:end");
        return "b";
      },
      { timeoutMs: 2000 },
    );
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe("a");
    expect(b).toBe("b");
    // p2 must start after p1 ended (or vice versa) — strict ordering
    const p1Start = log.indexOf("p1:start");
    const p1End = log.indexOf("p1:end");
    const p2Start = log.indexOf("p2:start");
    const p2End = log.indexOf("p2:end");
    expect(p1End).toBeLessThan(p2Start);
    expect(p2End).toBeGreaterThan(p1End);
  });

  it("throws FileLockTimeoutError when the lock cannot be acquired in time", async () => {
    // Holder keeps the lock for 500ms
    const holder = withFileLock(
      lockFile,
      async () => {
        await new Promise((r) => setTimeout(r, 500));
      },
      { timeoutMs: 2000 },
    );
    // Second attempt with 50ms timeout should fail.
    await expect(withFileLock(lockFile, async () => 1, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      FileLockTimeoutError,
    );
    await holder; // cleanup
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```
pnpm --filter @loomflo/core test file-lock
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/persistence/file-lock.ts
import lockfile from "proper-lockfile";

/** Thrown when the lock cannot be acquired within the configured timeout. */
export class FileLockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Could not acquire file lock on ${path} within ${timeoutMs}ms`);
    this.name = "FileLockTimeoutError";
  }
}

/** Options for {@link withFileLock}. */
export interface WithFileLockOptions {
  /** Maximum time to wait for the lock (milliseconds). */
  timeoutMs: number;
  /** Interval between retry attempts (milliseconds). Default: 50. */
  retryIntervalMs?: number;
}

/** Serialise a critical section behind an advisory file lock. */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: WithFileLockOptions,
): Promise<T> {
  const retryIntervalMs = options.retryIntervalMs ?? 50;
  const maxRetries = Math.max(1, Math.ceil(options.timeoutMs / retryIntervalMs));

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(filePath, {
      retries: {
        retries: maxRetries,
        minTimeout: retryIntervalMs,
        maxTimeout: retryIntervalMs,
      },
      stale: 10_000,
    });
  } catch (err) {
    if ((err as Error).message.includes("Lock file is already being held")) {
      throw new FileLockTimeoutError(filePath, options.timeoutMs);
    }
    throw err;
  }

  try {
    return await fn();
  } finally {
    if (release) await release().catch(() => undefined);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```
pnpm --filter @loomflo/core test file-lock
```

Expected: PASS — 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/src/persistence/file-lock.ts packages/core/tests/unit/file-lock.test.ts pnpm-lock.yaml
git commit -m "feat(core): add withFileLock utility using proper-lockfile (T4)"
```

---

# Phase B — Daemon registry

## Task 5: Define ProjectRuntime type

**Files:**

- Create: `packages/core/src/daemon-types.ts`
- Modify: `packages/core/src/index.ts` (re-export)

- [ ] **Step 1: Write the type module**

```typescript
// packages/core/src/daemon-types.ts
import type { CostTracker } from "./costs/tracker.js";
import type { MessageBus } from "./agents/message-bus.js";
import type { SharedMemoryManager } from "./memory/shared-memory.js";
import type { LLMProvider } from "./providers/base.js";
import type { Workflow } from "./types.js";
import type { LoomfloConfig } from "./config.js";

/** Per-project runtime state held in the daemon registry. */
export interface ProjectRuntime {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
  workflow: Workflow | null;
  provider: LLMProvider;
  config: LoomfloConfig;
  costTracker: CostTracker;
  messageBus: MessageBus;
  sharedMemory: SharedMemoryManager;
  startedAt: string;
  status: "idle" | "running" | "blocked" | "failed" | "completed";
}

/** Lightweight summary for `/projects` list responses. */
export interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
  status: ProjectRuntime["status"];
  startedAt: string;
}

/** Convert a ProjectRuntime into the public summary shape. */
export function toProjectSummary(rt: ProjectRuntime): ProjectSummary {
  return {
    id: rt.id,
    name: rt.name,
    projectPath: rt.projectPath,
    providerProfileId: rt.providerProfileId,
    status: rt.status,
    startedAt: rt.startedAt,
  };
}
```

- [ ] **Step 2: Re-export from index**

In `packages/core/src/index.ts`, add:

```typescript
export type { ProjectRuntime, ProjectSummary } from "./daemon-types.js";
export { toProjectSummary } from "./daemon-types.js";
```

- [ ] **Step 3: Compile check**

```
pnpm --filter @loomflo/core typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/daemon-types.ts packages/core/src/index.ts
git commit -m "feat(core): add ProjectRuntime + ProjectSummary types (T5)"
```

---

## Task 6: Refactor Daemon class for multi-project registry

**Files:**

- Modify: `packages/core/src/daemon.ts`
- Create: `packages/core/tests/unit/daemon-registry.test.ts`

Note: this task only refactors the internal state; routes are still legacy until Phase C. We verify by unit-testing the new registry methods. The existing integration tests will still pass because the legacy paths are kept temporarily — they're removed in Task 13.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/daemon-registry.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Daemon } from "../../src/daemon.js";

describe("Daemon registry", () => {
  let daemon: Daemon;

  beforeEach(() => {
    // The registry is in-memory and independent from server listen.
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
  });

  it("starts empty", () => {
    expect(daemon.listProjects()).toEqual([]);
  });

  it("upserts a project and returns it by id", () => {
    const rt = makeFakeRuntime("proj_a");
    daemon.upsertProject(rt);
    expect(daemon.getProject("proj_a")?.id).toBe("proj_a");
  });

  it("lists all projects as summaries", () => {
    daemon.upsertProject(makeFakeRuntime("proj_a"));
    daemon.upsertProject(makeFakeRuntime("proj_b"));
    const list = daemon.listProjects();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id).sort()).toEqual(["proj_a", "proj_b"]);
  });

  it("removes a project by id", () => {
    daemon.upsertProject(makeFakeRuntime("proj_a"));
    daemon.upsertProject(makeFakeRuntime("proj_b"));
    expect(daemon.removeProject("proj_a")).toBe(true);
    expect(daemon.getProject("proj_a")).toBeNull();
    expect(daemon.listProjects()).toHaveLength(1);
  });

  it("returns false when removing an unknown id", () => {
    expect(daemon.removeProject("nope")).toBe(false);
  });

  function makeFakeRuntime(id: string) {
    return {
      id,
      name: id,
      projectPath: `/tmp/${id}`,
      providerProfileId: "default",
      workflow: null,
      // provider / trackers are not exercised here — cast through unknown.
      provider: {} as never,
      config: {} as never,
      costTracker: {} as never,
      messageBus: {} as never,
      sharedMemory: {} as never,
      startedAt: new Date().toISOString(),
      status: "idle" as const,
    };
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter @loomflo/core test daemon-registry
```

Expected: FAIL — `upsertProject`, `listProjects`, `getProject`, `removeProject` not defined on `Daemon`.

- [ ] **Step 3: Add the registry methods to Daemon**

In `packages/core/src/daemon.ts`, inside the `Daemon` class (alongside existing fields), add:

```typescript
import type { ProjectRuntime, ProjectSummary } from "./daemon-types.js";
import { toProjectSummary } from "./daemon-types.js";

// ... inside `class Daemon`:
  private readonly projects: Map<string, ProjectRuntime> = new Map();

  /** Register or replace a project runtime. */
  upsertProject(rt: ProjectRuntime): void {
    this.projects.set(rt.id, rt);
  }

  /** Return the runtime for a given id, or null. */
  getProject(id: string): ProjectRuntime | null {
    return this.projects.get(id) ?? null;
  }

  /** List all registered projects as summaries. */
  listProjects(): ProjectSummary[] {
    return [...this.projects.values()].map(toProjectSummary);
  }

  /** Remove a project by id. Returns true if removed, false if absent. */
  removeProject(id: string): boolean {
    return this.projects.delete(id);
  }

  /** Internal: return the full map (for per-project shutdown iteration). */
  protected getAllRuntimes(): ProjectRuntime[] {
    return [...this.projects.values()];
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```
pnpm --filter @loomflo/core test daemon-registry
```

Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/daemon.ts packages/core/tests/unit/daemon-registry.test.ts
git commit -m "feat(core): add in-memory project registry to Daemon (T6)"
```

---

## Task 7: Refactor graceful shutdown to iterate all projects

**Files:**

- Modify: `packages/core/src/daemon.ts`

- [ ] **Step 1: Update the shutdown hook interface**

In `packages/core/src/daemon.ts`, change `ShutdownHooks` so each hook takes a `projectId`:

```typescript
export interface ShutdownHooks {
  /** Stop dispatching new LLM calls for a given project. */
  stopDispatching: (projectId: string) => void;
  /** Wait for in-flight LLM calls to drain for a given project. */
  waitForActiveCalls: (projectId: string) => Promise<void>;
  /** Mark running nodes as interrupted; return their IDs. */
  markNodesInterrupted: (projectId: string) => string[];
}
```

Note: `getWorkflow` moves into `ProjectRuntime.workflow`, so it's no longer in the hook.

- [ ] **Step 2: Rewrite `gracefulShutdown`**

Replace the body of `Daemon.gracefulShutdown()` with:

```typescript
async gracefulShutdown(timeoutMs: number = GRACEFUL_SHUTDOWN_TIMEOUT_MS): Promise<void> {
  if (this.shuttingDown) return;
  this.shuttingDown = true;

  const runtimes = this.getAllRuntimes();

  if (this.shutdownHooks === null && runtimes.length === 0) {
    await this.stop();
    return;
  }

  // Shut down all projects in parallel.
  await Promise.all(runtimes.map((rt) => this.shutdownOneProject(rt, timeoutMs)));

  await flushPendingWrites();
  if (this.server) {
    await this.server.close();
    this.server = null;
  }
  await removeDaemonFile();
  this.info = null;
  this.shuttingDown = false;
}

private async shutdownOneProject(
  rt: ProjectRuntime,
  timeoutMs: number,
): Promise<void> {
  const hooks = this.shutdownHooks;
  if (!hooks) return;

  hooks.stopDispatching(rt.id);

  try {
    await Promise.race([
      hooks.waitForActiveCalls(rt.id),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    /* proceed regardless */
  }

  const interruptedNodeIds = hooks.markNodesInterrupted(rt.id);

  if (rt.workflow !== null) {
    for (const nodeId of interruptedNodeIds) {
      const event = createEvent({
        type: "node_failed",
        workflowId: rt.workflow.id,
        nodeId,
        details: { reason: "daemon_shutdown", interrupted: true },
      });
      await appendEvent(rt.projectPath, event);
    }
    await saveWorkflowStateImmediate(rt.projectPath, rt.workflow);
  }
}
```

- [ ] **Step 3: Compile check**

```
pnpm --filter @loomflo/core typecheck
```

The typecheck will fail in places where `ShutdownHooks` is used with the old (no-arg) signature. Those call sites will be rewired in Phase C. For now, add temporary guards: any code in `daemon.ts` calling the hooks with the old signature should be updated to pass a `projectId` (use `""` as a placeholder inside the file if necessary — it will be cleaned up in Task 10 when the route wiring takes over).

Run again:

```
pnpm --filter @loomflo/core typecheck
```

Expected: PASS for `daemon.ts`. Other packages may still fail; those are fixed later.

- [ ] **Step 4: Run unit tests**

```
pnpm --filter @loomflo/core test daemon-registry
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/daemon.ts
git commit -m "refactor(core): per-project graceful shutdown, parallel over all registered projects (T7)"
```

---

# Phase C — Scoped API routes

## Task 8: Bump version to 0.2.0

**Files:**

- Modify: `packages/core/src/api/server.ts:20` (VERSION)
- Modify: `packages/core/src/api/routes/health.ts:45` (VERSION)
- Modify: `packages/cli/src/index.ts:29` (program.version)
- Modify: `packages/core/package.json` (version)
- Modify: `packages/cli/package.json` (version)
- Modify: `packages/sdk/package.json` (version)
- Modify: `packages/dashboard/package.json` (version)
- Modify: root `package.json` (version)
- Modify: `packages/sdk/tests/unit/client.test.ts:270` (expect 0.2.0)
- Modify: `packages/core/tests/unit/api.test.ts:191` (expect 0.2.0)

- [ ] **Step 1: Update all VERSION constants and package manifests**

Search and replace `"0.1.0"` with `"0.2.0"` across the files listed above. Verify no unintended hits by listing first:

```bash
grep -rn '"0\.1\.0"' packages/ package.json
```

Then edit each file. Do not use `sed -i` across all files blindly; edit deliberately.

- [ ] **Step 2: Run all tests**

```
pnpm test
```

Expected: PASS — version assertions updated.

- [ ] **Step 3: Commit**

```bash
git add -u packages/ package.json
git commit -m "chore: bump version 0.1.0 -> 0.2.0 (T8)"
```

---

## Task 9: Add daemon.json version field + /daemon/status route

**Files:**

- Modify: `packages/core/src/daemon.ts` (writeDaemonFile includes version)
- Modify: `packages/cli/src/commands/start.ts` (DaemonInfo interface gains `version`)
- Create: `packages/core/src/api/routes/daemon.ts`
- Modify: `packages/core/src/api/server.ts` (register daemon route)
- Create: `packages/core/tests/unit/daemon-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/daemon-route.test.ts
import { describe, it, expect } from "vitest";
import { createServer } from "../../src/api/server.js";

describe("GET /daemon/status", () => {
  it("returns port, pid, version, uptimeMs and projectCount", async () => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath: null,
      listProjects: () => [],
      getRuntime: () => null,
      daemonPort: 3123,
      health: { getUptime: () => 42, getWorkflow: () => null },
      workflow: {
        getWorkflow: () => null,
        setWorkflow: () => undefined,
        getProvider: () => {
          throw new Error("no provider");
        },
        getEventLog: () => ({ append: async () => undefined, query: async () => [] }),
        getSharedMemory: () => ({}) as never,
        getCostTracker: () => ({}) as never,
      },
      events: { getProjectPath: () => "/tmp" },
      onShutdown: () => undefined,
    });
    const res = await server.inject({
      method: "GET",
      url: "/daemon/status",
      headers: { authorization: "Bearer t" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.port).toBe(3123);
    expect(body.version).toBe("0.2.0");
    expect(body.projectCount).toBe(0);
    expect(typeof body.uptimeMs).toBe("number");
    expect(typeof body.pid).toBe("number");
    await server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter @loomflo/core test daemon-route
```

Expected: FAIL — `/daemon/status` not defined, and `ServerOptions` missing `listProjects`/`daemonPort`.

- [ ] **Step 3: Write the daemon route plugin**

```typescript
// packages/core/src/api/routes/daemon.ts
import type { FastifyPluginAsync } from "fastify";
import type { ProjectSummary } from "../../daemon-types.js";

const VERSION = "0.2.0";

export interface DaemonRoutesOptions {
  listProjects: () => ProjectSummary[];
  daemonPort: number;
  startedAtMs: number;
}

export const daemonRoutes: FastifyPluginAsync<DaemonRoutesOptions> = async (app, opts) => {
  app.get("/daemon/status", async (_req, reply) => {
    return reply.send({
      port: opts.daemonPort,
      pid: process.pid,
      version: VERSION,
      uptimeMs: Date.now() - opts.startedAtMs,
      projectCount: opts.listProjects().length,
    });
  });
};
```

- [ ] **Step 4: Extend ServerOptions and register the plugin**

In `packages/core/src/api/server.ts`:

```typescript
import { daemonRoutes } from "./routes/daemon.js";

// ServerOptions — add:
//   listProjects: () => ProjectSummary[];
//   getRuntime: (projectId: string) => ProjectRuntime | null;
//   daemonPort: number;

// inside createServer, after app creation:
const startedAtMs = Date.now();
await app.register(daemonRoutes, {
  listProjects: options.listProjects,
  daemonPort: options.daemonPort,
  startedAtMs,
});
```

Also change the VERSION constant in `server.ts` to `"0.2.0"` (already done in Task 8).

- [ ] **Step 5: Update Daemon to pass the new options and to include version in daemon.json**

In `packages/core/src/daemon.ts`:

```typescript
// In writeDaemonFile helper — extend DaemonInfo to include version:
interface DaemonInfo {
  port: number;
  host: string;
  token: string;
  pid: number;
  version: string;
}

const DAEMON_VERSION = "0.2.0";

// in Daemon.start(), when building createServer args, add:
// listProjects: () => this.listProjects(),
// getRuntime: (id) => this.getProject(id),
// daemonPort: this.port,

// When assigning this.info:
this.info = {
  port: this.port,
  host: this.host,
  token,
  pid: process.pid,
  version: DAEMON_VERSION,
};
```

- [ ] **Step 6: Update CLI DaemonInfo to include version**

In `packages/cli/src/commands/start.ts`:

```typescript
interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  version?: string;
}
```

- [ ] **Step 7: Run the test**

```
pnpm --filter @loomflo/core test daemon-route
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/api/routes/daemon.ts packages/core/src/api/server.ts packages/core/src/daemon.ts packages/cli/src/commands/start.ts packages/core/tests/unit/daemon-route.test.ts
git commit -m "feat(core): add /daemon/status route and embed version in daemon.json (T9)"
```

---

## Task 10: /projects CRUD routes

**Files:**

- Create: `packages/core/src/api/routes/projects-crud.ts`
- Modify: `packages/core/src/api/server.ts` (register)
- Modify: `packages/core/src/daemon.ts` (registration logic lives here, route calls into daemon)
- Create: `packages/core/tests/unit/projects-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/tests/unit/projects-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };

describe("/projects CRUD", () => {
  let daemon: Daemon;
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "loomflo-api-"));
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    // Inject token + projectPath via an undocumented test helper
    // (added in Step 3 to `Daemon` for testing only).
    await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest(TOKEN);
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(workspace, { recursive: true, force: true });
  });

  it("GET /projects returns [] when empty", async () => {
    const res = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST /projects registers a project and returns its summary", async () => {
    const res = await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload: {
        id: "proj_test01",
        name: "my-app",
        projectPath: workspace,
        providerProfileId: "default",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.id).toBe("proj_test01");
    expect(body.status).toBe("idle");
  });

  it("POST /projects returns 409 when id already registered", async () => {
    const payload = {
      id: "proj_test01",
      name: "my-app",
      projectPath: workspace,
      providerProfileId: "default",
    };
    await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload,
    });
    const dup = await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: "project_already_registered" });
  });

  it("GET /projects/:id returns 404 for unknown", async () => {
    const res = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects/proj_nope",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "project_not_registered" });
  });

  it("DELETE /projects/:id deregisters", async () => {
    await (daemon as any).server.inject({
      method: "POST",
      url: "/projects",
      headers: AUTH,
      payload: {
        id: "proj_test01",
        name: "my-app",
        projectPath: workspace,
        providerProfileId: "default",
      },
    });
    const del = await (daemon as any).server.inject({
      method: "DELETE",
      url: "/projects/proj_test01",
      headers: AUTH,
    });
    expect(del.statusCode).toBe(204);

    const after = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects/proj_test01",
      headers: AUTH,
    });
    expect(after.statusCode).toBe(404);
  });

  it("requires Bearer auth on all routes", async () => {
    const res = await (daemon as any).server.inject({ method: "GET", url: "/projects" });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm --filter @loomflo/core test projects-routes
```

Expected: FAIL — routes not defined and `startForTest` helper not present.

- [ ] **Step 3: Write the CRUD route plugin**

```typescript
// packages/core/src/api/routes/projects-crud.ts
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { ProjectRuntime, ProjectSummary } from "../../daemon-types.js";
import { toProjectSummary } from "../../daemon-types.js";

const RegisterSchema = z.object({
  id: z.string().regex(/^proj_[0-9a-f]{8}$/),
  name: z.string().min(1),
  projectPath: z.string().min(1),
  providerProfileId: z.string().min(1),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});

export interface ProjectsCrudOptions {
  listProjects: () => ProjectSummary[];
  getProject: (id: string) => ProjectRuntime | null;
  /** Build and register a ProjectRuntime. Throws on missing profile etc. */
  registerProject: (input: z.infer<typeof RegisterSchema>) => Promise<ProjectRuntime>;
  deregisterProject: (id: string) => Promise<boolean>;
}

export const projectsCrudRoutes: FastifyPluginAsync<ProjectsCrudOptions> = async (app, opts) => {
  app.get("/projects", async (_req, reply) => {
    return reply.send(opts.listProjects());
  });

  app.post("/projects", async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const existing = opts.getProject(parsed.data.id);
    if (existing) {
      return reply.code(409).send({ error: "project_already_registered", id: parsed.data.id });
    }
    try {
      const rt = await opts.registerProject(parsed.data);
      return reply.code(201).send(toProjectSummary(rt));
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("provider_missing_credentials")) {
        return reply.code(400).send({ error: "provider_missing_credentials" });
      }
      return reply.code(500).send({ error: "register_failed", message });
    }
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rt = opts.getProject(id);
    if (!rt) return reply.code(404).send({ error: "project_not_registered", id });
    return reply.send(toProjectSummary(rt));
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const removed = await opts.deregisterProject(id);
    if (!removed) return reply.code(404).send({ error: "project_not_registered", id });
    return reply.code(204).send();
  });
};
```

- [ ] **Step 4: Wire registerProject/deregisterProject in Daemon**

Add these methods to `Daemon`:

```typescript
import { ProviderProfiles } from "./providers/profiles.js";
import { resolveCredentials, resolveOpenAICompatCredentials } from "./providers/credentials.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { loadConfig } from "./config.js";
import { CostTracker } from "./costs/tracker.js";
import { SharedMemoryManager } from "./memory/shared-memory.js";
import { MessageBus } from "./agents/message-bus.js";
import type { LLMProvider } from "./providers/base.js";
import { homedir } from "node:os";
import { join } from "node:path";

private readonly profiles = new ProviderProfiles(
  join(homedir(), ".loomflo", "credentials.json"),
);

async registerProject(input: {
  id: string;
  name: string;
  projectPath: string;
  providerProfileId: string;
}): Promise<ProjectRuntime> {
  const profile = await this.profiles.get(input.providerProfileId);
  if (!profile) throw new Error(`provider_missing_credentials: ${input.providerProfileId}`);

  const provider = await buildProviderFromProfile(profile);
  const config = await loadConfig({ projectPath: input.projectPath });

  const rt: ProjectRuntime = {
    id: input.id,
    name: input.name,
    projectPath: input.projectPath,
    providerProfileId: input.providerProfileId,
    workflow: null,
    provider,
    config,
    costTracker: new CostTracker(),
    messageBus: new MessageBus(),
    sharedMemory: new SharedMemoryManager(input.projectPath),
    startedAt: new Date().toISOString(),
    status: "idle",
  };
  this.upsertProject(rt);
  return rt;
}

async deregisterProject(id: string): Promise<boolean> {
  return this.removeProject(id);
}

// Test-only helper — NOT part of the public API.
async startForTest(token: string): Promise<void> {
  const { createServer } = await import("./api/server.js");
  const { server } = await createServer({
    token,
    projectPath: process.cwd(),
    dashboardPath: null,
    listProjects: () => this.listProjects(),
    getRuntime: (id) => this.getProject(id),
    daemonPort: 0,
    registerProject: (input) => this.registerProject(input),
    deregisterProject: (id) => this.deregisterProject(id),
    health: { getUptime: () => 0, getWorkflow: () => null },
    workflow: {} as never,
    events: { getProjectPath: () => process.cwd() },
    onShutdown: () => undefined,
  });
  this.server = server;
  await this.server.listen({ port: 0, host: "127.0.0.1" });
}
```

Implement `buildProviderFromProfile` as a local helper in `daemon.ts`:

```typescript
async function buildProviderFromProfile(profile: ProviderProfile): Promise<LLMProvider> {
  switch (profile.type) {
    case "anthropic-oauth": {
      const creds = await resolveCredentials();
      return new AnthropicProvider(creds.config);
    }
    case "anthropic":
      return new AnthropicProvider({ apiKey: profile.apiKey });
    case "openai":
      return new OpenAIProvider({
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        defaultModel: profile.defaultModel,
      });
    case "moonshot":
    case "nvidia":
      return new OpenAIProvider({
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        defaultModel: profile.defaultModel,
      });
  }
}
```

- [ ] **Step 5: Register the plugin in the server**

In `packages/core/src/api/server.ts`, add imports and registration:

```typescript
import { projectsCrudRoutes } from "./routes/projects-crud.js";

// Inside createServer after auth setup:
await app.register(projectsCrudRoutes, {
  listProjects: options.listProjects,
  getProject: options.getRuntime,
  registerProject: options.registerProject,
  deregisterProject: options.deregisterProject,
});
```

Extend `ServerOptions` to include `registerProject` and `deregisterProject` with the right signatures.

- [ ] **Step 6: Run the tests**

```
pnpm --filter @loomflo/core test projects-routes
```

Expected: PASS — 6 tests green. The `default` profile can be a stub created by the test via `ProviderProfiles.upsert` in `beforeEach`, or the provider step is skipped because the test uses a sentinel provider profile (adjust if needed by seeding a `test` profile in `beforeEach`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/api/routes/projects-crud.ts packages/core/src/api/server.ts packages/core/src/daemon.ts packages/core/tests/unit/projects-routes.test.ts
git commit -m "feat(core): add /projects CRUD routes with registry wiring (T10)"
```

---

## Task 11: Scope existing routes under /projects/:id/\*

**Files:**

- Modify: `packages/core/src/api/routes/workflow.ts`
- Modify: `packages/core/src/api/routes/events.ts`
- Modify: `packages/core/src/api/routes/chat.ts`
- Modify: `packages/core/src/api/routes/nodes.ts`
- Modify: `packages/core/src/api/routes/memory.ts`
- Modify: `packages/core/src/api/routes/costs.ts`
- Modify: `packages/core/src/api/routes/config.ts`
- Modify: `packages/core/src/api/routes/specs.ts`
- Modify: `packages/core/src/api/server.ts`
- Rewrite: `packages/core/tests/integration/daemon-routes.test.ts` (URL prefix change)
- Rewrite: `packages/core/tests/integration/workflow-init.test.ts` (URL prefix change)
- Rewrite: `packages/core/tests/integration/events-routes.test.ts`
- Rewrite: `packages/core/tests/integration/resume.test.ts`

**Approach**: rather than duplicating each plugin, change each plugin's `options` to take functions that accept a `projectId`, and register the plugins under the prefix `/projects/:id`. Fastify will forward `req.params.id` to route handlers; we pass a small middleware that resolves the runtime or returns 404 before the handler runs.

- [ ] **Step 1: Add a helper preValidation hook**

Inside `packages/core/src/api/server.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from "fastify";

/** Resolve `:id` against the daemon registry, 404 if absent. Attaches runtime to request. */
function makeProjectRuntimeHook(getRuntime: (id: string) => ProjectRuntime | null) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const id = (req.params as { id?: string }).id;
    if (!id) return reply.code(400).send({ error: "missing_project_id" }) as unknown as void;
    const rt = getRuntime(id);
    if (!rt)
      return reply.code(404).send({ error: "project_not_registered", id }) as unknown as void;
    (req as FastifyRequest & { runtime?: ProjectRuntime }).runtime = rt;
  };
}
```

- [ ] **Step 2: Make each existing plugin pull from `req.runtime` instead of closure getters**

For each of `workflow.ts`, `events.ts`, `chat.ts`, `nodes.ts`, `memory.ts`, `costs.ts`, `config.ts`, `specs.ts`:

- Remove the `getWorkflow/getProvider/...` option fields.
- Inside every route handler, read the runtime off the request:
  ```typescript
  const rt = (req as FastifyRequest & { runtime: ProjectRuntime }).runtime;
  const workflow = rt.workflow;
  const provider = rt.provider;
  // ... etc
  ```
- For mutators like `setWorkflow`, write back to `rt.workflow = newWorkflow` and call a new callback `opts.onWorkflowChanged(rt.id)` if persistence is needed.

For concrete diffs of each file, follow this recipe (illustrated on `workflow.ts`):

```typescript
// Old:
export interface WorkflowRoutesOptions {
  getWorkflow: () => Workflow | null;
  setWorkflow: (workflow: Workflow) => void;
  getProvider: () => LLMProvider;
  // ...
}

// New:
export interface WorkflowRoutesOptions {
  /** Called when a new workflow was set; persistence + event broadcast live here. */
  onWorkflowChanged?: (projectId: string, workflow: Workflow) => void;
  /** Optional NodeExecutor factory per runtime. */
  createNodeExecutor?: (rt: ProjectRuntime, workflow: Workflow) => NodeExecutor;
}

// Inside a handler:
app.post("/workflow/start", async (req, reply) => {
  const rt = (req as any).runtime as ProjectRuntime;
  if (!rt.workflow) return reply.code(400).send({ error: "no_workflow_initialised" });
  // … use rt.provider, rt.costTracker, rt.sharedMemory, rt.messageBus, rt.config
});
```

- [ ] **Step 3: Register all scoped plugins under prefix `/projects/:id`**

In `createServer`, replace the existing registrations:

```typescript
const projectRuntimeHook = makeProjectRuntimeHook(options.getRuntime);

await app.register(
  async (scoped) => {
    scoped.addHook("preValidation", projectRuntimeHook);
    await scoped.register(workflowRoutes, {
      /* new opts */
    });
    await scoped.register(eventsRoutes, {
      /* new opts */
    });
    await scoped.register(chatRoutes, {
      /* new opts */
    });
    await scoped.register(nodesRoutes, {
      /* new opts */
    });
    await scoped.register(memoryRoutes, {
      /* new opts */
    });
    await scoped.register(costsRoutes, {
      /* new opts */
    });
    await scoped.register(configRoutes, {
      /* new opts */
    });
    await scoped.register(specsRoutes, {
      /* new opts */
    });
  },
  { prefix: "/projects/:id" },
);
```

- [ ] **Step 4: Rewrite the integration tests to target the new URLs**

For each rewritten test file, change the URL. Example:

```typescript
// tests/integration/workflow-init.test.ts (excerpt)
const PROJECT_ID = "proj_abcd1234";

beforeEach(async () => {
  // register a project via POST /projects first
  await daemon.registerProject({
    id: PROJECT_ID,
    name: "test",
    projectPath: workspace,
    providerProfileId: "default",
  });
});

it("POST /projects/:id/workflow/init initialises a workflow", async () => {
  const res = await server.inject({
    method: "POST",
    url: `/projects/${PROJECT_ID}/workflow/init`,
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: { description: "test", projectPath: workspace },
  });
  expect(res.statusCode).toBe(200);
});
```

Apply the same pattern to `daemon-routes.test.ts`, `events-routes.test.ts`, `resume.test.ts`.

- [ ] **Step 5: Run the full core test suite**

```
pnpm --filter @loomflo/core test
```

Expected: PASS. If any legacy test references `/workflow/...` without a prefix, either rewrite it (if it's a route test) or remove it if it's obsolete.

- [ ] **Step 6: Commit**

```bash
git add -u packages/core/
git commit -m "refactor(core): mount all project routes under /projects/:id (T11)"
```

---

## Task 12: Legacy routes return 410 Gone

**Files:**

- Create: `packages/core/src/api/routes/legacy-gone.ts`
- Modify: `packages/core/src/api/server.ts` (register BEFORE the scoped routes so non-scoped paths hit it)
- Create: `packages/core/tests/unit/legacy-gone.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/legacy-gone.test.ts
import { describe, it, expect } from "vitest";
import { createServer } from "../../src/api/server.js";

describe("legacy routes return 410 Gone", () => {
  it.each([
    ["POST", "/workflow/start"],
    ["POST", "/workflow/init"],
    ["POST", "/workflow/pause"],
    ["POST", "/workflow/resume"],
    ["POST", "/workflow/stop"],
    ["GET", "/workflow"],
    ["GET", "/events"],
    ["GET", "/nodes"],
    ["POST", "/chat"],
    ["GET", "/config"],
  ])("%s %s → 410", async (method, url) => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath: null,
      listProjects: () => [],
      getRuntime: () => null,
      daemonPort: 0,
      registerProject: async () => {
        throw new Error();
      },
      deregisterProject: async () => false,
      health: { getUptime: () => 0, getWorkflow: () => null },
      events: { getProjectPath: () => "/tmp" },
      onShutdown: () => undefined,
    });
    const res = await server.inject({
      method: method as "GET" | "POST",
      url,
      headers: { authorization: "Bearer t" },
    });
    expect(res.statusCode).toBe(410);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toBe("route_moved");
    expect(typeof body.newRoute).toBe("string");
    await server.close();
  });
});
```

- [ ] **Step 2: Run the test**

```
pnpm --filter @loomflo/core test legacy-gone
```

Expected: FAIL (routes currently 404 or other).

- [ ] **Step 3: Write the plugin**

```typescript
// packages/core/src/api/routes/legacy-gone.ts
import type { FastifyPluginAsync } from "fastify";

const MIGRATIONS: ReadonlyArray<readonly [string, string, string]> = [
  ["POST", "/workflow/init", "/projects/:id/workflow/init"],
  ["POST", "/workflow/start", "/projects/:id/workflow/start"],
  ["POST", "/workflow/pause", "/projects/:id/workflow/pause"],
  ["POST", "/workflow/resume", "/projects/:id/workflow/resume"],
  ["POST", "/workflow/stop", "/projects/:id/workflow/stop"],
  ["GET", "/workflow", "/projects/:id/workflow"],
  ["GET", "/events", "/projects/:id/events"],
  ["GET", "/nodes", "/projects/:id/nodes"],
  ["POST", "/chat", "/projects/:id/chat"],
  ["GET", "/config", "/projects/:id/config"],
];

export const legacyGoneRoutes: FastifyPluginAsync = async (app) => {
  for (const [method, url, newRoute] of MIGRATIONS) {
    app.route({
      method: method as "GET" | "POST",
      url,
      handler: async (_req, reply) => {
        return reply.code(410).send({ error: "route_moved", newRoute });
      },
    });
  }
};
```

- [ ] **Step 4: Register the plugin in `server.ts` before scoped routes**

```typescript
import { legacyGoneRoutes } from "./routes/legacy-gone.js";
// ...
await app.register(legacyGoneRoutes);
```

- [ ] **Step 5: Run the test**

```
pnpm --filter @loomflo/core test legacy-gone
```

Expected: PASS — all 10 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/api/routes/legacy-gone.ts packages/core/src/api/server.ts packages/core/tests/unit/legacy-gone.test.ts
git commit -m "feat(core): return 410 Gone with newRoute hint on v0.1.0 paths (T12)"
```

---

## Task 13: WebSocket subscribe + multiplexing

**Files:**

- Modify: `packages/core/src/api/websocket.ts`
- Modify: `packages/core/src/api/server.ts` (broadcast fn stamps projectId)
- Modify: `packages/core/src/daemon.ts` (plumb per-project broadcast)
- Create: `packages/core/tests/unit/websocket-subscription.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/unit/websocket-subscription.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Daemon } from "../../src/daemon.js";
import WebSocket from "ws";
import { once } from "node:events";

describe("WebSocket subscription", () => {
  let daemon: Daemon;
  let port: number;

  beforeEach(async () => {
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as unknown as { startForTest: (t: string) => Promise<void> }).startForTest("tok");
    port = (
      daemon as unknown as { server: { server: { address: () => { port: number } } } }
    ).server.server.address().port;
  });

  afterEach(async () => await daemon.stop());

  it("forwards only subscribed project events", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "subscribe", projectIds: ["proj_a"] }));
    await new Promise((r) => setTimeout(r, 50));

    const received: unknown[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));

    // @ts-expect-error protected test access
    daemon.broadcastForProject("proj_a", { type: "tick" });
    // @ts-expect-error protected test access
    daemon.broadcastForProject("proj_b", { type: "tick" });
    await new Promise((r) => setTimeout(r, 100));

    ws.close();
    // Filter out welcome/other messages
    const ticks = received.filter(
      (m): m is { projectId: string; type: string } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "tick",
    );
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.projectId).toBe("proj_a");
  });

  it("forwards all events when subscribed with {all: true}", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`);
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "subscribe", all: true }));
    await new Promise((r) => setTimeout(r, 50));

    const received: unknown[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));

    // @ts-expect-error test access
    daemon.broadcastForProject("proj_a", { type: "tick" });
    // @ts-expect-error test access
    daemon.broadcastForProject("proj_b", { type: "tick" });
    await new Promise((r) => setTimeout(r, 100));

    ws.close();
    const ticks = received.filter(
      (m): m is { projectId: string } => typeof m === "object" && m !== null && "projectId" in m,
    );
    expect(ticks.map((t) => t.projectId).sort()).toEqual(["proj_a", "proj_b"]);
  });
});
```

- [ ] **Step 2: Run tests**

```
pnpm --filter @loomflo/core test websocket-subscription
```

Expected: FAIL — subscribe protocol not implemented.

- [ ] **Step 3: Update websocket.ts**

Rework the WebSocket handler so each connection tracks its subscription. Key changes:

```typescript
// packages/core/src/api/websocket.ts
interface ClientSubscription {
  all: boolean;
  projectIds: Set<string>;
}

// Maintain Map<SocketClient, ClientSubscription>
// On message: parse subscribe/unsubscribe.
// Broadcast function signature becomes (projectId: string, event: object).

export function attachWebsocket(
  app: FastifyInstance,
  opts: WsOptions,
): {
  broadcastForProject: (projectId: string, event: object) => void;
} {
  const subs = new Map<SocketClient, ClientSubscription>();

  app.get("/ws", { websocket: true }, (conn, req) => {
    // ... auth via ?token= or Authorization header
    subs.set(conn.socket as SocketClient, { all: false, projectIds: new Set() });

    conn.socket.on("message", (raw: Buffer) => {
      try {
        const msg: unknown = JSON.parse(raw.toString());
        if (isSubscribe(msg)) {
          const sub = subs.get(conn.socket as SocketClient)!;
          if (msg.all) sub.all = true;
          else for (const id of msg.projectIds) sub.projectIds.add(id);
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    conn.socket.on("close", () => subs.delete(conn.socket as SocketClient));
  });

  return {
    broadcastForProject(projectId, event) {
      const envelope = JSON.stringify({ projectId, ...event });
      for (const [client, sub] of subs) {
        if (client.readyState !== WS_OPEN) continue;
        if (sub.all || sub.projectIds.has(projectId)) client.send(envelope);
      }
    },
  };
}

function isSubscribe(
  msg: unknown,
): msg is { type: "subscribe"; all?: boolean; projectIds?: string[] } {
  return (
    typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "subscribe"
  );
}
```

- [ ] **Step 4: Expose `broadcastForProject` on Daemon**

In `Daemon.start()`, after getting the `broadcast` handle from `createServer`, assign it:

```typescript
this.broadcastForProject = broadcastForProject;
```

And add a protected method:

```typescript
broadcastForProject: (projectId: string, event: object) => void = () => undefined;
```

Update the existing broadcast call sites (event emitters in routes) to call `rt.daemon.broadcastForProject(rt.id, event)` — or pass the function into route options.

- [ ] **Step 5: Run tests**

```
pnpm --filter @loomflo/core test websocket-subscription
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -u packages/core/
git commit -m "feat(core): multiplexed WebSocket with subscribe protocol (T13)"
```

---

# Phase D — CLI infrastructure

## Task 14: CLI project resolver

**Files:**

- Create: `packages/cli/src/project-resolver.ts`
- Create: `packages/cli/tests/unit/project-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/unit/project-resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/project-resolver.js";

describe("resolveProject", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-cli-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates identity if absent when createIfMissing=true", async () => {
    const result = await resolveProject({ cwd: tmp, createIfMissing: true });
    expect(result.created).toBe(true);
    expect(result.identity.name).toBe(tmp.split("/").pop());
  });

  it("returns existing identity from walk-up", async () => {
    // seed a nested project
    const root = join(tmp, "myproj");
    const nested = join(root, "src", "deep");
    await mkdir(nested, { recursive: true });
    await mkdir(join(root, ".loomflo"));
    await writeFile(
      join(root, ".loomflo", "project.json"),
      JSON.stringify({
        id: "proj_12345678",
        name: "myproj",
        providerProfileId: "default",
        createdAt: new Date().toISOString(),
      }),
    );

    const result = await resolveProject({ cwd: nested, createIfMissing: false });
    expect(result.created).toBe(false);
    expect(result.identity.id).toBe("proj_12345678");
    expect(result.projectRoot).toBe(root);
  });

  it("throws when no identity and createIfMissing=false", async () => {
    await expect(resolveProject({ cwd: tmp, createIfMissing: false })).rejects.toThrow(
      /not a loomflo project/i,
    );
  });
});
```

- [ ] **Step 2: Run test**

```
pnpm --filter @loomflo/cli test project-resolver
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/cli/src/project-resolver.ts
import { dirname, parse } from "node:path";
import { readFile } from "node:fs/promises";
import { ensureProjectIdentity, readProjectIdentity, type ProjectIdentity } from "@loomflo/core";

export interface ResolveOptions {
  cwd: string;
  createIfMissing: boolean;
  name?: string;
}

export interface ResolveResult {
  identity: ProjectIdentity;
  projectRoot: string;
  created: boolean;
}

export async function resolveProject(opts: ResolveOptions): Promise<ResolveResult> {
  const existing = await readProjectIdentity(opts.cwd);
  if (existing) {
    // Walk up to find its project.json, so callers know where the project root is.
    const root = await findProjectRoot(opts.cwd);
    return { identity: existing, projectRoot: root, created: false };
  }
  if (!opts.createIfMissing) {
    throw new Error(
      `${opts.cwd} is not a loomflo project (no .loomflo/project.json found). ` +
        `Run 'loomflo start' to initialise, or cd into a project directory.`,
    );
  }
  const identity = await ensureProjectIdentity(opts.cwd, { name: opts.name });
  return { identity, projectRoot: opts.cwd, created: true };
}

async function findProjectRoot(dir: string): Promise<string> {
  const root = parse(dir).root;
  let current = dir;
  while (true) {
    try {
      await readFile(`${current}/.loomflo/project.json`, "utf-8");
      return current;
    } catch {
      if (current === root) throw new Error("project root not found");
      current = dirname(current);
    }
  }
}
```

Update `packages/core/src/index.ts` to re-export `readProjectIdentity`, `ensureProjectIdentity`, `ProjectIdentity`:

```typescript
export {
  readProjectIdentity,
  ensureProjectIdentity,
  createProjectIdentity,
  generateProjectId,
} from "./persistence/project-identity.js";
export type { ProjectIdentity } from "./persistence/project-identity.js";
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @loomflo/cli test project-resolver
```

Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/project-resolver.ts packages/cli/tests/unit/project-resolver.test.ts packages/core/src/index.ts
git commit -m "feat(cli): add resolveProject (walk-up + create) (T14)"
```

---

## Task 15: CLI daemon control helper

**Files:**

- Create: `packages/cli/src/daemon-control.ts`
- Create: `packages/cli/tests/unit/daemon-control.test.ts`

- [ ] **Step 1: Write the failing test (pure functions that can be unit-tested; the spawn path is integration tested later)**

```typescript
// packages/cli/tests/unit/daemon-control.test.ts
import { describe, it, expect } from "vitest";
import { isCompatibleVersion, MIN_DAEMON_VERSION } from "../../src/daemon-control.js";

describe("daemon-control", () => {
  it("accepts 0.2.0 as compatible", () => {
    expect(isCompatibleVersion("0.2.0")).toBe(true);
  });

  it("rejects 0.1.0", () => {
    expect(isCompatibleVersion("0.1.0")).toBe(false);
  });

  it("accepts higher 0.2.x patch versions", () => {
    expect(isCompatibleVersion("0.2.3")).toBe(true);
  });

  it("rejects a missing version string", () => {
    expect(isCompatibleVersion(undefined)).toBe(false);
  });

  it("exposes the minimum version constant", () => {
    expect(MIN_DAEMON_VERSION).toBe("0.2.0");
  });
});
```

- [ ] **Step 2: Run tests**

```
pnpm --filter @loomflo/cli test daemon-control
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/cli/src/daemon-control.ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { withFileLock } from "@loomflo/core";

export const MIN_DAEMON_VERSION = "0.2.0";
const DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");
const DAEMON_LOCK_PATH = join(homedir(), ".loomflo", "daemon.lock");
const STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;
const LOCK_TIMEOUT_MS = 10_000;

export interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  version?: string;
}

export function isCompatibleVersion(version: string | undefined): boolean {
  if (!version) return false;
  const [major, minor] = version.split(".").map((n) => Number(n));
  const [reqMajor, reqMinor] = MIN_DAEMON_VERSION.split(".").map((n) => Number(n));
  if (Number.isNaN(major) || Number.isNaN(minor)) return false;
  if (major !== reqMajor) return false;
  return minor >= reqMinor;
}

export async function getRunningDaemon(): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(DAEMON_JSON_PATH, "utf-8");
    const info = JSON.parse(raw) as DaemonInfo;
    if (typeof info.pid === "number" && isProcessAlive(info.pid)) return info;
  } catch {
    /* missing or invalid */
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Start the daemon if it's not running. Returns the daemon info. */
export async function ensureDaemonRunning(): Promise<DaemonInfo> {
  const existing = await getRunningDaemon();
  if (existing) return assertCompatible(existing);

  await withFileLock(
    DAEMON_LOCK_PATH,
    async () => {
      const again = await getRunningDaemon();
      if (again) return;
      spawnDaemonDetached();
      await waitForDaemonFile(STARTUP_TIMEOUT_MS);
    },
    { timeoutMs: LOCK_TIMEOUT_MS },
  );

  const after = await getRunningDaemon();
  if (!after) throw new Error("Daemon spawn succeeded but daemon.json never appeared");
  return assertCompatible(after);
}

function assertCompatible(info: DaemonInfo): DaemonInfo {
  if (!isCompatibleVersion(info.version)) {
    throw new Error(
      `Incompatible daemon version (${info.version ?? "unknown"}). ` +
        `Run 'loomflo daemon stop --force' and retry.`,
    );
  }
  return info;
}

function spawnDaemonDetached(): void {
  const cliDir = new URL("..", import.meta.url).pathname;
  const daemonScript = resolve(cliDir, "..", "core", "dist", "daemon-entry.js");
  const child = spawn("node", [daemonScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
}

async function waitForDaemonFile(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(DAEMON_JSON_PATH, "utf-8");
      return;
    } catch {
      /* not yet */
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Daemon did not start within ${timeoutMs}ms`);
}
```

- [ ] **Step 4: Re-export `withFileLock` from core**

In `packages/core/src/index.ts`:

```typescript
export { withFileLock, FileLockTimeoutError } from "./persistence/file-lock.js";
```

- [ ] **Step 5: Run tests**

```
pnpm --filter @loomflo/cli test daemon-control
```

Expected: PASS — 5 tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/daemon-control.ts packages/cli/tests/unit/daemon-control.test.ts packages/core/src/index.ts
git commit -m "feat(cli): add daemonControl (ensureDaemonRunning, version compat, file lock) (T15)"
```

---

# Phase E — CLI commands

## Task 16: `daemon` subcommand namespace

**Files:**

- Create: `packages/cli/src/commands/daemon.ts`
- Modify: `packages/cli/src/index.ts` (register)
- Create: `packages/cli/tests/unit/daemon-command.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/unit/daemon-command.test.ts
import { describe, it, expect } from "vitest";
import { createDaemonCommand } from "../../src/commands/daemon.js";

describe("daemon command", () => {
  it("has start/stop/status/restart subcommands", () => {
    const cmd = createDaemonCommand();
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["restart", "start", "status", "stop"]);
  });

  it("stop supports --force flag", () => {
    const cmd = createDaemonCommand();
    const stop = cmd.commands.find((c) => c.name() === "stop")!;
    const hasForce = stop.options.some((o) => o.long === "--force");
    expect(hasForce).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

```
pnpm --filter @loomflo/cli test daemon-command
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the command**

```typescript
// packages/cli/src/commands/daemon.ts
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureDaemonRunning, getRunningDaemon } from "../daemon-control.js";

const DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");

export function createDaemonCommand(): Command {
  const root = new Command("daemon").description("Manage the Loomflo daemon");

  root
    .command("start")
    .description("Start the Loomflo daemon (no project)")
    .action(async () => {
      const info = await ensureDaemonRunning();
      console.log(`Daemon v${info.version ?? "?"} running on port ${info.port} (pid ${info.pid})`);
    });

  root
    .command("stop")
    .description("Stop the Loomflo daemon gracefully")
    .option("--force", "Skip confirmation and use SIGKILL")
    .action(async (opts: { force?: boolean }) => {
      const info = await getRunningDaemon();
      if (!info) {
        console.log("Daemon is not running.");
        return;
      }
      const running = await fetchActiveProjects(info);
      if (running.length > 0 && !opts.force) {
        console.error(
          `${running.length} project(s) active: ${running.join(", ")}. ` +
            `Re-run with --force to stop anyway.`,
        );
        process.exit(2);
      }
      const signal = opts.force ? "SIGKILL" : "SIGTERM";
      process.kill(info.pid, signal);
      console.log(`Sent ${signal} to daemon (pid ${info.pid}).`);
    });

  root
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const info = await getRunningDaemon();
      if (!info) {
        console.log("Daemon is not running.");
        return;
      }
      const res = await fetchJson(`http://127.0.0.1:${info.port}/daemon/status`, info.token);
      console.log(JSON.stringify(res, null, 2));
    });

  root
    .command("restart")
    .description("Stop then start the daemon")
    .option("--force", "Force stop")
    .action(async (opts: { force?: boolean }) => {
      const info = await getRunningDaemon();
      if (info) {
        process.kill(info.pid, opts.force ? "SIGKILL" : "SIGTERM");
        await waitUntilStopped(info.pid, 15_000);
      }
      const started = await ensureDaemonRunning();
      console.log(`Daemon restarted: v${started.version ?? "?"} pid ${started.pid}`);
    });

  return root;
}

async function fetchActiveProjects(info: { port: number; token: string }): Promise<string[]> {
  try {
    const res = await fetchJson<Array<{ id: string; status: string }>>(
      `http://127.0.0.1:${info.port}/projects`,
      info.token,
    );
    return res.filter((p) => p.status !== "idle").map((p) => p.id);
  } catch {
    return [];
  }
}

async function fetchJson<T = unknown>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function waitUntilStopped(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`Daemon (pid ${pid}) did not stop within ${timeoutMs}ms`);
}
```

- [ ] **Step 4: Register in index.ts**

```typescript
// packages/cli/src/index.ts (add)
import { createDaemonCommand } from "./commands/daemon.js";
// ...
program.addCommand(createDaemonCommand());
```

- [ ] **Step 5: Run tests**

```
pnpm --filter @loomflo/cli test daemon-command
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/daemon.ts packages/cli/src/index.ts packages/cli/tests/unit/daemon-command.test.ts
git commit -m "feat(cli): add 'daemon start|stop|status|restart' subcommands (T16)"
```

---

## Task 17: Refactor `loomflo start` to project-scoped flow

**Files:**

- Modify: `packages/cli/src/commands/start.ts`
- Modify: `packages/cli/src/client.ts`
- Create or Modify: `packages/cli/tests/unit/start-command.test.ts`

- [ ] **Step 1: Write a failing unit test for the project-scoped flow**

```typescript
// packages/cli/tests/unit/start-command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStart } from "../../src/commands/start.js";

describe("runStart", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-start-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates project.json, ensures daemon, registers project, returns identity", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 99, version: "0.2.0" })),
      fetchProject: vi.fn(async () => null),
      postProject: vi.fn(async () => ({ id: "proj_xxxxxxxx", status: "idle" })),
      streamEvents: vi.fn(async () => undefined),
    };
    const result = await runStart({ cwd: tmp, providerProfileId: "default", deps });
    expect(deps.ensureDaemon).toHaveBeenCalledTimes(1);
    expect(deps.postProject).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1234, token: "t" }),
      expect.objectContaining({ projectPath: tmp, providerProfileId: "default" }),
    );
    expect(result.identity.id).toMatch(/^proj_[0-9a-f]{8}$/);
  });

  it("skips registration if project is already known", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 99, version: "0.2.0" })),
      fetchProject: vi.fn(async () => ({ id: "proj_aaaaaaaa", status: "running" })),
      postProject: vi.fn(),
      streamEvents: vi.fn(async () => undefined),
    };
    await runStart({ cwd: tmp, providerProfileId: "default", deps });
    expect(deps.postProject).not.toHaveBeenCalled();
    expect(deps.streamEvents).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test**

```
pnpm --filter @loomflo/cli test start-command
```

Expected: FAIL.

- [ ] **Step 3: Rewrite `start.ts`**

```typescript
// packages/cli/src/commands/start.ts
import { Command } from "commander";
import { resolve } from "node:path";
import { resolveProject } from "../project-resolver.js";
import { ensureDaemonRunning, type DaemonInfo } from "../daemon-control.js";
import type { ProjectIdentity } from "@loomflo/core";

interface StartDeps {
  ensureDaemon: () => Promise<DaemonInfo>;
  fetchProject: (info: DaemonInfo, id: string) => Promise<{ id: string; status: string } | null>;
  postProject: (
    info: DaemonInfo,
    body: {
      id: string;
      name: string;
      projectPath: string;
      providerProfileId: string;
    },
  ) => Promise<{ id: string; status: string }>;
  streamEvents: (info: DaemonInfo, projectId: string) => Promise<void>;
}

export interface RunStartOptions {
  cwd: string;
  providerProfileId: string;
  projectName?: string;
  deps?: StartDeps;
}

export interface RunStartResult {
  identity: ProjectIdentity;
  created: boolean;
}

export async function runStart(opts: RunStartOptions): Promise<RunStartResult> {
  const deps = opts.deps ?? defaultDeps();
  const { identity, created } = await resolveProject({
    cwd: opts.cwd,
    createIfMissing: true,
    name: opts.projectName,
  });
  const info = await deps.ensureDaemon();
  const current = await deps.fetchProject(info, identity.id);
  if (!current) {
    await deps.postProject(info, {
      id: identity.id,
      name: identity.name,
      projectPath: opts.cwd,
      providerProfileId: opts.providerProfileId,
    });
  }
  await deps.streamEvents(info, identity.id);
  return { identity, created };
}

function defaultDeps(): StartDeps {
  return {
    ensureDaemon: ensureDaemonRunning,
    fetchProject: async (info, id) => {
      const res = await fetch(`http://127.0.0.1:${info.port}/projects/${id}`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { id: string; status: string };
    },
    postProject: async (info, body) => {
      const res = await fetch(`http://127.0.0.1:${info.port}/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${info.token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`register failed: HTTP ${res.status}`);
      return (await res.json()) as { id: string; status: string };
    },
    streamEvents: async (info, projectId) => {
      // Minimal streaming via polling /projects/:id/events until SIGINT.
      // A proper WebSocket stream is wired up in S3/S4.
      process.once("SIGINT", () => process.exit(0));
      while (true) {
        const res = await fetch(`http://127.0.0.1:${info.port}/projects/${projectId}/events`, {
          headers: { authorization: `Bearer ${info.token}` },
        });
        if (!res.ok) break;
        const events = (await res.json()) as unknown[];
        for (const ev of events) console.log(JSON.stringify(ev));
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    },
  };
}

export function createStartCommand(): Command {
  return new Command("start")
    .description("Start this project's workflow (auto-starts the daemon)")
    .option("--project-path <path>", "Project directory path")
    .option("--provider <id>", "Provider profile id", "default")
    .option("--name <name>", "Project name (first run only)")
    .action(async (options: { projectPath?: string; provider?: string; name?: string }) => {
      const cwd = options.projectPath ? resolve(options.projectPath) : process.cwd();
      try {
        await runStart({
          cwd,
          providerProfileId: options.provider ?? "default",
          projectName: options.name,
        });
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @loomflo/cli test start-command
```

Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/start.ts packages/cli/tests/unit/start-command.test.ts
git commit -m "feat(cli): project-scoped 'loomflo start' with auto-daemon + registration (T17)"
```

---

## Task 18: Refactor stop, status, resume, chat, logs to project-scoped

**Files:**

- Modify: `packages/cli/src/commands/stop.ts`
- Modify: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/commands/resume.ts`
- Modify: `packages/cli/src/commands/chat.ts`
- Modify: `packages/cli/src/commands/logs.ts`
- Modify: `packages/cli/src/client.ts`

All these commands follow the same pattern. The test coverage is handled in the integration tests (Task 22+); this task is purely a mechanical refactor.

- [ ] **Step 1: Update the shared client**

```typescript
// packages/cli/src/client.ts
import { getRunningDaemon, type DaemonInfo } from "./daemon-control.js";

export interface ScopedClient {
  projectId: string;
  info: DaemonInfo;
  request: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
}

export async function openClient(projectId: string): Promise<ScopedClient> {
  const info = await getRunningDaemon();
  if (!info) throw new Error("Daemon is not running. Run 'loomflo start' first.");
  const base = `http://127.0.0.1:${info.port}`;
  return {
    projectId,
    info,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const url = path.startsWith("/projects/")
        ? `${base}${path}`
        : `${base}/projects/${projectId}${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${info.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}`);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
```

- [ ] **Step 2: Rewrite each command to use resolveProject + openClient**

Example for `stop.ts`:

```typescript
// packages/cli/src/commands/stop.ts
import { Command } from "commander";
import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";

export function createStopCommand(): Command {
  return new Command("stop")
    .description("Stop this project's workflow (daemon keeps running)")
    .action(async () => {
      const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
      const client = await openClient(identity.id);
      await client.request("POST", "/workflow/stop");
      console.log(`Project ${identity.name} (${identity.id}) stopped.`);
    });
}
```

Apply the same pattern (resolve project → open client → call scoped path → log) to `status.ts`, `resume.ts`, `chat.ts`, `logs.ts`. Each command keeps its existing flags/args; only the HTTP target changes to the scoped URL.

- [ ] **Step 3: Build + typecheck**

```
pnpm --filter @loomflo/cli build
pnpm --filter @loomflo/cli typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/ packages/cli/src/client.ts
git commit -m "refactor(cli): scope stop/status/resume/chat/logs to current project (T18)"
```

---

## Task 19: `project` subcommand namespace (list | remove | prune)

**Files:**

- Create: `packages/cli/src/commands/project.ts`
- Modify: `packages/cli/src/index.ts` (register)
- Create: `packages/cli/tests/unit/project-command.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/unit/project-command.test.ts
import { describe, it, expect } from "vitest";
import { createProjectCommand } from "../../src/commands/project.js";

describe("project command", () => {
  it("has list/remove/prune subcommands", () => {
    const cmd = createProjectCommand();
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["list", "prune", "remove"]);
  });
});
```

- [ ] **Step 2: Run it**

```
pnpm --filter @loomflo/cli test project-command
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/cli/src/commands/project.ts
import { Command } from "commander";
import { stat } from "node:fs/promises";
import { getRunningDaemon } from "../daemon-control.js";

interface ProjectSummary {
  id: string;
  name: string;
  projectPath: string;
  status: string;
  startedAt: string;
}

export function createProjectCommand(): Command {
  const root = new Command("project").description("Manage Loomflo projects");

  root
    .command("list")
    .description("List projects known to the daemon")
    .action(async () => {
      const info = await getRunningDaemon();
      if (!info) return void console.log("Daemon is not running.");
      const res = await fetch(`http://127.0.0.1:${info.port}/projects`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      const projects = (await res.json()) as ProjectSummary[];
      for (const p of projects) {
        console.log(`${p.id}\t${p.name}\t${p.status}\t${p.projectPath}`);
      }
    });

  root
    .command("remove <id>")
    .description("Remove a project from the daemon registry")
    .action(async (id: string) => {
      const info = await getRunningDaemon();
      if (!info) throw new Error("Daemon is not running.");
      const res = await fetch(`http://127.0.0.1:${info.port}/projects/${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${info.token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`Removed ${id}.`);
    });

  root
    .command("prune")
    .description("Remove projects whose directory no longer exists")
    .action(async () => {
      const info = await getRunningDaemon();
      if (!info) throw new Error("Daemon is not running.");
      const res = await fetch(`http://127.0.0.1:${info.port}/projects`, {
        headers: { authorization: `Bearer ${info.token}` },
      });
      const projects = (await res.json()) as ProjectSummary[];
      let removed = 0;
      for (const p of projects) {
        const exists = await stat(p.projectPath)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          await fetch(`http://127.0.0.1:${info.port}/projects/${p.id}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${info.token}` },
          });
          removed++;
        }
      }
      console.log(`Pruned ${removed} orphan project(s).`);
    });

  return root;
}
```

Register in `index.ts`:

```typescript
import { createProjectCommand } from "./commands/project.js";
// ...
program.addCommand(createProjectCommand());
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @loomflo/cli test project-command
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/project.ts packages/cli/src/index.ts packages/cli/tests/unit/project-command.test.ts
git commit -m "feat(cli): add 'project list|remove|prune' subcommands (T19)"
```

---

## Task 20: Update `init` command to create project.json

**Files:**

- Modify: `packages/cli/src/commands/init.ts`
- Modify/Create: `packages/cli/tests/unit/init-command.test.ts`

- [ ] **Step 1: Modify init to create identity before spec gen**

The existing `init` command calls `POST /workflow/init`. Update it to:

1. `resolveProject({ cwd, createIfMissing: true, name })`.
2. `ensureDaemonRunning()`.
3. `POST /projects` if the project isn't registered yet.
4. `POST /projects/:id/workflow/init` with the description.

Write a test mirroring `start-command.test.ts`:

```typescript
// packages/cli/tests/unit/init-command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../../src/commands/init.js";

describe("runInit", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-init-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates identity, registers project, calls /workflow/init", async () => {
    const deps = {
      ensureDaemon: vi.fn(async () => ({ port: 1234, token: "t", pid: 9, version: "0.2.0" })),
      fetchProject: vi.fn(async () => null),
      postProject: vi.fn(async () => ({ id: "proj_xxxxxxxx", status: "idle" })),
      initWorkflow: vi.fn(async () => ({ id: "wf_1", status: "generating" })),
    };
    await runInit({ cwd: tmp, description: "build something", providerProfileId: "default", deps });
    expect(deps.postProject).toHaveBeenCalled();
    expect(deps.initWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^proj_[0-9a-f]{8}$/),
      { description: "build something", projectPath: tmp },
    );
  });
});
```

Write `runInit` in `init.ts` following the `runStart` dependency-injection shape from Task 17, then add a Commander action wrapper.

- [ ] **Step 2: Run tests**

```
pnpm --filter @loomflo/cli test init-command
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/tests/unit/init-command.test.ts
git commit -m "feat(cli): scope 'loomflo init' to per-project registration + workflow init (T20)"
```

---

# Phase F — Integration tests & E2E

## Task 21: Parallel multi-project integration test

**Files:**

- Create: `packages/core/tests/integration/multi-project.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/tests/integration/multi-project.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";
import { homedir } from "node:os";

describe("multi-project parallel", () => {
  let daemon: Daemon;
  let workA: string;
  let workB: string;

  beforeEach(async () => {
    // Seed a 'default' profile that uses env var — lets the test short-circuit provider build
    const profiles = new ProviderProfiles(join(homedir(), ".loomflo", "credentials.json"));
    await profiles.upsert("default", { type: "anthropic-oauth" });

    workA = await mkdtemp(join(tmpdir(), "loomflo-A-"));
    workB = await mkdtemp(join(tmpdir(), "loomflo-B-"));
    daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as any).startForTest("tok");
  });

  afterEach(async () => {
    await daemon.stop();
    await rm(workA, { recursive: true, force: true });
    await rm(workB, { recursive: true, force: true });
  });

  it("registers two projects independently", async () => {
    const register = async (id: string, projectPath: string) =>
      await (daemon as any).server.inject({
        method: "POST",
        url: "/projects",
        headers: { authorization: "Bearer tok" },
        payload: { id, name: id, projectPath, providerProfileId: "default" },
      });

    const a = await register("proj_aaaaaaaa", workA);
    const b = await register("proj_bbbbbbbb", workB);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    const list = await (daemon as any).server.inject({
      method: "GET",
      url: "/projects",
      headers: { authorization: "Bearer tok" },
    });
    const summaries = list.json() as Array<{ id: string }>;
    expect(summaries.map((s) => s.id).sort()).toEqual(["proj_aaaaaaaa", "proj_bbbbbbbb"]);
  });

  it("isolates workflow state between projects", async () => {
    const register = async (id: string, projectPath: string) =>
      await (daemon as any).server.inject({
        method: "POST",
        url: "/projects",
        headers: { authorization: "Bearer tok" },
        payload: { id, name: id, projectPath, providerProfileId: "default" },
      });
    await register("proj_aaaaaaaa", workA);
    await register("proj_bbbbbbbb", workB);

    // Mutate runtime A's workflow directly via the registry.
    const rtA = daemon.getProject("proj_aaaaaaaa")!;
    rtA.workflow = {
      id: "wf_a",
      status: "running",
      projectPath: workA,
      // minimal stub — full Workflow type fields populated by the engine in real flow
      graph: { nodes: {}, edges: [] },
    } as never;

    const rtB = daemon.getProject("proj_bbbbbbbb")!;
    expect(rtB.workflow).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

```
pnpm --filter @loomflo/core test multi-project
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/integration/multi-project.test.ts
git commit -m "test(core): multi-project parallel registration integration (T21)"
```

---

## Task 22: Daemon restart + projects.json persistence test

**Files:**

- Modify: `packages/core/src/daemon.ts` (persist registry changes to projects.json; reload on start)
- Create: `packages/core/tests/integration/daemon-reload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/integration/daemon-reload.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";
import { ProjectsRegistry } from "../../src/persistence/projects.js";

describe("daemon reload from projects.json", () => {
  let work: string;
  let registry: ProjectsRegistry;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "loomflo-reload-"));
    registry = new ProjectsRegistry(join(homedir(), ".loomflo", "projects.json"));
    await registry.upsert({
      id: "proj_persist1",
      name: "persisted",
      projectPath: work,
      providerProfileId: "default",
    });
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
    await registry.remove("proj_persist1");
  });

  it("loads projects from projects.json on daemon start", async () => {
    const daemon = new Daemon({ port: 0, host: "127.0.0.1" });
    await (daemon as any).startForTest("tok");
    const list = daemon.listProjects();
    expect(list.some((p) => p.id === "proj_persist1")).toBe(true);
    await daemon.stop();
  });
});
```

- [ ] **Step 2: Run test**

```
pnpm --filter @loomflo/core test daemon-reload
```

Expected: FAIL — daemon currently doesn't auto-load.

- [ ] **Step 3: Add projects.json persistence + reload to Daemon**

In `Daemon.start()` (and the helper `startForTest`):

```typescript
import { ProjectsRegistry } from "./persistence/projects.js";

private readonly projectsRegistry = new ProjectsRegistry(
  join(homedir(), ".loomflo", "projects.json"),
);

// At the top of start(), before createServer:
const persisted = await this.projectsRegistry.list();
for (const entry of persisted) {
  try {
    await this.registerProject(entry);
  } catch (err) {
    console.warn(`[loomflo] could not reload ${entry.id}: ${(err as Error).message}`);
  }
}
```

And modify `registerProject`/`deregisterProject` to persist:

```typescript
async registerProject(input: /*...*/): Promise<ProjectRuntime> {
  // ... build runtime ...
  this.upsertProject(rt);
  await this.projectsRegistry.upsert({
    id: rt.id,
    name: rt.name,
    projectPath: rt.projectPath,
    providerProfileId: rt.providerProfileId,
  });
  return rt;
}

async deregisterProject(id: string): Promise<boolean> {
  const removed = this.removeProject(id);
  if (removed) await this.projectsRegistry.remove(id);
  return removed;
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @loomflo/core test daemon-reload
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/daemon.ts packages/core/tests/integration/daemon-reload.test.ts
git commit -m "feat(core): persist & reload project registry from ~/.loomflo/projects.json (T22)"
```

---

## Task 23: Concurrent auto-start file-lock test

**Files:**

- Create: `packages/cli/tests/integration/concurrent-start.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/cli/tests/integration/concurrent-start.test.ts
import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile, rm } from "node:fs/promises";
import { withFileLock } from "@loomflo/core";

describe("concurrent start file lock", () => {
  it("serialises two concurrent critical sections via the lock file", async () => {
    const lockFile = join(homedir(), ".loomflo", "daemon.lock");
    await writeFile(lockFile, "");
    let concurrent = 0;
    let maxConcurrent = 0;

    const critical = async (): Promise<void> => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 25));
      concurrent--;
    };

    await Promise.all([
      withFileLock(lockFile, critical, { timeoutMs: 5000 }),
      withFileLock(lockFile, critical, { timeoutMs: 5000 }),
      withFileLock(lockFile, critical, { timeoutMs: 5000 }),
    ]);

    expect(maxConcurrent).toBe(1);
    await rm(lockFile, { force: true });
  });
});
```

- [ ] **Step 2: Run**

```
pnpm --filter @loomflo/cli test concurrent-start
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/tests/integration/concurrent-start.test.ts
git commit -m "test(cli): concurrent daemon auto-start serialised by file lock (T23)"
```

---

## Task 24: Legacy 410 + migration integration test

**Files:**

- Create: `packages/core/tests/integration/legacy-migration.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/tests/integration/legacy-migration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProjectIdentity } from "../../src/persistence/project-identity.js";

describe("legacy migration", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "loomflo-migrate-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("creates project.json when only state.json exists", async () => {
    await mkdir(join(work, ".loomflo"));
    await writeFile(join(work, ".loomflo", "state.json"), JSON.stringify({ id: "wf" }));

    const ident = await ensureProjectIdentity(work);
    expect(ident.id).toMatch(/^proj_[0-9a-f]{8}$/);

    const raw = await readFile(join(work, ".loomflo", "project.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(ident);
  });
});
```

- [ ] **Step 2: Run**

```
pnpm --filter @loomflo/core test legacy-migration
```

Expected: PASS (functionality already exists from Task 3).

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/integration/legacy-migration.test.ts
git commit -m "test(core): legacy project.json migration integration (T24)"
```

---

## Task 25: End-to-end smoke test

**Files:**

- Create: `tests/e2e/multi-project.e2e.test.ts`
- Modify: root `vitest.config.ts` to include `tests/e2e` only when `LOOMFLO_E2E=1`
- Modify: root `package.json` to add `test:e2e` script

- [ ] **Step 1: Add the e2e script**

```json
// package.json (root) — scripts
{
  "scripts": {
    "test": "vitest run --exclude tests/e2e/**",
    "test:e2e": "LOOMFLO_E2E=1 vitest run tests/e2e"
  }
}
```

- [ ] **Step 2: Write the E2E test**

```typescript
// tests/e2e/multi-project.e2e.test.ts
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env } });
    let stdout = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
  });
}

const CLI = join(__dirname, "..", "..", "packages", "cli", "dist", "index.js");

describe("E2E multi-project", () => {
  it("registers two projects under one daemon and stops cleanly", async () => {
    const a = await mkdtemp(join(tmpdir(), "loomflo-e2e-a-"));
    const b = await mkdtemp(join(tmpdir(), "loomflo-e2e-b-"));

    try {
      // Pre-seed credentials (stub default profile) — covered in S2; here we assume the env has ANTHROPIC_API_KEY or OAuth.
      const startA = await run("node", [CLI, "start"], a);
      expect(startA.code).toBe(0);
      const startB = await run("node", [CLI, "start"], b);
      expect(startB.code).toBe(0);

      const listJson = await run("node", [CLI, "project", "list"], a);
      expect(listJson.stdout).toMatch(/proj_[0-9a-f]{8}/);

      await run("node", [CLI, "stop"], a);
      await run("node", [CLI, "stop"], b);
      await run("node", [CLI, "daemon", "stop"], a);
    } finally {
      await rm(a, { recursive: true, force: true });
      await rm(b, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 3: Build the CLI and run the E2E**

```
pnpm build
LOOMFLO_E2E=1 pnpm test:e2e
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/multi-project.e2e.test.ts package.json vitest.config.ts
git commit -m "test(e2e): multi-project smoke test behind LOOMFLO_E2E=1 (T25)"
```

---

# Phase G — Documentation

## Task 26: README and changelog

**Files:**

- Modify: `README.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Update README**

Replace the "Quickstart" and "Usage Example" sections of `README.md` with multi-project equivalents, e.g.:

````markdown
## Quickstart

```bash
# From your project directory
loomflo start       # ← auto-starts the daemon + registers the project + runs the wizard
```
````

Running `loomflo start` in a second project works the same way — the daemon holds
both projects in parallel. See **Multi-project** below.

## Multi-project

One Loomflo daemon runs per machine. Each project registers itself the first time
you run `loomflo start` in its directory; it gets a stable ID in
`.loomflo/project.json` and a per-project provider profile.

- `loomflo start` — start this project's flow.
- `loomflo stop` — stop this project's flow (daemon keeps running).
- `loomflo project list` — see every project registered with the daemon.
- `loomflo daemon stop` — stop the daemon entirely (asks for confirmation if any project is active).

Each project keeps its workflow state under `./.loomflo/`. Provider credentials
live in `~/.loomflo/credentials.json` as named profiles that projects reference
by id.

````

- [ ] **Step 2: Create CHANGELOG.md**

```markdown
# Changelog

## 0.2.0 — 2026-04-14

### Breaking changes

- All daemon routes are now scoped under `/projects/:id/…`. The v0.1.0 paths
  (`/workflow/*`, `/events`, `/nodes`, `/chat`, `/config`) return `410 Gone`
  with a JSON hint pointing at the new route.
- `loomflo start` now means "start this project" (auto-starts the daemon if needed).
  Use `loomflo daemon start` for the daemon-only behaviour.
- The dashboard is not yet multi-project-aware; it will be in S5.

### New

- Multi-project daemon: one daemon per machine, N parallel workflows.
- `.loomflo/project.json` per project, stable ID, walk-up resolution from any subdir.
- `~/.loomflo/projects.json` persists the registry across daemon restarts.
- `~/.loomflo/credentials.json` holds named provider profiles.
- `loomflo daemon start|stop|status|restart` subcommands.
- `loomflo project list|remove|prune` subcommands.
- Concurrent `loomflo start` from two project dirs is safe (file lock).
````

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: multi-project Quickstart + CHANGELOG v0.2.0 (T26)"
```

---

# Final verification

After all 26 tasks are committed:

- [ ] **Run the full test suite**

```
pnpm test
pnpm --filter @loomflo/core lint
pnpm --filter @loomflo/cli lint
pnpm --filter @loomflo/core typecheck
pnpm --filter @loomflo/cli typecheck
pnpm build
```

All green. Any red must be fixed before merging.

- [ ] **Manual smoke test**

```bash
# clean slate
rm -rf ~/.loomflo/{daemon.json,projects.json,credentials.json}

# seed a minimal default profile for Anthropic OAuth (assumes Claude Code installed)
echo '{"profiles":{"default":{"type":"anthropic-oauth"}}}' > ~/.loomflo/credentials.json
chmod 600 ~/.loomflo/credentials.json

cd /tmp && mkdir -p projA projB
(cd projA && node packages/cli/dist/index.js start &)
(cd projB && node packages/cli/dist/index.js start &)
sleep 3
node packages/cli/dist/index.js project list
# → should list two proj_ ids
node packages/cli/dist/index.js daemon stop --force
```

Expected: two projects listed, daemon stops cleanly.

- [ ] **Self-review against spec**

Walk the S1 spec section-by-section. For each requirement, point at the task that implements it. Any gap → add a follow-up task.

- [ ] **Open the PR**

```bash
gh pr create --title "S1: multi-project daemon + auto-start (v0.2.0)" \
  --body "$(cat <<'EOF'
## Summary

- One daemon per machine, N projects in parallel.
- `loomflo start` in a project directory auto-starts the daemon and registers the project.
- All routes scoped under `/projects/:id/*`; legacy routes return `410 Gone`.
- Version bumped to `0.2.0` — breaking change.

Spec: `docs/superpowers/specs/2026-04-14-s1-multi-project-daemon.md`
Overview: `docs/superpowers/specs/2026-04-14-cli-daemon-overview.md`

## Test plan

- [x] Unit tests (`pnpm test`)
- [x] Integration tests
- [x] E2E smoke test (`LOOMFLO_E2E=1 pnpm test:e2e`)
- [x] Manual: two projects in parallel, daemon stop clean
- [ ] Dashboard still broken until S5 (documented in CHANGELOG)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
