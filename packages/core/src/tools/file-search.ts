import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, normalize, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import { z } from 'zod';
import type { Tool, ToolContext } from './base.js';

/** Directories to always skip during recursive traversal. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Byte-range heuristic for detecting binary files.
 * If the first chunk contains a null byte, the file is treated as binary.
 */
const BINARY_CHECK_BYTES = 8192;

/** Zod schema for search_files tool input. */
const SearchFilesInputSchema = z.object({
  /** Regex pattern to search for in file contents. */
  pattern: z.string().describe('Regex pattern to search for in file contents'),
  /** Glob pattern to filter which files to search. Defaults to all files. */
  glob: z
    .string()
    .optional()
    .describe('Glob pattern to filter which files to search (default: **/*)'),
  /** Maximum number of matches to return. Defaults to 50. */
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of matching lines to return (default: 50)'),
});

/**
 * Validate that a string is a valid regular expression.
 *
 * @param pattern - The regex pattern string to validate.
 * @returns The compiled RegExp on success, or an error string on failure.
 */
function compileRegex(pattern: string): RegExp | string {
  try {
    return new RegExp(pattern, 'g');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: invalid regex pattern — ${message}`;
  }
}

/**
 * Determine whether a buffer likely represents binary content.
 *
 * @param buffer - The file content buffer to inspect.
 * @returns True if the buffer appears to contain binary data.
 */
function isBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, BINARY_CHECK_BYTES);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

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
 * Tool that searches file contents within the agent's workspace using regex.
 *
 * Walks the workspace directory recursively, filtering files by an optional
 * glob pattern, and searches each text file for lines matching the given
 * regex. Binary files and excluded directories (node_modules, .git, dist)
 * are automatically skipped. Results are returned as `file:line:content`
 * entries, capped at maxResults. All errors are returned as descriptive
 * strings — this tool never throws.
 */
export const searchFilesTool: Tool = {
  name: 'search_files',
  description:
    'Search file contents within the workspace using a regex pattern. ' +
    'Optionally filter files with a glob pattern. ' +
    'Returns matching lines in "file:lineNumber:content" format, ' +
    'or an error message on failure.',
  inputSchema: SearchFilesInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const {
        pattern,
        glob: globPattern = '**/*',
        maxResults = 50,
      } = SearchFilesInputSchema.parse(input);

      const regex = compileRegex(pattern);
      if (typeof regex === 'string') {
        return regex;
      }

      const workspaceRoot = normalize(resolve(context.workspacePath));
      const realWorkspace = await realpath(workspaceRoot);
      const isGlobMatch = picomatch(globPattern);

      const allFiles = await walkDirectory(realWorkspace);
      const results: string[] = [];

      for (const absolutePath of allFiles) {
        if (results.length >= maxResults) {
          break;
        }

        // Compute relative path for glob matching and output.
        const rel = relative(realWorkspace, absolutePath);
        if (!isGlobMatch(rel)) {
          continue;
        }

        // Validate the file is still inside workspace (guards against symlinks).
        const realFile = await realpath(absolutePath);
        if (!realFile.startsWith(realWorkspace + '/') && realFile !== realWorkspace) {
          continue;
        }

        let buffer: Buffer;
        try {
          buffer = await readFile(realFile);
        } catch {
          continue;
        }

        if (isBinary(buffer)) {
          continue;
        }

        const content = buffer.toString('utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          // Reset regex state for each line (global flag carries lastIndex).
          regex.lastIndex = 0;
          const currentLine = lines[i] ?? '';
          if (regex.test(currentLine)) {
            results.push(`${rel}:${String(i + 1)}:${currentLine}`);
            if (results.length >= maxResults) {
              break;
            }
          }
        }
      }

      if (results.length === 0) {
        return 'No matches found';
      }

      return results.join('\n');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
