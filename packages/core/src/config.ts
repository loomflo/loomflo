import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

// ============================================================================
// Sub-schemas
// ============================================================================

/** Zod schema for the level preset selector. */
export const LevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('custom')]);

/** Level preset: 1 (Minimal), 2 (Standard), 3 (Full), or 'custom'. */
export type Level = z.infer<typeof LevelSchema>;

/** Zod schema for the retry strategy selector. */
export const RetryStrategySchema = z.union([z.literal('adaptive'), z.literal('same')]);

/** Retry strategy: 'adaptive' modifies the prompt on retry, 'same' retries with the original prompt. */
export type RetryStrategy = z.infer<typeof RetryStrategySchema>;

/** Zod schema for per-role model configuration. */
export const ModelsConfigSchema = z.object({
  /** LLM model for the Loom (Architect) agent. */
  loom: z.string().default('claude-opus-4-6'),
  /** LLM model for the Loomi (Orchestrator) agent. */
  loomi: z.string().default('claude-sonnet-4-6'),
  /** LLM model for the Looma (Worker) agent. */
  looma: z.string().default('claude-sonnet-4-6'),
  /** LLM model for the Loomex (Reviewer) agent. */
  loomex: z.string().default('claude-sonnet-4-6'),
});

/** Per-role model configuration mapping agent roles to LLM model identifiers. */
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

// ============================================================================
// Config Schema
// ============================================================================

/**
 * Zod schema for the full Loomflo configuration.
 *
 * Every field has a `.default()` so the schema can validate partial configs.
 * The three-level config loading logic (global, project, CLI) is implemented
 * separately in T015.
 */
export const ConfigSchema = z.object({
  /** Preset level controlling default agent topology and behavior. */
  level: LevelSchema.default(3),
  /** Default delay between node activations (e.g., "0", "30m", "1h", "1d"). */
  defaultDelay: z.string().default('0'),
  /** Whether the Loomex reviewer agent is enabled. */
  reviewerEnabled: z.boolean().default(true),
  /** Maximum retry cycles allowed per node before marking as failed. */
  maxRetriesPerNode: z.number().int().nonnegative().default(3),
  /** Maximum retries allowed per individual task within a node. */
  maxRetriesPerTask: z.number().int().nonnegative().default(2),
  /** Maximum worker agents (Loomas) per orchestrator (Loomi). Null means unlimited. */
  maxLoomasPerLoomi: z.number().int().positive().nullable().default(null),
  /** Strategy for modifying prompts on retry: 'adaptive' adjusts the prompt, 'same' retries as-is. */
  retryStrategy: RetryStrategySchema.default('adaptive'),
  /** Per-role LLM model assignments. */
  models: ModelsConfigSchema.default({}),
  /** LLM provider identifier (e.g., "anthropic", "openai"). */
  provider: z.string().default('anthropic'),
  /** Maximum total cost in USD before pausing the workflow. Null means no limit. */
  budgetLimit: z.number().nonnegative().nullable().default(null),
  /** Whether to pause the workflow when the budget limit is reached. */
  pauseOnBudgetReached: z.boolean().default(true),
  /** Whether shell commands executed by agents are sandboxed to the project workspace. */
  sandboxCommands: z.boolean().default(true),
  /** Whether agents are allowed to make outbound HTTP requests. */
  allowNetwork: z.boolean().default(false),
  /** TCP port for the monitoring dashboard. */
  dashboardPort: z.number().int().min(1).max(65535).default(3000),
  /** Whether to automatically open the dashboard in a browser on daemon start. */
  dashboardAutoOpen: z.boolean().default(true),
  /** Wall-clock timeout per agent call in milliseconds (default: 10 minutes). */
  agentTimeout: z.number().int().positive().default(600_000),
  /** Maximum tokens per agent LLM call. */
  agentTokenLimit: z.number().int().positive().default(100_000),
  /** Maximum LLM API calls per minute per agent (rate limiting). */
  apiRateLimit: z.number().int().positive().default(60),
});

/** Full Loomflo configuration with all fields resolved. */
export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Partial Config Schema
// ============================================================================

/**
 * Zod schema for validating user-provided partial configuration files.
 *
 * All fields are optional. Used when parsing `~/.loomflo/config.json`,
 * `.loomflo/config.json`, or CLI flag overrides before merging.
 */
export const PartialConfigSchema = ConfigSchema.partial();

/** A partial configuration where all fields are optional, for user-provided config files. */
export type PartialConfig = z.infer<typeof PartialConfigSchema>;

// ============================================================================
// Default Config
// ============================================================================

/**
 * The default configuration with all defaults applied.
 *
 * Produced by parsing an empty object through the ConfigSchema,
 * which fills in every `.default()` value.
 */
export const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

// ============================================================================
// Level Presets
// ============================================================================

/**
 * Configuration presets for each numeric level.
 * These set default values for reviewer, retries, worker limits, and models.
 * Explicit user config values override these presets.
 */
