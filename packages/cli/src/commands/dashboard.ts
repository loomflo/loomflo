import { exec } from "node:child_process";
import { platform } from "node:os";

import { Command } from "commander";

import { readDaemonConfig } from "../client.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Determine the platform-appropriate command to open a URL in the default
 * browser.
 *
 * @param url - The URL to open.
 * @returns The shell command string to execute.
 */
function openCommand(url: string): string {
  switch (platform()) {
    case "darwin":
      return `open "${url}"`;
    case "win32":
      return `start "${url}"`;
    default:
      // Linux and other POSIX systems.
      return `xdg-open "${url}"`;
  }
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `dashboard` command for the loomflo CLI.
 *
 * Usage: `loomflo dashboard`
 *
 * Opens the Loomflo web dashboard in the user's default browser. Reads the
 * daemon configuration to determine the port, then launches the browser
 * pointing at the daemon's HTTP server.
 *
 * @returns A configured commander Command instance.
 */
export function createDashboardCommand(): Command {
  const cmd = new Command("dashboard")
    .description("Open the web dashboard in the default browser")
    .option("-p, --port <port>", "Override the dashboard port (defaults to daemon port)")
    .option("--no-open", "Print the URL without opening the browser");
  withJsonSupport(cmd);
  cmd.action(async (options: { port?: string; open?: boolean; json?: boolean }): Promise<void> => {
    /* ------------------------------------------------------------------ */
    /* Read daemon config to get port                                     */
    /* ------------------------------------------------------------------ */

    let port: number;
    let token: string | undefined;

    if (options.port !== undefined) {
      port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        writeError(options, `Invalid port: ${options.port}`);
        process.exitCode = 1;
        return;
      }
    } else {
      try {
        const config = await readDaemonConfig();
        port = config.port;
        token = config.token;
      } catch {
        writeError(options, "Daemon is not running. Start with: loomflo start");
        process.exitCode = 1;
        return;
      }
    }

    const url = token !== undefined
      ? `http://127.0.0.1:${String(port)}/#token=${encodeURIComponent(token)}`
      : `http://127.0.0.1:${String(port)}`;

    /* ------------------------------------------------------------------ */
    /* Open browser or print URL                                          */
    /* ------------------------------------------------------------------ */

    if (isJsonMode(options)) {
      writeJson({ url });
      return;
    }

    // Always print the URL so the user can copy it regardless of whether
    // the browser opens successfully. This is especially important for
    // remote/headless environments and when --no-open is passed.
    process.stdout.write(
      theme.line(theme.glyph.check, "accent", "dashboard available", url) + "\n",
    );

    if (options.open === false) {
      return;
    }

    process.stdout.write(
      theme.line(theme.glyph.arrow, "muted", "opening browser") + "\n",
    );

    // exec is used intentionally here — the URL is constructed from a
    // validated port number, not user-supplied shell input.
    const command = openCommand(url);
    exec(command, (error: Error | null): void => {
      if (error !== null) {
        process.stderr.write(
          theme.line(theme.glyph.warn, "warn", `Failed to open browser automatically. Visit ${url} in your browser.`) + "\n",
        );
      }
    });
  });

  return cmd;
}
