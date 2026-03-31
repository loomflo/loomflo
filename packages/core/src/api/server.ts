import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { healthRoutes, type HealthRoutesOptions } from "./routes/health.js";
import { memoryRoutes, type MemoryRoutesOptions } from "./routes/memory.js";
import { eventsRoutes, type EventsRoutesOptions } from "./routes/events.js";
import { nodesRoutes, type NodesRoutesOptions } from "./routes/nodes.js";
import { workflowRoutes, type WorkflowRoutesOptions } from "./routes/workflow.js";
import { chatRoutes, type ChatRoutesOptions } from "./routes/chat.js";
import { configRoutes, type ConfigRoutesOptions } from "./routes/config.js";
import { costsRoutes, type CostsRoutesOptions } from "./routes/costs.js";

// ============================================================================
// Constants
// ============================================================================

/** Version string sent in the WebSocket welcome message. */
const VERSION = "0.1.0";

/** WebSocket close code for unauthorized connections. */
const WS_CLOSE_UNAUTHORIZED = 4001;

/** Numeric value of WebSocket.OPEN readyState. */
const WS_OPEN = 1;

/** Prefix for the Authorization header value. */
const BEARER_PREFIX = "Bearer ";

/**
 * Log verbosity level read from the `LOOMFLO_LOG_LEVEL` environment variable.
 *
 * Supported values: `'silent'`, `'error'`, `'warn'`, `'info'` (default), `'debug'`.
 * When set to `'silent'`, structured error logging to stderr is suppressed.
 */
export const LOG_LEVEL: string = process.env["LOOMFLO_LOG_LEVEL"] ?? "info";

/**
 * URL prefixes for authenticated API routes.
 *
 * GET requests to paths outside these prefixes are served without
 * authentication when the dashboard is active, allowing static assets
 * and SPA client-side routes to load without a Bearer token.
 */
const API_ROUTE_PREFIXES = [
  "/workflow",
  "/nodes",
  "/memory",
  "/events",
  "/specs",
  "/chat",
  "/config",
  "/costs",
];

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal WebSocket client interface for connection tracking.
 *
 * Defined locally to avoid a hard dependency on `@types/ws`.
 * Matches the subset of `ws.WebSocket` used by this module.
 */
