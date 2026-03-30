import { Command } from "commander";

import { DaemonClient } from "../client.js";
import type { ApiError } from "../client.js";

// ============================================================================
// Types
// ============================================================================

/** Shape of the GET /config JSON response from the daemon. */
interface ConfigResponse {
  /** The full merged configuration object. */
  config: Record<string, unknown>;
}

/** Shape of the PUT /config JSON response from the daemon. */
interface ConfigUpdateResponse {
  /** The full merged configuration after applying the update. */
  config: Record<string, unknown>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve a dot-notation key path against a nested object.
 *
 * Traverses the object following each segment of the dot-delimited key.
 * Returns `undefined` if any intermediate segment is missing or not an object.
 *
 * @param obj - The object to traverse.
 * @param keyPath - Dot-notation key path (e.g. "models.loom").
 * @returns The resolved value, or undefined if the path does not exist.
 */
function resolveKeyPath(obj: Record<string, unknown>, keyPath: string): unknown {
  const segments = keyPath.split(".");
  let current: unknown = obj;

  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Build a nested object from a dot-notation key path and a value.
 *
 * For example, `buildNestedObject("models.loom", "claude-sonnet-4-6")`
 * returns `{ models: { loom: "claude-sonnet-4-6" } }`.
 *
 * @param keyPath - Dot-notation key path.
 * @param value - The value to set at the leaf.
 * @returns A nested object with the value at the specified path.
 */
function buildNestedObject(keyPath: string, value: unknown): Record<string, unknown> {
  const segments = keyPath.split(".");
  const root: Record<string, unknown> = {};
  let current = root;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }

  const leaf = segments[segments.length - 1] as string;
  current[leaf] = value;
  return root;
}

/**
 * Parse a string value into its appropriate JS type.
 *
 * Recognizes boolean literals ("true"/"false"), null ("null"), numeric values,
 * and falls back to the raw string for everything else.
 *
 * @param raw - The raw string value from the CLI argument.
 * @returns The parsed value as a boolean, number, null, or string.
 */
function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;

  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") {
    return num;
  }

  return raw;
}

/**
 * Format a config value for display.
 *
 * Objects are pretty-printed as JSON; primitives are displayed as strings.
 *
 * @param value - The value to format.
 * @returns A human-readable string representation.
 */
function formatValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `config` command for the loomflo CLI.
 *
 * Provides three modes of operation:
 * - `loomflo config` — display the full configuration as pretty-printed JSON.
 * - `loomflo config get <key>` — display the value of a specific config key
 *   (supports dot notation for nested keys, e.g. "models.loom").
 * - `loomflo config set <key> <value>` — update a config key via PUT /config
 *   (auto-parses booleans, numbers, and null from string arguments).
 *
 * @returns A configured commander Command instance.
 */
export function createConfigCommand(): Command {
  const cmd = new Command("config")
    .description("Get or set configuration")
    .action(async (): Promise<void> => {
      let client: DaemonClient;
      try {
        client = await DaemonClient.connect();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }

      try {
        const res = await client.get<ConfigResponse>("/config");

        if (!res.ok) {
          const errData = res.data as unknown as ApiError;
          console.error(`Error: ${errData.error}`);
          process.exit(1);
        }

        console.log(JSON.stringify(res.data.config, null, 2));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to connect to daemon: ${msg}`);
        process.exit(1);
      }
    });

  cmd
    .command("get")
    .description("Get a configuration value by key (supports dot notation)")
    .argument("<key>", 'Configuration key (e.g. "models.loom")')
    .action(async (key: string): Promise<void> => {
      let client: DaemonClient;
      try {
        client = await DaemonClient.connect();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }

      try {
        const res = await client.get<ConfigResponse>("/config");

        if (!res.ok) {
          const errData = res.data as unknown as ApiError;
          console.error(`Error: ${errData.error}`);
          process.exit(1);
        }

        const value = resolveKeyPath(res.data.config, key);

        if (value === undefined) {
          console.error(`Error: unknown config key "${key}"`);
          process.exit(1);
        }

        console.log(formatValue(value));
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to connect to daemon: ${msg}`);
        process.exit(1);
      }
    });

  cmd
    .command("set")
    .description("Set a configuration value (auto-parses booleans and numbers)")
    .argument("<key>", 'Configuration key (e.g. "models.loom")')
    .argument("<value>", "Value to set")
    .action(async (key: string, rawValue: string): Promise<void> => {
      let client: DaemonClient;
      try {
        client = await DaemonClient.connect();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }

      try {
        const parsed = parseValue(rawValue);
        const body = buildNestedObject(key, parsed);
        const res = await client.put<ConfigUpdateResponse>("/config", body);

        if (!res.ok) {
          const errData = res.data as unknown as ApiError;
          console.error(`Error: ${errData.error}`);
          if (errData.details) {
            console.error(`Details: ${JSON.stringify(errData.details, null, 2)}`);
          }
          process.exit(1);
        }

        const updated = resolveKeyPath(res.data.config, key);
        console.log(`${key} = ${formatValue(updated)}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Failed to connect to daemon: ${msg}`);
        process.exit(1);
      }
    });

  return cmd;
}
