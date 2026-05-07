import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UiProject, UiProjectStatus, WorkflowStatus, AgentRole, Level } from "../lib/types.js";
import { SEED_PROJECTS } from "../lib/mock-data.js";

const STORAGE_KEY = "loomflo.projects";
const storeBus = new EventTarget();

function loadProjects(): UiProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_PROJECTS));
      return [...SEED_PROJECTS];
    }
    return JSON.parse(raw) as UiProject[];
  } catch {
    return [...SEED_PROJECTS];
  }
}

function saveProjects(projects: UiProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    /* localStorage unavailable */
  }
  storeBus.dispatchEvent(new CustomEvent("change", { detail: projects }));
}

export interface ProjectInitPartial {
  name?: string;
  projectPath?: string;
  status?: UiProjectStatus;
  workflowStatus?: WorkflowStatus;
  config?: { template: string; stack: string[]; level: Level };
  createdBy?: "user" | "cli";
  runningNode?: string;
  runningAgent?: AgentRole;
}

export interface ProjectStore {
  list(): UiProject[];
  get(id: string): UiProject | undefined;
  create(partial: ProjectInitPartial): UiProject;
  update(id: string, patch: Partial<UiProject>): void;
  remove(id: string): void;
  reset(): void;
  subscribe(handler: (projects: UiProject[]) => void): () => void;
  simulateExternalProjectInit(name: string, path: string): UiProject;
}

const projectStore: ProjectStore = {
  list() {
    return loadProjects();
  },
  get(id) {
    return loadProjects().find((p) => p.id === id);
  },
  create(partial) {
    const next: UiProject = {
      id: "p_" + Math.random().toString(36).slice(2, 9),
      name: partial.name || "nouveau-projet",
      projectPath:
        partial.projectPath || "/Users/adrien/dev/" + (partial.name || "nouveau-projet"),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      status: partial.status ?? "pending",
      workflowStatus: partial.workflowStatus ?? "init",
      nodeCount: { spec: 0, worker: 0, done: 0 },
      config: partial.config || { template: "—", stack: [], level: 1 },
      createdBy: partial.createdBy || "user",
      ...(partial.runningNode ? { runningNode: partial.runningNode } : {}),
      ...(partial.runningAgent ? { runningAgent: partial.runningAgent } : {}),
    };
    const all = loadProjects();
    saveProjects([next, ...all]);
    return next;
  },
  update(id, patch) {
    const all = loadProjects().map((p) => (p.id === id ? { ...p, ...patch } : p));
    saveProjects(all);
  },
  remove(id) {
    saveProjects(loadProjects().filter((p) => p.id !== id));
  },
  reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* localStorage unavailable */
    }
    saveProjects([...SEED_PROJECTS]);
  },
  subscribe(handler) {
    const listener = (e: Event) => handler((e as CustomEvent<UiProject[]>).detail);
    storeBus.addEventListener("change", listener);
    return () => storeBus.removeEventListener("change", listener);
  },
  simulateExternalProjectInit(name, path) {
    return this.create({
      name,
      projectPath: path,
      status: "running",
      workflowStatus: "spec",
      runningNode: "node-01 · constitution",
      runningAgent: "loom",
      createdBy: "cli",
    });
  },
};

interface ProjectStoreContextValue {
  projects: UiProject[];
  store: ProjectStore;
}

const ProjectStoreContext = createContext<ProjectStoreContextValue>({
  projects: [],
  store: projectStore,
});

export function ProjectStoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<UiProject[]>(() => projectStore.list());

  useEffect(() => projectStore.subscribe(setProjects), []);

  const value = useMemo(() => ({ projects, store: projectStore }), [projects]);
  return <ProjectStoreContext.Provider value={value}>{children}</ProjectStoreContext.Provider>;
}

export function useProjectStore(): ProjectStoreContextValue {
  return useContext(ProjectStoreContext);
}

export function useProjects(): UiProject[] {
  return useProjectStore().projects;
}

export function useStore(): ProjectStore {
  return useProjectStore().store;
}

export function useProject(id: string | undefined): UiProject | undefined {
  const { projects } = useProjectStore();
  return useCallback(() => projects.find((p) => p.id === id), [projects, id])();
}
