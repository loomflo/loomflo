// ============================================================================
// ProjectStoreContext
//
// Phase B wiring: the project list is now sourced from the daemon
// (`GET /projects`) — with optional reroute to `/mock/projects` when the
// ApiClient is in mock mode. Pages keep using `useProjects()` / `useStore()`
// unchanged; under the hood we hydrate the rich UiProject shape by merging
// ProjectSummary + locally-cached UI metadata.
//
// When no token is available we fall back to SEED_PROJECTS in localStorage
// so the SPA still renders for design / preview without a daemon.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApi, useAppContext, useWs } from "./AppContext.js";
import { ApiError } from "../lib/api.js";
import type {
  AgentRole,
  Level,
  ProjectSummary,
  UiProject,
  UiProjectStatus,
  WorkflowStatus,
} from "../lib/types.js";
import { SEED_PROJECTS } from "../lib/mock-data.js";

// ============================================================================
// Local UI metadata
// ============================================================================

const META_KEY = "loomflo.projects.meta";
const OFFLINE_KEY = "loomflo.projects.offline";

interface UiProjectMeta {
  createdAt?: string;
  lastActivityAt?: string;
  config?: { template: string; stack: string[]; level: Level };
  createdBy?: "user" | "cli";
  nodeCount?: { spec: number; worker: number; done: number };
  workflowStatus?: WorkflowStatus;
  runningNode?: string;
  runningAgent?: AgentRole;
}

function readMeta(): Record<string, UiProjectMeta> {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, UiProjectMeta>;
  } catch {
    return {};
  }
}

function writeMeta(meta: Record<string, UiProjectMeta>): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* localStorage unavailable */
  }
}

function patchMeta(id: string, patch: UiProjectMeta): void {
  const all = readMeta();
  all[id] = { ...all[id], ...patch };
  writeMeta(all);
}

// ============================================================================
// Offline fallback (no token)
// ============================================================================

function readOffline(): UiProject[] {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (raw) return JSON.parse(raw) as UiProject[];
  } catch {
    /* localStorage unavailable */
  }
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(SEED_PROJECTS));
  } catch {
    /* localStorage unavailable */
  }
  return [...SEED_PROJECTS];
}

function writeOffline(projects: UiProject[]): void {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(projects));
  } catch {
    /* localStorage unavailable */
  }
}

// ============================================================================
// UiProject derivation from daemon ProjectSummary
// ============================================================================

const STATUS_MAP: Record<ProjectSummary["status"], UiProjectStatus> = {
  idle: "pending",
  running: "running",
  blocked: "paused",
  failed: "failed",
  completed: "done",
};

function summaryToUiProject(s: ProjectSummary, meta: UiProjectMeta | undefined): UiProject {
  const ui: UiProject = {
    id: s.id,
    name: s.name,
    projectPath: s.projectPath,
    createdAt: meta?.createdAt ?? s.startedAt,
    lastActivityAt: meta?.lastActivityAt ?? s.startedAt,
    status: meta?.workflowStatus
      ? statusFromWorkflow(meta.workflowStatus)
      : STATUS_MAP[s.status],
    workflowStatus: meta?.workflowStatus ?? workflowStatusFromSummary(s),
    nodeCount: meta?.nodeCount ?? { spec: 0, worker: 0, done: 0 },
    config: meta?.config ?? { template: "—", stack: [], level: 1 },
    createdBy: meta?.createdBy ?? "user",
  };
  if (s.currentNodeId) ui.runningNode = s.currentNodeId;
  if (meta?.runningAgent) ui.runningAgent = meta.runningAgent;
  if (!ui.runningNode && meta?.runningNode) ui.runningNode = meta.runningNode;
  return ui;
}

function workflowStatusFromSummary(s: ProjectSummary): WorkflowStatus {
  switch (s.status) {
    case "running":
      return "running";
    case "blocked":
      return "paused";
    case "failed":
      return "failed";
    case "completed":
      return "done";
    case "idle":
    default:
      return "init";
  }
}

function statusFromWorkflow(ws: WorkflowStatus): UiProjectStatus {
  switch (ws) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "failed":
      return "failed";
    case "done":
      return "done";
    case "spec":
      return "spec";
    case "building":
      return "building";
    case "init":
      return "init";
    default:
      return "pending";
  }
}

