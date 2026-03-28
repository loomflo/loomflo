// ============================================================================
// REST API Client
//
// Typed fetch wrapper for the Loomflo daemon REST API.
// Uses Vite proxy in development (/api → daemon).
// ============================================================================

import type {
  Config,
  Event,
  EventType,
  NodeStatus,
  ReviewReport,
  Workflow,
  WorkflowStatus,
} from './types.js';

// ============================================================================
// Response Interfaces
// ============================================================================

/** Health-check workflow summary (subset of full Workflow). */
export interface HealthWorkflowSummary {
  /** Workflow identifier. */
  id: string;
  /** Current workflow status. */
  status: WorkflowStatus;
  /** Total nodes in the graph. */
  nodeCount: number;
  /** IDs of currently executing nodes. */
  activeNodes: string[];
}

/** Response from GET /health. */
export interface HealthResponse {
  /** Daemon status indicator. */
  status: string;
  /** Daemon uptime in seconds. */
  uptime: number;
  /** Daemon version string. */
  version: string;
  /** Active workflow summary, or null if no workflow is loaded. */
  workflow: HealthWorkflowSummary | null;
}

/** Response from POST /workflow/init. */
export interface WorkflowInitResponse {
  /** Newly created workflow identifier. */
  id: string;
  /** Initial workflow status (typically "spec"). */
  status: WorkflowStatus;
  /** Echo of the project description. */
  description: string;
}

/** Response from POST /workflow/start, /workflow/pause, /workflow/resume. */
export interface WorkflowActionResponse {
  /** Resulting workflow status after the action. */
  status: WorkflowStatus;
  /** Node ID from which execution resumes (present on resume). */
  resumingFrom?: string;
}

/** Summary of a node returned by the list endpoint. */
export interface NodeSummary {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node title. */
  title: string;
  /** Current node status. */
  status: NodeStatus;
  /** Number of agents assigned to this node. */
  agentCount: number;
  /** Accumulated cost in USD. */
  cost: number;
  /** Number of retry cycles attempted. */
  retryCount: number;
}

/** Response from GET /nodes. */
export interface NodesListResponse {
  /** All nodes in the workflow graph. */
  nodes: NodeSummary[];
}

/** Response from GET /nodes/:id. */
export interface NodeDetailResponse {
  /** Unique node identifier. */
  id: string;
  /** Human-readable node title. */
  title: string;
  /** Current node status. */
  status: NodeStatus;
  /** Markdown instructions for this node. */
  instructions: string;
  /** Delay before activation. */
  delay: string;
  /** Number of retry cycles attempted. */
  retryCount: number;
  /** Maximum allowed retry cycles. */
  maxRetries: number;
  /** Accumulated cost in USD. */
  cost: number;
  /** ISO 8601 timestamp when the node started, or null. */
  startedAt: string | null;
  /** Agents assigned to this node. */
  agents: {
    /** Agent identifier. */
    id: string;
    /** Agent role. */
    role: string;
    /** Agent lifecycle state. */
    status: string;
    /** Description of the agent's task. */
    taskDescription: string;
    /** File write scope glob patterns. */
    writeScope: string[];
    /** Cumulative token usage. */
    tokenUsage: { input: number; output: number };
    /** Cumulative cost in USD. */
    cost: number;
  }[];
  /** Agent ID to glob patterns mapping. */
  fileOwnership: Record<string, string[]>;
}

/** Metadata for a spec artifact. */
export interface SpecArtifact {
  /** Artifact file name. */
  name: string;
  /** Relative path within the project. */
  path: string;
  /** File size in bytes. */
  size: number;
}

/** Response from GET /specs. */
export interface SpecsListResponse {
  /** Available spec artifacts. */
  artifacts: SpecArtifact[];
}

/** Metadata for a shared memory file. */
export interface MemoryFile {
  /** Memory file name. */
  name: string;
  /** Agent ID that last modified this file. */
  lastModifiedBy: string;
  /** ISO 8601 timestamp of last modification. */
  lastModifiedAt: string;
}

