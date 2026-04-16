import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createServer } from "./api/server.js";
import { runLoomi } from "./agents/loomi.js";
import { appendEvent, createEvent } from "./persistence/events.js";
import { flushPendingWrites, saveWorkflowStateImmediate } from "./persistence/state.js";
import { ProjectsRegistry } from "./persistence/projects.js";
import { CostTracker } from "./costs/tracker.js";
import { SharedMemoryManager } from "./memory/shared-memory.js";
import { MessageBus } from "./agents/message-bus.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import type { LLMProvider } from "./providers/base.js";
import { resolveCredentials } from "./providers/credentials.js";
import { ProviderProfiles, type ProviderProfile } from "./providers/profiles.js";
import { readFileTool } from "./tools/file-read.js";
import { writeFileTool } from "./tools/file-write.js";
import { editFileTool } from "./tools/file-edit.js";
import { listFilesTool } from "./tools/file-list.js";
import { searchFilesTool } from "./tools/file-search.js";
import { shellExecTool } from "./tools/shell-exec.js";
import { memoryReadTool } from "./tools/memory-read.js";
import { memoryWriteTool } from "./tools/memory-write.js";
import { loadConfig } from "./config.js";
import type { NodeExecutor } from "./workflow/execution-engine.js";
import type { Workflow } from "./types.js";
import type { ProjectRuntime, ProjectSummary } from "./daemon-types.js";
import { toProjectSummary } from "./daemon-types.js";

// ============================================================================
// Interfaces
// ============================================================================

/** Configuration options for the daemon. */
export interface DaemonConfig {
  /** TCP port to listen on. Defaults to 3000. */
  port?: number;
  /** Host address to bind to. Defaults to '127.0.0.1'. */
  host?: string;
  /** Absolute path to the project workspace. */
  projectPath?: string;
  /** Absolute path to the dashboard static files directory. */
  dashboardPath?: string;
}

/**
 * Callback interface for graceful shutdown coordination.
 *
 * The daemon does not own workflow state directly — the caller provides
 * these hooks so the daemon can coordinate an orderly shutdown with
 * the execution engine for each registered project.
 */
export interface ShutdownHooks {
  /** Stop dispatching new LLM calls for a given project. */
  stopDispatching: (projectId: string) => void;
  /** Wait for in-flight LLM calls to drain for a given project. */
  waitForActiveCalls: (projectId: string) => Promise<void>;
  /** Mark running nodes as interrupted for a project; return their IDs. */
  markNodesInterrupted: (projectId: string) => string[];
}

/** Runtime information about a running daemon instance. */
export interface DaemonInfo {
  /** TCP port the daemon is listening on. */
  port: number;
  /** Host address the daemon is bound to. */
  host: string;
  /** Cryptographic auth token for API access. */
  token: string;
  /** Process ID of the daemon. */
  pid: number;
  /** Daemon version string. */
  version: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Current daemon version — written to daemon.json so clients can verify compatibility. */
const DAEMON_VERSION = "0.3.0";

/** Directory name for global Loomflo config/state. */
const LOOMFLO_HOME_DIR = ".loomflo";

/** Filename for daemon runtime info. */
const DAEMON_FILE = "daemon.json";

/** Default host — loopback only for security. */
const DEFAULT_HOST = "127.0.0.1";

/** Default port. */
const DEFAULT_PORT = 3000;

/** Token length in bytes (produces 64-char hex string). */
const TOKEN_BYTES = 32;

// ============================================================================
// Daemon Class
// ============================================================================

/** Default timeout for graceful shutdown in milliseconds. */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Manages the Loomflo daemon lifecycle: Fastify server start/stop,
 * auth token generation, daemon.json persistence, and graceful shutdown.
 */
export class Daemon {
  private readonly port: number;
  private readonly host: string;
  private readonly projectPath: string | undefined;
  private readonly dashboardPath: string | undefined;
  private server: FastifyInstance | null = null;
  private broadcast: ((event: Record<string, unknown>) => void) | null = null;
  /** Broadcast a project-scoped event to subscribed WebSocket clients. */
  broadcastForProject: (projectId: string, event: Record<string, unknown>) => void = (): void => {
    /* no-op until server is started */
  };
  private info: DaemonInfo | null = null;
  private shutdownHooks: ShutdownHooks | null = null;
  private shuttingDown = false;
  private readonly projects: Map<string, ProjectRuntime> = new Map();
  private readonly profiles = new ProviderProfiles(join(homedir(), ".loomflo", "credentials.json"));
  private readonly projectsRegistry = new ProjectsRegistry(
    join(homedir(), ".loomflo", "projects.json"),
  );

