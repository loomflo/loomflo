import { readFile, realpath } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

/** Zod schema for read_file tool input. */
const ReadFileInputSchema = z.object({
  /** File path relative to the workspace root. */
  path: z.string().describe('File path relative to the workspace root'),
});

/**
 * Tool that reads file content from the agent's workspace.
 *
 * Resolves the given path relative to the workspace root and validates
 * that the resolved path stays within workspace boundaries before reading.
 * Path traversal via `..` segments and symlink escapes are detected and
 * rejected. All errors are returned as descriptive strings — this tool
 * never throws.
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a file from the workspace. ' +
    'Provide a path relative to the workspace root. ' +
    'Returns the file content as a string, or an error message if the file ' +
    'cannot be read.',
  inputSchema: ReadFileInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { path: filePath } = ReadFileInputSchema.parse(input);

      const workspaceRoot = normalize(resolve(context.workspacePath));
      const resolved = normalize(resolve(workspaceRoot, filePath));

      if (!resolved.startsWith(workspaceRoot + '/') && resolved !== workspaceRoot) {
        return `Error: path "${filePath}" resolves outside the workspace`;
      }

      // Resolve symlinks to their real path and re-check containment.
      let real: string;
      try {
        real = await realpath(resolved);
      } catch {
        return `Error: file not found — ${filePath}`;
      }

      const realWorkspace = await realpath(workspaceRoot);
      if (!real.startsWith(realWorkspace + '/') && real !== realWorkspace) {
        return `Error: path "${filePath}" resolves outside the workspace via symlink`;
      }

      const content = await readFile(real, 'utf-8');
      return content;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