/** Response from GET /memory. */
export interface MemoryListResponse {
  /** Shared memory files. */
  files: MemoryFile[];
}

/** An action taken by Loom in response to a chat message. */
export interface ChatAction {
  /** Action type identifier (e.g., "graph_modified"). */
  type: string;
  /** Action-specific payload. */
  details: Record<string, unknown>;
}

/** Response from POST /chat. */
export interface ChatResponse {
  /** Loom's textual response. */
  response: string;
  /** Action taken by Loom, or null if no action. */
  action: ChatAction | null;
}

/** A single message in chat history. */
export interface ChatMessage {
  /** Message author: "user" or "assistant". */
  role: 'user' | 'assistant';
  /** Message text content. */
  content: string;
  /** ISO 8601 timestamp when the message was sent. */
  timestamp: string;
}

/** Response from GET /chat/history. */
export interface ChatHistoryResponse {
  /** Full chat message history. */
  messages: ChatMessage[];
}

/** Per-node cost summary entry. */
export interface NodeCostEntry {
  /** Node identifier. */
  id: string;
  /** Node title. */
  title: string;
  /** Cost in USD for this node. */
  cost: number;
  /** Number of retry cycles. */
  retries: number;
}

/** Response from GET /costs. */
export interface CostsResponse {
  /** Total cost in USD across all nodes. */
  total: number;
  /** Configured budget limit in USD. */
  budgetLimit: number | null;
  /** Remaining budget in USD. */
  budgetRemaining: number | null;
  /** Per-node cost breakdown. */
  nodes: NodeCostEntry[];
  /** Cost in USD attributed to Loom (architect) interactions. */
  loomCost: number;
}

/** Response from GET /events. */
export interface EventsResponse {
  /** Matching events. */
  events: Event[];
  /** Total number of events matching the filter (before pagination). */
  total: number;
}

/** Query parameters for GET /events. */
export interface EventsParams {
  /** Filter by event type. */
  type?: EventType;
  /** Filter by node ID. */
  nodeId?: string;
  /** Maximum number of events to return. */
  limit?: number;
  /** Number of events to skip (for pagination). */
  offset?: number;
}

/** Daemon error response body. */
export interface ErrorBody {
  /** Human-readable error message. */
  error: string;
  /** Additional error details. */
  details?: unknown;
}

// ============================================================================
// ApiError
// ============================================================================

/** Error thrown when the API returns a non-OK HTTP response. */
export class ApiError extends Error {
  /** HTTP status code. */
  public readonly status: number;

  /** Parsed response body, or raw text if JSON parsing failed. */
  public readonly body: ErrorBody | string;