// ============================================================================
// Public store API
// ============================================================================

export interface ProjectInitPartial {
  name?: string;
  projectPath?: string;
  status?: UiProjectStatus;
  workflowStatus?: WorkflowStatus;
  config?: { template: string; stack: string[]; level: Level };
  createdBy?: "user" | "cli";
  runningNode?: string;
  runningAgent?: AgentRole;
  /**
   * Provider profile id required by POST /projects. Defaults to "default" so
   * the wizard can still create a project when the user has only one profile
   * configured under that name.
   */
  providerProfileId?: string;
}

export interface ProjectStore {
  list(): UiProject[];
  get(id: string): UiProject | undefined;
  /** Async — returns once the daemon has acked the create. */
  create(partial: ProjectInitPartial): Promise<UiProject>;
  /** UI-only metadata patch (does not call the daemon). */
  update(id: string, patch: Partial<UiProject>): void;
  /** DELETE /projects/:id when authenticated, otherwise local-only. */
  remove(id: string): Promise<void>;
  /** Mock/dev only: reset offline fallback. */
  reset(): void;
  /** Subscribe to the in-memory project list. */
  subscribe(handler: (projects: UiProject[]) => void): () => void;
  /** Stub: only used by the legacy mock to inject a "cli" project. */
  simulateExternalProjectInit(name: string, path: string): Promise<UiProject>;
}

interface ProjectStoreContextValue {
  projects: UiProject[];
  store: ProjectStore;
  loading: boolean;
  error: Error | null;
}

const ProjectStoreContext = createContext<ProjectStoreContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

const PROJECT_ID_RE = /^proj_[0-9a-f]{8}$/;

function makeProjectId(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return `proj_${out}`;
}

function normalizeProjectId(raw: string): string {
  return PROJECT_ID_RE.test(raw) ? raw : makeProjectId();
}

