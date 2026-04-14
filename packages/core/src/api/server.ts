import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { healthRoutes, type HealthRoutesOptions } from "./routes/health.js";
import { memoryRoutes } from "./routes/memory.js";
import { eventsRoutes } from "./routes/events.js";
import { nodesRoutes } from "./routes/nodes.js";
import { workflowRoutes, type WorkflowRoutesOptions } from "./routes/workflow.js";
import { chatRoutes } from "./routes/chat.js";
import { configRoutes } from "./routes/config.js";
import { costsRoutes } from "./routes/costs.js";
import { specsRoutes } from "./routes/specs.js";
import { daemonRoutes } from "./routes/daemon.js";
import { projectsCrudRoutes } from "./routes/projects-crud.js";
import { legacyGoneRoutes } from "./routes/legacy-gone.js";
import type { ProjectSummary, ProjectRuntime } from "../daemon-types.js";

// ============================================================================
// Constants
// ============================================================================

/** Version string sent in the WebSocket welcome message. */
const VERSION = "0.2.0";

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
  "/projects",
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
  /**
   * Legacy: closure-based workflow route options.
   * When provided, workflow routes are also registered at the root level
   * (without a project-id prefix) for backward compatibility.
   */
  workflow?: WorkflowRoutesOptions;
  /**
   * Optional callback invoked when `POST /shutdown` is received.
   *
   * The handler is called asynchronously after the `{ ok: true }` response
   * has been sent — the route always responds immediately and triggers the
   * shutdown in the background. When omitted, `POST /shutdown` returns 404.
   */
  onShutdown?: () => void | Promise<void>;
  /** Return all registered projects as summaries (for /daemon/status). When omitted, returns []. */
  listProjects?: () => ProjectSummary[];
  /** Return a project runtime by id (for /projects/:id/* routes). When omitted, returns null. */
  getRuntime?: (projectId: string) => ProjectRuntime | null;
  /** TCP port the daemon is listening on (for /daemon/status). When omitted, 0. */
  daemonPort?: number;
  /** Build and register a ProjectRuntime. When omitted, /projects CRUD routes are not registered. */
  registerProject?: (input: {
    id: string;
    name: string;
    projectPath: string;
    providerProfileId: string;
    configOverrides?: Record<string, unknown>;
  }) => Promise<ProjectRuntime>;
  /** Remove a project from the registry by id. When omitted, /projects CRUD routes are not registered. */
  deregisterProject?: (id: string) => Promise<boolean>;
  /**
   * Optional node executor factory for multi-project route execution.
   * Passed through to workflowRoutes inside the /projects/:id scope.
   */
  createNodeExecutor?: WorkflowRoutesOptions["createNodeExecutor"];
}

/** Return value of {@link createServer}. */
export interface ServerResult {
  /** The configured Fastify instance (not yet listening). */
  server: FastifyInstance;
  /** Broadcast a JSON event to all connected WebSocket clients. */
  broadcast: (event: Record<string, unknown>) => void;
  /**
   * Broadcast a JSON event to WebSocket clients subscribed to the given project.
   *
   * The envelope sent to each matching client is `{ projectId, ...event }`.
   * A client receives the event if it subscribed with `{ all: true }` or if it
   * explicitly listed `projectId` in its `{ projectIds: [...] }` subscription.
   */
  broadcastForProject: (projectId: string, event: Record<string, unknown>) => void;
  /** Signal that is aborted when the server closes. */
  signal: AbortSignal;
}

// ============================================================================
// preValidation hook factory
// ============================================================================

/**
 * Build a preValidation hook that resolves a project runtime from `:id`
 * and attaches it to the request as `req.runtime`.
 *
 * Returns 400 when no `:id` param is present, 404 when the project is not registered.
 *
 * @param getRuntime - Callback to look up a ProjectRuntime by project ID.
 */
