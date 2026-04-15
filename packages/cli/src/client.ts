import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getRunningDaemon, type DaemonInfo } from "./daemon-control.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of the daemon connection file at ~/.loomflo/daemon.json. */
export interface DaemonConfig {
  /** TCP port the daemon is listening on. */
  port: number;
  /** Cryptographic auth token for API access. */
  token: string;
  /** Process ID of the running daemon. */
  pid: number;
}

/** Supported HTTP methods for daemon API requests. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Options for an HTTP request to the daemon. */
export interface RequestOptions {
  /** HTTP method. */
  method: HttpMethod;
  /** URL path relative to the daemon base URL (e.g. '/workflow'). */
  path: string;
  /** Optional JSON body for POST/PUT requests. */
  body?: unknown;
  /** Optional additional headers. Authorization is added automatically. */
  headers?: Record<string, string>;
}

/**
 * Typed response from the daemon API.
 *
 * @typeParam T - The expected shape of the response data.
 */
export interface ApiResponse<T> {
  /** Whether the response status code indicates success (2xx). */
  ok: boolean;
  /** HTTP status code. */
  status: number;
  /** Parsed response body. */
  data: T;
}

/** Standard error response from the daemon API. */
export interface ApiError {
  /** Human-readable error message. */
  error: string;
  /** Optional structured details (e.g. zod validation errors). */
  details?: unknown;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

/** Payload for the 'connected' event sent on WebSocket connection. */
export interface WsConnectedEvent {
  type: "connected";
  version: string;
}

/** Payload for the 'node_status' event. */
export interface WsNodeStatusEvent {
  type: "node_status";
  nodeId: string;
  status: string;
  title: string;
  timestamp: string;
}

/** Payload for the 'agent_status' event. */
export interface WsAgentStatusEvent {
  type: "agent_status";
  nodeId: string;
  agentId: string;
  role: string;
  status: string;
  task: string;
  timestamp: string;
}

/** Payload for the 'agent_message' event. */
export interface WsAgentMessageEvent {
  type: "agent_message";
  nodeId: string;
  from: string;
  to: string;
  summary: string;
  timestamp: string;
}

/** Payload for the 'review_verdict' event. */
export interface WsReviewVerdictEvent {
  type: "review_verdict";
  nodeId: string;
  verdict: "PASS" | "FAIL" | "BLOCKED";
  summary: string;
  timestamp: string;
}

/** Payload for the 'graph_modified' event. */
export interface WsGraphModifiedEvent {
  type: "graph_modified";
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
}

/** Payload for the 'cost_update' event. */
export interface WsCostUpdateEvent {
  type: "cost_update";
  nodeId: string;
  agentId: string;
  callCost: number;
  nodeCost: number;
  totalCost: number;
  budgetRemaining: number | null;
  timestamp: string;
}

/** Payload for the 'memory_updated' event. */
export interface WsMemoryUpdatedEvent {
  type: "memory_updated";
  file: string;
  agentId: string;
  summary: string;
  timestamp: string;
}

/** Payload for the 'spec_artifact_ready' event. */
export interface WsSpecArtifactReadyEvent {
  type: "spec_artifact_ready";
  name: string;
  path: string;
  timestamp: string;
}

/** Payload for the 'chat_response' event. */
export interface WsChatResponseEvent {
  type: "chat_response";
  message: string;
  action: Record<string, unknown> | null;
  timestamp: string;
}

/** Payload for the 'workflow_status' event. */
export interface WsWorkflowStatusEvent {
  type: "workflow_status";
  status: string;
  reason: string;
  timestamp: string;
}

/** Map of WebSocket event type names to their payload types. */
export interface WsEventMap {
  connected: WsConnectedEvent;
  node_status: WsNodeStatusEvent;
  agent_status: WsAgentStatusEvent;
  agent_message: WsAgentMessageEvent;
  review_verdict: WsReviewVerdictEvent;
  graph_modified: WsGraphModifiedEvent;
  cost_update: WsCostUpdateEvent;
  memory_updated: WsMemoryUpdatedEvent;
  spec_artifact_ready: WsSpecArtifactReadyEvent;
  chat_response: WsChatResponseEvent;
  workflow_status: WsWorkflowStatusEvent;
}

/** All known WebSocket event type names. */
export type WsEventType = keyof WsEventMap;

/** Callback handler for a specific WebSocket event type. */
export type WsEventHandler<K extends WsEventType> = (event: WsEventMap[K]) => void;

// ============================================================================
// Constants
// ============================================================================

/** Path to daemon.json within the user's home directory. */
const DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");

/** Initial delay in milliseconds for WebSocket reconnection backoff. */
const RECONNECT_INITIAL_MS = 500;

/** Maximum delay in milliseconds for WebSocket reconnection backoff. */
const RECONNECT_MAX_MS = 30_000;

/** Multiplier for exponential backoff on WebSocket reconnection. */
const RECONNECT_MULTIPLIER = 2;

// ============================================================================
// Daemon Config Loader
// ============================================================================

/**
 * Read the daemon connection file from ~/.loomflo/daemon.json.
 *
 * The daemon writes this file at startup containing the port, auth token,
 * and process ID. If the file is missing or malformed, an error is thrown.
 *
 * @returns The parsed daemon configuration.
 * @throws {Error} If the daemon.json file does not exist or is invalid.
 */
export async function readDaemonConfig(): Promise<DaemonConfig> {
  let raw: string;
  try {
    raw = await readFile(DAEMON_JSON_PATH, "utf-8");
  } catch {
    throw new Error(
      "Daemon not running — ~/.loomflo/daemon.json not found. Start with: loomflo start",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid daemon.json — file is not valid JSON. Re-start the daemon with: loomflo start",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as DaemonConfig).port !== "number" ||
    typeof (parsed as DaemonConfig).token !== "string"
  ) {
    throw new Error(
      "Invalid daemon.json — missing port or token. Re-start the daemon with: loomflo start",
    );
  }

  const config = parsed as DaemonConfig;
  return {
    port: config.port,
    token: config.token,
    pid: typeof config.pid === "number" ? config.pid : 0,
  };
}

// ============================================================================
// DaemonClient
// ============================================================================

/**
 * HTTP + WebSocket client for communicating with the Loomflo daemon.
 *
 * Provides typed HTTP request/response methods for the REST API and a
 * WebSocket event subscription system for real-time updates.
 *
 * Usage:
 * ```ts
 * const client = await DaemonClient.connect();
 * const res = await client.get<WorkflowData>('/workflow');
 * client.on('node_status', (event) => console.log(event.nodeId));
 * client.disconnect();
 * ```
 */
export class DaemonClient {
  /** Base URL for HTTP requests (e.g. 'http://127.0.0.1:3000'). */
  private readonly baseUrl: string;

  /** Auth token for API access. */
  private readonly token: string;

  /** Active WebSocket connection, if any. */
  private ws: WebSocket | null = null;

  /** Whether the client is intentionally disconnected. */
  private closed = false;

  /** Current reconnection delay in milliseconds. */
  private reconnectDelay = RECONNECT_INITIAL_MS;

  /** Timer handle for pending reconnection attempts. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Registry of event handlers keyed by event type. */
  private readonly handlers = new Map<string, Set<WsEventHandler<WsEventType>>>();

  /**
   * Create a DaemonClient instance.
   *
   * Prefer using {@link DaemonClient.connect} which reads daemon.json
   * and optionally establishes a WebSocket connection automatically.
   *
   * @param port - The daemon port number.
   * @param token - The daemon auth token.
   */
  constructor(port: number, token: string) {
    this.baseUrl = `http://127.0.0.1:${String(port)}`;
    this.token = token;
  }

  // --------------------------------------------------------------------------
  // Static Factory
  // --------------------------------------------------------------------------

  /**
   * Read daemon.json and create a connected DaemonClient.
   *
   * Optionally opens a WebSocket connection for real-time event streaming.
   *
   * @param options - Connection options.
   * @param options.websocket - Whether to open a WebSocket connection (default: false).
   * @returns A configured DaemonClient instance.
   * @throws {Error} If the daemon is not running or daemon.json is invalid.
   */
  static async connect(options?: { websocket?: boolean }): Promise<DaemonClient> {
    const config = await readDaemonConfig();
    const client = new DaemonClient(config.port, config.token);

    if (options?.websocket === true) {
      client.connectWebSocket();
    }

    return client;
  }

  // --------------------------------------------------------------------------
  // HTTP Methods
  // --------------------------------------------------------------------------

  /**
   * Send a typed HTTP request to the daemon REST API.
   *
   * The Authorization header is set automatically. JSON body is serialized
   * for POST/PUT requests. The response is parsed as JSON unless the
   * content type is text.
   *
   * @typeParam T - The expected shape of the response data.
   * @param options - Request configuration.
   * @returns A typed API response containing status, ok flag, and data.
   */
  async request<T = unknown>(options: RequestOptions): Promise<ApiResponse<T>> {
    const { method, path, body, headers: extraHeaders } = options;
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...extraHeaders,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";

    let data: T;
    if (contentType.includes("application/json")) {
      data = (await response.json()) as T;
    } else {
      data = (await response.text()) as unknown as T;
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  }

  /**
   * Send a GET request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @returns A typed API response.
   */
  async get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "GET", path });
  }

