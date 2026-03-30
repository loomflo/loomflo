#!/usr/bin/env node

// src/index.ts
import { Command as Command10 } from "commander";

// src/commands/chat.ts
import { Command } from "commander";

// src/client.ts
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
var DAEMON_JSON_PATH = join(homedir(), ".loomflo", "daemon.json");
var RECONNECT_INITIAL_MS = 500;
var RECONNECT_MAX_MS = 3e4;
var RECONNECT_MULTIPLIER = 2;
async function readDaemonConfig() {
  let raw;
  try {
    raw = await readFile(DAEMON_JSON_PATH, "utf-8");
  } catch {
    throw new Error(
      "Daemon not running \u2014 ~/.loomflo/daemon.json not found. Start with: loomflo start"
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid daemon.json \u2014 file is not valid JSON. Re-start the daemon with: loomflo start"
    );
  }
  if (typeof parsed !== "object" || parsed === null || typeof parsed.port !== "number" || typeof parsed.token !== "string") {
    throw new Error(
      "Invalid daemon.json \u2014 missing port or token. Re-start the daemon with: loomflo start"
    );
  }
  const config = parsed;
  return {
    port: config.port,
    token: config.token,
    pid: typeof config.pid === "number" ? config.pid : 0
  };
}
var DaemonClient = class _DaemonClient {
  /** Base URL for HTTP requests (e.g. 'http://127.0.0.1:3000'). */
  baseUrl;
  /** Auth token for API access. */
  token;
  /** Active WebSocket connection, if any. */
  ws = null;
  /** Whether the client is intentionally disconnected. */
  closed = false;
  /** Current reconnection delay in milliseconds. */
  reconnectDelay = RECONNECT_INITIAL_MS;
  /** Timer handle for pending reconnection attempts. */
  reconnectTimer = null;
  /** Registry of event handlers keyed by event type. */
  handlers = /* @__PURE__ */ new Map();
  /**
   * Create a DaemonClient instance.
   *
   * Prefer using {@link DaemonClient.connect} which reads daemon.json
   * and optionally establishes a WebSocket connection automatically.
   *
   * @param port - The daemon port number.
   * @param token - The daemon auth token.
   */
  constructor(port, token) {
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
  static async connect(options) {
    const config = await readDaemonConfig();
    const client = new _DaemonClient(config.port, config.token);
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
  async request(options) {
    const { method, path, body, headers: extraHeaders } = options;
    const url = `${this.baseUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      ...extraHeaders
    };
    const init = { method, headers };
    if (body !== void 0 && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";
    let data;
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return {
      ok: response.ok,
      status: response.status,
      data
    };
  }
  /**
   * Send a GET request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @returns A typed API response.
   */
  async get(path) {
    return this.request({ method: "GET", path });
  }
  /**
   * Send a POST request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @param body - Optional JSON body.
   * @returns A typed API response.
   */
  async post(path, body) {
    return this.request({ method: "POST", path, body });
  }
  /**
   * Send a PUT request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @param body - Optional JSON body.
   * @returns A typed API response.
   */
  async put(path, body) {
    return this.request({ method: "PUT", path, body });
  }
  /**
   * Send a DELETE request to the daemon.
   *
   * @typeParam T - The expected response data type.
   * @param path - URL path relative to the daemon base URL.
   * @returns A typed API response.
   */
  async delete(path) {
    return this.request({ method: "DELETE", path });
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
  connectWebSocket() {
    if (this.ws !== null || this.closed) {
      return;
    }
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws?token=${this.token}`;
    const socket = new WebSocket(wsUrl);
    socket.addEventListener("open", () => {
      this.reconnectDelay = RECONNECT_INITIAL_MS;
    });
    socket.addEventListener("message", (event) => {
      this.handleMessage(event);
    });
    socket.addEventListener("close", () => {
      this.ws = null;
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", () => {
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
  on(eventType, handler) {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.handlers.set(eventType, set);
    }
    const castHandler = handler;
    set.add(castHandler);
    const handlerSet = set;
    return () => {
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
  off(eventType) {
    if (eventType !== void 0) {
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
  disconnect() {
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
  get connected() {
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
  handleMessage(event) {
    let payload;
    try {
      payload = JSON.parse(String(event.data));
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
        handler(payload);
      } catch {
      }
    }
  }
  /**
   * Schedule a WebSocket reconnection attempt with exponential backoff.
   *
   * The delay doubles on each attempt up to {@link RECONNECT_MAX_MS},
   * and resets to {@link RECONNECT_INITIAL_MS} on successful connection.
   */
  scheduleReconnect() {
    if (this.closed || this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS
    );
  }
};

// src/commands/chat.ts
function createChatCommand() {
  const cmd = new Command("chat").description("Chat with the Loom architect agent").argument("<message>", "Message to send to Loom").action(async (message) => {
    let client;
    try {
      client = await DaemonClient.connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
    try {
      const res = await client.post("/chat", { message });
      if (!res.ok) {
        const errData = res.data;
        console.error(`Error: ${errData.error}`);
        process.exit(1);
      }
      const { response, action, category } = res.data;
      console.log(`[${category}] ${response}`);
      if (action !== null) {
        console.log(`  Action: ${action.type}`);
        for (const [key, value] of Object.entries(action.details)) {
          console.log(`    ${key}: ${JSON.stringify(value)}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to connect to daemon: ${msg}`);
      process.exit(1);
    }
  });
  return cmd;
}

// src/commands/config.ts
import { Command as Command2 } from "commander";
function resolveKeyPath(obj, keyPath) {
  const segments = keyPath.split(".");
  let current = obj;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return void 0;
    }
    current = current[segment];
  }
  return current;
}
function buildNestedObject(keyPath, value) {
  const segments = keyPath.split(".");
  const root = {};
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const next = {};
    current[segment] = next;
    current = next;
  }
  const leaf = segments[segments.length - 1];
  current[leaf] = value;
  return root;
}
function parseValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") {
    return num;
  }
  return raw;
}
function formatValue(value) {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
function createConfigCommand() {
  const cmd = new Command2("config").description("Get or set configuration").action(async () => {
    let client;
    try {
      client = await DaemonClient.connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
    try {
      const res = await client.get("/config");
      if (!res.ok) {
        const errData = res.data;
        console.error(`Error: ${errData.error}`);
        process.exit(1);
      }
      console.log(JSON.stringify(res.data.config, null, 2));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to connect to daemon: ${msg}`);
      process.exit(1);
    }
  });
  cmd.command("get").description("Get a configuration value by key (supports dot notation)").argument("<key>", 'Configuration key (e.g. "models.loom")').action(async (key) => {
    let client;
    try {
      client = await DaemonClient.connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
    try {
      const res = await client.get("/config");
      if (!res.ok) {
        const errData = res.data;
        console.error(`Error: ${errData.error}`);
        process.exit(1);
      }
      const value = resolveKeyPath(res.data.config, key);
      if (value === void 0) {
        console.error(`Error: unknown config key "${key}"`);
        process.exit(1);
      }
      console.log(formatValue(value));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to connect to daemon: ${msg}`);
      process.exit(1);
    }
  });
  cmd.command("set").description("Set a configuration value (auto-parses booleans and numbers)").argument("<key>", 'Configuration key (e.g. "models.loom")').argument("<value>", "Value to set").action(async (key, rawValue) => {
    let client;
    try {
      client = await DaemonClient.connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
    try {
      const parsed = parseValue(rawValue);
      const body = buildNestedObject(key, parsed);
      const res = await client.put("/config", body);
      if (!res.ok) {
        const errData = res.data;
        console.error(`Error: ${errData.error}`);
        if (errData.details) {
          console.error(`Details: ${JSON.stringify(errData.details, null, 2)}`);
        }
        process.exit(1);
      }
      const updated = resolveKeyPath(res.data.config, key);
      console.log(`${key} = ${formatValue(updated)}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to connect to daemon: ${msg}`);
      process.exit(1);
    }
  });
  return cmd;
}

// src/commands/dashboard.ts
import { exec } from "child_process";
import { platform } from "os";
import { Command as Command3 } from "commander";
function openCommand(url) {
  switch (platform()) {
    case "darwin":
      return `open "${url}"`;
    case "win32":
      return `start "${url}"`;
    default:
      return `xdg-open "${url}"`;
  }
}
function createDashboardCommand() {
  const cmd = new Command3("dashboard").description("Open the web dashboard in the default browser").option(
    "-p, --port <port>",
    "Override the dashboard port (defaults to daemon port)"
  ).option("--no-open", "Print the URL without opening the browser").action(async (options) => {
    let port;
    if (options.port !== void 0) {
      port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${options.port}`);
        process.exit(1);
      }
    } else {
      try {
        const config = await readDaemonConfig();
        port = config.port;
      } catch {
        console.error(
          "Daemon is not running. Start with: loomflo start"
        );
        process.exit(1);
      }
    }
    const url = `http://127.0.0.1:${String(port)}`;
    if (options.open === false) {
      console.log(url);
      return;
    }
    console.log(`Opening dashboard at ${url}`);
    const command = openCommand(url);
    exec(command, (error) => {
      if (error !== null) {
        console.error(`Failed to open browser. Visit manually: ${url}`);
      }
    });
  });
  return cmd;
}

// src/commands/init.ts
import { Command as Command4 } from "commander";
import { readFile as readFile2 } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join2, resolve } from "path";
async function readDaemonConfig2() {
  const configPath = join2(homedir2(), ".loomflo", "daemon.json");
  let raw;
  try {
    raw = await readFile2(configPath, "utf-8");
  } catch {
    console.error("Daemon not running. Start with: loomflo start");
    process.exit(1);
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || typeof parsed.port !== "number" || typeof parsed.token !== "string") {
    console.error("Invalid daemon.json. Re-start the daemon with: loomflo start");
    process.exit(1);
  }
  return parsed;
}
function createSpinner(message) {
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  let i = 0;
  process.stdout.write(`${String(frames[0])} ${message}`);
  const interval = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${String(frames[i])} ${message}`);
  }, 80);
  return {
    stop() {
      clearInterval(interval);
      process.stdout.write(`\r${" ".repeat(message.length + 3)}\r`);
    }
  };
}
function createInitCommand() {
  const cmd = new Command4("init").description("Initialize a new workflow from a project description").argument("<description>", "Natural language description of the project").option("--project-path <path>", "Project directory path", process.cwd()).option("--budget <number>", "Budget limit in dollars").option("--reviewer", "Enable the reviewer agent").action(async (description, options) => {
    const daemon = await readDaemonConfig2();
    const projectPath = resolve(options.projectPath);
    const config = {};
    if (options.budget !== void 0) {
      const budgetLimit = Number(options.budget);
      if (Number.isNaN(budgetLimit) || budgetLimit <= 0) {
        console.error("Error: --budget must be a positive number");
        process.exit(1);
      }
      config["budgetLimit"] = budgetLimit;
    }
    if (options.reviewer === true) {
      config["reviewerEnabled"] = true;
    }
    const body = {
      description,
      projectPath
    };
    if (Object.keys(config).length > 0) {
      body["config"] = config;
    }
    const url = `http://127.0.0.1:${String(daemon.port)}/workflow/init`;
    const spinner = createSpinner("Initializing workflow...");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${daemon.token}`
        },
        body: JSON.stringify(body)
      });
      spinner.stop();
      if (response.status === 201) {
        const data = await response.json();
        console.log("Workflow initialized successfully.");
        console.log(`  ID:     ${data.id}`);
        console.log(`  Status: ${data.status}`);
      } else {
        const data = await response.json();
        console.error(`Error: ${data.error}`);
        process.exit(1);
      }
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to connect to daemon: ${message}`);
      process.exit(1);
    }
  });
  return cmd;
}

// src/commands/logs.ts
import { Command as Command5 } from "commander";
function formatTimestamp(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour12: false });
}
function formatEvent(event) {
  const time = formatTimestamp(event.ts);
  const node = event.nodeId !== null ? ` [${event.nodeId}]` : "";
  const agent = event.agentId !== null ? ` agent=${event.agentId}` : "";
  const detailKeys = Object.keys(event.details);
  const detail = detailKeys.length > 0 ? " " + JSON.stringify(event.details) : "";
  return `${time}${node} ${event.type}${agent}${detail}`;
}
function createLogsCommand() {
  const cmd = new Command5("logs").description("Fetch and display agent logs").argument("[node-id]", "Filter events by node ID").option("--type <type>", "Filter by event type").option("--limit <n>", "Maximum number of events to fetch", "50").option("-f, --follow", "Stream new events in real time via WebSocket", false).action(async (nodeId, opts) => {
    let config;
    try {
      config = await readDaemonConfig();
    } catch {
      console.error("Daemon is not running. Start with: loomflo start");
      process.exit(1);
    }
    const client = new DaemonClient(config.port, config.token);
    const params = new URLSearchParams();
    if (nodeId !== void 0) {
      params.set("nodeId", nodeId);
    }
    if (opts.type !== void 0) {
      params.set("type", opts.type);
    }
    const limit = parseInt(opts.limit, 10);
    params.set("limit", String(Number.isFinite(limit) && limit > 0 ? limit : 50));
    const queryString = params.toString();
    const path = queryString.length > 0 ? `/events?${queryString}` : "/events";
    const result = await client.get(path);
    if (!result.ok) {
      const errorData = result.data;
      console.error(`Failed to fetch events: ${errorData.error}`);
      process.exit(1);
    }
    const { events, total } = result.data;
    if (events.length === 0 && !opts.follow) {
      console.log("No events found.");
      return;
    }
    const chronological = [...events].reverse();
    for (const event of chronological) {
      console.log(formatEvent(event));
    }
    if (events.length < total) {
      console.log(`
Showing ${String(events.length)} of ${String(total)} events. Use --limit to see more.`);
    }
    if (!opts.follow) {
      return;
    }
    console.log("\n--- streaming live events (Ctrl+C to stop) ---\n");
    client.connectWebSocket();
    const handleWsEvent = (wsEvent) => {
      const event = {
        ts: typeof wsEvent["timestamp"] === "string" ? wsEvent["timestamp"] : (/* @__PURE__ */ new Date()).toISOString(),
        type: typeof wsEvent["type"] === "string" ? wsEvent["type"] : "unknown",
        nodeId: typeof wsEvent["nodeId"] === "string" ? wsEvent["nodeId"] : null,
        agentId: typeof wsEvent["agentId"] === "string" ? wsEvent["agentId"] : null,
        details: {}
      };
      if (nodeId !== void 0 && event.nodeId !== nodeId) {
        return;
      }
      if (opts.type !== void 0 && event.type !== opts.type) {
        return;
      }
      console.log(formatEvent(event));
    };
    const eventTypes = [
      "node_status",
      "agent_status",
      "agent_message",
      "review_verdict",
      "graph_modified",
      "cost_update",
      "memory_updated",
      "workflow_status"
    ];
    const removers = [];
    for (const eventType of eventTypes) {
      const remover = client.on(eventType, (payload) => {
        handleWsEvent(payload);
      });
      removers.push(remover);
    }
    const cleanup = () => {
      for (const remove of removers) {
        remove();
      }
      client.disconnect();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    await new Promise(() => {
    });
  });
  return cmd;
}

// src/commands/resume.ts
import { Command as Command6 } from "commander";
function createResumeCommand() {
  const cmd = new Command6("resume").description("Resume a paused or interrupted workflow").action(async () => {
    let config;
    try {
      config = await readDaemonConfig();
    } catch {
      console.error("Daemon is not running. Start with: loomflo start");
      process.exit(1);
    }
    const client = new DaemonClient(config.port, config.token);
    console.log("Resuming workflow...");
    const response = await client.post("/workflow/resume");
    if (!response.ok) {
      const errorData = response.data;
      console.error(`Failed to resume: ${errorData.error}`);
      process.exit(1);
    }
    const data = response.data;
    const info = data.resumeInfo;
    console.log(`Workflow resumed. Status: ${data.status}`);
    console.log("");
    if (info.completedNodeIds.length > 0) {
      console.log(`  Completed (skipped): ${String(info.completedNodeIds.length)} nodes`);
    }
    if (info.resetNodeIds.length > 0) {
      console.log(`  Interrupted (reset): ${String(info.resetNodeIds.length)} nodes`);
      for (const nodeId of info.resetNodeIds) {
        console.log(`    - ${nodeId}`);
      }
    }
    if (info.rescheduledNodeIds.length > 0) {
      console.log(`  Rescheduled: ${String(info.rescheduledNodeIds.length)} nodes`);
    }
    if (info.resumedFrom !== null) {
      console.log(`  Resuming from: ${info.resumedFrom}`);
    }
    console.log("");
    console.log("Execution will continue from where it left off.");
  });
  return cmd;
}

// src/commands/start.ts
import { spawn } from "child_process";
import { readFile as readFile3 } from "fs/promises";
import { homedir as homedir3 } from "os";
import { join as join3, resolve as resolve2 } from "path";
import { Command as Command7 } from "commander";
var DAEMON_JSON_PATH2 = join3(homedir3(), ".loomflo", "daemon.json");
var STARTUP_TIMEOUT_MS = 15e3;
var POLL_INTERVAL_MS = 250;
var DEFAULT_PORT = 3e3;
async function waitForDaemonFile(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile3(DAEMON_JSON_PATH2, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && typeof parsed.port === "number" && typeof parsed.token === "string" && typeof parsed.pid === "number") {
        return parsed;
      }
    } catch {
    }
    await new Promise((resolve3) => {
      setTimeout(resolve3, POLL_INTERVAL_MS);
    });
  }
  throw new Error(`Daemon did not start within ${String(timeoutMs / 1e3)} seconds`);
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function getRunningDaemon() {
  try {
    const raw = await readFile3(DAEMON_JSON_PATH2, "utf-8");
    const info = JSON.parse(raw);
    if (typeof info.pid === "number" && isProcessAlive(info.pid)) {
      return info;
    }
  } catch {
  }
  return null;
}
function resolveDaemonScript() {
  const cliDir = new URL("..", import.meta.url).pathname;
  const monorepoPath = resolve2(cliDir, "..", "core", "dist", "daemon-entry.js");
  return monorepoPath;
}
function createStartCommand() {
  const cmd = new Command7("start").description("Start the Loomflo daemon").option("--port <number>", "TCP port to listen on", String(DEFAULT_PORT)).option("--project-path <path>", "Project directory path").action(async (options) => {
    const existing = await getRunningDaemon();
    if (existing) {
      console.log(
        `Daemon already running on port ${String(existing.port)} (PID ${String(existing.pid)})`
      );
      return;
    }
    const port = options.port !== void 0 ? Number(options.port) : DEFAULT_PORT;
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      console.error("Error: --port must be a valid port number (1\u201365535)");
      process.exit(1);
    }
    const projectPath = options.projectPath ? resolve2(options.projectPath) : process.cwd();
    const daemonScript = resolveDaemonScript();
    const env = {
      ...process.env,
      LOOMFLO_PORT: String(port),
      LOOMFLO_PROJECT_PATH: projectPath
    };
    const child = spawn("node", [daemonScript], {
      detached: true,
      stdio: "ignore",
      env
    });
    child.unref();
    console.log("Starting Loomflo daemon...");
    try {
      const info = await waitForDaemonFile(STARTUP_TIMEOUT_MS);
      console.log(`Daemon started successfully.`);
      console.log(`  Port: ${String(info.port)}`);
      console.log(`  PID:  ${String(info.pid)}`);
      console.log(`  URL:  http://127.0.0.1:${String(info.port)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to start daemon: ${message}`);
      process.exit(1);
    }
  });
  return cmd;
}

// src/commands/status.ts
import { Command as Command8 } from "commander";
function formatCost(value) {
  return `$${value.toFixed(2)}`;
}
function createStatusCommand() {
  const cmd = new Command8("status").description("Show workflow status and costs").action(async () => {
    let config;
    try {
      config = await readDaemonConfig();
    } catch {
      console.error("Daemon is not running. Start with: loomflo start");
      process.exit(1);
    }
    const client = new DaemonClient(config.port, config.token);
    const [workflowResult, costsResult, nodesResult] = await Promise.allSettled([
      client.get("/workflow"),
      client.get("/costs"),
      client.get("/nodes")
    ]);
    if (workflowResult.status === "rejected") {
      console.error("Failed to connect to daemon.");
      process.exit(1);
    }
    const workflowRes = workflowResult.value;
    if (!workflowRes.ok) {
      if (workflowRes.status === 404) {
        console.log("No active workflow. Start one with: loomflo start");
        return;
      }
      const errorData = workflowRes.data;
      console.error(`Failed to fetch workflow: ${errorData.error}`);
      process.exit(1);
    }
    const workflow = workflowRes.data;
    console.log("Workflow");
    console.log(`  ID:          ${workflow.id}`);
    console.log(`  Status:      ${workflow.status}`);
    console.log(`  Description: ${workflow.description}`);
    console.log("");
    let nodes = [];
    if (nodesResult.status === "fulfilled") {
      const nodesRes = nodesResult.value;
      if (nodesRes.ok) {
        nodes = nodesRes.data;
      }
    }
    const activeNodes = nodes.filter(
      (n) => n.status === "running" || n.status === "review"
    );
    if (activeNodes.length > 0) {
      console.log("Active Nodes");
      for (const node of activeNodes) {
        console.log(`  - ${node.title} [${node.status}] (${String(node.agentCount)} agents)`);
      }
      console.log("");
    }
    if (nodes.length > 0) {
      console.log("Node Costs");
      const titleWidth = Math.max(
        "Node".length,
        ...nodes.map((n) => n.title.length)
      );
      const statusWidth = Math.max(
        "Status".length,
        ...nodes.map((n) => n.status.length)
      );
      const header = "  " + "Node".padEnd(titleWidth) + "  " + "Status".padEnd(statusWidth) + "  " + "Cost".padStart(10) + "  Retries";
      const separator = "  " + "-".repeat(header.length - 2);
      console.log(header);
      console.log(separator);
      for (const node of nodes) {
        const line = "  " + node.title.padEnd(titleWidth) + "  " + node.status.padEnd(statusWidth) + "  " + formatCost(node.cost).padStart(10) + "  " + String(node.retryCount);
        console.log(line);
      }
      console.log("");
    }
    if (costsResult.status === "fulfilled") {
      const costsRes = costsResult.value;
      if (costsRes.ok) {
        const costs = costsRes.data;
        console.log("Cost Summary");
        console.log(`  Total Cost:       ${formatCost(costs.total)}`);
        console.log(`  Budget Limit:     ${costs.budgetLimit !== null ? formatCost(costs.budgetLimit) : "None"}`);
        console.log(`  Budget Remaining: ${costs.budgetRemaining !== null ? formatCost(costs.budgetRemaining) : "N/A"}`);
        console.log(`  Loom Overhead:    ${formatCost(costs.loomCost)}`);
      }
    }
  });
  return cmd;
}

// src/commands/stop.ts
import { Command as Command9 } from "commander";
var SHUTDOWN_TIMEOUT_MS = 3e4;
var POLL_INTERVAL_MS2 = 500;
function isProcessAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive2(pid)) {
      return true;
    }
    await new Promise((resolve3) => {
      setTimeout(resolve3, POLL_INTERVAL_MS2);
    });
  }
  return false;
}
function createStopCommand() {
  const cmd = new Command9("stop").description("Stop the Loomflo daemon").option("--force", "Force stop with SIGTERM if graceful shutdown fails").action(async (options) => {
    let config;
    try {
      config = await readDaemonConfig();
    } catch {
      console.log("Daemon is not running.");
      return;
    }
    const client = new DaemonClient(config.port, config.token);
    console.log("Stopping Loomflo daemon...");
    try {
      const response = await client.post("/shutdown");
      if (response.ok) {
        console.log("Shutdown signal sent. Waiting for active calls to finish...");
      } else {
        if (options.force === true && config.pid > 0) {
          console.log("Graceful shutdown not available. Sending SIGTERM...");
          process.kill(config.pid, "SIGTERM");
        } else {
          console.error(
            "Daemon did not accept shutdown request. Use --force to send SIGTERM."
          );
          process.exit(1);
        }
      }
    } catch {
      if (config.pid > 0 && isProcessAlive2(config.pid)) {
        console.log("Cannot reach daemon API. Sending SIGTERM to process...");
        try {
          process.kill(config.pid, "SIGTERM");
        } catch {
          console.log("Daemon process is no longer running.");
          return;
        }
      } else {
        console.log("Daemon process is no longer running.");
        return;
      }
    }
    if (config.pid > 0) {
      const exited = await waitForProcessExit(config.pid, SHUTDOWN_TIMEOUT_MS);
      if (exited) {
        console.log("Daemon stopped.");
      } else if (options.force === true) {
        console.log("Timeout exceeded. Sending SIGKILL...");
        try {
          process.kill(config.pid, "SIGKILL");
        } catch {
        }
        console.log("Daemon killed.");
      } else {
        console.error(
          "Daemon did not stop within timeout. Use --force to terminate."
        );
        process.exit(1);
      }
    } else {
      console.log("Daemon stopped.");
    }
  });
  return cmd;
}

// src/index.ts
function createProgram() {
  const program2 = new Command10().name("loomflo").description("AI Agent Orchestration Framework").version("0.1.0");
  program2.addCommand(createInitCommand());
  program2.addCommand(createStartCommand());
  program2.addCommand(createStopCommand());
  program2.addCommand(createChatCommand());
  program2.addCommand(createConfigCommand());
  program2.addCommand(createResumeCommand());
  program2.addCommand(createStatusCommand());
  program2.addCommand(createLogsCommand());
  program2.addCommand(createDashboardCommand());
  return program2;
}
var program = createProgram();
program.parse(process.argv);
if (program.args.length === 0 && process.argv.length <= 2) {
  program.help();
}