  /** Register or replace a project runtime. */
  upsertProject(rt: ProjectRuntime): void {
    this.projects.set(rt.id, rt);
  }

  /** Return the runtime for a given id, or null. */
  getProject(id: string): ProjectRuntime | null {
    return this.projects.get(id) ?? null;
  }

  /** List all registered projects as summaries. */
  listProjects(): ProjectSummary[] {
    return [...this.projects.values()].map(toProjectSummary);
  }

  /** Remove a project by id. Returns true if removed, false if absent. */
  removeProject(id: string): boolean {
    return this.projects.delete(id);
  }

  /** Internal: return the full map (for per-project shutdown iteration). */
  protected getAllRuntimes(): ProjectRuntime[] {
    return [...this.projects.values()];
  }

  /**
   * Create a new Daemon instance.
   *
   * @param config - Daemon configuration options.
   */
  constructor(config: DaemonConfig) {
    this.port = config.port ?? DEFAULT_PORT;
    this.host = config.host ?? DEFAULT_HOST;
    this.projectPath = config.projectPath;
    this.dashboardPath = config.dashboardPath;

    const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);

    if (!ALLOWED_HOSTS.has(this.host)) {
      throw new Error(
        `Daemon host must be one of ${[...ALLOWED_HOSTS].join(", ")}, got '${this.host}'. ` +
          "Use 0.0.0.0 only inside containers where network isolation is provided by the runtime.",
      );
    }
  }

  /**
   * Register shutdown hooks for graceful shutdown coordination.
   *
   * These hooks allow the daemon to coordinate with the execution engine
   * during shutdown: stop dispatching new calls, wait for active calls,
   * mark interrupted nodes, and persist final state.
   *
   * @param hooks - Callback interface for shutdown coordination.
   */
  setShutdownHooks(hooks: ShutdownHooks): void {
    this.shutdownHooks = hooks;
  }

  /**
   * Whether the daemon is currently in the process of shutting down.
   *
   * @returns True if graceful shutdown has been initiated.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Start the Fastify server and write daemon.json.
   *
   * Generates a cryptographic auth token, creates the Fastify instance,
   * starts listening on host:port, and persists runtime info to
   * `~/.loomflo/daemon.json` with restricted file permissions (0o600).
   *
   * @returns Runtime information about the started daemon.
   * @throws If the server is already running or fails to start.
   */
  async start(): Promise<DaemonInfo> {
    if (this.server) {
      throw new Error("Daemon is already running");
    }

    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const projectPath = this.projectPath ?? process.cwd();

    const workerTools = [
      readFileTool,
      writeFileTool,
      editFileTool,
      listFilesTool,
      searchFilesTool,
      shellExecTool,
      memoryReadTool,
      memoryWriteTool,
    ];

    /**
     * Build a NodeExecutor for a given project runtime and workflow.
     * Used by workflowRoutes inside /projects/:id/* (T11).
     */
    const createNodeExecutor =
      (rt: ProjectRuntime, workflow: Workflow): NodeExecutor =>
      async (node) => {
        const nodeConfig = await loadConfig({ projectPath: workflow.projectPath });
        const messageBus = new MessageBus();

        const result = await runLoomi({
          nodeId: node.id,
          nodeTitle: node.title,
          instructions: (node as unknown as { instructions?: string }).instructions ?? "",
          workspacePath: workflow.projectPath,
          provider: rt.provider,
          model: nodeConfig.models.loomi,
          config: nodeConfig,
          messageBus,
          eventLog: { workflowId: workflow.id },
          costTracker: rt.costTracker,
          sharedMemory: rt.sharedMemory,
          escalationHandler: {
            escalate: async () => {
              /* no-op in daemon — agents self-manage */
            },
          },
          workerTools,
        });

        return {
          status:
            result.status === "completed"
              ? "done"
              : result.status === "blocked"
                ? "blocked"
                : "failed",
          cost: 0,
        };
      };

    const { server, broadcast, broadcastForProject } = await createServer({
      token,
      projectPath,
      dashboardPath: this.dashboardPath ?? null,
      listProjects: () => this.listProjects(),
      getRuntime: (id) => this.getProject(id),
      daemonPort: this.port,
      health: {
        getUptime: (): number => Math.floor(process.uptime()),
        getWorkflow: (): null => null,
      },
      createNodeExecutor,
      registerProject: (input) => this.registerProject(input),
      deregisterProject: (id) => this.deregisterProject(id),
      onShutdown: (): void => {
        void this.gracefulShutdown();
      },
    });

    this.server = server;
    this.broadcast = broadcast;
    this.broadcastForProject = broadcastForProject;

    try {
      await this.server.listen({ port: this.port, host: this.host });
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === "EADDRINUSE") {
        throw new Error(
          `Port ${String(this.port)} is already in use. Use --port to specify a different port or stop the existing process.`,
        );
      }
      throw error;
    }

