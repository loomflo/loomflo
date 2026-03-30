import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve } from 'node:path';
import picomatch from 'picomatch';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

/** Zod schema for write_file tool input. */
const WriteFileInputSchema = z.object({
  /** File path relative to the workspace root. */
  path: z.string().describe('File path relative to the workspace root'),
  /** Content to write to the file. */
  content: z.string().describe('Content to write to the file'),
});

/**
 * Tool that writes or creates a file within the agent's workspace.
 *
 * Resolves the given path relative to the workspace root and validates
 * that the resolved path stays within workspace boundaries. Additionally
 * enforces write scope: the path must match at least one glob pattern in
 * the agent's assigned writeScope (checked via picomatch). Parent
 * directories are created automatically if they do not exist. All errors
 * are returned as descriptive strings — this tool never throws.
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Create or overwrite a file within the workspace. ' +
    'Provide a path relative to the workspace root and the content to write. ' +
    'The path must fall within the agent\'s assigned write scope. ' +
    'Returns a success message with bytes written, or an error message on failure.',
  inputSchema: WriteFileInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { path: filePath, content } = WriteFileInputSchema.parse(input);

      const workspaceRoot = normalize(resolve(context.workspacePath));
      const resolved = normalize(resolve(workspaceRoot, filePath));

      // Validate the resolved path stays within the workspace.
      if (!resolved.startsWith(workspaceRoot + '/') && resolved !== workspaceRoot) {
        return `Error: path "${filePath}" resolves outside the workspace`;
      }

      // Resolve symlinks on the parent directory (the file itself may not exist yet).
      const parentDir = dirname(resolved);
      let realParent: string;
      try {
        realParent = await realpath(parentDir);
      } catch {
        // Parent does not exist yet — we'll create it below, but first
        // verify the workspace root itself is real for symlink containment.
        realParent = parentDir;
      }

      const realWorkspace = await realpath(workspaceRoot);
      if (!realParent.startsWith(realWorkspace + '/') && realParent !== realWorkspace) {
        return `Error: path "${filePath}" resolves outside the workspace via symlink`;
      }

      // Enforce write scope: path must match at least one allowed glob pattern.
      const relativePath = resolved.slice(workspaceRoot.length + 1);
      const isAllowed = picomatch(context.writeScope);
      if (!isAllowed(relativePath)) {
        return 'Error: Write denied — path outside your assigned scope';
      }

      // Create parent directories if needed.
      await mkdir(parentDir, { recursive: true });

      // Write the file content.
      const bytes = Buffer.byteLength(content, 'utf-8');
      await writeFile(resolved, content, 'utf-8');

      return `Successfully wrote ${String(bytes)} bytes to ${filePath}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
