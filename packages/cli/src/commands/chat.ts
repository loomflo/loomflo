import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";
import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of the POST /chat JSON response from the daemon. */
interface ChatResponse {
  /** The assistant's response text. */
  response: string;
  /** Graph action taken, or null if none. */
  action: { type: string; details: Record<string, unknown> } | null;
  /** The classified message category. */
  category: string;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `chat` command for the loomflo CLI.
 *
 * Usage: `loomflo chat "message"`
 *
 * Resolves the current project from the working directory and sends a
 * chat message to the Loom architect agent via POST /chat. Displays the
 * response text, message category, and any graph action taken.
 *
 * @returns A configured commander Command instance.
 */
export function createChatCommand(): Command {
  const cmd = new Command("chat")
    .description("Chat with the Loom architect agent")
    .argument("<message>", "Message to send to Loom")
    .action(async (message: string, options: { json?: boolean }): Promise<void> => {
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);

        const { response, action, category } = await client.request<ChatResponse>("POST", "/chat", {
          message,
        });

        if (isJsonMode(options)) {
          writeJson({ response, category, action });
          return;
        }

        process.stdout.write(
          `${theme.line(theme.glyph.arrow, "muted", response, category)}\n`,
        );

        if (action !== null) {
          process.stdout.write(`${theme.kv("action", action.type)}\n`);
          for (const [key, value] of Object.entries(action.details)) {
            process.stdout.write(`${theme.kv(key, JSON.stringify(value))}\n`);
          }
        }
      } catch (err) {
        writeError(options, (err as Error).message, "E_CHAT");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