  /**
   * @param status - HTTP status code from the response.
   * @param body - Parsed error body or raw response text.
   * @param message - Human-readable error summary.
   */
  constructor(status: number, body: ErrorBody | string, message?: string) {
    const msg =
      message ??
      (typeof body === 'object' ? body.error : `API error ${status}`);
    super(msg);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// ============================================================================
// ApiClient
// ============================================================================

/**
 * Typed HTTP client for the Loomflo daemon REST API.
 *
 * In development the Vite dev server proxies `/api` to the daemon,
 * so the default base URL is an empty string. For direct connections
 * pass the full daemon origin (e.g., `http://127.0.0.1:3100`).
 */
export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  /**
   * @param baseUrl - Base URL prepended to every request path.
   *                  Defaults to `""` (uses Vite proxy in development).
   */
  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * Set the Bearer token used for authenticated requests.
   *
   * @param token - The daemon auth token, or `null` to clear.
   */
  setToken(token: string | null): void {
    this.token = token;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  /**
   * Build request headers including Authorization when a token is set.
   *
   * @param extra - Additional headers to merge.
   * @returns Merged headers object.
   */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Execute an HTTP request and parse the response as JSON.
   *
   * @typeParam T - Expected JSON response type.
   * @param path - Request path (e.g., `/api/health`).
   * @param options - Fetch options (method, body, etc.).
   * @returns Parsed JSON response body.
   * @throws {ApiError} When the response status is not OK.
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = this.buildHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    });

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let body: ErrorBody | string;
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        body = await response.text();
      }
      throw new ApiError(response.status, body);
    }

    return (await response.json()) as T;
  }

  /**
   * Execute an HTTP request and return the response as plain text.
   *
   * @param path - Request path (e.g., `/api/specs/spec.md`).
   * @param options - Fetch options (method, body, etc.).
   * @returns Raw response text.
   * @throws {ApiError} When the response status is not OK.
   */
  private async requestText(path: string, options: RequestInit = {}): Promise<string> {
    const headers = this.buildHeaders({
      Accept: 'text/markdown, text/plain',
      ...(options.headers as Record<string, string> | undefined),
    });

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let body: ErrorBody | string;
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        body = await response.text();
      }
      throw new ApiError(response.status, body);
    }

    return response.text();
  }

  // --------------------------------------------------------------------------
  // Health
  // --------------------------------------------------------------------------

  /**
   * Check daemon health. No authentication required.
   *
   * @returns Daemon status, uptime, version, and optional workflow summary.
   */
  async getHealth(): Promise<HealthResponse> {
    // Health endpoint does not require auth — bypass token injection.
    const response = await fetch(`${this.baseUrl}/api/health`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      let body: ErrorBody | string;
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        body = await response.text();
      }
      throw new ApiError(response.status, body);
    }

    return (await response.json()) as HealthResponse;
  }

  // --------------------------------------------------------------------------
  // Workflow
  // --------------------------------------------------------------------------

  /**
   * Retrieve the current workflow state.
   *
   * @returns Full workflow object including graph and configuration.
   * @throws {ApiError} 404 if no active workflow exists.
   */
  async getWorkflow(): Promise<Workflow> {
    return this.request<Workflow>('/api/workflow');
  }

  /**
   * Initialize a new workflow from a natural language description.
   *
   * @param description - Project description in natural language.
   * @param projectPath - Absolute filesystem path for the project workspace.
   * @param config - Optional partial configuration overrides.
   * @returns The newly created workflow summary.
   * @throws {ApiError} 409 if a workflow is already active.
   */
  async initWorkflow(
    description: string,
    projectPath: string,
    config?: Partial<Config>,
  ): Promise<WorkflowInitResponse> {
    return this.request<WorkflowInitResponse>('/api/workflow/init', {
      method: 'POST',
      body: JSON.stringify({ description, projectPath, config }),
    });
  }

  /**
   * Confirm the spec and begin workflow execution (Phase 2).
   *
   * @returns Updated workflow status.
   * @throws {ApiError} 400 if the workflow is not in the "building" state.
   */
  async startWorkflow(): Promise<WorkflowActionResponse> {
    return this.request<WorkflowActionResponse>('/api/workflow/start', {
      method: 'POST',
    });
  }

  /**
   * Pause the running workflow. Active agent calls finish; no new calls are dispatched.
   *
   * @returns Updated workflow status.
   * @throws {ApiError} 400 if the workflow is not running.
   */
  async pauseWorkflow(): Promise<WorkflowActionResponse> {
    return this.request<WorkflowActionResponse>('/api/workflow/pause', {
      method: 'POST',
    });
  }

  /**
   * Resume a paused or interrupted workflow.
   *
   * @returns Updated workflow status and the node from which execution resumes.
   * @throws {ApiError} 400 if there is nothing to resume.
   */
  async resumeWorkflow(): Promise<WorkflowActionResponse> {
    return this.request<WorkflowActionResponse>('/api/workflow/resume', {
      method: 'POST',
    });
  }

  // --------------------------------------------------------------------------
  // Nodes
  // --------------------------------------------------------------------------

  /**
   * List all nodes in the workflow graph.
   *
   * @returns Array of node summaries.
   */
  async getNodes(): Promise<NodesListResponse> {
    return this.request<NodesListResponse>('/api/nodes');
  }

  /**
   * Retrieve detailed information for a single node.
   *
   * @param id - Node identifier (e.g., "node-1").
   * @returns Full node detail including agents and file ownership.
   * @throws {ApiError} 404 if the node does not exist.
   */
  async getNode(id: string): Promise<NodeDetailResponse> {
    return this.request<NodeDetailResponse>(`/api/nodes/${encodeURIComponent(id)}`);
  }

  /**
   * Retrieve the Loomex review report for a completed node.
   *
   * @param id - Node identifier.
   * @returns Structured review report with verdict and task verifications.
   * @throws {ApiError} 404 if no review report exists for this node.
   */
  async getNodeReview(id: string): Promise<ReviewReport> {
    return this.request<ReviewReport>(`/api/nodes/${encodeURIComponent(id)}/review`);
  }

  // --------------------------------------------------------------------------
  // Specs
  // --------------------------------------------------------------------------

  /**
   * List available spec artifacts.
   *
   * @returns Array of spec artifact metadata.
   */
  async getSpecs(): Promise<SpecsListResponse> {
    return this.request<SpecsListResponse>('/api/specs');
  }

  /**
   * Read a specific spec artifact as raw markdown.
   *
   * @param name - Artifact file name (e.g., "spec.md").
   * @returns Raw markdown content of the artifact.
   * @throws {ApiError} 404 if the artifact does not exist.
   */
  async getSpec(name: string): Promise<string> {
    return this.requestText(`/api/specs/${encodeURIComponent(name)}`);
  }

  // --------------------------------------------------------------------------
  // Shared Memory
  // --------------------------------------------------------------------------

  /**
   * List shared memory files.
   *
   * @returns Array of memory file metadata.
   */
  async getMemory(): Promise<MemoryListResponse> {
    return this.request<MemoryListResponse>('/api/memory');
  }

  /**
   * Read a specific shared memory file as raw markdown.
   *
   * @param name - Memory file name (e.g., "DECISIONS.md").
   * @returns Raw markdown content of the memory file.
   * @throws {ApiError} 404 if the memory file does not exist.
   */
  async getMemoryFile(name: string): Promise<string> {
    return this.requestText(`/api/memory/${encodeURIComponent(name)}`);
  }

  // --------------------------------------------------------------------------
  // Chat
  // --------------------------------------------------------------------------

  /**
   * Send a message to Loom and receive a response.
   *
   * @param message - Natural language message to Loom.
   * @returns Loom's response text and any action taken.
   */
  async chat(message: string): Promise<ChatResponse> {
    return this.request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  /**
   * Retrieve the full chat message history.
   *
   * @returns Ordered list of all chat messages.
   */
  async getChatHistory(): Promise<ChatHistoryResponse> {
    return this.request<ChatHistoryResponse>('/api/chat/history');
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Retrieve the current merged configuration.
   *
   * @returns Full resolved configuration object.
   */
  async getConfig(): Promise<Config> {
    return this.request<Config>('/api/config');
  }

  /**
   * Update configuration. Changes take effect at the next node activation.
   *
   * @param config - Partial configuration fields to update.
   * @returns The full updated configuration object.
   * @throws {ApiError} 400 if validation fails.
   */
  async updateConfig(config: Partial<Config>): Promise<Config> {
    return this.request<Config>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // --------------------------------------------------------------------------
  // Costs
  // --------------------------------------------------------------------------

  /**
   * Retrieve the cost summary for the current workflow.
   *
   * @returns Total cost, budget info, per-node breakdown, and Loom cost.
   */
  async getCosts(): Promise<CostsResponse> {
    return this.request<CostsResponse>('/api/costs');
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  /**
   * Query the event log with optional filters.
   *
   * @param params - Optional filter and pagination parameters.
   * @returns Matching events and total count.
   */
  async getEvents(params?: EventsParams): Promise<EventsResponse> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.nodeId) searchParams.set('nodeId', params.nodeId);
    if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));

    const query = searchParams.toString();
    const path = query ? `/api/events?${query}` : '/api/events';
    return this.request<EventsResponse>(path);
  }
}

// ============================================================================
// Singleton
// ============================================================================

/** Pre-configured API client instance for use throughout the dashboard. */
export const apiClient = new ApiClient();