const LEVEL_PRESETS: Record<1 | 2 | 3, PartialConfig> = {
  1: {
    reviewerEnabled: false,
    maxRetriesPerNode: 0,
    maxLoomasPerLoomi: 1,
    models: {
      loom: 'claude-sonnet-4-6',
      loomi: 'claude-sonnet-4-6',
      looma: 'claude-sonnet-4-6',
      loomex: 'claude-sonnet-4-6',
    },
  },
  2: {
    reviewerEnabled: true,
    maxRetriesPerNode: 1,
    maxLoomasPerLoomi: 2,
    models: {
      loom: 'claude-opus-4-6',
      loomi: 'claude-sonnet-4-6',
      looma: 'claude-opus-4-6',
      loomex: 'claude-sonnet-4-6',
    },
  },
  3: {
    reviewerEnabled: true,
    maxRetriesPerNode: 2,
    maxLoomasPerLoomi: null,
    models: {
      loom: 'claude-opus-4-6',
      loomi: 'claude-opus-4-6',
      looma: 'claude-opus-4-6',
      loomex: 'claude-opus-4-6',
    },
  },
};

// ============================================================================
// Deep Merge Utility
// ============================================================================

/**
 * Check whether a value is a plain object (not an array, null, Date, etc.).
 *
 * @param value - The value to check.
 * @returns True if the value is a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge two objects. Nested plain objects are recursively merged;
 * arrays are replaced (not concatenated); `null` values override;
 * `undefined` values are skipped.
 *
 * @param target - The base object to merge into.
 * @param source - The object whose values take precedence.
 * @returns A new object with deeply merged values.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = (source as Record<string, unknown>)[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (sourceValue === null) {
      (result as Record<string, unknown>)[key] = null;
      continue;
    }

    const targetValue = (result as Record<string, unknown>)[key];

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      (result as Record<string, unknown>)[key] = deepMerge(targetValue, sourceValue);
      continue;
    }

    (result as Record<string, unknown>)[key] = sourceValue;
  }

  return result;
}

// ============================================================================
// Config File Loading
// ============================================================================

/**
 * Load and validate a partial configuration from a JSON file.
 *
 * @param filePath - Absolute path to a JSON config file.
 * @returns The validated partial configuration, or an empty object if the file does not exist.
 * @throws If the file contains invalid JSON or fails schema validation.
 */
export async function loadConfigFile(filePath: string): Promise<PartialConfig> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'ENOENT') {
      return {};
    }
    throw new Error(
      `Failed to read config file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in config file at ${filePath}`);
  }

  const result = PartialConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config in ${filePath}: ${result.error.message}`);
  }

  // Return raw parsed JSON to preserve only explicitly set values.
  // PartialConfigSchema validation above ensures type correctness, but
  // returning result.data would inject zod defaults for nested objects
  // (e.g., models), which would incorrectly override level presets.
  return parsed as PartialConfig;
}

// ============================================================================
// Config Resolution
// ============================================================================

/**
 * Get the level preset configuration for a given level.
 * Returns an empty object for 'custom' level (no preset overrides).
 *
 * @param level - The level to get the preset for.
 * @returns The partial config preset for the level.
 */
function getLevelPreset(level: Level): PartialConfig {
  if (level === 'custom') {
    return {};
  }
  return LEVEL_PRESETS[level];
}

/**
 * Load and resolve the full Loomflo configuration by merging sources in order:
 * DEFAULT_CONFIG → level preset → global config → project config → CLI overrides.
 *
 * Level presets provide default values for `reviewerEnabled`, `maxRetriesPerNode`,
 * `maxLoomasPerLoomi`, and `models`, but explicit values in config files or
 * overrides take precedence.
 *
 * @param options - Loading options.
 * @param options.projectPath - Path to the project root (for project-level config).
 * @param options.overrides - CLI or programmatic overrides applied last.
 * @returns The fully resolved and validated configuration.
 * @throws If any config file contains invalid JSON or fails validation.
 */
export async function loadConfig(
  options: { projectPath?: string; overrides?: PartialConfig } = {},
): Promise<Config> {
  const { projectPath, overrides = {} } = options;

  // Load global config (~/.loomflo/config.json)
  const globalPath = join(homedir(), '.loomflo', 'config.json');
  const globalConfig = await loadConfigFile(globalPath);

  // Load project config ({projectPath}/.loomflo/config.json)
  let projectConfig: PartialConfig = {};
  if (projectPath) {
    projectConfig = await loadConfigFile(join(projectPath, '.loomflo', 'config.json'));
  }

  // Determine the effective level from the highest-priority source
  const resolvedLevel: Level =
    overrides.level ?? projectConfig.level ?? globalConfig.level ?? DEFAULT_CONFIG.level;

  // Get level preset (empty for 'custom')
  const levelPreset = getLevelPreset(resolvedLevel);

  // Deep merge: DEFAULT_CONFIG → level preset → global → project → overrides
  // Level preset overrides defaults; user configs override level preset.
  let merged: Config = deepMerge(DEFAULT_CONFIG, levelPreset as Partial<Config>);
  merged = deepMerge(merged, globalConfig as Partial<Config>);
  merged = deepMerge(merged, projectConfig as Partial<Config>);
  merged = deepMerge(merged, overrides as Partial<Config>);

  return ConfigSchema.parse(merged);
}
