import { readdir, realpath } from 'node:fs/promises';
import { join, normalize, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

/** Directories to always skip during recursive traversal. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/** Zod schema for list_files tool input. */
const ListFilesInputSchema = z.object({
  /** Glob pattern to filter which files to list. Defaults to all files. */
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter which files to list (default: **/*)'),
  /** Maximum number of file paths to return. Defaults to 200. */
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of file paths to return (default: 200)'),
});

/**
 * Recursively collect file paths under a directory, skipping excluded dirs.
 *
 * @param dir - Absolute path of the directory to traverse.
 * @returns An array of absolute file paths.
 */
async function walkDirectory(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const nested = await walkDirectory(join(dir, entry.name));
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(join(dir, entry.name));
    }
  }

  return files;
}

/**
 * Tool that lists files within the agent's workspace matching a glob pattern.
 *
 * Walks the workspace directory recursively, filtering files by an optional
 * glob pattern. Returns relative paths (one per line), capped at maxResults.
 * Excluded directories (node_modules, .git, dist) are automatically skipped.
 * All errors are returned as descriptive strings — this tool never throws.
 */
export const listFilesTool: Tool = {
  name: 'list_files',
  description:
    'List files in the workspace matching a glob pattern. ' +
    'Returns relative file paths, one per line. ' +
    'Skips node_modules, .git, and dist directories.',
  inputSchema: ListFilesInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { glob: globPattern = '**/*', maxResults = 200 } =
        ListFilesInputSchema.parse(input);

      const workspaceRoot = normalize(resolve(context.workspacePath));
      const realWorkspace = await realpath(workspaceRoot);
      const isGlobMatch = picomatch(globPattern);

      const allFiles = await walkDirectory(realWorkspace);
      const matched: string[] = [];
      let totalMatches = 0;

      for (const absolutePath of allFiles) {
        const rel = relative(realWorkspace, absolutePath);
        if (!isGlobMatch(rel)) {
          continue;
        }

        // Validate the file is still inside workspace (guards against symlinks).
        const realFile = await realpath(absolutePath);
        if (!realFile.startsWith(realWorkspace + '/') && realFile !== realWorkspace) {
          continue;
        }

        totalMatches++;
        if (matched.length < maxResults) {
          matched.push(rel);
        }
      }

      if (totalMatches === 0) {
        return 'No files found matching the pattern';
      }

      let result = matched.join('\n');
      if (totalMatches > maxResults) {
        result += `\n\n(Showing ${String(maxResults)} of ${String(totalMatches)} matching files)`;
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