function makeProjectRuntimeHook(getRuntime: (id: string) => ProjectRuntime | null) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const projectId = (req.params as { projectId?: string }).projectId;
    if (!projectId) {
      await reply.code(400).send({ error: "missing_project_id" });
      return;
    }
    const rt = getRuntime(projectId);
    if (!rt) {
      await reply.code(404).send({ error: "project_not_registered", id: projectId });
      return;
    }
    (req as FastifyRequest & { runtime?: ProjectRuntime }).runtime = rt;
  };
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
    subscriptions.clear();
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

  const startedAtMs = Date.now();
  await server.register(daemonRoutes, {
    listProjects: options.listProjects ?? ((): ProjectSummary[] => []),
    daemonPort: options.daemonPort ?? 0,
    startedAtMs,
  });

  await server.register(
    healthRoutes(
      options.health ?? {
        getUptime: (): number => Math.floor(process.uptime()),
        getWorkflow: (): null => null,
      },
    ),
  );

  if (options.registerProject && options.deregisterProject) {
    await server.register(projectsCrudRoutes, {
      listProjects: options.listProjects ?? ((): ProjectSummary[] => []),
      getProject: options.getRuntime ?? ((): null => null),
      registerProject: options.registerProject,
      deregisterProject: options.deregisterProject,
    });
  }

  // ---------------------------------------------------------------------------
  // Legacy v0.1.0 routes — return 410 Gone with a newRoute hint (T12)
  //
  // Only registered when the caller does NOT pass `options.workflow`. When
  // `options.workflow` is provided (backward-compat mode), the root-level
  // workflow routes are already registered below and must not be duplicated.
  // ---------------------------------------------------------------------------

  if (!options.workflow) {
    await server.register(legacyGoneRoutes);
  }

  // ---------------------------------------------------------------------------
  // /projects/:id/* — per-project routes (T11)
  //
  // All project-specific routes are mounted under this scoped prefix.
  // The preValidation hook resolves the project runtime by ID and attaches
  // it to `req.runtime` for use by route handlers.
  // ---------------------------------------------------------------------------

  const getRuntime = options.getRuntime ?? ((): null => null);
  const projectRuntimeHook = makeProjectRuntimeHook(getRuntime);

  await server.register(
    async (scoped) => {
      scoped.addHook("preValidation", projectRuntimeHook);
      await scoped.register(workflowRoutes({
        signal: abortController.signal,
        createNodeExecutor: options.createNodeExecutor,
      }));
      await scoped.register(eventsRoutes({}));
      await scoped.register(chatRoutes({}));
      await scoped.register(nodesRoutes({}));
      await scoped.register(memoryRoutes({}));
      await scoped.register(costsRoutes({}));
      await scoped.register(configRoutes({}));
      await scoped.register(specsRoutes({}));
    },
    { prefix: "/projects/:projectId" },
  );

  // ---------------------------------------------------------------------------
  // Legacy root-level routes (backward compatibility)
  //
  // When a caller passes the `workflow` option, also register routes at the
  // top level (no project-id prefix) so that existing tests and tools that
  // directly call createServer() with closures continue to work.
  // ---------------------------------------------------------------------------

  if (options.workflow) {
    await server.register(workflowRoutes({ ...options.workflow, signal: abortController.signal }));
  }

  // ---------------------------------------------------------------------------
  // WebSocket endpoint with query-param token auth
  // ---------------------------------------------------------------------------

  /**
   * Per-connection subscription state.
   *
   * - `all`: when true, the client receives events for every project.
   * - `projectIds`: the set of project IDs the client has explicitly subscribed to.
   */
  interface ClientSubscription {
    all: boolean;
    projectIds: Set<string>;
  }

  const clients = new Set<SocketClient>();

  /** Map from connected socket to its subscription state. */
  const subscriptions = new Map<SocketClient, ClientSubscription>();

  server.get("/ws", { websocket: true }, (socket: SocketClient, _request: FastifyRequest): void => {
    const url = new URL(_request.url, `http://${_request.headers.host ?? "localhost"}`);
    const queryToken = url.searchParams.get("token");

    if (queryToken !== token) {
      socket.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    clients.add(socket);
    subscriptions.set(socket, { all: false, projectIds: new Set() });

    socket.send(JSON.stringify({ type: "connected", version: VERSION }));

    socket.on("message", (...args: unknown[]): void => {
      const raw = args[0] as Buffer | string;
      let msg: unknown;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      } catch {
        return;
      }
      if (
        typeof msg !== "object" ||
        msg === null ||
        (msg as Record<string, unknown>)["type"] !== "subscribe"
      ) {
        return;
      }
      const sub = subscriptions.get(socket);
      if (!sub) return;
      const payload = msg as Record<string, unknown>;
      if (payload["all"] === true) {
        sub.all = true;
      }
      if (Array.isArray(payload["projectIds"])) {
        for (const id of payload["projectIds"] as unknown[]) {
          if (typeof id === "string") {
            sub.projectIds.add(id);
          }
        }
      }
    });

    socket.on("close", (): void => {
      clients.delete(socket);
      subscriptions.delete(socket);
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

  /**
   * Send a project-scoped event to WebSocket clients that are subscribed
   * to the given project (or have subscribed with `{ all: true }`).
   *
   * The message sent to each eligible client is `{ projectId, ...event }`.
   *
   * @param projectId - The project whose subscribers should receive the event.
   * @param event - The event payload to forward.
   */
  const broadcastForProject = (projectId: string, event: Record<string, unknown>): void => {
    const envelope = JSON.stringify({ projectId, ...event });
    for (const [client, sub] of subscriptions) {
      if (client.readyState !== WS_OPEN) continue;
      if (sub.all || sub.projectIds.has(projectId)) {
        client.send(envelope);
      }
    }
  };

  return { server, broadcast, broadcastForProject, signal: abortController.signal };
}
