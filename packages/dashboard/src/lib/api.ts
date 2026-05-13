// ============================================================================
// REST API Client
//
// Typed fetch wrapper for the Loomflo daemon REST API. Provides one method
// per endpoint surfaced by the daemon (Phase 4 backend).
//
// Auth: Bearer token in the Authorization header.
// Mock mode: when `useMock` is true, project-scoped routes are rerouted to
// the daemon's `/mock/*` fixtures (only when the daemon was started with
// LOOMFLO_MOCK_API=1).
// ============================================================================

import type {
  AgentCliName,
  ChatHistoryEntry,
  ChatResponse,
  CliAvailability,
  Config,
  CostsResponse,
  CreateProjectBody,
  DaemonStatusResponse,
  Event as WorkflowEvent,
  EventType,
  HealthResponse,
  InitResponse,
  InitWorkflowBody,
  McpServerConfigEntry,
  Memory,
  ModelInfo,
  Node as WorkflowNode,
  ProjectSummary,
  ProviderProfilePayload,
  RedactedProfile,
  ReviewReport,
  RuntimeListEntry,
  Specs,
  StartResponse,
  Workflow,
} from "./types.js";

// ============================================================================
// Errors
// ============================================================================

/** Thrown for any non-2xx HTTP response. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Thrown when the daemon returns 410 Gone (build / route mismatch). */
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

export interface ApiClientOptions {
  /** Daemon base URL (no trailing slash). */
  baseUrl: string;
  /** Bearer token issued by the daemon. */
  token: string;
  /** When true, project-scoped GETs reroute to /mock/* fixtures. */
  useMock?: boolean;
}

export interface EventsQuery {
  type?: EventType;
  nodeId?: string;
  limit?: number;
  offset?: number;
}

export interface EventsListResponse {
  events: WorkflowEvent[];
  total: number;
}

export interface MockSeedResponse {
  workflow: Workflow;
  events: WorkflowEvent[];
  projects: ProjectSummary[];
  clis: Record<AgentCliName, CliAvailability>;
}

