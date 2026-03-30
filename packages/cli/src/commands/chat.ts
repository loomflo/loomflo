import { Command } from "commander";

import { DaemonClient } from "../client.js";
import type { ApiError } from "../client.js";

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
 * Sends a chat message to the Loom architect agent via POST /chat and
 * displays the response text, message category, and any graph action taken.
 *
 * @returns A configured commander Command instance.
 */
export function createChatCommand(): Command {
  const cmd = new Command("chat")
    .description("Chat with the Loom architect agent")
    .argument("<message>", "Message to send to Loom")
    .action(async (message: string): Promise<void> => {
      let client: DaemonClient;
      try {
        client = await DaemonClient.connect();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }

      try {
        const res = await client.post<ChatResponse>("/chat", { message });

        if (!res.ok) {
          const errData = res.data as unknown as ApiError;
          console.error(`Error: ${errData.error}`);
          process.exit(1);
        }

        const { response, action, category } = res.data;

        console.log(`[${category}] ${response}`);

        if (action !== null) {
          console.log(`  Action: ${action.type}`);
          for (const [key, value] of Object.entries(action.details)) {
            console.log(`    ${key}: ${JSON.stringify(value)}`);
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to connect to daemon: ${msg}`);
        process.exit(1);
      }
    });

  return cmd;
}
