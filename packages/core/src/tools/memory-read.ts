import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

/** Directory within the workspace where shared memory files are stored. */
const SHARED_MEMORY_DIR = '.loomflo/shared-memory';

/** Zod schema for read_memory tool input. */
const ReadMemoryInputSchema = z.object({
  /** Name of the shared memory file to read (e.g. "DECISIONS.md"). */
  name: z.string().describe('Name of the shared memory file (e.g. "DECISIONS.md")'),
});

/**
 * Tool that reads a shared memory file from the workspace.
 *
 * Shared memory files live in `.loomflo/shared-memory/` relative to the
 * workspace root. The tool validates the file name to prevent path traversal
 * (no slashes or `..` segments) and reads the file content as UTF-8.
 * All errors are returned as descriptive strings — this tool never throws.
 */
export const memoryReadTool: Tool = {
  name: 'read_memory',
  description:
    'Read a shared memory file from the workspace. ' +
    'Provide the file name (e.g. "DECISIONS.md", "PROGRESS.md"). ' +
    'Returns the file content as a string, or an error message if the file ' +
    'cannot be read.',
  inputSchema: ReadMemoryInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { name } = ReadMemoryInputSchema.parse(input);

      // Reject path traversal: name must not contain slashes or ".." segments.
      if (name.includes('/') || name.includes('\\') || name.includes('..')) {
        return `Error: invalid memory file name "${name}" — must not contain path separators or ".."`;
      }

      const filePath = join(context.workspacePath, SHARED_MEMORY_DIR, name);

      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        return `Error: shared memory file not found — ${name}`;
      }

      return content;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
