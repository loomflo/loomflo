import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { flushPendingWrites } from './persistence/state.js';

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
const LOOMFLO_HOME_DIR = '.loomflo';

/** Filename for daemon runtime info. */
const DAEMON_FILE = 'daemon.json';

/** Default host — loopback only for security. */
const DEFAULT_HOST = '127.0.0.1';

/** Default port. */
const DEFAULT_PORT = 3000;

/** Token length in bytes (produces 64-char hex string). */
const TOKEN_BYTES = 32;

// ============================================================================
// Daemon Class
// ============================================================================

/**
 * Manages the Loomflo daemon lifecycle: Fastify server start/stop,
 * auth token generation, and daemon.json persistence.
 */
export class Daemon {
  private readonly port: number;
  private readonly host: string;
  private server: FastifyInstance | null = null;
  private info: DaemonInfo | null = null;

  /**
   * Create a new Daemon instance.
   *
   * @param config - Daemon configuration options.
   */
  constructor(config: DaemonConfig) {
    this.port = config.port ?? DEFAULT_PORT;
    this.host = config.host ?? DEFAULT_HOST;

    if (this.host !== '127.0.0.1' && this.host !== 'localhost') {
      throw new Error(
        `Daemon must listen on 127.0.0.1 only, got '${this.host}'. ` +
          'Binding to external interfaces is prohibited for security.',
      );
    }
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
      throw new Error('Daemon is already running');
    }

    const token = randomBytes(TOKEN_BYTES).toString('hex');

    this.server = Fastify({ logger: false });

    await this.server.listen({ port: this.port, host: this.host });

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
   * Gracefully stop the daemon.
   *
   * Flushes any pending state writes, closes the Fastify server,
   * and removes `~/.loomflo/daemon.json`.
   */
  async stop(): Promise<void> {
    await flushPendingWrites();

    if (this.server) {
      await this.server.close();
      this.server = null;
    }

    await removeDaemonFile();
    this.info = null;
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
    encoding: 'utf-8',
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
    if (code !== 'ENOENT') {
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
    content = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
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
