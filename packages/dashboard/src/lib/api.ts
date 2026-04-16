// ============================================================================
// REST API Client
//
// Typed fetch wrapper for the Loomflo daemon REST API.
// All resource endpoints are scoped under /projects/:id/*.
// ============================================================================

import type {
  ChatBody,
  ChatResponse,
  Config,
  CostSummary as Costs,
  Event as WorkflowEvent,
  Memory,
  Node as WorkflowNode,
  ProjectDetail,
  ProjectSummary,
  Specs,
  Workflow,
} from "./types.js";

// ============================================================================
// Errors
// ============================================================================

/** Thrown when the daemon returns 410 Gone, indicating a client/server mismatch. */
export class DashboardOutdatedError extends Error {
  readonly code = "DASHBOARD_OUTDATED";
  readonly newRoute?: string;
  constructor(message: string, newRoute?: string) {
    super(message);
    this.newRoute = newRoute;
  }
}

// ============================================================================
// Public API types
// ============================================================================

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
  getEvents(
    projectId: string,
    opts?: { type?: string; limit?: number; offset?: number },
  ): Promise<WorkflowEvent[]>;
  getCosts(projectId: string): Promise<Costs>;
  getConfig(projectId: string): Promise<Record<string, unknown>>;
  getMemory(projectId: string): Promise<Memory>;
  getSpecs(projectId: string): Promise<Specs>;
  postChat(projectId: string, body: ChatBody): Promise<ChatResponse>;
}

// ============================================================================
// Factory
// ============================================================================

export function api(opts: ApiOptions): ApiClient {
  const headers = { authorization: `Bearer ${opts.token}` };

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${opts.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
        "content-type": "application/json",
      },
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

  const base = (id: string, sub: string): string =>
    `/projects/${encodeURIComponent(id)}${sub}`;

  return {
    listProjects: () => req<ProjectSummary[]>("/projects"),

    getProject: (id) => req<ProjectDetail>(base(id, "")),

    getWorkflow: (id) => req<Workflow>(base(id, "/workflow")),

    getNodes: (id) => req<WorkflowNode[]>(base(id, "/nodes")),

    getNode: (id, nodeId) =>
      req<WorkflowNode>(base(id, `/nodes/${encodeURIComponent(nodeId)}`)),

    getEvents: (id, o) => {
      const q = new URLSearchParams();
      if (o?.type !== undefined) q.set("type", o.type);
      if (o?.limit !== undefined) q.set("limit", String(o.limit));
      if (o?.offset !== undefined) q.set("offset", String(o.offset));
      const suffix = q.size > 0 ? `?${q.toString()}` : "";
      return req<WorkflowEvent[]>(base(id, `/events${suffix}`));
    },

    getCosts: (id) => req<Costs>(base(id, "/costs")),

    getConfig: (id) => req<Record<string, unknown>>(base(id, "/config")),

    getMemory: (id) => req<Memory>(base(id, "/memory")),

    getSpecs: (id) => req<Specs>(base(id, "/specs")),

    postChat: (id, body) =>
      req<ChatResponse>(base(id, "/chat"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
  };
}
