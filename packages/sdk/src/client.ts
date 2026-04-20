/**
 * Loomflo SDK client — wraps the Loomflo daemon REST API and WebSocket event stream.
 *
 * Zero runtime dependencies. Uses the built-in `fetch` and `WebSocket` APIs
 * available in Node.js 22+.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Error thrown when a Loomflo daemon API request fails with a non-2xx status.
 */
export class LoomfloApiError extends Error {
  /** HTTP status code returned by the daemon. */
  public readonly status: number;
  /** Raw response body (parsed JSON when available, raw text otherwise). */
  public readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "LoomfloApiError";
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** Workflow summary embedded in the health response. */
export interface HealthWorkflowSummary {
  id: string;
  status: string;
  nodeCount: number;
  activeNodes: string[];
}

/** Response from `GET /health`. */
export interface HealthResponse {
  status: string;
  uptime: number;
  version: string;
  workflow: HealthWorkflowSummary | null;
}

/** Graph structure embedded in the workflow response. */
export interface WorkflowGraph {
  nodes: unknown[];
  edges: unknown[];
  topology: string;
}

/** Response from `GET /workflow`. */
export interface WorkflowResponse {
  id: string;
  status: string;
  description: string;
  projectPath: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  graph: WorkflowGraph;
}

/** Response from `POST /workflow/init`. */
export interface InitResponse {
  id: string;
  status: string;
  description: string;
}

/** Action taken by Loom in response to a chat message. */
export interface ChatAction {
  type: string;
  details: Record<string, unknown>;
}

/** Response from `POST /chat`. */
export interface ChatResponse {
  response: string;
  action: ChatAction | null;
}

/** Single message in the chat history. */
export interface ChatMessage {
  role: string;
  content: string;
  timestamp: string;
}

/** Response from `GET /chat/history`. */
export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

/** Summary of a single node returned by `GET /nodes`. */
export interface NodeSummary {
  id: string;
  title: string;
  status: string;
  agentCount: number;
  cost: number;
  retryCount: number;
}

/** Token usage for a single agent. */
export interface AgentTokenUsage {
  input: number;
  output: number;
}

/** Agent detail within a node. */
export interface AgentDetail {
  id: string;
  role: string;
  status: string;
  taskDescription: string;
  writeScope: string[];
  tokenUsage: AgentTokenUsage;
  cost: number;
}

/** Response from `GET /nodes/:id`. */
export interface NodeDetailResponse {
  id: string;
  title: string;
  status: string;
  instructions: string;
  delay: string;
  retryCount: number;
  maxRetries: number;
  cost: number;
  startedAt: string;
  agents: AgentDetail[];
  fileOwnership: Record<string, string[]>;
}

/** Per-node cost entry. */
export interface NodeCost {
  id: string;
  title: string;
  cost: number;
  retries: number;
}

/** Response from `GET /costs`. */
export interface CostsResponse {
  total: number;
  budgetLimit: number;
  budgetRemaining: number;
  nodes: NodeCost[];
  loomCost: number;
}

/** Single event in the event log. */
export interface WorkflowEvent {
  ts: string;
  type: string;
  nodeId: string | null;
  agentId: string | null;
  details: Record<string, unknown>;
}

/** Response from `GET /events`. */
export interface EventsResponse {
  events: WorkflowEvent[];
  total: number;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

/** Options for constructing a {@link LoomfloClient}. */
export interface LoomfloClientOptions {
  /** Daemon host. Defaults to `"127.0.0.1"`. */
  host?: string;
  /** Daemon port. Defaults to `3000`. */
  port?: number;
  /** Authentication token (required). */
  token: string;
}

// ---------------------------------------------------------------------------
// Event callback type
// ---------------------------------------------------------------------------

/** Callback invoked when a WebSocket event of the subscribed type is received. */
export type EventCallback = (event: unknown) => void;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Programmatic client for the Loomflo daemon.
 *
 * Wraps the REST API for issuing commands and the WebSocket stream for
 * receiving real-time events. Uses only built-in Node.js APIs (`fetch`,
 * `WebSocket`) — no runtime dependencies required.
 *
 * @example
 * ```ts
 * const client = new LoomfloClient({ token: 'my-token' });
 * const health = await client.health();
 *
 * await client.connect();
 * const unsub = client.onEvent('node_status', (evt) => console.log(evt));
 * // later…
 * unsub();
 * client.disconnect();
 * ```
 */
export class LoomfloClient {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly token: string;
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * Create a new LoomfloClient.
   *
   * @param options - Connection options including host, port, and auth token.
   */
  constructor(options: LoomfloClientOptions) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 3000;
    this.token = options.token;
    this.baseUrl = `http://${host}:${String(port)}`;
    this.wsUrl = `ws://${host}:${String(port)}`;
  }