    // Reload projects persisted from a previous daemon session.
    const persisted = await this.projectsRegistry.list();
    for (const entry of persisted) {
      try {
        await this.registerProject(entry);
      } catch (err) {
        console.warn(`[loomflo] could not reload ${entry.id}: ${(err as Error).message}`);
      }
    }

    this.info = {
      port: this.port,
      host: this.host,
      token,
      pid: process.pid,
      version: DAEMON_VERSION,
    };

    await writeDaemonFile(this.info);

    return this.info;
  }

  /**
   * Stop the daemon immediately.
   *
   * Flushes any pending state writes, closes the Fastify server,
   * and removes `~/.loomflo/daemon.json`. Does NOT wait for active
   * agent calls to finish. Use {@link gracefulShutdown} for orderly shutdown.
   */
  async stop(): Promise<void> {
    await flushPendingWrites();

    if (this.server) {
      await this.server.close();
      this.server = null;
    }

    await removeDaemonFile();
    this.info = null;
    this.shuttingDown = false;
  }

  /**
   * Gracefully shut down the daemon with full state preservation.
   *
   * Performs the following steps in order:
   * 1. Stops dispatching new agent LLM calls.
   * 2. Waits for all currently in-flight LLM calls to complete
   *    (or until the timeout is reached).
   * 3. Marks any running nodes as interrupted in the workflow state.
   * 4. Logs interruption events to events.jsonl.
   * 5. Saves the final workflow.json state immediately (no debounce).
   * 6. Flushes all pending writes.
   * 7. Closes the Fastify server.
   * 8. Removes daemon.json.
   *
   * If no shutdown hooks are registered, falls back to {@link stop}.
   *
   * @param timeoutMs - Maximum time to wait for active calls in milliseconds.
   *   Defaults to 30 seconds.
   */
  async gracefulShutdown(timeoutMs: number = GRACEFUL_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const runtimes = this.getAllRuntimes();

    if (this.shutdownHooks === null && runtimes.length === 0) {
      await this.stop();
      return;
    }

    // Shut down all projects in parallel.
    await Promise.all(runtimes.map((rt) => this.shutdownOneProject(rt, timeoutMs)));

    await flushPendingWrites();
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    await removeDaemonFile();
    this.info = null;
    this.shuttingDown = false;
  }

  private async shutdownOneProject(rt: ProjectRuntime, timeoutMs: number): Promise<void> {
    const hooks = this.shutdownHooks;
    if (!hooks) return;

    hooks.stopDispatching(rt.id);

    try {
      await Promise.race([
        hooks.waitForActiveCalls(rt.id),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } catch {
      /* proceed regardless */
    }

    const interruptedNodeIds = hooks.markNodesInterrupted(rt.id);

    if (rt.workflow !== null) {
      for (const nodeId of interruptedNodeIds) {
        const event = createEvent({
          type: "node_failed",
          workflowId: rt.workflow.id,
          nodeId,
          details: { reason: "daemon_shutdown", interrupted: true },
        });
        await appendEvent(rt.projectPath, event);
      }
      await saveWorkflowStateImmediate(rt.projectPath, rt.workflow);
    }
  }

  /**
   * Get runtime information about the daemon if it is running.
   *
   * @returns The daemon info, or null if the daemon is not running.
   */
  getInfo(): DaemonInfo | null {
    return this.info;
  }

  /**
   * Check whether the daemon is currently running.
   *
   * @returns True if the daemon server is active.
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get the WebSocket broadcast function.
   *
   * Returns a no-op function if the server has not been started yet.
   *
   * @returns A function that broadcasts a JSON event to all connected WebSocket clients.
   */
  getBroadcast(): (event: Record<string, unknown>) => void {
    return (
      this.broadcast ??
      ((_event: Record<string, unknown>): void => {
        /* no-op broadcaster */ void _event;
      })
    );
  }

  /**
   * Build and register a ProjectRuntime from a provider profile.
   *
   * @param input - Project registration parameters.
   * @returns The newly created ProjectRuntime.
   * @throws If the provider profile is not found.
   */
  async registerProject(input: {
    id: string;
    name: string;
    projectPath: string;
    providerProfileId: string;
  }): Promise<ProjectRuntime> {
    const profile = await this.profiles.get(input.providerProfileId);
    if (!profile) throw new Error(`provider_missing_credentials: ${input.providerProfileId}`);

    const provider = await buildProviderFromProfile(profile);
    const config = await loadConfig({ projectPath: input.projectPath });

    const rt: ProjectRuntime = {
      id: input.id,
      name: input.name,
      projectPath: input.projectPath,
      providerProfileId: input.providerProfileId,
      workflow: null,
      provider,
      config,
      costTracker: new CostTracker(),
      messageBus: new MessageBus(),
      sharedMemory: new SharedMemoryManager(input.projectPath),
      startedAt: new Date().toISOString(),
      status: "idle",
    };
    this.upsertProject(rt);
    await this.projectsRegistry.upsert({
      id: rt.id,
      name: rt.name,
      projectPath: rt.projectPath,
      providerProfileId: rt.providerProfileId,
    });
    return rt;
  }

  /**
   * Remove a project from the registry by id.
   *
   * @param id - The project id to deregister.
   * @returns True if the project was found and removed, false if it was not registered.
   */
  async deregisterProject(id: string): Promise<boolean> {
    const removed = this.removeProject(id);
    if (removed) await this.projectsRegistry.remove(id);
    return removed;
  }

  /**
   * Test-only helper: start the server with a given static token (port 0).
   *
   * This method is intentionally not part of the public API surface.
   * It is used exclusively by unit tests to create an in-process server
   * accessible via `server.inject()`.
   *
   * @param token - Static auth token to use instead of a random one.
   */
  async startForTest(token: string): Promise<void> {
    const { createServer } = await import("./api/server.js");
    const { server, broadcastForProject } = await createServer({
      token,
      projectPath: process.cwd(),
      dashboardPath: null,
      listProjects: () => this.listProjects(),
      getRuntime: (id: string) => this.getProject(id),
      daemonPort: 0,
      registerProject: (input) => this.registerProject(input),
      deregisterProject: (id: string) => this.deregisterProject(id),
    });
    this.server = server;
    this.broadcastForProject = broadcastForProject;
    await this.server.listen({ port: 0, host: "127.0.0.1" });

    // Reload projects persisted from a previous daemon session.
    const persisted = await this.projectsRegistry.list();
    for (const entry of persisted) {
      try {
        await this.registerProject(entry);
      } catch (err) {
        console.warn(`[loomflo] could not reload ${entry.id}: ${(err as Error).message}`);
      }
    }
  }
}

// ============================================================================
// Daemon File Helpers
// ============================================================================

/**
 * Get the path to `~/.loomflo/daemon.json`.
 *
 * @returns Absolute path to the daemon info file.
 */
function getDaemonFilePath(): string {
  return join(homedir(), LOOMFLO_HOME_DIR, DAEMON_FILE);
}

/**
 * Write daemon runtime info to `~/.loomflo/daemon.json`.
 *
 * Creates the `~/.loomflo/` directory if it does not exist.
 * The file is written with mode 0o600 (owner read/write only).
 *
 * @param info - The daemon runtime info to persist.
 */
async function writeDaemonFile(info: DaemonInfo): Promise<void> {
  const dir = join(homedir(), LOOMFLO_HOME_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(getDaemonFilePath(), JSON.stringify(info, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Remove `~/.loomflo/daemon.json` from disk.
 *
 * Silently ignores if the file does not exist.
 */
async function removeDaemonFile(): Promise<void> {
  try {
    await unlink(getDaemonFilePath());
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

// ============================================================================
// Standalone Loader
// ============================================================================

/**
 * Load daemon runtime info from `~/.loomflo/daemon.json`.
 *
 * Reads and parses the file. Returns `null` if the file does not exist.
 *
 * @returns The daemon info, or null if no daemon info file is found.
 * @throws If the file contains invalid JSON.
 */
export async function loadDaemonInfo(): Promise<DaemonInfo | null> {
  const filePath = getDaemonFilePath();

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Failed to read daemon info at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in daemon info at ${filePath}`);
  }

  return parsed as DaemonInfo;
}

// ============================================================================
// Provider Builder
// ============================================================================

/**
 * Build an LLMProvider from a stored ProviderProfile.
 *
 * @param profile - The provider profile describing credentials and provider type.
 * @returns A ready-to-use LLMProvider instance.
 */
async function buildProviderFromProfile(profile: ProviderProfile): Promise<LLMProvider> {
  switch (profile.type) {
    case "anthropic-oauth": {
      const creds = await resolveCredentials();
      return new AnthropicProvider(creds.config);
    }
    case "anthropic":
      return new AnthropicProvider({ apiKey: profile.apiKey });
    case "openai":
      return new OpenAIProvider({
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        defaultModel: profile.defaultModel,
      });
    case "moonshot":
    case "nvidia":
      return new OpenAIProvider({
        apiKey: profile.apiKey,
        baseUrl: profile.baseUrl,
        defaultModel: profile.defaultModel,
      });
  }
}
