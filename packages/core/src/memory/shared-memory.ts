/**
 * Shared memory manager for Loomflo agent orchestration.
 *
 * Manages append-only markdown files in `.loomflo/shared-memory/` that serve as
 * the cross-node state sharing mechanism. All writes are serialized per file
 * using async-mutex to prevent race conditions (Constitution Principles III, V).
 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Mutex } from "async-mutex";
import type { SharedMemoryFile } from "../types.js";

// ============================================================================
// Constants
// ============================================================================

/** Directory within the workspace where shared memory files are stored. */
const SHARED_MEMORY_DIR = ".loomflo/shared-memory";

/** Regex to extract timestamp and agent ID from entry headers. */
const ENTRY_HEADER_REGEX = /_\[(.+?)\] written by (.+?)_/g;

/** The 7 standard shared memory files managed by the daemon. */
export const STANDARD_MEMORY_FILES: readonly string[] = [
  "DECISIONS.md",
  "ERRORS.md",
  "PROGRESS.md",
  "PREFERENCES.md",
  "ISSUES.md",
  "INSIGHTS.md",
  "ARCHITECTURE_CHANGES.md",
];

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates a memory file name for safety and correctness.
 *
 * @param name - File name to validate.
 * @throws Error if the name contains path separators, ".." segments, or does
 *   not end in `.md`.
 */
function validateFileName(name: string): void {
  if (!name.endsWith(".md")) {
    throw new Error(`Invalid memory file name "${name}" — must end in .md`);
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid memory file name "${name}" — must not contain path separators`);
  }
  if (name.includes("..")) {
    throw new Error(`Invalid memory file name "${name}" — must not contain ".." segments`);
  }
}

// ============================================================================
// SharedMemoryManager
// ============================================================================

/**
 * Manages shared memory files for cross-node state sharing.
 *
 * Files are append-only markdown documents stored in `.loomflo/shared-memory/`
 * relative to the workspace root. Each write is serialized per file using
 * async-mutex, ensuring no concurrent writes or race conditions.
 *
 * Read operations do not acquire the mutex — concurrent reads are safe.
 */
export class SharedMemoryManager {
  private readonly memoryDir: string;
  private readonly mutexes: Map<string, Mutex> = new Map();

  /**
   * Creates a new SharedMemoryManager instance.
   *
   * @param workspacePath - Absolute path to the project workspace root.
   */
  constructor(workspacePath: string) {
    this.memoryDir = join(workspacePath, SHARED_MEMORY_DIR);
  }

  /**
   * Initializes the shared memory directory and standard files.
   *
   * Creates the `.loomflo/shared-memory/` directory if it does not exist,
   * then creates each standard file with a title header if it is missing.
   * This operation is idempotent — existing files are not overwritten.
   */
  async initialize(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });

    for (const fileName of STANDARD_MEMORY_FILES) {
      const filePath = join(this.memoryDir, fileName);
      try {
        await stat(filePath);
      } catch {
        const title = fileName.replace(".md", "");
        await writeFile(filePath, `# ${title}\n\n`, "utf-8");
      }
    }
  }

  /**
   * Reads a shared memory file and returns its content with metadata.
   *
   * Parses the file content to extract the last modification timestamp
   * and agent ID from entry headers. If the file has no entries (freshly
   * initialized), file system metadata is used instead.
   *
   * @param name - Name of the memory file (e.g. "DECISIONS.md").
   * @returns The shared memory file with content and metadata.
   * @throws Error if the name is invalid or the file does not exist.
   */
  async read(name: string): Promise<SharedMemoryFile> {
    validateFileName(name);

    const filePath = join(this.memoryDir, name);

    let content: string;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      [content, fileStat] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
    } catch {
      throw new Error(`Shared memory file not found: ${name}`);
    }

    const { lastModifiedBy, lastModifiedAt } = this.parseLastEntry(content, fileStat.mtime);

    return {
      name,
      path: filePath,
      content,
      lastModifiedBy,
      lastModifiedAt,
    };
  }

  /**
   * Appends content to a shared memory file with a timestamped header.
   *
   * The write is serialized per file using async-mutex. Each entry is
   * formatted with a separator, timestamp, and agent attribution header.
   *
   * @param name - Name of the memory file (e.g. "DECISIONS.md").
   * @param content - Text content to append.
   * @param agentId - ID of the agent performing the write.
   * @throws Error if the name is invalid or the write fails.
   */
  async write(name: string, content: string, agentId: string): Promise<void> {
    validateFileName(name);

    const filePath = join(this.memoryDir, name);
    const mutex = this.getMutex(name);

    await mutex.runExclusive(async () => {
      const timestamp = new Date().toISOString();
      const entry = `\n---\n_[${timestamp}] written by ${agentId}_\n\n${content}\n`;
      await appendFile(filePath, entry, "utf-8");
    });
  }

  /**
   * Lists all shared memory files with their content and metadata.
   *
   * Reads every `.md` file in the shared memory directory and returns
   * an array of {@link SharedMemoryFile} objects. Files that cannot be
   * read are silently skipped.
   *
   * @returns Array of all shared memory files with content and metadata.
   */
  async list(): Promise<SharedMemoryFile[]> {
    let entries: string[];
    try {
      entries = await readdir(this.memoryDir);
    } catch {
      return [];
    }

    const mdFiles = entries.filter((e) => e.endsWith(".md"));
    const results: SharedMemoryFile[] = [];

    for (const fileName of mdFiles) {
      try {
        results.push(await this.read(fileName));
      } catch {
        // Skip files that cannot be read
      }
    }

    return results;
  }

  /**
   * Returns the names of the 7 standard shared memory files.
   *
   * @returns Array of standard file names.
   */
  getStandardFiles(): string[] {
    return [...STANDARD_MEMORY_FILES];
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Returns the mutex for a given file, creating one if it does not exist.
   */
  private getMutex(name: string): Mutex {
    let mutex = this.mutexes.get(name);
    if (mutex === undefined) {
      mutex = new Mutex();
      this.mutexes.set(name, mutex);
    }
    return mutex;
  }

  /**
   * Parses file content for the last entry header to extract metadata.
   *
   * Falls back to file system mtime and "system" agent if no entry
   * headers are found (freshly initialized file).
   */
  private parseLastEntry(
    content: string,
    mtime: Date,
  ): { lastModifiedBy: string; lastModifiedAt: string } {
    const matches = [...content.matchAll(ENTRY_HEADER_REGEX)];

    const lastMatch = matches.at(-1);
    if (lastMatch !== undefined) {
      return {
        lastModifiedAt: lastMatch[1] ?? mtime.toISOString(),
        lastModifiedBy: lastMatch[2] ?? "system",
      };
    }

    return {
      lastModifiedBy: "system",
      lastModifiedAt: mtime.toISOString(),
    };
  }
}
