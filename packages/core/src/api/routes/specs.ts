import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { Workflow } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

/** Metadata for a single spec artifact file. */
export interface SpecArtifact {
  /** File name (e.g., "spec.md"). */
  name: string;
  /** Path relative to the project root (e.g., ".loomflo/specs/spec.md"). */
  path: string;
  /** File size in bytes. */
  size: number;
}

/** Shape of the GET /specs JSON response. */
export interface ListSpecsResponse {
  /** Available spec artifact files. */
  artifacts: SpecArtifact[];
}

/** Options accepted by the {@link specsRoutes} factory. */
export interface SpecsRoutesOptions {
  /** Return the current active workflow, or null if none exists. */
  getWorkflow: () => Workflow | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Directory within the project workspace that holds spec artifacts. */
const SPECS_DIR = '.loomflo/specs';

// ============================================================================
// Plugin Factory
// ============================================================================

/**
 * Create a Fastify route plugin that registers spec artifact routes.
 *
 * - GET /specs — list available spec artifacts.
 * - GET /specs/:name — read a specific spec artifact as raw markdown.
 *
 * @param options - Callbacks that supply runtime data for the response.
 * @returns A Fastify plugin suitable for `server.register()`.
 */
export function specsRoutes(options: SpecsRoutesOptions): FastifyPluginAsync {
  const { getWorkflow } = options;

  const plugin: FastifyPluginAsync = async (fastify): Promise<void> => {
    /**
     * GET /specs
     *
     * Lists all spec artifact files in the project's `.loomflo/specs/` directory.
     * Returns 404 if no workflow is active.
     */
    fastify.get('/specs', async (_request, reply): Promise<void> => {
      const workflow = getWorkflow();

      if (workflow === null) {
        await reply.code(404).send({ error: 'No active workflow' });
        return;
      }

      const specsPath = join(workflow.projectPath, SPECS_DIR);
      const artifacts = await listSpecArtifacts(specsPath);

      await reply.code(200).send({ artifacts } satisfies ListSpecsResponse);
    });

    /**
     * GET /specs/:name
     *
     * Reads a specific spec artifact and returns its raw markdown content.
     * Validates the `:name` parameter to prevent path traversal.
     * Returns 404 if no workflow is active or the file does not exist.
     */
    fastify.get<{ Params: { name: string } }>(
      '/specs/:name',
      async (request, reply): Promise<void> => {
        const workflow = getWorkflow();

        if (workflow === null) {
          await reply.code(404).send({ error: 'No active workflow' });
          return;
        }

        const { name } = request.params;

        if (!isValidArtifactName(name)) {
          await reply.code(400).send({ error: 'Invalid artifact name' });
          return;
        }

        const filePath = join(workflow.projectPath, SPECS_DIR, name);

        let content: string;
        try {
          content = await readFile(filePath, 'utf-8');
        } catch (error: unknown) {
          const code = (error as { code?: string }).code;
          if (code === 'ENOENT') {
            await reply.code(404).send({ error: 'Artifact not found' });
            return;
          }
          throw error;
        }

        await reply.type('text/markdown').code(200).send(content);
      },
    );
  };

  return plugin;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate that an artifact name is safe (no path traversal).
 *
 * Rejects names containing `..`, `/`, `\`, or null bytes.
 *
 * @param name - The artifact name from the URL parameter.
 * @returns True if the name is safe to use as a filename.
 */
function isValidArtifactName(name: string): boolean {
  if (name.length === 0) {
    return false;
  }

  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return false;
  }

  return true;
}

/**
 * List spec artifacts in the given directory.
 *
 * Returns an empty array if the directory does not exist or is empty.
 *
 * @param specsPath - Absolute path to the `.loomflo/specs/` directory.
 * @returns Array of spec artifact metadata sorted by name.
 */
async function listSpecArtifacts(specsPath: string): Promise<SpecArtifact[]> {
  let entries: string[];
  try {
    entries = await readdir(specsPath);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const artifacts: SpecArtifact[] = [];

  for (const entry of entries) {
    const filePath = join(specsPath, entry);
    const fileStat = await stat(filePath);

    if (fileStat.isFile()) {
      artifacts.push({
        name: entry,
        path: `${SPECS_DIR}/${entry}`,
        size: fileStat.size,
      });
    }
  }

  artifacts.sort((a, b) => a.name.localeCompare(b.name));

  return artifacts;
}