  // -------------------------------------------------------------------------
  // REST API — Health
  // -------------------------------------------------------------------------

  /**
   * Check daemon health. Does not require authentication.
   *
   * @returns The daemon health status including optional workflow summary.
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  // -------------------------------------------------------------------------
  // REST API — Workflow
  // -------------------------------------------------------------------------

  /**
   * Get the current workflow state.
   *
   * @returns The workflow state, or `null` if no workflow is active.
   */
  async getWorkflow(): Promise<WorkflowResponse | null> {
    try {
      return await this.request<WorkflowResponse>("GET", "/workflow");
    } catch (err: unknown) {
      if (err instanceof LoomfloApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Initialize a new workflow from a natural-language description.
   *
   * @param description - What the workflow should build.
   * @param projectPath - Absolute path to the target project directory.
   * @param config - Optional workflow configuration overrides.
   * @returns The newly created workflow summary.
   */
  async init(
    description: string,
    projectPath: string,
    config?: Record<string, unknown>,
  ): Promise<InitResponse> {
    return this.request<InitResponse>("POST", "/workflow/init", {
      description,
      projectPath,
      config,
    });
  }

  /**
   * Confirm the generated spec and begin Phase 2 execution.
   */
  async start(): Promise<void> {
    await this.request<unknown>("POST", "/workflow/start");
  }

  /**
   * Pause the running workflow. Active agent calls finish; no new calls are
   * dispatched.
   */
  async pause(): Promise<void> {
    await this.request<unknown>("POST", "/workflow/pause");
  }

  /**
   * Resume a paused or interrupted workflow.
   */
  async resume(): Promise<void> {
    await this.request<unknown>("POST", "/workflow/resume");
  }

  // -------------------------------------------------------------------------
  // REST API — Chat
  // -------------------------------------------------------------------------

  /**
   * Send a chat message to Loom (the architect agent).
   *
   * @param message - The user's message.
   * @returns Loom's response and any action taken.
   */
  async chat(message: string): Promise<ChatResponse> {
    return this.request<ChatResponse>("POST", "/chat", { message });
  }

  /**
   * Retrieve the full chat history.
   *
   * @returns All chat messages exchanged with Loom.
   */
  async chatHistory(): Promise<ChatHistoryResponse> {
    return this.request<ChatHistoryResponse>("GET", "/chat/history");
  }

  // -------------------------------------------------------------------------
  // REST API — Nodes
  // -------------------------------------------------------------------------

  /**
   * List all nodes in the workflow graph.
   *
   * @returns An array of node summaries.
   */
  async getNodes(): Promise<NodeSummary[]> {
    const data = await this.request<{ nodes: NodeSummary[] }>("GET", "/nodes");
    return data.nodes;
  }

  /**
   * Get detailed information about a single node including its agents.
   *
   * @param nodeId - The node identifier.
   * @returns Full node detail with agents and file ownership.
   */
  async getNode(nodeId: string): Promise<NodeDetailResponse> {
    return this.request<NodeDetailResponse>("GET", `/nodes/${encodeURIComponent(nodeId)}`);
  }

  // -------------------------------------------------------------------------
  // REST API — Specs
  // -------------------------------------------------------------------------

  /**
   * List available spec artifact names.
   *
   * @returns An array of artifact names (e.g. `["spec.md", "plan.md"]`).
   */
  async getSpecs(): Promise<string[]> {
    const data = await this.request<{
      artifacts: Array<{ name: string; path: string; size: number }>;
    }>("GET", "/specs");
    return data.artifacts.map((a) => a.name);
  }

  /**
   * Read a specific spec artifact.
   *
   * @param name - Artifact filename (e.g. `"spec.md"`).
   * @returns The raw markdown content of the artifact.
   */
  async getSpec(name: string): Promise<string> {
    const url = `${this.baseUrl}/specs/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new LoomfloApiError(
        res.status,
        `GET /specs/${name} failed with status ${String(res.status)}`,
        body,
      );
    }

    return res.text();
  }

  // -------------------------------------------------------------------------
  // REST API — Costs
  // -------------------------------------------------------------------------

  /**
   * Get the cost summary for the current workflow.
   *
   * @returns Cost breakdown by node and totals.
   */
  async getCosts(): Promise<CostsResponse> {
    return this.request<CostsResponse>("GET", "/costs");
  }

  // -------------------------------------------------------------------------
  // REST API — Configuration
  // -------------------------------------------------------------------------

  /**
   * Get the current merged daemon configuration.
   *
   * @returns The configuration key-value map.
   */
  async getConfig(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/config");
  }

  /**
   * Update daemon configuration. Changes take effect for the next node
   * activation.
   *
   * @param updates - Key-value pairs to merge into the current config.
   */
  async setConfig(updates: Record<string, unknown>): Promise<void> {
    await this.request<unknown>("PUT", "/config", updates);
  }

  // -------------------------------------------------------------------------
  // REST API — Events
  // -------------------------------------------------------------------------

  /**
   * Query the event log with optional filters.
   *
   * @param params - Optional filter parameters.
   * @param params.type - Filter by event type (e.g. `"node_started"`).
   * @param params.nodeId - Filter by node identifier.
   * @param params.limit - Maximum number of events to return.
   * @param params.offset - Number of events to skip (for pagination).
   * @returns Matching events and total count.
   */
  async getEvents(params?: {
    type?: string;
    nodeId?: string;
    limit?: number;
    offset?: number;
  }): Promise<EventsResponse> {
    const search = new URLSearchParams();
    if (params?.type !== undefined) search.set("type", params.type);
    if (params?.nodeId !== undefined) search.set("nodeId", params.nodeId);
    if (params?.limit !== undefined) search.set("limit", String(params.limit));
    if (params?.offset !== undefined) search.set("offset", String(params.offset));

    const qs = search.toString();
    const path = qs ? `/events?${qs}` : "/events";
    return this.request<EventsResponse>("GET", path);
  }

  // -------------------------------------------------------------------------
  // WebSocket — Event subscription
  // -------------------------------------------------------------------------

  /**
   * Open a WebSocket connection to the daemon event stream.
   *
   * Resolves once the server sends the `connected` welcome message.
   * Requires the global `WebSocket` API (available in Node.js 22+).
   *
   * @throws {Error} If already connected.
   * @throws {Error} If the global `WebSocket` API is not available.
   */
  async connect(): Promise<void> {
    if (this.ws) {
      throw new Error("WebSocket is already connected");
    }

    if (typeof WebSocket === "undefined") {
      throw new Error("Global WebSocket API is not available. Node.js 22+ is required.");
    }

    const url = `${this.wsUrl}/ws`;

    return new Promise<void>((resolve, reject) => {
      // Auth rides on the Sec-WebSocket-Protocol upgrade header
      // (`loomflo.bearer, <token>`). Node 22 and browser WebSocket constructors
      // both accept a `protocols` array and forward it unchanged.
      const ws = new WebSocket(url, ["loomflo.bearer", this.token]);

      ws.addEventListener("message", (event: MessageEvent) => {
        this.handleMessage(event);
      });

      ws.addEventListener("error", () => {
        reject(new Error("WebSocket connection failed"));
      });

      /** Resolve on the first message (the welcome `connected` event). */
      const onFirstMessage = (event: MessageEvent): void => {
        ws.removeEventListener("message", onFirstMessage);
        try {
          const data: unknown = JSON.parse(String(event.data));
          if (
            typeof data === "object" &&
            data !== null &&
            "type" in data &&
            (data as Record<string, unknown>)["type"] === "connected"
          ) {
            this.ws = ws;
            resolve();
          } else {
            ws.close();
            reject(new Error("Unexpected first WebSocket message"));
          }
        } catch {
          ws.close();
          reject(new Error("Failed to parse WebSocket welcome message"));
        }
      };

      ws.addEventListener("message", onFirstMessage);

      ws.addEventListener(
        "close",
        () => {
          if (this.ws === ws) {
            this.ws = null;
          }
        },
        { once: true },
      );
    });
  }

  /**
   * Close the WebSocket connection. No-op if not connected.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to WebSocket events of a specific type.
   *
   * @param type - The event type to listen for (e.g. `"node_status"`).
   * @param callback - Invoked with the full parsed event object.
   * @returns An unsubscribe function. Call it to remove this listener.
   */
  onEvent(type: string, callback: EventCallback): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Dispatch an incoming WebSocket message to registered listeners.
   */
  private handleMessage(event: MessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (typeof data !== "object" || data === null || !("type" in data)) {
      return;
    }

    const eventType = (data as Record<string, unknown>)["type"];
    if (typeof eventType !== "string") {
      return;
    }

    const set = this.listeners.get(eventType);
    if (set) {
      for (const cb of set) {
        cb(data);
      }
    }
  }

  /**
   * Send an HTTP request to the daemon and parse the JSON response.
   *
   * @param method - HTTP method.
   * @param path - URL path (e.g. `"/workflow"`).
   * @param body - Optional JSON request body.
   * @returns The parsed response body.
   * @throws {LoomfloApiError} On non-2xx responses.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    let reqBody: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: reqBody,
    });

    if (!res.ok) {
      let errorBody: unknown;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = await res.text();
      }
      throw new LoomfloApiError(
        res.status,
        `${method} ${path} failed with status ${String(res.status)}`,
        errorBody,
      );
    }

    return (await res.json()) as T;
  }
}