// ============================================================================
// Implementation
// ============================================================================

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  /** When true, project-scoped GETs reroute to /mock/* fixtures. */
  readonly useMock: boolean;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.useMock = opts.useMock === true;
  }

  /** Resolved daemon base URL (no trailing slash). */
  get baseUrlValue(): string {
    return this.baseUrl;
  }

  /** Bearer token (read-only). */
  get tokenValue(): string {
    return this.token;
  }

  // --------------------------------------------------------------------------
  // Core request helpers
  // --------------------------------------------------------------------------

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (init.body !== undefined && headers["Content-Type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, { ...init, headers });

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
      const text = await safeBody(res);
      throw new ApiError(res.status, `HTTP ${String(res.status)} on ${path}`, text);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async requestText(path: string, init: RequestInit = {}): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await safeBody(res);
      throw new ApiError(res.status, `HTTP ${String(res.status)} on ${path}`, text);
    }
    return res.text();
  }

  /**
   * Reroute a project-scoped path to the daemon's `/mock/*` fixture if
   * mock mode is on and a fixture is available.
   *
   * Only applies to GETs that have a 1:1 mock counterpart. Calls with no
   * mock equivalent fall through to the real route.
   */
  private resolvePath(path: string): string {
    if (!this.useMock) return path;
    if (path === "/projects") return "/mock/projects";
    if (path.startsWith("/projects/") && path.endsWith("/workflow")) return "/mock/workflow";
    if (path.startsWith("/projects/") && path.includes("/events")) return "/mock/events";
    if (path === "/runtimes/availability") return "/mock/runtimes/availability";
    return path;
  }

  // --------------------------------------------------------------------------
  // Daemon-level
  // --------------------------------------------------------------------------

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  daemonStatus(): Promise<DaemonStatusResponse> {
    return this.request<DaemonStatusResponse>("/daemon/status");
  }

  // --------------------------------------------------------------------------
  // Runtimes
  // --------------------------------------------------------------------------

  listRuntimes(): Promise<{ runtimes: RuntimeListEntry[] }> {
    return this.request("/runtimes");
  }

  runtimeAvailability(): Promise<{ clis: Record<AgentCliName, CliAvailability> }> {
    return this.request(this.resolvePath("/runtimes/availability"));
  }

  runtimeAvailabilityFor(name: string): Promise<CliAvailability> {
    return this.request(`/runtimes/${encodeURIComponent(name)}/availability`);
  }

  runtimeModels(name: string): Promise<{ models: ModelInfo[] }> {
    return this.request(`/runtimes/${encodeURIComponent(name)}/models`);
  }

  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------

  listCredentials(): Promise<{ credentials: RedactedProfile[] }> {
    return this.request("/credentials");
  }

  upsertCredential(
    name: string,
    body: ProviderProfilePayload,
  ): Promise<{ credential: RedactedProfile }> {
    return this.request(`/credentials/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  deleteCredential(name: string): Promise<void> {
    return this.request(`/credentials/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  // --------------------------------------------------------------------------
  // Projects (daemon-level CRUD)
  // --------------------------------------------------------------------------

  listProjects(): Promise<ProjectSummary[]> {
    if (this.useMock) {
      return this.request<{ projects: ProjectSummary[] }>("/mock/projects").then(
        (res) => res.projects,
      );
    }
    return this.request<ProjectSummary[]>("/projects");
  }

  createProject(body: CreateProjectBody): Promise<ProjectSummary> {
    return this.request<ProjectSummary>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  getProject(id: string): Promise<ProjectSummary> {
    return this.request<ProjectSummary>(`/projects/${encodeURIComponent(id)}`);
  }

  deleteProject(id: string): Promise<void> {
    return this.request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // --------------------------------------------------------------------------
  // Per-project: workflow lifecycle
  // --------------------------------------------------------------------------

  getWorkflow(projectId: string): Promise<Workflow> {
    const path = this.resolvePath(`/projects/${encodeURIComponent(projectId)}/workflow`);
    if (this.useMock && path === "/mock/workflow") {
      return this.request<{ workflow: Workflow }>(path).then((r) => r.workflow);
    }
    return this.request<Workflow>(path);
  }

  initWorkflow(projectId: string, body: InitWorkflowBody): Promise<InitResponse> {
    return this.request<InitResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflow/init`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  startWorkflow(projectId: string): Promise<StartResponse> {
    return this.request<StartResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflow/start`,
      { method: "POST" },
    );
  }

  pauseWorkflow(projectId: string): Promise<StartResponse> {
    return this.request<StartResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflow/pause`,
      { method: "POST" },
    );
  }

  resumeWorkflow(projectId: string): Promise<StartResponse> {
    return this.request<StartResponse>(
      `/projects/${encodeURIComponent(projectId)}/workflow/resume`,
      { method: "POST" },
    );
  }

  // --------------------------------------------------------------------------
  // Per-project: events
  // --------------------------------------------------------------------------

  getEvents(projectId: string, query: EventsQuery = {}): Promise<EventsListResponse> {
    const qs = new URLSearchParams();
    if (query.type !== undefined) qs.set("type", query.type);
    if (query.nodeId !== undefined) qs.set("nodeId", query.nodeId);
    if (query.limit !== undefined) qs.set("limit", String(query.limit));
    if (query.offset !== undefined) qs.set("offset", String(query.offset));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    const path = this.resolvePath(`/projects/${encodeURIComponent(projectId)}/events${suffix}`);

    if (this.useMock && path === "/mock/events") {
      return this.request<{ events: WorkflowEvent[] }>(path).then((r) => ({
        events: r.events,
        total: r.events.length,
      }));
    }
    return this.request<EventsListResponse>(path);
  }

  // --------------------------------------------------------------------------
  // Per-project: chat
  // --------------------------------------------------------------------------

  postChat(projectId: string, message: string): Promise<ChatResponse> {
    return this.request<ChatResponse>(`/projects/${encodeURIComponent(projectId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  }

  getChatHistory(projectId: string): Promise<{ messages: ChatHistoryEntry[] }> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/chat/history`);
  }

  // --------------------------------------------------------------------------
  // Per-project: nodes
  // --------------------------------------------------------------------------

  listNodes(projectId: string): Promise<WorkflowNode[]> {
    return this.request<WorkflowNode[]>(`/projects/${encodeURIComponent(projectId)}/nodes`);
  }

  getNode(projectId: string, nodeId: string): Promise<WorkflowNode> {
    return this.request<WorkflowNode>(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`,
    );
  }

  getReview(projectId: string, nodeId: string): Promise<ReviewReport> {
    return this.request<ReviewReport>(
      `/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/review`,
    );
  }

  // --------------------------------------------------------------------------
  // Per-project: memory
  // --------------------------------------------------------------------------

  listMemory(projectId: string): Promise<Memory> {
    return this.request<Memory>(`/projects/${encodeURIComponent(projectId)}/memory`);
  }

  /** Returns raw markdown (text/markdown, not JSON). */
  readMemory(projectId: string, name: string): Promise<string> {
    return this.requestText(
      `/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(name)}`,
    );
  }

  // --------------------------------------------------------------------------
  // Per-project: costs
  // --------------------------------------------------------------------------

  getCosts(projectId: string): Promise<CostsResponse> {
    return this.request<CostsResponse>(`/projects/${encodeURIComponent(projectId)}/costs`);
  }

  // --------------------------------------------------------------------------
  // Per-project: config
  // --------------------------------------------------------------------------

  getConfig(projectId: string): Promise<{ config: Config }> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/config`);
  }

  updateConfig(projectId: string, partial: Partial<Config>): Promise<{ config: Config }> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/config`, {
      method: "PUT",
      body: JSON.stringify(partial),
    });
  }

  // --------------------------------------------------------------------------
  // Per-project: specs
  // --------------------------------------------------------------------------

  listSpecs(projectId: string): Promise<Specs> {
    return this.request<Specs>(`/projects/${encodeURIComponent(projectId)}/specs`);
  }

  readSpec(projectId: string, name: string): Promise<string> {
    return this.requestText(
      `/projects/${encodeURIComponent(projectId)}/specs/${encodeURIComponent(name)}`,
    );
  }

  // --------------------------------------------------------------------------
  // Per-project: MCP
  // --------------------------------------------------------------------------

  listMcp(projectId: string): Promise<{ servers: Record<string, McpServerConfigEntry> }> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/mcp`);
  }

  upsertMcp(
    projectId: string,
    name: string,
    entry: McpServerConfigEntry,
  ): Promise<{ server: McpServerConfigEntry }> {
    return this.request(
      `/projects/${encodeURIComponent(projectId)}/mcp/${encodeURIComponent(name)}`,
      { method: "PUT", body: JSON.stringify(entry) },
    );
  }

  deleteMcp(projectId: string, name: string): Promise<void> {
    return this.request(
      `/projects/${encodeURIComponent(projectId)}/mcp/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
  }

  // --------------------------------------------------------------------------
  // Mock helpers (only useful in mock mode)
  // --------------------------------------------------------------------------

  mockSeed(): Promise<MockSeedResponse> {
    return this.request<MockSeedResponse>("/mock/seed");
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function safeBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return undefined;
    }
  }
}