export function ProjectStoreProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const ws = useWs();
  const { token, useMock } = useAppContext();
  const isOnline = Boolean(token) || useMock;

  const [projects, setProjects] = useState<UiProject[]>(() =>
    isOnline ? [] : readOffline(),
  );
  const [loading, setLoading] = useState(isOnline);
  const [error, setError] = useState<Error | null>(null);
  const subsRef = useRef(new Set<(p: UiProject[]) => void>());

  const broadcast = useCallback((next: UiProject[]) => {
    setProjects(next);
    for (const fn of subsRef.current) fn(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!isOnline) {
      const offline = readOffline();
      broadcast(offline);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const summaries = await api.listProjects();
      const meta = readMeta();
      const ui = summaries.map((s) => summaryToUiProject(s, meta[s.id]));
      broadcast(ui);
    } catch (err) {
      const apiErr = err as ApiError;
      // 401 / network failure → fall back to offline view, but keep the error
      // so the UI can show a "daemon unreachable" banner if it wants.
      setError(apiErr instanceof Error ? apiErr : new Error(String(err)));
      broadcast(readOffline());
    } finally {
      setLoading(false);
    }
  }, [api, isOnline, broadcast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Daemon-side lifecycle signals — refresh list on relevant WS events.
  useEffect(() => {
    if (!isOnline) return;
    const offGraph = ws.on("graph_modified", () => {
      void refresh();
    });
    const offSession = ws.on("runtime_session_started", () => {
      void refresh();
    });
    const offNode = ws.on("node_status", () => {
      void refresh();
    });
    return () => {
      offGraph();
      offSession();
      offNode();
    };
  }, [ws, isOnline, refresh]);

  const store: ProjectStore = useMemo(() => {
    return {
      list: () => projects,
      get: (id) => projects.find((p) => p.id === id),
      create: async (partial) => {
        const name = partial.name ?? "nouveau-projet";
        const projectPath = partial.projectPath ?? `~/${name}`;
        const id = makeProjectId();
        const meta: UiProjectMeta = {
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
          createdBy: partial.createdBy ?? "user",
        };
        if (partial.config) meta.config = partial.config;
        if (partial.workflowStatus) meta.workflowStatus = partial.workflowStatus;
        if (partial.runningNode !== undefined) meta.runningNode = partial.runningNode;
        if (partial.runningAgent !== undefined) meta.runningAgent = partial.runningAgent;
        meta.nodeCount = { spec: 0, worker: 0, done: 0 };

        if (token) {
          // Real create through the daemon. Provider profile id defaults to
          // "default" so the wizard works for users with a single profile.
          const summary = await api.createProject({
            id,
            name,
            projectPath,
            providerProfileId: partial.providerProfileId ?? "default",
          });
          patchMeta(summary.id, meta);
          await refresh();
          return summaryToUiProject(summary, meta);
        }

        // Offline / mock: append a local-only entry so the wizard still works.
        const nowIso = new Date().toISOString();
        const ui: UiProject = {
          id,
          name,
          projectPath,
          createdAt: meta.createdAt ?? nowIso,
          lastActivityAt: meta.lastActivityAt ?? nowIso,
          status: partial.status ?? "pending",
          workflowStatus: partial.workflowStatus ?? "init",
          nodeCount: meta.nodeCount ?? { spec: 0, worker: 0, done: 0 },
          config: meta.config ?? { template: "—", stack: [], level: 1 },
          createdBy: meta.createdBy ?? "user",
          ...(partial.runningNode ? { runningNode: partial.runningNode } : {}),
          ...(partial.runningAgent ? { runningAgent: partial.runningAgent } : {}),
        };
        const next = [ui, ...projects];
        writeOffline(next);
        patchMeta(id, meta);
        broadcast(next);
        return ui;
      },
      update: (id, patch) => {
        // UI-side metadata patch only.
        const meta: UiProjectMeta = {};
        if (patch.config) meta.config = patch.config;
        if (patch.nodeCount) meta.nodeCount = patch.nodeCount;
        if (patch.workflowStatus) meta.workflowStatus = patch.workflowStatus;
        if (patch.lastActivityAt) meta.lastActivityAt = patch.lastActivityAt;
        if (patch.runningNode !== undefined) meta.runningNode = patch.runningNode;
        if (patch.runningAgent !== undefined) meta.runningAgent = patch.runningAgent;
        if (patch.createdBy) meta.createdBy = patch.createdBy;
        if (Object.keys(meta).length > 0) patchMeta(id, meta);
        const next = projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
        if (!isOnline) writeOffline(next);
        broadcast(next);
      },
      remove: async (id) => {
        if (token) {
          try {
            await api.deleteProject(normalizeProjectId(id));
          } catch (err) {
            // 404 means already gone — keep going.
            const status = (err as ApiError | undefined)?.status;
            if (status !== undefined && status !== 404) throw err;
          }
        }
        const next = projects.filter((p) => p.id !== id);
        if (!isOnline) writeOffline(next);
        const meta = readMeta();
        const { [id]: _omitted, ...rest } = meta;
        void _omitted;
        writeMeta(rest);
        broadcast(next);
      },
      reset: () => {
        if (isOnline) {
          void refresh();
          return;
        }
        try {
          localStorage.removeItem(OFFLINE_KEY);
        } catch {
          /* localStorage unavailable */
        }
        broadcast([...SEED_PROJECTS]);
      },
      subscribe: (handler) => {
        subsRef.current.add(handler);
        return () => {
          subsRef.current.delete(handler);
        };
      },
      simulateExternalProjectInit: async (name, path) =>
        store.create({
          name,
          projectPath: path,
          status: "running",
          workflowStatus: "spec",
          runningNode: "node-01 · constitution",
          runningAgent: "loom",
          createdBy: "cli",
        }),
    };
  }, [api, isOnline, projects, broadcast, refresh, token]);

  const value = useMemo(
    () => ({ projects, store, loading, error }),
    [projects, store, loading, error],
  );

  return <ProjectStoreContext.Provider value={value}>{children}</ProjectStoreContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

export function useProjectStore(): ProjectStoreContextValue {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) {
    throw new Error("useProjectStore must be used inside <ProjectStoreProvider>");
  }
  return ctx;
}

export function useProjects(): UiProject[] {
  return useProjectStore().projects;
}

export function useStore(): ProjectStore {
  return useProjectStore().store;
}

export function useProject(id: string | undefined): UiProject | undefined {
  const { projects } = useProjectStore();
  return useMemo(() => projects.find((p) => p.id === id), [projects, id]);
}
