import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createServer } from "./api/server.js";
import { appendEvent, createEvent } from "./persistence/events.js";
import { flushPendingWrites, saveWorkflowStateImmediate } from "./persistence/state.js";
import type { Workflow } from "./types.js";

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
 * the execution engine.
 */
export interface ShutdownHooks {
  /** Stop dispatching new agent LLM calls. Called first during shutdown. */
  stopDispatching: () => void;
  /**
   * Wait for all currently in-flight LLM calls to complete.
   * Resolves when no more active calls remain.
   */
  waitForActiveCalls: () => Promise<void>;
  /**
   * Return the current in-memory workflow state for persistence,
   * or `null` if no active workflow exists.
   */
  getWorkflow: () => Workflow | null;
  /**
   * Mark any currently running nodes as interrupted in the workflow.
   * Returns the IDs of nodes that were marked.
   */
  markNodesInterrupted: () => string[];
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
}

// ============================================================================
// Constants
// ============================================================================

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
  private info: DaemonInfo | null = null;
  private shutdownHooks: ShutdownHooks | null = null;
  private shuttingDown = false;

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

    const { server, broadcast } = await createServer({
      token,
      projectPath: this.projectPath ?? process.cwd(),
      dashboardPath: this.dashboardPath ?? null,
      health: {
        getUptime: (): number => Math.floor(process.uptime()),
        getWorkflow: (): null => null,
      },
    });

    this.server = server;
    this.broadcast = broadcast;

    this.server.post("/shutdown", async (_request, reply): Promise<void> => {
      void this.gracefulShutdown();
      await reply.code(200).send({ ok: true });
    });

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

    this.info = {
      port: this.port,
      host: this.host,
      token,
      pid: process.pid,
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
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    if (!this.shutdownHooks) {
      await this.stop();
      return;
    }

    const { stopDispatching, waitForActiveCalls, getWorkflow, markNodesInterrupted } =
      this.shutdownHooks;

    // Step 1: Stop dispatching new agent calls.
    stopDispatching();

    // Step 2: Wait for active calls with timeout.
    try {
      await Promise.race([
        waitForActiveCalls(),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    } catch {
      // Timeout or error — proceed with shutdown regardless.
    }

    // Step 3: Mark running nodes as interrupted.
    const interruptedNodeIds = markNodesInterrupted();

    // Step 4 & 5: Persist final state if there's an active workflow.
    const workflow = getWorkflow();
    if (workflow !== null && this.projectPath) {
      // Log interruption events for each interrupted node.
      for (const nodeId of interruptedNodeIds) {
        const event = createEvent({
          type: "node_failed",
          workflowId: workflow.id,
          nodeId,
          details: { reason: "daemon_shutdown", interrupted: true },
        });
        await appendEvent(this.projectPath, event);
      }

      // Save workflow state immediately (bypass debounce).
      await saveWorkflowStateImmediate(this.projectPath, workflow);
    }

    // Step 6: Flush any remaining pending writes.
    await flushPendingWrites();

    // Step 7: Close the server.
    if (this.server) {
      await this.server.close();
      this.server = null;
    }

    // Step 8: Remove daemon.json.
    await removeDaemonFile();
    this.info = null;
    this.shuttingDown = false;
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
    return this.broadcast ?? ((_event: Record<string, unknown>): void => { /* no-op */ });
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
