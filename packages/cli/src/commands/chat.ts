import { Command } from "commander";

import { resolveProject } from "../project-resolver.js";
import { openClient } from "../client.js";

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
  return new Command("chat")
    .description("Chat with the Loom architect agent")
    .argument("<message>", "Message to send to Loom")
    .action(async (message: string): Promise<void> => {
      try {
        const { identity } = await resolveProject({ cwd: process.cwd(), createIfMissing: false });
        const client = await openClient(identity.id);

        const { response, action, category } = await client.request<ChatResponse>("POST", "/chat", {
          message,
        });

        console.log(`[${category}] ${response}`);

        if (action !== null) {
          console.log(`  Action: ${action.type}`);
          for (const [key, value] of Object.entries(action.details)) {
            console.log(`    ${key}: ${JSON.stringify(value)}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
