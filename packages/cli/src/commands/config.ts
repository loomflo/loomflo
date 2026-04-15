import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { ConfigSchema } from "@loomflo/core";
import { ZodError } from "zod";

import { withJsonSupport, isJsonMode, writeJson, writeError } from "../output.js";
import { theme } from "../theme/index.js";

// ============================================================================
// Constants
// ============================================================================

/** Directory name for global Loomflo config/state. */
const LOOMFLO_HOME_DIR = ".loomflo";

/** Filename for the global configuration. */
const CONFIG_FILE = "config.json";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Return the path to the global Loomflo config file (~/.loomflo/config.json).
 *
 * @returns Absolute path to the configuration file.
 */
function globalConfigPath(): string {
  return join(homedir(), LOOMFLO_HOME_DIR, CONFIG_FILE);
}

/**
 * Return the path to the project-level config file (.loomflo/config.json).
 *
 * If CWD contains a `.loomflo/` directory, the project config path is
 * returned; otherwise only the global config path is used.
 *
 * @returns Absolute path to the project-level config file.
 */
function projectConfigPath(): string {
  return join(process.cwd(), ".loomflo", CONFIG_FILE);
}

/**
 * Read a JSON config file from disk.
 *
 * Returns an empty object if the file does not exist.
 *
 * @param filePath - Absolute path to the config file.
 * @returns Parsed JSON object, or an empty object if the file is absent.
 */
async function readConfigFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

/**
 * Write a JSON config object to disk.
 *
 * Creates the parent directory if it does not exist.
 *
 * @param filePath - Absolute path to the config file.
 * @param config - The configuration object to persist.
 */
async function writeConfigFile(filePath: string, config: Record<string, unknown>): Promise<void> {
  const dir = filePath.slice(0, filePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

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
 * Set a value at a dot-notation key path within a nested object.
 *
 * Mutates `obj` in place, creating intermediate objects as needed.
 *
 * @param obj - The object to mutate.
 * @param keyPath - Dot-notation key path (e.g. "models.loom").
 * @param value - The value to set at the leaf.
 */
function setKeyPath(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const segments = keyPath.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    if (typeof current[segment] !== "object" || current[segment] === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1] as string;
  current[leaf] = value;
}

/**
 * Deep merge two objects. Values from `overrides` win.
 *
 * @param base - The base object.
 * @param overrides - The overriding object.
 * @returns A new merged object.
 */
function deepMerge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
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
 * Reads from and writes to `~/.loomflo/config.json` (global) and
 * `.loomflo/config.json` (project-level) directly on disk. No daemon
 * connection is required — config works even when the daemon is stopped.
 *
 * The displayed config is the merged view (global merged with project).
 * `config set` writes to the project-level config when run inside a project
 * directory (where `.loomflo/` exists), otherwise falls back to global.
 *
 * Provides three modes of operation:
 * - `loomflo config` — display the merged configuration as pretty-printed JSON.
 * - `loomflo config get <key>` — display the value of a specific config key
 *   (supports dot notation for nested keys, e.g. "models.loom").
 * - `loomflo config set <key> <value>` — set a config key in the active config
 *   file (auto-parses booleans, numbers, and null from string arguments).
 *
 * @returns A configured commander Command instance.
 */
export function createConfigCommand(): Command {
  const cmd = new Command("config")
    .description("Get or set configuration (reads/writes local config files, no daemon required)")
    .enablePositionalOptions()
    .passThroughOptions();
  withJsonSupport(cmd);
  cmd.action(async (options: { json?: boolean }): Promise<void> => {
    try {
      const global = await readConfigFile(globalConfigPath());
      const project = await readConfigFile(projectConfigPath());
      const merged = deepMerge(global, project);
      const resolved = ConfigSchema.parse(merged);
      if (isJsonMode(options)) {
        writeJson(resolved);
      } else {
        process.stdout.write(theme.heading("Configuration") + "\n");
        for (const [key, value] of Object.entries(resolved as Record<string, unknown>)) {
          process.stdout.write(theme.kv(key, formatValue(value)) + "\n");
        }
      }
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        writeError(options, `corrupted config - ${error.message}`, "CORRUPTED_CONFIG");
        process.exitCode = 1;
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      writeError(options, `reading config: ${msg}`);
      process.exitCode = 1;
    }
  });

  const getCmd = cmd
    .command("get")
    .description("Get a configuration value by key (supports dot notation)")
    .argument("<key>", 'Configuration key (e.g. "models.loom")');
  withJsonSupport(getCmd);
  getCmd.action(async (key: string, options: { json?: boolean }): Promise<void> => {
    try {
      const global = await readConfigFile(globalConfigPath());
      const project = await readConfigFile(projectConfigPath());
      const merged = deepMerge(global, project);
      const resolved = ConfigSchema.parse(merged);

      const value = resolveKeyPath(resolved as unknown as Record<string, unknown>, key);

      if (value === undefined) {
        writeError(options, `unknown config key "${key}"`, "UNKNOWN_KEY");
        process.exitCode = 1;
        return;
      }

      if (isJsonMode(options)) {
        writeJson({ key, value });
      } else {
        process.stdout.write(theme.kv(key, formatValue(value)) + "\n");
      }
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        writeError(options, `corrupted config - ${error.message}`, "CORRUPTED_CONFIG");
        process.exitCode = 1;
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      writeError(options, `reading config: ${msg}`);
      process.exitCode = 1;
    }
  });

  const setCmd = cmd
    .command("set")
    .description(
      "Set a configuration value (writes to project config if in a project, else global config)",
    )
    .argument("<key>", 'Configuration key (e.g. "models.loom")')
    .argument("<value>", "Value to set (booleans, numbers, and null are auto-parsed)")
    .option("--global", "Force writing to global config (~/.loomflo/config.json)");
  withJsonSupport(setCmd);
  setCmd.action(async (key: string, rawValue: string, options: { global?: boolean; json?: boolean }): Promise<void> => {
    try {
      // Determine which config file to write to
      const useGlobal = options.global === true;
      const targetPath = useGlobal ? globalConfigPath() : projectConfigPath();

      // Read the existing config from the target file
      const existing = await readConfigFile(targetPath);

      // Validate that the key exists in the schema
      const defaults = ConfigSchema.parse({}) as unknown as Record<string, unknown>;
      if (resolveKeyPath(defaults, key) === undefined) {
        writeError(options, `unknown config key "${key}"`, "UNKNOWN_KEY");
        process.exitCode = 1;
        return;
      }

      // Apply the new value
      const parsed = parseValue(rawValue);
      setKeyPath(existing, key, parsed);

      // Write back
      await writeConfigFile(targetPath, existing);

      const scope = useGlobal ? "global" : "project";
      if (isJsonMode(options)) {
        writeJson({ key, value: parsed, scope });
      } else {
        process.stdout.write(
          theme.line(theme.glyph.check, "accent", `${key} updated`, scope) + "\n",
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeError(options, `writing config: ${msg}`);
      process.exitCode = 1;
    }
  });

  return cmd;
}
