import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// ============================================================================
// Sub-schemas
// ============================================================================

/** Zod schema for the level preset selector. */
export const LevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal("custom")]);

/** Level preset: 1 (Minimal), 2 (Standard), 3 (Full), or 'custom'. */
export type Level = z.infer<typeof LevelSchema>;

/** Zod schema for the retry strategy selector. */
export const RetryStrategySchema = z.union([z.literal("adaptive"), z.literal("same")]);

/** Retry strategy: 'adaptive' modifies the prompt on retry, 'same' retries with the original prompt. */
export type RetryStrategy = z.infer<typeof RetryStrategySchema>;

/** Zod schema for per-role model configuration. */
export const ModelsConfigSchema = z.object({
  /** LLM model for the Loom (Architect) agent. */
  loom: z.string().default("claude-opus-4-6"),
  /** LLM model for the Loomi (Orchestrator) agent. */
  loomi: z.string().default("claude-sonnet-4-6"),
  /** LLM model for the Looma (Worker) agent. */
  looma: z.string().default("claude-sonnet-4-6"),
  /** LLM model for the Loomex (Reviewer) agent. */
  loomex: z.string().default("claude-sonnet-4-6"),
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
  defaultDelay: z.string().default("0"),
  /** Whether the Loomex reviewer agent is enabled. */
  reviewerEnabled: z.boolean().default(true),
  /** Maximum retry cycles allowed per node before marking as failed. */
  maxRetriesPerNode: z.number().int().nonnegative().default(3),
  /** Maximum retries allowed per individual task within a node. */
  maxRetriesPerTask: z.number().int().nonnegative().default(2),
  /** Maximum worker agents (Loomas) per orchestrator (Loomi). Null means unlimited. */
  maxLoomasPerLoomi: z.number().int().positive().nullable().default(null),
  /** Strategy for modifying prompts on retry: 'adaptive' adjusts the prompt, 'same' retries as-is. */
  retryStrategy: RetryStrategySchema.default("adaptive"),
  /** Per-role LLM model assignments. */
  models: ModelsConfigSchema.default({}),
  /** LLM provider identifier (e.g., "anthropic", "openai"). */
  provider: z.string().default("anthropic"),
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
  agentTokenLimit: z.number().int().positive().nullable().default(null),
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
      loom: "claude-sonnet-4-6",
      loomi: "claude-sonnet-4-6",
      looma: "claude-sonnet-4-6",
      loomex: "claude-sonnet-4-6",
    },
  },
  2: {
    reviewerEnabled: true,
    maxRetriesPerNode: 1,
    maxLoomasPerLoomi: 2,
    models: {
      loom: "claude-opus-4-6",
      loomi: "claude-sonnet-4-6",
      looma: "claude-opus-4-6",
      loomex: "claude-sonnet-4-6",
    },
  },
  3: {
    reviewerEnabled: true,
    maxRetriesPerNode: 2,
    maxLoomasPerLoomi: null,
    models: {
      loom: "claude-opus-4-6",
      loomi: "claude-opus-4-6",
      looma: "claude-opus-4-6",
      loomex: "claude-opus-4-6",
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
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
    content = await readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") {
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
  if (level === "custom") {
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
  const globalPath = join(homedir(), ".loomflo", "config.json");
  const globalConfig = await loadConfigFile(globalPath);

  // Load project config ({projectPath}/.loomflo/config.json)
  let projectConfig: PartialConfig = {};
  if (projectPath) {
    projectConfig = await loadConfigFile(join(projectPath, ".loomflo", "config.json"));
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

// ============================================================================
// Config Resolution (from pre-loaded layers)
// ============================================================================

/**
 * Resolve a full configuration from pre-loaded config layers.
 *
 * Merges in order: DEFAULT_CONFIG → level preset → global → project → overrides.
 * The effective level is determined from the highest-priority source that sets it.
 *
 * @param globalConfig - Global-level partial configuration (~/.loomflo/config.json).
 * @param projectConfig - Project-level partial configuration (.loomflo/config.json).
 * @param overrides - CLI or programmatic overrides applied with highest precedence.
 * @returns The fully resolved and validated configuration.
 */
export function resolveConfig(
  globalConfig: PartialConfig,
  projectConfig: PartialConfig,
  overrides: PartialConfig,
): Config {
  const resolvedLevel: Level =
    overrides.level ?? projectConfig.level ?? globalConfig.level ?? DEFAULT_CONFIG.level;
  const levelPreset = getLevelPreset(resolvedLevel);
  let merged: Config = deepMerge(DEFAULT_CONFIG, levelPreset as Partial<Config>);
  merged = deepMerge(merged, globalConfig as Partial<Config>);
  merged = deepMerge(merged, projectConfig as Partial<Config>);
  merged = deepMerge(merged, overrides as Partial<Config>);
  return ConfigSchema.parse(merged);
}

// ============================================================================
// Config Manager
// ============================================================================

/** Options for creating a {@link ConfigManager} instance. */
export interface ConfigManagerOptions {
  /** Path to the project root (for project-level config and file watching). */
  projectPath?: string;
  /** CLI or programmatic overrides applied with highest precedence. */
  overrides?: PartialConfig;
}

/**
 * Runtime configuration manager with live reload support.
 *
 * Holds the current resolved config in memory, supports partial updates via
 * {@link updateConfig}, and watches the project config file for external
 * changes. Emits a `'configChanged'` event (with the new {@link Config} as
 * the argument) whenever the resolved configuration changes.
 *
 * **Design contract**: configuration changes apply to the **next node
 * activation only** — they do not retroactively affect nodes that are already
 * executing. This contract is enforced by the execution engine, not by
 * ConfigManager itself.
 *
 * Use the static {@link ConfigManager.create} factory to construct an instance.
 *
 * @example
 * ```ts
 * const manager = await ConfigManager.create({ projectPath: '/my/project' });
 * manager.on('configChanged', (config) => console.log('Config updated'));
 * manager.updateConfig({ apiRateLimit: 120 });
 * manager.destroy();
 * ```
 */
export class ConfigManager extends EventEmitter {
  /** Current fully-resolved configuration. */
  private config: Config;

  /** Cached global-level partial config from the last load/reload. */
  private globalConfig: PartialConfig;

  /** Current project-level partial config (updated by updateConfig and reload). */
  private projectFileConfig: PartialConfig;

  /** Path to the project root, or undefined if no project context. */
  private readonly projectPath: string | undefined;

  /** CLI/programmatic overrides (immutable after construction). */
  private readonly overrides: PartialConfig;

  /** Active file system watcher, or null if not watching. */
  private watcher: FSWatcher | null = null;

  /** Debounce timer for file watch events. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Flag to skip the next watcher-triggered reload after our own persist. */
  private skipNextReload = false;

  /** Debounce delay in milliseconds for file watch events. */
  private static readonly DEBOUNCE_MS = 75;

  /**
   * Private constructor — use {@link ConfigManager.create} instead.
   *
   * @param config - Initial fully-resolved configuration.
   * @param globalConfig - Initial global-level partial config.
   * @param projectFileConfig - Initial project-level partial config.
   * @param projectPath - Project root path.
   * @param overrides - CLI/programmatic overrides.
   */
  private constructor(
    config: Config,
    globalConfig: PartialConfig,
    projectFileConfig: PartialConfig,
    projectPath: string | undefined,
    overrides: PartialConfig,
  ) {
    super();
    this.config = config;
    this.globalConfig = globalConfig;
    this.projectFileConfig = projectFileConfig;
    this.projectPath = projectPath;
    this.overrides = overrides;
  }

  /**
   * Create and initialize a new ConfigManager.
   *
   * Loads configuration from all three levels (global, project, CLI overrides),
   * resolves the merged config, and starts watching the project config directory
   * for external changes to `config.json`.
   *
   * @param options - Configuration manager options.
   * @returns A fully initialized ConfigManager instance.
   */
  static async create(options: ConfigManagerOptions = {}): Promise<ConfigManager> {
    const { projectPath, overrides = {} } = options;

    const globalPath = join(homedir(), ".loomflo", "config.json");
    const globalConfig = await loadConfigFile(globalPath);

    let projectFileConfig: PartialConfig = {};
    if (projectPath) {
      projectFileConfig = await loadConfigFile(join(projectPath, ".loomflo", "config.json"));
    }

    const config = resolveConfig(globalConfig, projectFileConfig, overrides);
    const manager = new ConfigManager(
      config,
      globalConfig,
      projectFileConfig,
      projectPath,
      overrides,
    );
    manager.startWatching();

    return manager;
  }

  /**
   * Return the current fully-resolved configuration.
   *
   * @returns The current merged configuration object.
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Apply a partial configuration update.
   *
   * Deep-merges the partial update into the project-level configuration,
   * re-resolves the full merged config, validates it against {@link ConfigSchema},
   * persists changes to the project config file (`.loomflo/config.json`)
   * asynchronously, and emits a `'configChanged'` event if the resolved
   * config actually changed.
   *
   * @param partial - Partial configuration values to merge into project config.
   * @returns The new fully-resolved configuration.
   * @throws If the merged configuration fails zod schema validation.
   */
  updateConfig(partial: Partial<Config>): Config {
    this.projectFileConfig = deepMerge(this.projectFileConfig as Config, partial) as PartialConfig;

    const previous = this.config;
    this.config = resolveConfig(this.globalConfig, this.projectFileConfig, this.overrides);

    if (JSON.stringify(previous) !== JSON.stringify(this.config)) {
      this.emit("configChanged", this.config);
    }

    this.persistProjectConfig();

    return this.config;
  }

  /**
   * Reload configuration from all three levels (global, project, CLI overrides).
   *
   * Re-reads config files from disk, re-merges them, and emits `'configChanged'`
   * if the resolved config changed.
   *
   * @returns The newly resolved configuration.
   */
  async reload(): Promise<Config> {
    const globalPath = join(homedir(), ".loomflo", "config.json");
    this.globalConfig = await loadConfigFile(globalPath);

    if (this.projectPath) {
      this.projectFileConfig = await loadConfigFile(
        join(this.projectPath, ".loomflo", "config.json"),
      );
    }

    const previous = this.config;
    this.config = resolveConfig(this.globalConfig, this.projectFileConfig, this.overrides);

    if (JSON.stringify(previous) !== JSON.stringify(this.config)) {
      this.emit("configChanged", this.config);
    }

    return this.config;
  }

  /**
   * Stop watching for file changes and clean up all resources.
   *
   * Call this method when the ConfigManager is no longer needed to prevent
   * resource leaks from the file watcher and timers.
   */
  destroy(): void {
    this.stopWatching();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.removeAllListeners();
  }

  /**
   * Start watching the project config directory for file changes.
   * Handles missing directories gracefully (no-op if directory does not exist).
   */
  private startWatching(): void {
    if (!this.projectPath) return;

    const configDir = join(this.projectPath, ".loomflo");

    try {
      this.watcher = watch(configDir, (_eventType: string, filename: string | null): void => {
        if (filename === "config.json") {
          this.handleFileChange();
        }
      });

      this.watcher.on("error", (): void => {
        this.stopWatching();
      });
    } catch {
      // Directory doesn't exist yet; file watching is not available.
    }
  }

  /** Stop the file system watcher if active. */
  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Handle a file change event from the watcher.
   * Debounces rapid events and triggers a config reload.
   */
  private handleFileChange(): void {
    if (this.skipNextReload) {
      this.skipNextReload = false;
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout((): void => {
      this.debounceTimer = null;
      void this.reload().catch((): void => {
        // Reload failure from file watching is non-fatal.
      });
    }, ConfigManager.DEBOUNCE_MS);
  }

  /**
   * Persist the current project-level config to the project config file.
   * Runs asynchronously in the background; errors are silently ignored
   * since the in-memory config is already up-to-date.
   */
  private persistProjectConfig(): void {
    if (!this.projectPath) return;

    this.skipNextReload = true;

    const configDir = join(this.projectPath, ".loomflo");
    const configPath = join(configDir, "config.json");
    const content = JSON.stringify(this.projectFileConfig, null, 2) + "\n";

    void mkdir(configDir, { recursive: true })
      .then(() => writeFile(configPath, content, "utf-8"))
      .catch((): void => {
        // Persist failure is non-fatal; in-memory config is already updated.
      });
  }
}