  /**
   * Send a POST request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @param body - Optional JSON body.
   * @returns A typed API response.
   */
  async post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "POST", path, body });
  }

  /**
   * Send a PUT request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @param body - Optional JSON body.
   * @returns A typed API response.
   */
  async put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "PUT", path, body });
  }

  /**
   * Send a DELETE request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @returns A typed API response.
   */
  async delete<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>({ method: "DELETE", path });
  }

  // --------------------------------------------------------------------------
  // WebSocket
  // --------------------------------------------------------------------------

  /**
   * Open a WebSocket connection to the daemon for real-time events.
   *
   * If a connection is already active, this method is a no-op.
   * The connection authenticates via query parameter and supports
   * automatic reconnection with exponential backoff on unexpected
   * disconnections.
   */
  connectWebSocket(): void {
    if (this.ws !== null || this.closed) {
      return;
    }

    const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws?token=${this.token}`;
    const socket = new WebSocket(wsUrl);

    socket.addEventListener("open", (): void => {
      this.reconnectDelay = RECONNECT_INITIAL_MS;
    });

    socket.addEventListener("message", (event: MessageEvent): void => {
      this.handleMessage(event);
    });

    socket.addEventListener("close", (): void => {
      this.ws = null;
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });

    socket.addEventListener("error", (): void => {
      /* Close event will follow — reconnect is handled there. */
    });

    this.ws = socket;
  }

  /**
   * Register an event handler for a specific WebSocket event type.
   *
   * Multiple handlers can be registered for the same event type.
   * Handlers are called in registration order when a matching event
   * arrives.
   *
   * @typeParam K - The event type name from {@link WsEventMap}.
   * @param eventType - The event type to listen for.
   * @param handler - Callback invoked with the typed event payload.
   * @returns A function that removes this specific handler when called.
   */
  on<K extends WsEventType>(eventType: K, handler: WsEventHandler<K>): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    const castHandler = handler as WsEventHandler<WsEventType>;
    set.add(castHandler);

    const handlerSet = set;
    return (): void => {
      handlerSet.delete(castHandler);
      if (handlerSet.size === 0) {
        this.handlers.delete(eventType);
      }
    };
  }

  /**
   * Remove all registered event handlers, optionally for a specific type.
   *
   * @param eventType - If provided, only handlers for this type are removed.
   */
  off(eventType?: WsEventType): void {
    if (eventType !== undefined) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Disconnect the WebSocket and prevent further reconnection attempts.
   *
   * Also clears all registered event handlers. After calling this method,
   * the client can still be used for HTTP requests but will not receive
   * WebSocket events.
   */
  disconnect(): void {
    this.closed = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }

    this.handlers.clear();
  }

  /**
   * Check whether the WebSocket connection is currently open.
   *
   * @returns True if the WebSocket is connected and ready.
   */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Parse and dispatch a WebSocket message to registered handlers.
   *
   * Messages that are not valid JSON or lack a `type` field are silently
   * ignored to avoid disrupting the event loop.
   *
   * @param event - The raw MessageEvent from the WebSocket.
   */
  private handleMessage(event: MessageEvent): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }

    const eventType = payload["type"];
    if (typeof eventType !== "string") {
      return;
    }

    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      try {
        handler(payload as unknown as WsEventMap[WsEventType]);
      } catch {
        /* Handler errors are silently swallowed to prevent cascade failures. */
      }
    }
  }

  /**
   * Schedule a WebSocket reconnection attempt with exponential backoff.
   *
   * The delay doubles on each attempt up to {@link RECONNECT_MAX_MS},
   * and resets to {@link RECONNECT_INITIAL_MS} on successful connection.
   */
  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) {
      return;
    }

    this.reconnectTimer = setTimeout((): void => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * RECONNECT_MULTIPLIER, RECONNECT_MAX_MS);
  }
}

// ============================================================================
// ScopedClient — project-scoped HTTP client
// ============================================================================

/**
 * A lightweight project-scoped HTTP client.
 *
 * All relative paths are automatically prefixed with `/projects/:projectId`.
 * Paths that already start with `/projects/` are passed through unchanged.
 */
export interface ScopedClient {
  /** The project ID this client is scoped to. */
  projectId: string;
  /** Information about the running daemon. */
  info: DaemonInfo;
  /**
   * Send an HTTP request to the daemon.
   *
   * @typeParam T - The expected response type.
   * @param method - HTTP method string (e.g. "GET", "POST").
   * @param path - URL path. If it does not start with "/projects/", the
   *   projectId prefix is added automatically.
   * @param body - Optional JSON body for POST/PUT requests.
   * @returns Parsed JSON response body, or undefined for 204 responses.
   * @throws {Error} If the response status is not 2xx.
   */
  request: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
}

/**
 * Open a project-scoped HTTP client against the running daemon.
 *
 * Reads the running daemon from `~/.loomflo/daemon.json` (via
 * {@link getRunningDaemon}) and returns a {@link ScopedClient} that
 * automatically prefixes all relative paths with `/projects/:projectId`.
 *
 * @param projectId - The project ID to scope requests to.
 * @returns A configured ScopedClient.
 * @throws {Error} If the daemon is not running.
 */
export async function openClient(projectId: string): Promise<ScopedClient> {
  const info = await getRunningDaemon();
  if (!info) throw new Error("Daemon is not running. Run 'loomflo start' first.");
  const base = `http://127.0.0.1:${String(info.port)}`;
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
      if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${String(res.status)}`);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
  };
}
