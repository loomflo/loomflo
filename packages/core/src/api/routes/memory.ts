import type { FastifyPluginAsync } from "fastify";
import type { SharedMemoryManager } from "../../memory/shared-memory.js";

// ============================================================================
// Types
// ============================================================================

/** Metadata for a single shared memory file in the list response. */
export interface MemoryFileEntry {
  /** File name (e.g., "DECISIONS.md"). */
  name: string;
  /** Agent ID that last wrote to this file. */
  lastModifiedBy: string;
  /** ISO 8601 timestamp of last modification. */
  lastModifiedAt: string;
}

/** Shape of the GET /memory JSON response. */
export interface MemoryListResponse {
  /** Available shared memory files with metadata. */
  files: MemoryFileEntry[];
}

/** Options accepted by the {@link memoryRoutes} factory. */
export interface MemoryRoutesOptions {
  /** Return the current shared memory manager, or null if no workflow is active. */
  getSharedMemory: () => SharedMemoryManager | null;
}

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers shared memory routes.
 *
 * - GET /memory — list all shared memory files with metadata.
 * - GET /memory/:name — read a specific memory file as raw markdown.
 *
 * @param options - Callbacks that supply runtime data for the response.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function memoryRoutes(options: MemoryRoutesOptions): FastifyPluginAsync {
  const { getSharedMemory } = options;

  const plugin: FastifyPluginAsync = (fastify): Promise<void> => {
    /**
     * GET /memory
     *
     * Lists all shared memory files with metadata (name, lastModifiedBy, lastModifiedAt).
     * Returns 404 if no workflow is active.
     */
    fastify.get("/memory", async (_request, reply): Promise<void> => {
      const sharedMemory = getSharedMemory();

      if (sharedMemory === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }

      const memoryFiles = await sharedMemory.list();

      const files: MemoryFileEntry[] = memoryFiles.map((file) => ({
        name: file.name,
        lastModifiedBy: file.lastModifiedBy,
        lastModifiedAt: file.lastModifiedAt,
      }));

      await reply.code(200).send({ files } satisfies MemoryListResponse);
    });

    /**
     * GET /memory/:name
     *
     * Reads a specific shared memory file and returns its raw markdown content.
     * Validates the `:name` parameter to prevent path traversal.
     * Returns 404 if no workflow is active or the file does not exist.
     */
    fastify.get<{ Params: { name: string } }>(
      "/memory/:name",
      async (request, reply): Promise<void> => {
        const sharedMemory = getSharedMemory();

        if (sharedMemory === null) {
          await reply.code(404).send({ error: "No active workflow" });
          return;
        }

        const { name } = request.params;

        if (!isValidMemoryFileName(name)) {
          await reply.code(400).send({ error: "Invalid memory file name" });
          return;
        }

        try {
          const file = await sharedMemory.read(name);
          await reply.type("text/markdown").code(200).send(file.content);
        } catch {
          await reply.code(404).send({ error: "Memory file not found" });
        }
      },
    );
    return Promise.resolve();
  };

  return plugin;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that a memory file name is safe (no path traversal).
 *
 * Rejects names containing `..`, `/`, `\`, or null bytes.
 *
 * @param name - The memory file name from the URL parameter.
 * @returns True if the name is safe to use as a filename.
 */
function isValidMemoryFileName(name: string): boolean {
  if (name.length === 0) {
    return false;
  }

  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return false;
  }

  return true;
}
