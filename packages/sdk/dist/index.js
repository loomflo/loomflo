// src/client.ts
var LoomfloApiError = class extends Error {
  /** HTTP status code returned by the daemon. */
  status;
  /** Raw response body (parsed JSON when available, raw text otherwise). */
  body;
  constructor(status, message, body) {
    super(message);
    this.name = "LoomfloApiError";
    this.status = status;
    this.body = body;
  }
};
var LoomfloClient = class {
  baseUrl;
  wsUrl;
  token;
  ws = null;
  listeners = /* @__PURE__ */ new Map();
  /**
   * Create a new LoomfloClient.
   *
   * @param options - Connection options including host, port, and auth token.
   */
  constructor(options) {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 3e3;
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
  async health() {
    return this.request("GET", "/health");
  }
  // -------------------------------------------------------------------------
  // REST API — Workflow
  // -------------------------------------------------------------------------
  /**
   * Get the current workflow state.
   *
   * @returns The workflow state, or `null` if no workflow is active.
   */
  async getWorkflow() {
    try {
      return await this.request("GET", "/workflow");
    } catch (err) {
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
  async init(description, projectPath, config) {
    return this.request("POST", "/workflow/init", {
      description,
      projectPath,
      config
    });
  }
  /**
   * Confirm the generated spec and begin Phase 2 execution.
   */
  async start() {
    await this.request("POST", "/workflow/start");
  }
  /**
   * Pause the running workflow. Active agent calls finish; no new calls are
   * dispatched.
   */
  async pause() {
    await this.request("POST", "/workflow/pause");
  }
  /**
   * Resume a paused or interrupted workflow.
   */
  async resume() {
    await this.request("POST", "/workflow/resume");
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
  async chat(message) {
    return this.request("POST", "/chat", { message });
  }
  /**
   * Retrieve the full chat history.
   *
   * @returns All chat messages exchanged with Loom.
   */
  async chatHistory() {
    return this.request("GET", "/chat/history");
  }
  // -------------------------------------------------------------------------
  // REST API — Nodes
  // -------------------------------------------------------------------------
  /**
   * List all nodes in the workflow graph.
   *
   * @returns An array of node summaries.
   */
  async getNodes() {
    const data = await this.request("GET", "/nodes");
    return data.nodes;
  }
  /**
   * Get detailed information about a single node including its agents.
   *
   * @param nodeId - The node identifier.
   * @returns Full node detail with agents and file ownership.
   */
  async getNode(nodeId) {
    return this.request(
      "GET",
      `/nodes/${encodeURIComponent(nodeId)}`
    );
  }
  // -------------------------------------------------------------------------
  // REST API — Specs
  // -------------------------------------------------------------------------
  /**
   * List available spec artifact names.
   *
   * @returns An array of artifact names (e.g. `["spec.md", "plan.md"]`).
   */
  async getSpecs() {
    const data = await this.request("GET", "/specs");
    return data.artifacts.map((a) => a.name);
  }
  /**
   * Read a specific spec artifact.
   *
   * @param name - Artifact filename (e.g. `"spec.md"`).
   * @returns The raw markdown content of the artifact.
   */
  async getSpec(name) {
    const url = `${this.baseUrl}/specs/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new LoomfloApiError(
        res.status,
        `GET /specs/${name} failed with status ${String(res.status)}`,
        body
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
  async getCosts() {
    return this.request("GET", "/costs");
  }
  // -------------------------------------------------------------------------
  // REST API — Configuration
  // -------------------------------------------------------------------------
  /**
   * Get the current merged daemon configuration.
   *
   * @returns The configuration key-value map.
   */
  async getConfig() {
    return this.request("GET", "/config");
  }
  /**
   * Update daemon configuration. Changes take effect for the next node
   * activation.
   *
   * @param updates - Key-value pairs to merge into the current config.
   */
  async setConfig(updates) {
    await this.request("PUT", "/config", updates);
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
  async getEvents(params) {
    const search = new URLSearchParams();
    if (params?.type !== void 0) search.set("type", params.type);
    if (params?.nodeId !== void 0) search.set("nodeId", params.nodeId);
    if (params?.limit !== void 0) search.set("limit", String(params.limit));
    if (params?.offset !== void 0)
      search.set("offset", String(params.offset));
    const qs = search.toString();
    const path = qs ? `/events?${qs}` : "/events";
    return this.request("GET", path);
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
  async connect() {
    if (this.ws) {
      throw new Error("WebSocket is already connected");
    }
    if (typeof WebSocket === "undefined") {
      throw new Error(
        "Global WebSocket API is not available. Node.js 22+ is required."
      );
    }
    const url = `${this.wsUrl}/ws?token=${encodeURIComponent(this.token)}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("message", (event) => {
        this.handleMessage(event);
      });
      ws.addEventListener("error", () => {
        reject(new Error("WebSocket connection failed"));
      });
      const onFirstMessage = (event) => {
        ws.removeEventListener("message", onFirstMessage);
        try {
          const data = JSON.parse(String(event.data));
          if (typeof data === "object" && data !== null && "type" in data && data["type"] === "connected") {
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
        { once: true }
      );
    });
  }
  /**
   * Close the WebSocket connection. No-op if not connected.
   */
  disconnect() {
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
  onEvent(type, callback) {
    let set = this.listeners.get(type);
    if (!set) {
      set = /* @__PURE__ */ new Set();
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
  handleMessage(event) {
    let data;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof data !== "object" || data === null || !("type" in data)) {
      return;
    }
    const eventType = data["type"];
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
  async request(method, path, body) {
    const headers = {
      Authorization: `Bearer ${this.token}`
    };
    let reqBody;
    if (body !== void 0) {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: reqBody
    });
    if (!res.ok) {
      let errorBody;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = await res.text();
      }
      throw new LoomfloApiError(
        res.status,
        `${method} ${path} failed with status ${String(res.status)}`,
        errorBody
      );
    }
    return await res.json();
  }
};
export {
  LoomfloApiError,
  LoomfloClient
};
