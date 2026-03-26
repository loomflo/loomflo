import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

/** Directory within the workspace where shared memory files are stored. */
const SHARED_MEMORY_DIR = '.loomflo/shared-memory';

/** Zod schema for write_memory tool input. */
const WriteMemoryInputSchema = z.object({
  /** Name of the shared memory file to write to (e.g. "DECISIONS.md"). */
  name: z.string().describe('Name of the shared memory file (e.g. "DECISIONS.md")'),
  /** Text content to append to the memory file. */
  content: z.string().describe('Text content to append to the shared memory file'),
});

/**
 * Build a timestamped header line for a memory append entry.
 *
 * @param agentId - The ID of the agent performing the write.
 * @returns A formatted header string with ISO timestamp and agent ID.
 */
function buildEntryHeader(agentId: string): string {
  const timestamp = new Date().toISOString();
  return `\n---\n_[${timestamp}] written by ${agentId}_\n\n`;
}

/**
 * Tool that appends content to a shared memory file in the workspace.
 *
 * Shared memory files live in `.loomflo/shared-memory/` relative to the
 * workspace root. The tool validates the file name to prevent path traversal
 * (no slashes or `..` segments), creates the directory and file if they do
 * not exist, and appends the content with a timestamped header for
 * traceability. All errors are returned as descriptive strings — this tool
 * never throws.
 *
 * Note: daemon-level serialization (async mutex) is handled by the
 * shared-memory manager (T042). This tool performs only the file I/O.
 */
export const memoryWriteTool: Tool = {
  name: 'write_memory',
  description:
    'Append content to a shared memory file in the workspace. ' +
    'Provide the file name (e.g. "DECISIONS.md", "PROGRESS.md") and the ' +
    'text content to append. The content is appended with a timestamp and ' +
    'agent ID header for traceability. Returns a success confirmation or ' +
    'an error message.',
  inputSchema: WriteMemoryInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { name, content } = WriteMemoryInputSchema.parse(input);

      // Reject path traversal: name must not contain slashes or ".." segments.
      if (name.includes('/') || name.includes('\\') || name.includes('..')) {
        return `Error: invalid memory file name "${name}" — must not contain path separators or ".."`;
      }

      const dirPath = join(context.workspacePath, SHARED_MEMORY_DIR);
      const filePath = join(dirPath, name);

      // Ensure the shared-memory directory exists.
      try {
        await mkdir(dirPath, { recursive: true });
      } catch {
        return `Error: failed to create shared memory directory at ${dirPath}`;
      }

      // Build entry with timestamp header and append to file.
      const entry = buildEntryHeader(context.agentId) + content + '\n';

      try {
        await appendFile(filePath, entry, 'utf-8');
      } catch {
        return `Error: failed to write to shared memory file — ${name}`;
      }

      return `Successfully appended to ${name}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
