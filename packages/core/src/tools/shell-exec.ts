import { exec } from "node:child_process";
import { realpath } from "node:fs/promises";
import { normalize, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "./base.js";

/** Default timeout for shell commands in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum output buffer size in bytes (1 MB). */
const MAX_BUFFER_BYTES = 1_024 * 1_024;

/** Zod schema for exec_command tool input. */
const ShellExecInputSchema = z.object({
  /** Shell command to execute within the workspace. */
  command: z.string().describe("Shell command to execute within the workspace"),
  /** Max execution time in milliseconds (default 30000). */
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max execution time in milliseconds (default 30000)"),
});

/**
 * Patterns that indicate path traversal or workspace escape attempts.
 *
 * Each entry is a tuple of [regex, human-readable reason] used to produce
 * clear rejection messages.
 */
const DANGEROUS_PATTERNS: readonly [RegExp, string][] = [
  [/\.\.[\\/]/, "path traversal (../)"],
  [/\/etc(\/|$)/, "access to /etc"],
  [/\/root(\/|$)/, "access to /root"],
  [/\/proc(\/|$)/, "access to /proc"],
  [/\/sys(\/|$)/, "access to /sys"],
  [/\/dev(\/|$)/, "access to /dev"],
  [/\/var(\/|$)/, "access to /var"],
  [/\/tmp(\/|$)/, "access to /tmp"],
  [/~\//, "home directory expansion (~/)"],
  [/\bcd\s+\//, "directory escape (cd /)"],
];

/**
 * Scan a command string for patterns that indicate an attempt to
 * escape the workspace sandbox.
 *
 * @param command - The raw shell command to inspect.
 * @returns A human-readable reason if a dangerous pattern is found, or null if safe.
 */
function detectDangerousPattern(command: string): string | null {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return null;
}

/**
 * Tool that executes a shell command sandboxed to the agent's workspace.
 *
 * The command runs with `cwd` set to the workspace root. Before execution,
 * the tool validates that the workspace path resolves safely (no symlink
 * escapes) and scans the command for path traversal patterns, references
 * to sensitive system directories, and explicit directory escape attempts.
 * stdout and stderr are captured and returned as a combined string. All
 * errors are returned as descriptive strings — this tool never throws.
 *
 * NOTE: This tool intentionally uses child_process.exec (not execFile)
 * because agents need shell features such as pipes, redirects, and
 * chained commands. Security is enforced via command-level pattern
 * scanning, workspace sandboxing, and timeout limits.
 */
export const shellExecTool: Tool = {
  name: "exec_command",
  description:
    "Execute a shell command within the workspace directory. " +
    "The command is sandboxed to the project workspace — path traversal " +
    "and access to system directories are rejected. " +
    "Returns the combined stdout and stderr output, or an error message on failure.",
  inputSchema: ShellExecInputSchema,

  async execute(input: unknown, context: ToolContext): Promise<string> {
    try {
      const { command, timeout } = ShellExecInputSchema.parse(input);
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      // Reject empty commands.
      if (command.trim().length === 0) {
        return "Error: command must not be empty";
      }

      // Scan command for dangerous patterns before execution.
      const danger = detectDangerousPattern(command);
      if (danger !== null) {
        return `Error: command rejected — ${danger}`;
      }

      // Resolve workspace path and verify it hasn't been symlinked outside.
      const workspaceRoot = normalize(resolve(context.workspacePath));
      let realWorkspace: string;
      try {
        realWorkspace = await realpath(workspaceRoot);
      } catch {
        return `Error: workspace path does not exist — ${context.workspacePath}`;
      }

      if (!realWorkspace.startsWith(workspaceRoot) && realWorkspace !== workspaceRoot) {
        return "Error: workspace path resolves outside expected location via symlink";
      }

      // Execute the command with workspace as cwd.
      // Uses exec() intentionally — agents require shell features (pipes, redirects).
      return await new Promise<string>((resolvePromise) => {
        exec(
          command,
          {
            cwd: realWorkspace,
            timeout: timeoutMs,
            maxBuffer: MAX_BUFFER_BYTES,
            env: { ...process.env, HOME: realWorkspace },
          },
          (error, stdout, stderr) => {
            const output = combineOutput(stdout, stderr);

            if (error !== null) {
              // Timeout produces a "killed" flag on the error.
              if (error.killed) {
                resolvePromise(
                  `Error: command timed out after ${String(timeoutMs)}ms` +
                    (output.length > 0 ? `\n${output}` : ""),
                );
                return;
              }
              // Non-zero exit code — include the output for context.
              resolvePromise(
                `Error: command exited with code ${String(error.code ?? 1)}` +
                  (output.length > 0 ? `\n${output}` : ""),
              );
              return;
            }

            resolvePromise(output.length > 0 ? output : "(no output)");
          },
        );
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
};

/**
 * Combine stdout and stderr into a single trimmed string.
 *
 * @param stdout - Standard output from the child process.
 * @param stderr - Standard error from the child process.
 * @returns Combined output with stdout first, then stderr (if non-empty).
 */
function combineOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  const out = stdout.trim();
  const err = stderr.trim();
  if (out.length > 0) parts.push(out);
  if (err.length > 0) parts.push(err);
  return parts.join("\n");
}
