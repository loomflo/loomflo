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