interface SocketClient {
  /** The current connection state (1 = OPEN). */
  readonly readyState: number;
  /** Send a UTF-8 message to the client. */
  send(data: string): void;
  /** Close the connection with an optional code and reason. */
  close(code?: number, reason?: string): void;
  /** Register an event listener on the socket. */
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** Configuration options for the Fastify server factory. */
export interface ServerOptions {
  /** Cryptographic auth token for API and WebSocket access. */
  token: string;
  /** Absolute path to the project workspace. */
  projectPath: string;
  /** Absolute path to the dashboard static files directory, or null if not available. */
  dashboardPath: string | null;
  /** Callbacks for the health endpoint. When omitted, defaults to process uptime and no workflow. */
  health?: HealthRoutesOptions;
  /** Callbacks for the workflow routes. When omitted, workflow routes are not registered. */
  workflow?: WorkflowRoutesOptions;
  /** Callbacks for the node routes. When omitted, node routes are not registered. */
  nodes?: NodesRoutesOptions;
  /** Callbacks for the memory routes. When omitted, memory routes are not registered. */
  memory?: MemoryRoutesOptions;
  /** Callbacks for the events routes. When omitted, events routes are not registered. */
  events?: EventsRoutesOptions;
  /** Callbacks for the chat routes. When omitted, chat routes are not registered. */
  chat?: ChatRoutesOptions;
  /** Callbacks for the config routes. When omitted, config routes are not registered. */
  config?: ConfigRoutesOptions;
  /** Callbacks for the costs routes. When omitted, costs routes are not registered. */
  costs?: CostsRoutesOptions;
  /**
   * Optional callback invoked when `POST /shutdown` is received.
   *
   * The handler is called asynchronously after the `{ ok: true }` response
   * has been sent — the route always responds immediately and triggers the
   * shutdown in the background. When omitted, `POST /shutdown` returns 404.
   */
  onShutdown?: () => void | Promise<void>;
}

/** Return value of {@link createServer}. */
export interface ServerResult {
  /** The configured Fastify instance (not yet listening). */
  server: FastifyInstance;
  /** Broadcast a JSON event to all connected WebSocket clients. */
  broadcast: (event: Record<string, unknown>) => void;
  /** Signal that is aborted when the server closes. */
  signal: AbortSignal;
}

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure a Fastify server with WebSocket support, CORS,
 * optional static file serving, and token-based authentication.
 *
 * The server is returned in a non-listening state — call `server.listen()`
 * to begin accepting connections.
 *
 * Authentication:
 * - HTTP routes use Bearer token in the `Authorization` header.
 * - WebSocket connections authenticate via `?token=xxx` query parameter.
 * - `GET /health` is unauthenticated.
 *
 * @param options - Server configuration options.
 * @returns The configured server instance and a broadcast function.
 */
export async function createServer(options: ServerOptions): Promise<ServerResult> {
  const { token, dashboardPath } = options;

  const server = Fastify({ logger: false });

  /** Controller used to signal background tasks on server close. */
  const abortController = new AbortController();

  /** Resolved dashboard build directory when it exists on disk, otherwise null. */
  const dashboardRoot = dashboardPath && existsSync(dashboardPath) ? dashboardPath : null;

  // ---------------------------------------------------------------------------
  // Plugins
  // ---------------------------------------------------------------------------

  await server.register(fastifyWebsocket);
  await server.register(fastifyCors, { origin: true });

  if (dashboardRoot) {
    await server.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: "/",
    });
  }

  // ---------------------------------------------------------------------------
  // Abort background tasks on server close
  // ---------------------------------------------------------------------------

  server.addHook("onClose", (): void => {
    abortController.abort();
    // Close all open WebSocket clients so the ws.Server can shut down
    // and the Node.js event loop is not kept alive during tests.
    for (const client of clients) {
      client.close();
    }
    clients.clear();
  });

  // ---------------------------------------------------------------------------
  // Auth middleware — Bearer token on all HTTP routes except GET /health.
  // WebSocket upgrade requests are excluded because WS clients authenticate
  // via query parameter inside the WebSocket handler.
  // ---------------------------------------------------------------------------

  server.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (request.method === "GET" && request.url === "/health") {
        return;
      }

      if (request.url === "/ws" || request.url.startsWith("/ws?")) {
        return;
      }

      // When the dashboard is active, skip auth for GET requests to non-API
      // paths. Static assets and SPA client-side routes do not carry a Bearer
      // token; the dashboard includes it only in its API fetch/XHR calls.
      if (dashboardRoot && request.method === "GET") {
        const isApiRoute = API_ROUTE_PREFIXES.some(
          (p) =>
            request.url === p || request.url.startsWith(p + "/") || request.url.startsWith(p + "?"),
        );
        if (!isApiRoute) return;
      }

      const header = request.headers.authorization;

      if (!header || !header.startsWith(BEARER_PREFIX)) {
        await reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      if (header.slice(BEARER_PREFIX.length) !== token) {
        await reply.code(401).send({ error: "Unauthorized" });
        return;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Error handler — return structured { error } JSON for all failures.
  // ---------------------------------------------------------------------------

  server.setErrorHandler(
    async (
      error: Error & { statusCode?: number },
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<void> => {
      const statusCode = error.statusCode ?? 500;

      if (LOG_LEVEL !== "silent" && statusCode >= 400) {
        const logEntry = {
          timestamp: new Date().toISOString(),
          method: request.method,
          url: request.url,
          statusCode,
          errorMessage: error.message,
        };
        console.error(JSON.stringify(logEntry));
      }

      await reply.code(statusCode).send({ error: error.message });
    },
  );

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  await server.register(
    healthRoutes(
      options.health ?? {
        getUptime: (): number => Math.floor(process.uptime()),
        getWorkflow: (): null => null,
      },
    ),
  );

  if (options.workflow) {
    await server.register(workflowRoutes({ ...options.workflow, signal: abortController.signal }));
  }

  if (options.nodes) {
    await server.register(nodesRoutes(options.nodes));
  }

  if (options.memory) {
    await server.register(memoryRoutes(options.memory));
  }

  if (options.events) {
    await server.register(eventsRoutes(options.events));
  }

  if (options.chat) {
    await server.register(chatRoutes(options.chat));
  }

  if (options.config) {
    await server.register(configRoutes(options.config));
  }

  if (options.costs) {
    await server.register(costsRoutes(options.costs));
  }

  // ---------------------------------------------------------------------------
  // WebSocket endpoint with query-param token auth
  // ---------------------------------------------------------------------------

  const clients = new Set<SocketClient>();

  server.get("/ws", { websocket: true }, (socket: SocketClient, _request: FastifyRequest): void => {
    const url = new URL(_request.url, `http://${_request.headers.host ?? "localhost"}`);
    const queryToken = url.searchParams.get("token");

    if (queryToken !== token) {
      socket.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    clients.add(socket);

    socket.send(JSON.stringify({ type: "connected", version: VERSION }));

    socket.on("close", (): void => {
      clients.delete(socket);
    });
  });

  // ---------------------------------------------------------------------------
  // Not-found handler — SPA fallback for the dashboard.
  //
  // When the dashboard is active, unmatched GET requests that accept text/html
  // receive index.html so React Router can handle client-side navigation.
  // Existing static files are already served by @fastify/static before this
  // handler is reached (the static plugin calls reply.callNotFound() only when
  // the requested file does not exist on disk).
  //
  // All other unmatched requests (non-GET, or requests that do not accept HTML)
  // receive a structured JSON 404 response.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Shutdown route — authenticated POST /shutdown
  // ---------------------------------------------------------------------------

  if (options.onShutdown) {
    const shutdownCallback = options.onShutdown;

    server.post(
      "/shutdown",
      async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        // Respond immediately, then trigger graceful shutdown in the background.
        await reply.code(200).send({ ok: true });
        void Promise.resolve(shutdownCallback());
      },
    );
  }

  // ---------------------------------------------------------------------------
  // 404 handler
  // ---------------------------------------------------------------------------

  server.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (
      dashboardRoot &&
      request.method === "GET" &&
      request.headers.accept?.includes("text/html")
    ) {
      reply.sendFile("index.html");
      return;
    }
    await reply.code(404).send({ error: "Not found" });
  });

  // ---------------------------------------------------------------------------
  // Broadcast
  // ---------------------------------------------------------------------------

  /**
   * Send a JSON-stringified event to every connected WebSocket client.
   *
   * Clients whose connection is no longer open are silently skipped.
   *
   * @param event - The event payload to broadcast.
   */
  const broadcast = (event: Record<string, unknown>): void => {
    const data = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WS_OPEN) {
        client.send(data);
      }
    }
  };

  return { server, broadcast, signal: abortController.signal };
}
