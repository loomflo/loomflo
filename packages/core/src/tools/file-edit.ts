import { readFile, realpath, writeFile } from "node:fs/promises";
import { normalize, resolve } from "node:path";
import picomatch from "picomatch";
import { z } from "zod";
import type { Tool, ToolContext } from "./base.js";

/** Zod schema for edit_file tool input. */
const EditFileInputSchema = z.object({
  /** File path relative to the workspace root. */
  path: z.string().describe("File path relative to the workspace root"),
  /** The exact text to find in the file. */
  oldText: z.string().describe("The exact text to find in the file"),
  /** The replacement text. */
  newText: z.string().describe("The replacement text"),
});

/**
 * Tool that edits a file by replacing a string within the agent's workspace.
 *
 * Resolves the given path relative to the workspace root and validates
 * that the resolved path stays within workspace boundaries. Additionally
 * enforces write scope: the path must match at least one glob pattern in
 * the agent's assigned writeScope (checked via picomatch). Reads the file,
 * finds the first occurrence of oldText, and replaces it with newText.
 * All errors are returned as descriptive strings — this tool never throws.
 */
export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Edit a file by replacing a string occurrence within the workspace. " +
    "Provide a path relative to the workspace root, the exact text to find (oldText), " +
    "and the replacement text (newText). Only the first occurrence is replaced. " +
    "The path must fall within the agent's assigned write scope. " +
    "Returns a success message, or an error message on failure.",
  inputSchema: EditFileInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { path: filePath, oldText, newText } = EditFileInputSchema.parse(input);

      const workspaceRoot = normalize(resolve(context.workspacePath));
      const resolved = normalize(resolve(workspaceRoot, filePath));

      // Validate the resolved path stays within the workspace.
      if (!resolved.startsWith(workspaceRoot + "/") && resolved !== workspaceRoot) {
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
      if (!real.startsWith(realWorkspace + "/") && real !== realWorkspace) {
        return `Error: path "${filePath}" resolves outside the workspace via symlink`;
      }

      // Enforce write scope: path must match at least one allowed glob pattern.
      const relativePath = resolved.slice(workspaceRoot.length + 1);
      const isAllowed = picomatch(context.writeScope);
      if (!isAllowed(relativePath)) {
        return "Error: Write denied — path outside your assigned scope";
      }

      // Read the current file content.
      const content = await readFile(real, "utf-8");

      // Verify oldText exists in the file.
      const firstIndex = content.indexOf(oldText);
      if (firstIndex === -1) {
        return "Error: oldText not found in file";
      }

      // Count occurrences to inform the caller.
      let occurrences = 0;
      let searchFrom = 0;
      for (;;) {
        const idx = content.indexOf(oldText, searchFrom);
        if (idx === -1) break;
        occurrences++;
        searchFrom = idx + oldText.length;
      }

      // Replace only the first occurrence.
      const modified =
        content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);

      await writeFile(real, modified, "utf-8");

      if (occurrences > 1) {
        return `Successfully edited ${filePath} (replaced first of ${String(occurrences)} occurrences)`;
      }
      return `Successfully edited ${filePath}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};
