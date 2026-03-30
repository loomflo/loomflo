import { z } from 'zod';
import { EventEmitter } from 'node:events';
import { FastifyInstance } from 'fastify';
import { preHandlerAsyncHookHandler } from 'fastify/types/hooks.js';

/** Zod schema for the level preset selector. */
declare const LevelSchema: z.ZodUnion<[z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<"custom">]>;
/** Level preset: 1 (Minimal), 2 (Standard), 3 (Full), or 'custom'. */
type Level = z.infer<typeof LevelSchema>;
/** Zod schema for the retry strategy selector. */
declare const RetryStrategySchema: z.ZodUnion<[z.ZodLiteral<"adaptive">, z.ZodLiteral<"same">]>;
/** Retry strategy: 'adaptive' modifies the prompt on retry, 'same' retries with the original prompt. */
type RetryStrategy = z.infer<typeof RetryStrategySchema>;
/** Zod schema for per-role model configuration. */
declare const ModelsConfigSchema: z.ZodObject<{
    /** LLM model for the Loom (Architect) agent. */
    loom: z.ZodDefault<z.ZodString>;
    /** LLM model for the Loomi (Orchestrator) agent. */
    loomi: z.ZodDefault<z.ZodString>;
    /** LLM model for the Looma (Worker) agent. */
    looma: z.ZodDefault<z.ZodString>;
    /** LLM model for the Loomex (Reviewer) agent. */
    loomex: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    loom: string;
    loomi: string;
    looma: string;
    loomex: string;
}, {
    loom?: string | undefined;
    loomi?: string | undefined;
    looma?: string | undefined;
    loomex?: string | undefined;
}>;
/** Per-role model configuration mapping agent roles to LLM model identifiers. */
type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
/**
 * Zod schema for the full Loomflo configuration.
 *
 * Every field has a `.default()` so the schema can validate partial configs.
 * The three-level config loading logic (global, project, CLI) is implemented
 * separately in T015.
 */
declare const ConfigSchema: z.ZodObject<{
    /** Preset level controlling default agent topology and behavior. */
    level: z.ZodDefault<z.ZodUnion<[z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<"custom">]>>;
    /** Default delay between node activations (e.g., "0", "30m", "1h", "1d"). */
    defaultDelay: z.ZodDefault<z.ZodString>;
    /** Whether the Loomex reviewer agent is enabled. */
    reviewerEnabled: z.ZodDefault<z.ZodBoolean>;
    /** Maximum retry cycles allowed per node before marking as failed. */
    maxRetriesPerNode: z.ZodDefault<z.ZodNumber>;
    /** Maximum retries allowed per individual task within a node. */
    maxRetriesPerTask: z.ZodDefault<z.ZodNumber>;
    /** Maximum worker agents (Loomas) per orchestrator (Loomi). Null means unlimited. */
    maxLoomasPerLoomi: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    /** Strategy for modifying prompts on retry: 'adaptive' adjusts the prompt, 'same' retries as-is. */
    retryStrategy: z.ZodDefault<z.ZodUnion<[z.ZodLiteral<"adaptive">, z.ZodLiteral<"same">]>>;
    /** Per-role LLM model assignments. */
    models: z.ZodDefault<z.ZodObject<{
        /** LLM model for the Loom (Architect) agent. */
        loom: z.ZodDefault<z.ZodString>;
        /** LLM model for the Loomi (Orchestrator) agent. */
        loomi: z.ZodDefault<z.ZodString>;
        /** LLM model for the Looma (Worker) agent. */
        looma: z.ZodDefault<z.ZodString>;
        /** LLM model for the Loomex (Reviewer) agent. */
        loomex: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        loom: string;
        loomi: string;
        looma: string;
        loomex: string;
    }, {
        loom?: string | undefined;
        loomi?: string | undefined;
        looma?: string | undefined;
        loomex?: string | undefined;
    }>>;
    /** LLM provider identifier (e.g., "anthropic", "openai"). */
    provider: z.ZodDefault<z.ZodString>;
    /** Maximum total cost in USD before pausing the workflow. Null means no limit. */
    budgetLimit: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    /** Whether to pause the workflow when the budget limit is reached. */
    pauseOnBudgetReached: z.ZodDefault<z.ZodBoolean>;
    /** Whether shell commands executed by agents are sandboxed to the project workspace. */
    sandboxCommands: z.ZodDefault<z.ZodBoolean>;
    /** Whether agents are allowed to make outbound HTTP requests. */
    allowNetwork: z.ZodDefault<z.ZodBoolean>;
    /** TCP port for the monitoring dashboard. */
    dashboardPort: z.ZodDefault<z.ZodNumber>;
    /** Whether to automatically open the dashboard in a browser on daemon start. */
    dashboardAutoOpen: z.ZodDefault<z.ZodBoolean>;
    /** Wall-clock timeout per agent call in milliseconds (default: 10 minutes). */
    agentTimeout: z.ZodDefault<z.ZodNumber>;
    /** Maximum tokens per agent LLM call. */
    agentTokenLimit: z.ZodDefault<z.ZodNumber>;
    /** Maximum LLM API calls per minute per agent (rate limiting). */
    apiRateLimit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    level: 1 | 2 | "custom" | 3;
    defaultDelay: string;
    reviewerEnabled: boolean;
    maxRetriesPerNode: number;
    maxRetriesPerTask: number;
    maxLoomasPerLoomi: number | null;
    retryStrategy: "adaptive" | "same";
    models: {
        loom: string;
        loomi: string;
        looma: string;
        loomex: string;
    };
    provider: string;
    budgetLimit: number | null;
    pauseOnBudgetReached: boolean;
    sandboxCommands: boolean;
    allowNetwork: boolean;
    dashboardPort: number;
    dashboardAutoOpen: boolean;
    agentTimeout: number;
    agentTokenLimit: number;
    apiRateLimit: number;
}, {
    level?: 1 | 2 | "custom" | 3 | undefined;
    defaultDelay?: string | undefined;
    reviewerEnabled?: boolean | undefined;
    maxRetriesPerNode?: number | undefined;
    maxRetriesPerTask?: number | undefined;
    maxLoomasPerLoomi?: number | null | undefined;
    retryStrategy?: "adaptive" | "same" | undefined;
    models?: {
        loom?: string | undefined;
        loomi?: string | undefined;
        looma?: string | undefined;
        loomex?: string | undefined;
    } | undefined;
    provider?: string | undefined;
    budgetLimit?: number | null | undefined;
    pauseOnBudgetReached?: boolean | undefined;
    sandboxCommands?: boolean | undefined;
    allowNetwork?: boolean | undefined;
    dashboardPort?: number | undefined;
    dashboardAutoOpen?: boolean | undefined;
    agentTimeout?: number | undefined;
    agentTokenLimit?: number | undefined;
    apiRateLimit?: number | undefined;
}>;
/** Full Loomflo configuration with all fields resolved. */
type Config = z.infer<typeof ConfigSchema>;
/**
 * Zod schema for validating user-provided partial configuration files.
 *
 * All fields are optional. Used when parsing `~/.loomflo/config.json`,
 * `.loomflo/config.json`, or CLI flag overrides before merging.
 */
declare const PartialConfigSchema: z.ZodObject<{
    level: z.ZodOptional<z.ZodDefault<z.ZodUnion<[z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<"custom">]>>>;
    defaultDelay: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    reviewerEnabled: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    maxRetriesPerNode: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    maxRetriesPerTask: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    maxLoomasPerLoomi: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodNumber>>>;
    retryStrategy: z.ZodOptional<z.ZodDefault<z.ZodUnion<[z.ZodLiteral<"adaptive">, z.ZodLiteral<"same">]>>>;
    models: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        /** LLM model for the Loom (Architect) agent. */
        loom: z.ZodDefault<z.ZodString>;
        /** LLM model for the Loomi (Orchestrator) agent. */
        loomi: z.ZodDefault<z.ZodString>;
        /** LLM model for the Looma (Worker) agent. */
        looma: z.ZodDefault<z.ZodString>;
        /** LLM model for the Loomex (Reviewer) agent. */
        loomex: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        loom: string;
        loomi: string;
        looma: string;
        loomex: string;
    }, {
        loom?: string | undefined;
        loomi?: string | undefined;
        looma?: string | undefined;
        loomex?: string | undefined;
    }>>>;
    provider: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    budgetLimit: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodNumber>>>;
    pauseOnBudgetReached: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    sandboxCommands: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    allowNetwork: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    dashboardPort: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    dashboardAutoOpen: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    agentTimeout: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    agentTokenLimit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    apiRateLimit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    level?: 1 | 2 | "custom" | 3 | undefined;
    defaultDelay?: string | undefined;
    reviewerEnabled?: boolean | undefined;
    maxRetriesPerNode?: number | undefined;
    maxRetriesPerTask?: number | undefined;
    maxLoomasPerLoomi?: number | null | undefined;
    retryStrategy?: "adaptive" | "same" | undefined;
    models?: {
        loom: string;
        loomi: string;
        looma: string;
        loomex: string;
    } | undefined;
    provider?: string | undefined;
    budgetLimit?: number | null | undefined;
    pauseOnBudgetReached?: boolean | undefined;
    sandboxCommands?: boolean | undefined;
    allowNetwork?: boolean | undefined;
    dashboardPort?: number | undefined;
    dashboardAutoOpen?: boolean | undefined;
    agentTimeout?: number | undefined;
    agentTokenLimit?: number | undefined;
    apiRateLimit?: number | undefined;
}, {
    level?: 1 | 2 | "custom" | 3 | undefined;
    defaultDelay?: string | undefined;
    reviewerEnabled?: boolean | undefined;
    maxRetriesPerNode?: number | undefined;
    maxRetriesPerTask?: number | undefined;
    maxLoomasPerLoomi?: number | null | undefined;
    retryStrategy?: "adaptive" | "same" | undefined;
    models?: {
        loom?: string | undefined;
        loomi?: string | undefined;
        looma?: string | undefined;
        loomex?: string | undefined;
    } | undefined;
    provider?: string | undefined;
    budgetLimit?: number | null | undefined;
    pauseOnBudgetReached?: boolean | undefined;
    sandboxCommands?: boolean | undefined;
    allowNetwork?: boolean | undefined;
    dashboardPort?: number | undefined;
    dashboardAutoOpen?: boolean | undefined;
    agentTimeout?: number | undefined;
    agentTokenLimit?: number | undefined;
    apiRateLimit?: number | undefined;
}>;
/** A partial configuration where all fields are optional, for user-provided config files. */
type PartialConfig = z.infer<typeof PartialConfigSchema>;
/**
 * The default configuration with all defaults applied.
 *
 * Produced by parsing an empty object through the ConfigSchema,
 * which fills in every `.default()` value.
 */
declare const DEFAULT_CONFIG: Config;
/**
 * Deep-merge two objects. Nested plain objects are recursively merged;
 * arrays are replaced (not concatenated); `null` values override;
 * `undefined` values are skipped.
 *
 * @param target - The base object to merge into.
 * @param source - The object whose values take precedence.
 * @returns A new object with deeply merged values.
 */
declare function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T;
/**
 * Load and validate a partial configuration from a JSON file.
 *
 * @param filePath - Absolute path to a JSON config file.
 * @returns The validated partial configuration, or an empty object if the file does not exist.
 * @throws If the file contains invalid JSON or fails schema validation.
 */
declare function loadConfigFile(filePath: string): Promise<PartialConfig>;
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
declare function loadConfig(options?: {
    projectPath?: string;
    overrides?: PartialConfig;
}): Promise<Config>;
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
declare function resolveConfig(globalConfig: PartialConfig, projectConfig: PartialConfig, overrides: PartialConfig): Config;
/** Options for creating a {@link ConfigManager} instance. */
interface ConfigManagerOptions {
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
declare class ConfigManager extends EventEmitter {
    /** Current fully-resolved configuration. */
    private config;
    /** Cached global-level partial config from the last load/reload. */
    private globalConfig;
    /** Current project-level partial config (updated by updateConfig and reload). */
    private projectFileConfig;
    /** Path to the project root, or undefined if no project context. */
    private readonly projectPath;
    /** CLI/programmatic overrides (immutable after construction). */
    private readonly overrides;
    /** Active file system watcher, or null if not watching. */
    private watcher;
    /** Debounce timer for file watch events. */
    private debounceTimer;
    /** Flag to skip the next watcher-triggered reload after our own persist. */
    private skipNextReload;
    /** Debounce delay in milliseconds for file watch events. */
    private static readonly DEBOUNCE_MS;
    /**
     * Private constructor — use {@link ConfigManager.create} instead.
     *
     * @param config - Initial fully-resolved configuration.
     * @param globalConfig - Initial global-level partial config.
     * @param projectFileConfig - Initial project-level partial config.
     * @param projectPath - Project root path.
     * @param overrides - CLI/programmatic overrides.
     */
    private constructor();
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
    static create(options?: ConfigManagerOptions): Promise<ConfigManager>;
    /**
     * Return the current fully-resolved configuration.
     *
     * @returns The current merged configuration object.
     */
    getConfig(): Config;
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
    updateConfig(partial: Partial<Config>): Config;
    /**
     * Reload configuration from all three levels (global, project, CLI overrides).
     *
     * Re-reads config files from disk, re-merges them, and emits `'configChanged'`
     * if the resolved config changed.
     *
     * @returns The newly resolved configuration.
     */
    reload(): Promise<Config>;
    /**
     * Stop watching for file changes and clean up all resources.
     *
     * Call this method when the ConfigManager is no longer needed to prevent
     * resource leaks from the file watcher and timers.
     */
    destroy(): void;
    /**
     * Start watching the project config directory for file changes.
     * Handles missing directories gracefully (no-op if directory does not exist).
     */
    private startWatching;
    /** Stop the file system watcher if active. */
    private stopWatching;
    /**
     * Handle a file change event from the watcher.
     * Debounces rapid events and triggers a config reload.
     */
    private handleFileChange;
    /**
     * Persist the current project-level config to the project config file.
     * Runs asynchronously in the background; errors are silently ignored
     * since the in-memory config is already up-to-date.
     */
    private persistProjectConfig;
}

/** Zod schema for workflow lifecycle states. */
declare const WorkflowStatusSchema: z.ZodEnum<["init", "spec", "building", "running", "paused", "done", "failed"]>;
/** Workflow lifecycle state. */
type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
/** Zod schema for node execution states. */
declare const NodeStatusSchema: z.ZodEnum<["pending", "waiting", "running", "review", "done", "failed", "blocked"]>;
/** Node execution state. */
type NodeStatus = z.infer<typeof NodeStatusSchema>;
/** Zod schema for agent role identifiers. */
declare const AgentRoleSchema: z.ZodEnum<["loom", "loomi", "looma", "loomex"]>;
/** Agent role: loom (architect), loomi (orchestrator), looma (worker), loomex (reviewer). */
type AgentRole = z.infer<typeof AgentRoleSchema>;
/** Zod schema for agent lifecycle states. */
declare const AgentStatusSchema: z.ZodEnum<["created", "running", "completed", "failed"]>;
/** Agent lifecycle state. */
type AgentStatus = z.infer<typeof AgentStatusSchema>;
/** Zod schema for graph topology classifications. */
declare const TopologyTypeSchema: z.ZodEnum<["linear", "divergent", "convergent", "tree", "mixed"]>;
/** Graph topology classification. */
type TopologyType = z.infer<typeof TopologyTypeSchema>;
/** Zod schema for all event types emitted by the engine. */
declare const EventTypeSchema: z.ZodEnum<["workflow_created", "workflow_started", "workflow_paused", "workflow_resumed", "workflow_completed", "spec_phase_started", "spec_phase_completed", "graph_built", "graph_modified", "node_started", "node_completed", "node_failed", "node_blocked", "agent_created", "agent_completed", "agent_failed", "reviewer_started", "reviewer_verdict", "retry_triggered", "escalation_triggered", "message_sent", "cost_tracked", "memory_updated"]>;
/** Event type identifier for the event log. */
type EventType = z.infer<typeof EventTypeSchema>;
/** Zod schema for a directed edge between two nodes. */
declare const EdgeSchema: z.ZodObject<{
    /** Source node ID. */
    from: z.ZodString;
    /** Target node ID. */
    to: z.ZodString;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string;
}, {
    from: string;
    to: string;
}>;
/** A directed edge between two nodes in the workflow graph. */
type Edge = z.infer<typeof EdgeSchema>;
/** Zod schema for a single task verification result within a review report. */
declare const TaskVerificationSchema: z.ZodObject<{
    /** Identifier of the verified task. */
    taskId: z.ZodString;
    /** Task-level verification result. */
    status: z.ZodEnum<["pass", "fail", "blocked"]>;
    /** Explanation of what was found during verification. */
    details: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "blocked" | "pass" | "fail";
    taskId: string;
    details: string;
}, {
    status: "blocked" | "pass" | "fail";
    taskId: string;
    details: string;
}>;
/** Per-task verification result from a Loomex review. */
type TaskVerification = z.infer<typeof TaskVerificationSchema>;
/** Zod schema for a content block in an LLM response (text, tool_use, or tool_result). */
declare const ContentBlockSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /** Block type discriminator. */
    type: z.ZodLiteral<"text">;
    /** The text content. */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
}, {
    type: "text";
    text: string;
}>, z.ZodObject<{
    /** Block type discriminator. */
    type: z.ZodLiteral<"tool_use">;
    /** Unique tool-use invocation ID. */
    id: z.ZodString;
    /** Tool name being invoked. */
    name: z.ZodString;
    /** Tool input arguments. */
    input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}, {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}>, z.ZodObject<{
    /** Block type discriminator. */
    type: z.ZodLiteral<"tool_result">;
    /** ID of the tool-use invocation this result responds to. */
    toolUseId: z.ZodString;
    /** Tool execution result as a string. */
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "tool_result";
    toolUseId: string;
    content: string;
}, {
    type: "tool_result";
    toolUseId: string;
    content: string;
}>]>;
/** A content block in an LLM response: text, tool invocation, or tool result. */
type ContentBlock = z.infer<typeof ContentBlockSchema>;
/** Zod schema for a JSON-serializable tool definition sent to the LLM. */
declare const ToolDefinitionSchema: z.ZodObject<{
    /** Tool identifier (e.g., "read_file"). */
    name: z.ZodString;
    /** Human-readable description included in the LLM prompt. */
    description: z.ZodString;
    /** JSON Schema describing the tool's input parameters. */
    inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}, {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}>;
/** JSON-serializable tool definition sent to the LLM for tool-use. */
type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
/** Zod schema for a shared memory file managed by the daemon. */
declare const SharedMemoryFileSchema: z.ZodObject<{
    /** File name (e.g., "DECISIONS.md"). */
    name: z.ZodString;
    /** Full path within .loomflo/shared-memory/. */
    path: z.ZodString;
    /** Current file content (Markdown). */
    content: z.ZodString;
    /** Agent ID that last wrote to this file. */
    lastModifiedBy: z.ZodString;
    /** ISO 8601 timestamp of last modification. */
    lastModifiedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    name: string;
    content: string;
    lastModifiedBy: string;
    lastModifiedAt: string;
}, {
    path: string;
    name: string;
    content: string;
    lastModifiedBy: string;
    lastModifiedAt: string;
}>;
/** A shared memory file managed by the daemon for cross-node state. */
type SharedMemoryFile = z.infer<typeof SharedMemoryFileSchema>;
/** Zod schema for agent token usage tracking. */
declare const TokenUsageSchema: z.ZodObject<{
    /** Number of input tokens consumed. */
    input: z.ZodNumber;
    /** Number of output tokens produced. */
    output: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    input: number;
    output: number;
}, {
    input: number;
    output: number;
}>;
/** Cumulative token usage for an agent. */
type TokenUsage = z.infer<typeof TokenUsageSchema>;
/** Zod schema for agent metadata assigned to a node. */
declare const AgentInfoSchema: z.ZodObject<{
    /** Unique agent identifier (e.g., "looma-auth-1"). */
    id: z.ZodString;
    /** Agent role in the workflow. */
    role: z.ZodEnum<["loom", "loomi", "looma", "loomex"]>;
    /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
    model: z.ZodString;
    /** Current agent lifecycle state. */
    status: z.ZodEnum<["created", "running", "completed", "failed"]>;
    /** Glob patterns defining the agent's file write permissions. */
    writeScope: z.ZodArray<z.ZodString, "many">;
    /** Description of the agent's assigned task. */
    taskDescription: z.ZodString;
    /** Cumulative token usage for this agent's LLM calls. */
    tokenUsage: z.ZodObject<{
        /** Number of input tokens consumed. */
        input: z.ZodNumber;
        /** Number of output tokens produced. */
        output: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        input: number;
        output: number;
    }, {
        input: number;
        output: number;
    }>;
    /** Cumulative cost in USD for this agent's LLM calls. */
    cost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "running" | "failed" | "created" | "completed";
    id: string;
    role: "loom" | "loomi" | "looma" | "loomex";
    model: string;
    writeScope: string[];
    taskDescription: string;
    tokenUsage: {
        input: number;
        output: number;
    };
    cost: number;
}, {
    status: "running" | "failed" | "created" | "completed";
    id: string;
    role: "loom" | "loomi" | "looma" | "loomex";
    model: string;
    writeScope: string[];
    taskDescription: string;
    tokenUsage: {
        input: number;
        output: number;
    };
    cost: number;
}>;
/** Metadata about an agent assigned to a workflow node. */
type AgentInfo = z.infer<typeof AgentInfoSchema>;
/** Zod schema for a structured review report from Loomex. */
declare const ReviewReportSchema: z.ZodObject<{
    /** Overall review verdict. */
    verdict: z.ZodEnum<["PASS", "FAIL", "BLOCKED"]>;
    /** Per-task verification results. */
    tasksVerified: z.ZodArray<z.ZodObject<{
        /** Identifier of the verified task. */
        taskId: z.ZodString;
        /** Task-level verification result. */
        status: z.ZodEnum<["pass", "fail", "blocked"]>;
        /** Explanation of what was found during verification. */
        details: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        status: "blocked" | "pass" | "fail";
        taskId: string;
        details: string;
    }, {
        status: "blocked" | "pass" | "fail";
        taskId: string;
        details: string;
    }>, "many">;
    /** Detailed findings: what works, what's missing, what's blocked. */
    details: z.ZodString;
    /** Specific recommended actions for retry or escalation. */
    recommendation: z.ZodString;
    /** ISO 8601 timestamp when the review was produced. */
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    details: string;
    verdict: "PASS" | "FAIL" | "BLOCKED";
    tasksVerified: {
        status: "blocked" | "pass" | "fail";
        taskId: string;
        details: string;
    }[];
    recommendation: string;
    createdAt: string;
}, {
    details: string;
    verdict: "PASS" | "FAIL" | "BLOCKED";
    tasksVerified: {
        status: "blocked" | "pass" | "fail";
        taskId: string;
        details: string;
    }[];
    recommendation: string;
    createdAt: string;
}>;
/** Structured review report produced by a Loomex reviewer agent. */
type ReviewReport = z.infer<typeof ReviewReportSchema>;
/** Zod schema for an inter-agent message routed by the MessageBus. */
declare const MessageSchema: z.ZodObject<{
    /** Unique message identifier. */
    id: z.ZodString;
    /** Sender agent ID. */
    from: z.ZodString;
    /** Recipient agent ID. */
    to: z.ZodString;
    /** Node context (messages are node-scoped). */
    nodeId: z.ZodString;
    /** Message body. */
    content: z.ZodString;
    /** ISO 8601 timestamp when the message was sent. */
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    from: string;
    to: string;
    id: string;
    content: string;
    nodeId: string;
    timestamp: string;
}, {
    from: string;
    to: string;
    id: string;
    content: string;
    nodeId: string;
    timestamp: string;
}>;
/** An inter-agent message routed by the MessageBus within a node. */
type Message = z.infer<typeof MessageSchema>;
/** Zod schema for an event log entry. */
declare const EventSchema: z.ZodObject<{
    /** ISO 8601 precise timestamp. */
    ts: z.ZodString;
    /** Event type identifier. */
    type: z.ZodEnum<["workflow_created", "workflow_started", "workflow_paused", "workflow_resumed", "workflow_completed", "spec_phase_started", "spec_phase_completed", "graph_built", "graph_modified", "node_started", "node_completed", "node_failed", "node_blocked", "agent_created", "agent_completed", "agent_failed", "reviewer_started", "reviewer_verdict", "retry_triggered", "escalation_triggered", "message_sent", "cost_tracked", "memory_updated"]>;
    /** Workflow this event belongs to. */
    workflowId: z.ZodString;
    /** Node this event relates to, or null for workflow-level events. */
    nodeId: z.ZodNullable<z.ZodString>;
    /** Agent this event relates to, or null for node/workflow-level events. */
    agentId: z.ZodNullable<z.ZodString>;
    /** Event-specific payload data. */
    details: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    type: "workflow_created" | "workflow_started" | "workflow_paused" | "workflow_resumed" | "workflow_completed" | "spec_phase_started" | "spec_phase_completed" | "graph_built" | "graph_modified" | "node_started" | "node_completed" | "node_failed" | "node_blocked" | "agent_created" | "agent_completed" | "agent_failed" | "reviewer_started" | "reviewer_verdict" | "retry_triggered" | "escalation_triggered" | "message_sent" | "cost_tracked" | "memory_updated";
    details: Record<string, unknown>;
    nodeId: string | null;
    ts: string;
    workflowId: string;
    agentId: string | null;
}, {
    type: "workflow_created" | "workflow_started" | "workflow_paused" | "workflow_resumed" | "workflow_completed" | "spec_phase_started" | "spec_phase_completed" | "graph_built" | "graph_modified" | "node_started" | "node_completed" | "node_failed" | "node_blocked" | "agent_created" | "agent_completed" | "agent_failed" | "reviewer_started" | "reviewer_verdict" | "retry_triggered" | "escalation_triggered" | "message_sent" | "cost_tracked" | "memory_updated";
    details: Record<string, unknown>;
    nodeId: string | null;
    ts: string;
    workflowId: string;
    agentId: string | null;
}>;
/** A single entry in the workflow event log (events.jsonl). */
type Event = z.infer<typeof EventSchema>;
/** Zod schema for an LLM response from a provider. */
declare const LLMResponseSchema: z.ZodObject<{
    /** Response content blocks. */
    content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /** Block type discriminator. */
        type: z.ZodLiteral<"text">;
        /** The text content. */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        /** Block type discriminator. */
        type: z.ZodLiteral<"tool_use">;
        /** Unique tool-use invocation ID. */
        id: z.ZodString;
        /** Tool name being invoked. */
        name: z.ZodString;
        /** Tool input arguments. */
        input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    }, {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    }>, z.ZodObject<{
        /** Block type discriminator. */
        type: z.ZodLiteral<"tool_result">;
        /** ID of the tool-use invocation this result responds to. */
        toolUseId: z.ZodString;
        /** Tool execution result as a string. */
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "tool_result";
        toolUseId: string;
        content: string;
    }, {
        type: "tool_result";
        toolUseId: string;
        content: string;
    }>]>, "many">;
    /** Reason the LLM stopped generating. */
    stopReason: z.ZodEnum<["end_turn", "tool_use"]>;
    /** Token usage for this response. */
    usage: z.ZodObject<{
        /** Input tokens consumed. */
        inputTokens: z.ZodNumber;
        /** Output tokens produced. */
        outputTokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
    }, {
        inputTokens: number;
        outputTokens: number;
    }>;
    /** Model identifier that produced this response. */
    model: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: ({
        type: "text";
        text: string;
    } | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    } | {
        type: "tool_result";
        toolUseId: string;
        content: string;
    })[];
    model: string;
    stopReason: "tool_use" | "end_turn";
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}, {
    content: ({
        type: "text";
        text: string;
    } | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    } | {
        type: "tool_result";
        toolUseId: string;
        content: string;
    })[];
    model: string;
    stopReason: "tool_use" | "end_turn";
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}>;
/** Structured response from an LLM provider. */
type LLMResponse = z.infer<typeof LLMResponseSchema>;
/** Zod schema for a workflow node. */
declare const NodeSchema: z.ZodObject<{
    /** Unique node identifier (e.g., "node-1"). */
    id: z.ZodString;
    /** Human-readable node name (e.g., "Setup Authentication"). */
    title: z.ZodString;
    /** Current node execution state. */
    status: z.ZodEnum<["pending", "waiting", "running", "review", "done", "failed", "blocked"]>;
    /** Markdown instructions for this node. */
    instructions: z.ZodString;
    /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
    delay: z.ZodString;
    /** ISO 8601 timestamp when the delay expires, or null. */
    resumeAt: z.ZodNullable<z.ZodString>;
    /** Agents assigned to this node. */
    agents: z.ZodArray<z.ZodObject<{
        /** Unique agent identifier (e.g., "looma-auth-1"). */
        id: z.ZodString;
        /** Agent role in the workflow. */
        role: z.ZodEnum<["loom", "loomi", "looma", "loomex"]>;
        /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
        model: z.ZodString;
        /** Current agent lifecycle state. */
        status: z.ZodEnum<["created", "running", "completed", "failed"]>;
        /** Glob patterns defining the agent's file write permissions. */
        writeScope: z.ZodArray<z.ZodString, "many">;
        /** Description of the agent's assigned task. */
        taskDescription: z.ZodString;
        /** Cumulative token usage for this agent's LLM calls. */
        tokenUsage: z.ZodObject<{
            /** Number of input tokens consumed. */
            input: z.ZodNumber;
            /** Number of output tokens produced. */
            output: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            input: number;
            output: number;
        }, {
            input: number;
            output: number;
        }>;
        /** Cumulative cost in USD for this agent's LLM calls. */
        cost: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: "running" | "failed" | "created" | "completed";
        id: string;
        role: "loom" | "loomi" | "looma" | "loomex";
        model: string;
        writeScope: string[];
        taskDescription: string;
        tokenUsage: {
            input: number;
            output: number;
        };
        cost: number;
    }, {
        status: "running" | "failed" | "created" | "completed";
        id: string;
        role: "loom" | "loomi" | "looma" | "loomex";
        model: string;
        writeScope: string[];
        taskDescription: string;
        tokenUsage: {
            input: number;
            output: number;
        };
        cost: number;
    }>, "many">;
    /** Agent ID to glob patterns mapping for write scope enforcement. */
    fileOwnership: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
    /** Number of retry cycles attempted. */
    retryCount: z.ZodNumber;
    /** Maximum allowed retry cycles (from config). */
    maxRetries: z.ZodNumber;
    /** Loomex review report, or null if no review has run. */
    reviewReport: z.ZodNullable<z.ZodObject<{
        /** Overall review verdict. */
        verdict: z.ZodEnum<["PASS", "FAIL", "BLOCKED"]>;
        /** Per-task verification results. */
        tasksVerified: z.ZodArray<z.ZodObject<{
            /** Identifier of the verified task. */
            taskId: z.ZodString;
            /** Task-level verification result. */
            status: z.ZodEnum<["pass", "fail", "blocked"]>;
            /** Explanation of what was found during verification. */
            details: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            status: "blocked" | "pass" | "fail";
            taskId: string;
            details: string;
        }, {
            status: "blocked" | "pass" | "fail";
            taskId: string;
            details: string;
        }>, "many">;
        /** Detailed findings: what works, what's missing, what's blocked. */
        details: z.ZodString;
        /** Specific recommended actions for retry or escalation. */
        recommendation: z.ZodString;
        /** ISO 8601 timestamp when the review was produced. */
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        details: string;
        verdict: "PASS" | "FAIL" | "BLOCKED";
        tasksVerified: {
            status: "blocked" | "pass" | "fail";
            taskId: string;
            details: string;
        }[];
        recommendation: string;
        createdAt: string;
    }, {
        details: string;
        verdict: "PASS" | "FAIL" | "BLOCKED";
        tasksVerified: {
            status: "blocked" | "pass" | "fail";
            taskId: string;
            details: string;
        }[];
        recommendation: string;
        createdAt: string;
    }>>;
    /** Total accumulated cost in USD for this node (including retries). */
    cost: z.ZodNumber;
    /** ISO 8601 timestamp when the node started running, or null. */
    startedAt: z.ZodNullable<z.ZodString>;
    /** ISO 8601 timestamp when the node finished, or null. */
    completedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
    id: string;
    cost: number;
    title: string;
    instructions: string;
    delay: string;
    resumeAt: string | null;
    agents: {
        status: "running" | "failed" | "created" | "completed";
        id: string;
        role: "loom" | "loomi" | "looma" | "loomex";
        model: string;
        writeScope: string[];
        taskDescription: string;
        tokenUsage: {
            input: number;
            output: number;
        };
        cost: number;
    }[];
    fileOwnership: Record<string, string[]>;
    retryCount: number;
    maxRetries: number;
    reviewReport: {
        details: string;
        verdict: "PASS" | "FAIL" | "BLOCKED";
        tasksVerified: {
            status: "blocked" | "pass" | "fail";
            taskId: string;
            details: string;
        }[];
        recommendation: string;
        createdAt: string;
    } | null;
    startedAt: string | null;
    completedAt: string | null;
}, {
    status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
    id: string;
    cost: number;
    title: string;
    instructions: string;
    delay: string;
    resumeAt: string | null;
    agents: {
        status: "running" | "failed" | "created" | "completed";
        id: string;
        role: "loom" | "loomi" | "looma" | "loomex";
        model: string;
        writeScope: string[];
        taskDescription: string;
        tokenUsage: {
            input: number;
            output: number;
        };
        cost: number;
    }[];
    fileOwnership: Record<string, string[]>;
    retryCount: number;
    maxRetries: number;
    reviewReport: {
        details: string;
        verdict: "PASS" | "FAIL" | "BLOCKED";
        tasksVerified: {
            status: "blocked" | "pass" | "fail";
            taskId: string;
            details: string;
        }[];
        recommendation: string;
        createdAt: string;
    } | null;
    startedAt: string | null;
    completedAt: string | null;
}>;
/** A workflow node representing one major step in the execution graph. */
type Node = z.infer<typeof NodeSchema>;
/** Zod schema for the directed execution graph. Uses z.record for JSON serialization. */
declare const GraphSchema: z.ZodObject<{
    /** All nodes keyed by node ID. */
    nodes: z.ZodRecord<z.ZodString, z.ZodObject<{
        /** Unique node identifier (e.g., "node-1"). */
        id: z.ZodString;
        /** Human-readable node name (e.g., "Setup Authentication"). */
        title: z.ZodString;
        /** Current node execution state. */
        status: z.ZodEnum<["pending", "waiting", "running", "review", "done", "failed", "blocked"]>;
        /** Markdown instructions for this node. */
        instructions: z.ZodString;
        /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
        delay: z.ZodString;
        /** ISO 8601 timestamp when the delay expires, or null. */
        resumeAt: z.ZodNullable<z.ZodString>;
        /** Agents assigned to this node. */
        agents: z.ZodArray<z.ZodObject<{
            /** Unique agent identifier (e.g., "looma-auth-1"). */
            id: z.ZodString;
            /** Agent role in the workflow. */
            role: z.ZodEnum<["loom", "loomi", "looma", "loomex"]>;
            /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
            model: z.ZodString;
            /** Current agent lifecycle state. */
            status: z.ZodEnum<["created", "running", "completed", "failed"]>;
            /** Glob patterns defining the agent's file write permissions. */
            writeScope: z.ZodArray<z.ZodString, "many">;
            /** Description of the agent's assigned task. */
            taskDescription: z.ZodString;
            /** Cumulative token usage for this agent's LLM calls. */
            tokenUsage: z.ZodObject<{
                /** Number of input tokens consumed. */
                input: z.ZodNumber;
                /** Number of output tokens produced. */
                output: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                input: number;
                output: number;
            }, {
                input: number;
                output: number;
            }>;
            /** Cumulative cost in USD for this agent's LLM calls. */
            cost: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            status: "running" | "failed" | "created" | "completed";
            id: string;
            role: "loom" | "loomi" | "looma" | "loomex";
            model: string;
            writeScope: string[];
            taskDescription: string;
            tokenUsage: {
                input: number;
                output: number;
            };
            cost: number;
        }, {
            status: "running" | "failed" | "created" | "completed";
            id: string;
            role: "loom" | "loomi" | "looma" | "loomex";
            model: string;
            writeScope: string[];
            taskDescription: string;
            tokenUsage: {
                input: number;
                output: number;
            };
            cost: number;
        }>, "many">;
        /** Agent ID to glob patterns mapping for write scope enforcement. */
        fileOwnership: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
        /** Number of retry cycles attempted. */
        retryCount: z.ZodNumber;
        /** Maximum allowed retry cycles (from config). */
        maxRetries: z.ZodNumber;
        /** Loomex review report, or null if no review has run. */
        reviewReport: z.ZodNullable<z.ZodObject<{
            /** Overall review verdict. */
            verdict: z.ZodEnum<["PASS", "FAIL", "BLOCKED"]>;
            /** Per-task verification results. */
            tasksVerified: z.ZodArray<z.ZodObject<{
                /** Identifier of the verified task. */
                taskId: z.ZodString;
                /** Task-level verification result. */
                status: z.ZodEnum<["pass", "fail", "blocked"]>;
                /** Explanation of what was found during verification. */
                details: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }, {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }>, "many">;
            /** Detailed findings: what works, what's missing, what's blocked. */
            details: z.ZodString;
            /** Specific recommended actions for retry or escalation. */
            recommendation: z.ZodString;
            /** ISO 8601 timestamp when the review was produced. */
            createdAt: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            details: string;
            verdict: "PASS" | "FAIL" | "BLOCKED";
            tasksVerified: {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }[];
            recommendation: string;
            createdAt: string;
        }, {
            details: string;
            verdict: "PASS" | "FAIL" | "BLOCKED";
            tasksVerified: {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }[];
            recommendation: string;
            createdAt: string;
        }>>;
        /** Total accumulated cost in USD for this node (including retries). */
        cost: z.ZodNumber;
        /** ISO 8601 timestamp when the node started running, or null. */
        startedAt: z.ZodNullable<z.ZodString>;
        /** ISO 8601 timestamp when the node finished, or null. */
        completedAt: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
        id: string;
        cost: number;
        title: string;
        instructions: string;
        delay: string;
        resumeAt: string | null;
        agents: {
            status: "running" | "failed" | "created" | "completed";
            id: string;
            role: "loom" | "loomi" | "looma" | "loomex";
            model: string;
            writeScope: string[];
            taskDescription: string;
            tokenUsage: {
                input: number;
                output: number;
            };
            cost: number;
        }[];
        fileOwnership: Record<string, string[]>;
        retryCount: number;
        maxRetries: number;
        reviewReport: {
            details: string;
            verdict: "PASS" | "FAIL" | "BLOCKED";
            tasksVerified: {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }[];
            recommendation: string;
            createdAt: string;
        } | null;
        startedAt: string | null;
        completedAt: string | null;
    }, {
        status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
        id: string;
        cost: number;
        title: string;
        instructions: string;
        delay: string;
        resumeAt: string | null;
        agents: {
            status: "running" | "failed" | "created" | "completed";
            id: string;
            role: "loom" | "loomi" | "looma" | "loomex";
            model: string;
            writeScope: string[];
            taskDescription: string;
            tokenUsage: {
                input: number;
                output: number;
            };
            cost: number;
        }[];
        fileOwnership: Record<string, string[]>;
        retryCount: number;
        maxRetries: number;
        reviewReport: {
            details: string;
            verdict: "PASS" | "FAIL" | "BLOCKED";
            tasksVerified: {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }[];
            recommendation: string;
            createdAt: string;
        } | null;
        startedAt: string | null;
        completedAt: string | null;
    }>>;
    /** Directed edges connecting nodes. */
    edges: z.ZodArray<z.ZodObject<{
        /** Source node ID. */
        from: z.ZodString;
        /** Target node ID. */
        to: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        from: string;
        to: string;
    }, {
        from: string;
        to: string;
    }>, "many">;
    /** Graph topology classification. */
    topology: z.ZodEnum<["linear", "divergent", "convergent", "tree", "mixed"]>;
}, "strip", z.ZodTypeAny, {
    nodes: Record<string, {
        status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
        id: string;
        cost: number;
        title: string;
        instructions: string;
        delay: string;
        resumeAt: string | null;
        agents: {
            status: "running" | "failed" | "created" | "completed";
            id: string;
            role: "loom" | "loomi" | "looma" | "loomex";
            model: string;
            writeScope: string[];
            taskDescription: string;
            tokenUsage: {
                input: number;
                output: number;
            };
            cost: number;
        }[];
        fileOwnership: Record<string, string[]>;
        retryCount: number;
        maxRetries: number;
        reviewReport: {
            details: string;
            verdict: "PASS" | "FAIL" | "BLOCKED";
            tasksVerified: {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }[];
            recommendation: string;
            createdAt: string;
        } | null;
        startedAt: string | null;
        completedAt: string | null;
    }>;
    edges: {
        from: string;
        to: string;
    }[];
    topology: "linear" | "divergent" | "convergent" | "tree" | "mixed";
}, {
    nodes: Record<string, {
        status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
        id: string;
        cost: number;
        title: string;
        instructions: string;
        delay: string;
        resumeAt: string | null;
        agents: {
            status: "running" | "failed" | "created" | "completed";
            id: string;
            role: "loom" | "loomi" | "looma" | "loomex";
            model: string;
            writeScope: string[];
            taskDescription: string;
            tokenUsage: {
                input: number;
                output: number;
            };
            cost: number;
        }[];
        fileOwnership: Record<string, string[]>;
        retryCount: number;
        maxRetries: number;
        reviewReport: {
            details: string;
            verdict: "PASS" | "FAIL" | "BLOCKED";
            tasksVerified: {
                status: "blocked" | "pass" | "fail";
                taskId: string;
                details: string;
            }[];
            recommendation: string;
            createdAt: string;
        } | null;
        startedAt: string | null;
        completedAt: string | null;
    }>;
    edges: {
        from: string;
        to: string;
    }[];
    topology: "linear" | "divergent" | "convergent" | "tree" | "mixed";
}>;
/** The directed acyclic graph defining workflow execution topology. */
type Graph = z.infer<typeof GraphSchema>;

/** Zod schema for the top-level workflow entity. */
declare const WorkflowSchema: z.ZodObject<{
    /** Unique workflow identifier. */
    id: z.ZodString;
    /** Current workflow lifecycle state. */
    status: z.ZodEnum<["init", "spec", "building", "running", "paused", "done", "failed"]>;
    /** Original natural language project description. */
    description: z.ZodString;
    /** Absolute path to the project workspace. */
    projectPath: z.ZodString;
    /** The directed execution graph. */
    graph: z.ZodObject<{
        /** All nodes keyed by node ID. */
        nodes: z.ZodRecord<z.ZodString, z.ZodObject<{
            /** Unique node identifier (e.g., "node-1"). */
            id: z.ZodString;
            /** Human-readable node name (e.g., "Setup Authentication"). */
            title: z.ZodString;
            /** Current node execution state. */
            status: z.ZodEnum<["pending", "waiting", "running", "review", "done", "failed", "blocked"]>;
            /** Markdown instructions for this node. */
            instructions: z.ZodString;
            /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
            delay: z.ZodString;
            /** ISO 8601 timestamp when the delay expires, or null. */
            resumeAt: z.ZodNullable<z.ZodString>;
            /** Agents assigned to this node. */
            agents: z.ZodArray<z.ZodObject<{
                /** Unique agent identifier (e.g., "looma-auth-1"). */
                id: z.ZodString;
                /** Agent role in the workflow. */
                role: z.ZodEnum<["loom", "loomi", "looma", "loomex"]>;
                /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
                model: z.ZodString;
                /** Current agent lifecycle state. */
                status: z.ZodEnum<["created", "running", "completed", "failed"]>;
                /** Glob patterns defining the agent's file write permissions. */
                writeScope: z.ZodArray<z.ZodString, "many">;
                /** Description of the agent's assigned task. */
                taskDescription: z.ZodString;
                /** Cumulative token usage for this agent's LLM calls. */
                tokenUsage: z.ZodObject<{
                    /** Number of input tokens consumed. */
                    input: z.ZodNumber;
                    /** Number of output tokens produced. */
                    output: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    input: number;
                    output: number;
                }, {
                    input: number;
                    output: number;
                }>;
                /** Cumulative cost in USD for this agent's LLM calls. */
                cost: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }, {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }>, "many">;
            /** Agent ID to glob patterns mapping for write scope enforcement. */
            fileOwnership: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
            /** Number of retry cycles attempted. */
            retryCount: z.ZodNumber;
            /** Maximum allowed retry cycles (from config). */
            maxRetries: z.ZodNumber;
            /** Loomex review report, or null if no review has run. */
            reviewReport: z.ZodNullable<z.ZodObject<{
                /** Overall review verdict. */
                verdict: z.ZodEnum<["PASS", "FAIL", "BLOCKED"]>;
                /** Per-task verification results. */
                tasksVerified: z.ZodArray<z.ZodObject<{
                    /** Identifier of the verified task. */
                    taskId: z.ZodString;
                    /** Task-level verification result. */
                    status: z.ZodEnum<["pass", "fail", "blocked"]>;
                    /** Explanation of what was found during verification. */
                    details: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }, {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }>, "many">;
                /** Detailed findings: what works, what's missing, what's blocked. */
                details: z.ZodString;
                /** Specific recommended actions for retry or escalation. */
                recommendation: z.ZodString;
                /** ISO 8601 timestamp when the review was produced. */
                createdAt: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            }, {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            }>>;
            /** Total accumulated cost in USD for this node (including retries). */
            cost: z.ZodNumber;
            /** ISO 8601 timestamp when the node started running, or null. */
            startedAt: z.ZodNullable<z.ZodString>;
            /** ISO 8601 timestamp when the node finished, or null. */
            completedAt: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
            id: string;
            cost: number;
            title: string;
            instructions: string;
            delay: string;
            resumeAt: string | null;
            agents: {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }[];
            fileOwnership: Record<string, string[]>;
            retryCount: number;
            maxRetries: number;
            reviewReport: {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            } | null;
            startedAt: string | null;
            completedAt: string | null;
        }, {
            status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
            id: string;
            cost: number;
            title: string;
            instructions: string;
            delay: string;
            resumeAt: string | null;
            agents: {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }[];
            fileOwnership: Record<string, string[]>;
            retryCount: number;
            maxRetries: number;
            reviewReport: {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            } | null;
            startedAt: string | null;
            completedAt: string | null;
        }>>;
        /** Directed edges connecting nodes. */
        edges: z.ZodArray<z.ZodObject<{
            /** Source node ID. */
            from: z.ZodString;
            /** Target node ID. */
            to: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            from: string;
            to: string;
        }, {
            from: string;
            to: string;
        }>, "many">;
        /** Graph topology classification. */
        topology: z.ZodEnum<["linear", "divergent", "convergent", "tree", "mixed"]>;
    }, "strip", z.ZodTypeAny, {
        nodes: Record<string, {
            status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
            id: string;
            cost: number;
            title: string;
            instructions: string;
            delay: string;
            resumeAt: string | null;
            agents: {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }[];
            fileOwnership: Record<string, string[]>;
            retryCount: number;
            maxRetries: number;
            reviewReport: {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            } | null;
            startedAt: string | null;
            completedAt: string | null;
        }>;
        edges: {
            from: string;
            to: string;
        }[];
        topology: "linear" | "divergent" | "convergent" | "tree" | "mixed";
    }, {
        nodes: Record<string, {
            status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
            id: string;
            cost: number;
            title: string;
            instructions: string;
            delay: string;
            resumeAt: string | null;
            agents: {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }[];
            fileOwnership: Record<string, string[]>;
            retryCount: number;
            maxRetries: number;
            reviewReport: {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            } | null;
            startedAt: string | null;
            completedAt: string | null;
        }>;
        edges: {
            from: string;
            to: string;
        }[];
        topology: "linear" | "divergent" | "convergent" | "tree" | "mixed";
    }>;
    /** Merged configuration (global + project + CLI). */
    config: z.ZodObject<{
        level: z.ZodDefault<z.ZodUnion<[z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>, z.ZodLiteral<"custom">]>>;
        defaultDelay: z.ZodDefault<z.ZodString>;
        reviewerEnabled: z.ZodDefault<z.ZodBoolean>;
        maxRetriesPerNode: z.ZodDefault<z.ZodNumber>;
        maxRetriesPerTask: z.ZodDefault<z.ZodNumber>;
        maxLoomasPerLoomi: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        retryStrategy: z.ZodDefault<z.ZodUnion<[z.ZodLiteral<"adaptive">, z.ZodLiteral<"same">]>>;
        models: z.ZodDefault<z.ZodObject<{
            loom: z.ZodDefault<z.ZodString>;
            loomi: z.ZodDefault<z.ZodString>;
            looma: z.ZodDefault<z.ZodString>;
            loomex: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            loom: string;
            loomi: string;
            looma: string;
            loomex: string;
        }, {
            loom?: string | undefined;
            loomi?: string | undefined;
            looma?: string | undefined;
            loomex?: string | undefined;
        }>>;
        provider: z.ZodDefault<z.ZodString>;
        budgetLimit: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        pauseOnBudgetReached: z.ZodDefault<z.ZodBoolean>;
        sandboxCommands: z.ZodDefault<z.ZodBoolean>;
        allowNetwork: z.ZodDefault<z.ZodBoolean>;
        dashboardPort: z.ZodDefault<z.ZodNumber>;
        dashboardAutoOpen: z.ZodDefault<z.ZodBoolean>;
        agentTimeout: z.ZodDefault<z.ZodNumber>;
        agentTokenLimit: z.ZodDefault<z.ZodNumber>;
        apiRateLimit: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        level: 1 | 2 | "custom" | 3;
        defaultDelay: string;
        reviewerEnabled: boolean;
        maxRetriesPerNode: number;
        maxRetriesPerTask: number;
        maxLoomasPerLoomi: number | null;
        retryStrategy: "adaptive" | "same";
        models: {
            loom: string;
            loomi: string;
            looma: string;
            loomex: string;
        };
        provider: string;
        budgetLimit: number | null;
        pauseOnBudgetReached: boolean;
        sandboxCommands: boolean;
        allowNetwork: boolean;
        dashboardPort: number;
        dashboardAutoOpen: boolean;
        agentTimeout: number;
        agentTokenLimit: number;
        apiRateLimit: number;
    }, {
        level?: 1 | 2 | "custom" | 3 | undefined;
        defaultDelay?: string | undefined;
        reviewerEnabled?: boolean | undefined;
        maxRetriesPerNode?: number | undefined;
        maxRetriesPerTask?: number | undefined;
        maxLoomasPerLoomi?: number | null | undefined;
        retryStrategy?: "adaptive" | "same" | undefined;
        models?: {
            loom?: string | undefined;
            loomi?: string | undefined;
            looma?: string | undefined;
            loomex?: string | undefined;
        } | undefined;
        provider?: string | undefined;
        budgetLimit?: number | null | undefined;
        pauseOnBudgetReached?: boolean | undefined;
        sandboxCommands?: boolean | undefined;
        allowNetwork?: boolean | undefined;
        dashboardPort?: number | undefined;
        dashboardAutoOpen?: boolean | undefined;
        agentTimeout?: number | undefined;
        agentTokenLimit?: number | undefined;
        apiRateLimit?: number | undefined;
    }>;
    /** ISO 8601 timestamp when the workflow was created. */
    createdAt: z.ZodString;
    /** ISO 8601 timestamp of the last state change. */
    updatedAt: z.ZodString;
    /** Accumulated cost in USD across all nodes. */
    totalCost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "init" | "spec" | "building" | "running" | "paused" | "done" | "failed";
    projectPath: string;
    id: string;
    description: string;
    createdAt: string;
    graph: {
        nodes: Record<string, {
            status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
            id: string;
            cost: number;
            title: string;
            instructions: string;
            delay: string;
            resumeAt: string | null;
            agents: {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }[];
            fileOwnership: Record<string, string[]>;
            retryCount: number;
            maxRetries: number;
            reviewReport: {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            } | null;
            startedAt: string | null;
            completedAt: string | null;
        }>;
        edges: {
            from: string;
            to: string;
        }[];
        topology: "linear" | "divergent" | "convergent" | "tree" | "mixed";
    };
    config: {
        level: 1 | 2 | "custom" | 3;
        defaultDelay: string;
        reviewerEnabled: boolean;
        maxRetriesPerNode: number;
        maxRetriesPerTask: number;
        maxLoomasPerLoomi: number | null;
        retryStrategy: "adaptive" | "same";
        models: {
            loom: string;
            loomi: string;
            looma: string;
            loomex: string;
        };
        provider: string;
        budgetLimit: number | null;
        pauseOnBudgetReached: boolean;
        sandboxCommands: boolean;
        allowNetwork: boolean;
        dashboardPort: number;
        dashboardAutoOpen: boolean;
        agentTimeout: number;
        agentTokenLimit: number;
        apiRateLimit: number;
    };
    updatedAt: string;
    totalCost: number;
}, {
    status: "init" | "spec" | "building" | "running" | "paused" | "done" | "failed";
    projectPath: string;
    id: string;
    description: string;
    createdAt: string;
    graph: {
        nodes: Record<string, {
            status: "running" | "done" | "failed" | "pending" | "waiting" | "review" | "blocked";
            id: string;
            cost: number;
            title: string;
            instructions: string;
            delay: string;
            resumeAt: string | null;
            agents: {
                status: "running" | "failed" | "created" | "completed";
                id: string;
                role: "loom" | "loomi" | "looma" | "loomex";
                model: string;
                writeScope: string[];
                taskDescription: string;
                tokenUsage: {
                    input: number;
                    output: number;
                };
                cost: number;
            }[];
            fileOwnership: Record<string, string[]>;
            retryCount: number;
            maxRetries: number;
            reviewReport: {
                details: string;
                verdict: "PASS" | "FAIL" | "BLOCKED";
                tasksVerified: {
                    status: "blocked" | "pass" | "fail";
                    taskId: string;
                    details: string;
                }[];
                recommendation: string;
                createdAt: string;
            } | null;
            startedAt: string | null;
            completedAt: string | null;
        }>;
        edges: {
            from: string;
            to: string;
        }[];
        topology: "linear" | "divergent" | "convergent" | "tree" | "mixed";
    };
    config: {
        level?: 1 | 2 | "custom" | 3 | undefined;
        defaultDelay?: string | undefined;
        reviewerEnabled?: boolean | undefined;
        maxRetriesPerNode?: number | undefined;
        maxRetriesPerTask?: number | undefined;
        maxLoomasPerLoomi?: number | null | undefined;
        retryStrategy?: "adaptive" | "same" | undefined;
        models?: {
            loom?: string | undefined;
            loomi?: string | undefined;
            looma?: string | undefined;
            loomex?: string | undefined;
        } | undefined;
        provider?: string | undefined;
        budgetLimit?: number | null | undefined;
        pauseOnBudgetReached?: boolean | undefined;
        sandboxCommands?: boolean | undefined;
        allowNetwork?: boolean | undefined;
        dashboardPort?: number | undefined;
        dashboardAutoOpen?: boolean | undefined;
        agentTimeout?: number | undefined;
        agentTokenLimit?: number | undefined;
        apiRateLimit?: number | undefined;
    };
    updatedAt: string;
    totalCost: number;
}>;
/** The top-level workflow entity representing a project being built. */
type Workflow = z.infer<typeof WorkflowSchema>;

/** Configuration options for the daemon. */
interface DaemonConfig {
    /** TCP port to listen on. Defaults to 3000. */
    port?: number;
    /** Host address to bind to. Defaults to '127.0.0.1'. */
    host?: string;
    /** Absolute path to the project workspace. */
    projectPath?: string;
}
/**
 * Callback interface for graceful shutdown coordination.
 *
 * The daemon does not own workflow state directly — the caller provides
 * these hooks so the daemon can coordinate an orderly shutdown with
 * the execution engine.
 */
interface ShutdownHooks {
    /** Stop dispatching new agent LLM calls. Called first during shutdown. */
    stopDispatching: () => void;
    /**
     * Wait for all currently in-flight LLM calls to complete.
     * Resolves when no more active calls remain.
     */
    waitForActiveCalls: () => Promise<void>;
    /**
     * Return the current in-memory workflow state for persistence,
     * or `null` if no active workflow exists.
     */
    getWorkflow: () => Workflow | null;
    /**
     * Mark any currently running nodes as interrupted in the workflow.
     * Returns the IDs of nodes that were marked.
     */
    markNodesInterrupted: () => string[];
}
/** Runtime information about a running daemon instance. */
interface DaemonInfo {
    /** TCP port the daemon is listening on. */
    port: number;
    /** Host address the daemon is bound to. */
    host: string;
    /** Cryptographic auth token for API access. */
    token: string;
    /** Process ID of the daemon. */
    pid: number;
}
/**
 * Manages the Loomflo daemon lifecycle: Fastify server start/stop,
 * auth token generation, daemon.json persistence, and graceful shutdown.
 */
declare class Daemon {
    private readonly port;
    private readonly host;
    private readonly projectPath;
    private server;
    private info;
    private shutdownHooks;
    private shuttingDown;
    /**
     * Create a new Daemon instance.
     *
     * @param config - Daemon configuration options.
     */
    constructor(config: DaemonConfig);
    /**
     * Register shutdown hooks for graceful shutdown coordination.
     *
     * These hooks allow the daemon to coordinate with the execution engine
     * during shutdown: stop dispatching new calls, wait for active calls,
     * mark interrupted nodes, and persist final state.
     *
     * @param hooks - Callback interface for shutdown coordination.
     */
    setShutdownHooks(hooks: ShutdownHooks): void;
    /**
     * Whether the daemon is currently in the process of shutting down.
     *
     * @returns True if graceful shutdown has been initiated.
     */
    get isShuttingDown(): boolean;
    /**
     * Start the Fastify server and write daemon.json.
     *
     * Generates a cryptographic auth token, creates the Fastify instance,
     * starts listening on host:port, and persists runtime info to
     * `~/.loomflo/daemon.json` with restricted file permissions (0o600).
     *
     * @returns Runtime information about the started daemon.
     * @throws If the server is already running or fails to start.
     */
    start(): Promise<DaemonInfo>;
    /**
     * Stop the daemon immediately.
     *
     * Flushes any pending state writes, closes the Fastify server,
     * and removes `~/.loomflo/daemon.json`. Does NOT wait for active
     * agent calls to finish. Use {@link gracefulShutdown} for orderly shutdown.
     */
    stop(): Promise<void>;
    /**
     * Gracefully shut down the daemon with full state preservation.
     *
     * Performs the following steps in order:
     * 1. Stops dispatching new agent LLM calls.
     * 2. Waits for all currently in-flight LLM calls to complete
     *    (or until the timeout is reached).
     * 3. Marks any running nodes as interrupted in the workflow state.
     * 4. Logs interruption events to events.jsonl.
     * 5. Saves the final workflow.json state immediately (no debounce).
     * 6. Flushes all pending writes.
     * 7. Closes the Fastify server.
     * 8. Removes daemon.json.
     *
     * If no shutdown hooks are registered, falls back to {@link stop}.
     *
     * @param timeoutMs - Maximum time to wait for active calls in milliseconds.
     *   Defaults to 30 seconds.
     */
    gracefulShutdown(timeoutMs?: number): Promise<void>;
    /**
     * Get runtime information about the daemon if it is running.
     *
     * @returns The daemon info, or null if the daemon is not running.
     */
    getInfo(): DaemonInfo | null;
    /**
     * Check whether the daemon is currently running.
     *
     * @returns True if the daemon server is active.
     */
    isRunning(): boolean;
}
/**
 * Load daemon runtime info from `~/.loomflo/daemon.json`.
 *
 * Reads and parses the file. Returns `null` if the file does not exist.
 *
 * @returns The daemon info, or null if no daemon info file is found.
 * @throws If the file contains invalid JSON.
 */
declare function loadDaemonInfo(): Promise<DaemonInfo | null>;

/**
 * Load workflow state from `{projectPath}/.loomflo/workflow.json`.
 *
 * Reads the file, parses JSON, and validates the data against {@link WorkflowSchema}.
 * Returns `null` if the file does not exist. Throws a descriptive error if the
 * file contains invalid JSON or fails schema validation.
 *
 * @param projectPath - Absolute path to the project root.
 * @returns The validated workflow state, or `null` if no state file exists.
 * @throws If the file contains invalid JSON or fails zod validation.
 */
declare function loadWorkflowState(projectPath: string): Promise<Workflow | null>;
/**
 * Save workflow state to `{projectPath}/.loomflo/workflow.json` with debounced writes.
 *
 * Multiple calls within {@link DEBOUNCE_MS}ms are coalesced — only the last
 * workflow state is written. The returned promise resolves once the write completes.
 *
 * Uses atomic writes (temp file + rename) to prevent corruption.
 *
 * @param projectPath - Absolute path to the project root.
 * @param workflow - The workflow state to persist.
 * @returns A promise that resolves when the debounced write completes.
 */
declare function saveWorkflowState(projectPath: string, workflow: Workflow): Promise<void>;
/**
 * Force an immediate write of the workflow state, bypassing the debounce timer.
 *
 * If a debounced write is pending for this project path, it is cancelled and the
 * provided workflow is written immediately instead. Useful for graceful shutdown.
 *
 * Uses atomic writes (temp file + rename) to prevent corruption.
 *
 * @param projectPath - Absolute path to the project root.
 * @param workflow - The workflow state to persist.
 */
declare function saveWorkflowStateImmediate(projectPath: string, workflow: Workflow): Promise<void>;
/**
 * Flush all pending debounced writes across all project paths.
 *
 * Waits for every pending write to complete. Useful for graceful shutdown
 * to ensure no state is lost.
 *
 * @returns A promise that resolves when all pending writes are flushed.
 */
declare function flushPendingWrites(): Promise<void>;
/**
 * Result of verifying consistency between workflow.json and events.jsonl.
 *
 * @property valid - Whether the workflow state is fully consistent with the event log.
 * @property issues - Human-readable descriptions of each detected inconsistency.
 * @property recoverable - Whether all detected issues can be auto-fixed by {@link repairState}.
 */
interface VerificationResult {
    /** Whether the workflow state is fully consistent with the event log. */
    valid: boolean;
    /** Human-readable descriptions of each detected inconsistency. */
    issues: string[];
    /** Whether all detected issues can be auto-fixed by {@link repairState}. */
    recoverable: boolean;
}
/**
 * Cross-check workflow.json against events.jsonl for consistency and detect corruption.
 *
 * Loads the persisted workflow state and the full event log, then verifies:
 * 1. The workflow exists in both sources.
 * 2. Node statuses in workflow.json match the last node-level event for each node.
 * 3. Nodes marked as 'done' have a corresponding `node_completed` event.
 * 4. Corruption in workflow.json (missing file, invalid JSON, schema failure) is reported
 *    as a non-recoverable issue.
 *
 * @param projectPath - Absolute path to the project root.
 * @returns A {@link VerificationResult} describing any inconsistencies found.
 */
declare function verifyStateConsistency(projectPath: string): Promise<VerificationResult>;
/**
 * Attempt to repair recoverable inconsistencies between workflow.json and events.jsonl.
 *
 * Updates node statuses in workflow.json to match the latest events in events.jsonl.
 * Only fixes status mismatches — non-recoverable issues (missing workflow, event log
 * referencing a different workflow) are not addressed.
 *
 * @param projectPath - Absolute path to the project root.
 * @returns A {@link VerificationResult} reflecting the state after repair.
 */
declare function repairState(projectPath: string): Promise<VerificationResult>;

/** Filters for querying events from the event log. */
interface EventQueryFilters {
    /** Filter by one or more event types. */
    type?: EventType | EventType[];
    /** Filter by node ID. */
    nodeId?: string;
    /** Filter by agent ID. */
    agentId?: string;
    /** ISO 8601 timestamp — include events at or after this time. */
    after?: string;
    /** ISO 8601 timestamp — exclude events at or after this time. */
    before?: string;
    /** Maximum number of results, taken from the end of the log. */
    limit?: number;
}
/** Parameters for creating a new event via the factory function. */
interface CreateEventParams {
    /** Event type identifier. */
    type: EventType;
    /** Workflow this event belongs to. */
    workflowId: string;
    /** Node this event relates to, or null/undefined for workflow-level events. */
    nodeId?: string | null;
    /** Agent this event relates to, or null/undefined for node/workflow-level events. */
    agentId?: string | null;
    /** Event-specific payload data. */
    details?: Record<string, unknown>;
}
/**
 * Create a valid Event object with the current timestamp.
 *
 * @param params - Event creation parameters.
 * @returns A fully populated Event object ready for persistence.
 */
declare function createEvent(params: CreateEventParams): Event;
/**
 * Append a single event as one JSON line to the project's events.jsonl file.
 *
 * Creates the .loomflo/ directory and events.jsonl file if they do not exist.
 * Uses append mode so concurrent writes each produce a complete line.
 *
 * @param projectPath - Absolute path to the project workspace.
 * @param event - The event to persist.
 */
declare function appendEvent(projectPath: string, event: Event): Promise<void>;
/**
 * Read and filter events from the project's events.jsonl file.
 *
 * Parses each line independently, validates against EventSchema, and applies
 * optional filters. Malformed lines are skipped with a warning logged to stderr.
 *
 * @param projectPath - Absolute path to the project workspace.
 * @param filters - Optional filters to narrow the result set.
 * @returns Array of matching Event objects in log order.
 */
declare function queryEvents(projectPath: string, filters?: EventQueryFilters): Promise<Event[]>;

/** Zod schema for the role field of an LLM conversation message. */
declare const LLMMessageRoleSchema: z.ZodEnum<["user", "assistant"]>;
/** Role of an LLM conversation message. */
type LLMMessageRole = z.infer<typeof LLMMessageRoleSchema>;
/**
 * Zod schema for a single message in an LLM conversation.
 *
 * Content can be a plain string (convenience for simple text messages)
 * or an array of ContentBlock for structured content including tool
 * invocations and results.
 */
declare const LLMMessageSchema: z.ZodObject<{
    /** Message author: 'user' for human/system input, 'assistant' for LLM output. */
    role: z.ZodEnum<["user", "assistant"]>;
    /** Message content: plain string or structured content blocks. */
    content: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"tool_use">;
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    }, {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"tool_result">;
        toolUseId: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "tool_result";
        toolUseId: string;
        content: string;
    }, {
        type: "tool_result";
        toolUseId: string;
        content: string;
    }>]>, "many">]>;
}, "strip", z.ZodTypeAny, {
    content: string | ({
        type: "text";
        text: string;
    } | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    } | {
        type: "tool_result";
        toolUseId: string;
        content: string;
    })[];
    role: "user" | "assistant";
}, {
    content: string | ({
        type: "text";
        text: string;
    } | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
    } | {
        type: "tool_result";
        toolUseId: string;
        content: string;
    })[];
    role: "user" | "assistant";
}>;
/** A single message in an LLM conversation history. */
type LLMMessage = z.infer<typeof LLMMessageSchema>;
/**
 * Zod schema for provider-specific configuration.
 *
 * Contains connection details needed to initialize an LLM provider.
 * Each provider implementation reads only the fields it needs;
 * unknown fields are passed through to support provider-specific options.
 */
declare const ProviderConfigSchema: z.ZodObject<{
    /** API key for authentication (e.g., ANTHROPIC_API_KEY value). */
    apiKey: z.ZodString;
    /** Base URL override for the provider API (e.g., custom proxy or local endpoint). */
    baseUrl: z.ZodOptional<z.ZodString>;
    /** Default model identifier (e.g., "claude-sonnet-4-6", "gpt-4o"). */
    defaultModel: z.ZodOptional<z.ZodString>;
    /** Default maximum tokens for completions. */
    defaultMaxTokens: z.ZodOptional<z.ZodNumber>;
    /** Additional provider-specific options passed through without validation. */
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    apiKey: string;
    options?: Record<string, unknown> | undefined;
    baseUrl?: string | undefined;
    defaultModel?: string | undefined;
    defaultMaxTokens?: number | undefined;
}, {
    apiKey: string;
    options?: Record<string, unknown> | undefined;
    baseUrl?: string | undefined;
    defaultModel?: string | undefined;
    defaultMaxTokens?: number | undefined;
}>;
/** Configuration for initializing an LLM provider. */
type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
/**
 * Zod schema for the parameters accepted by LLMProvider.complete().
 *
 * Defines a provider-agnostic completion request. Each provider
 * implementation translates these params into its native API format.
 */
declare const CompletionParamsSchema: z.ZodObject<{
    /** Conversation message history sent to the LLM. */
    messages: z.ZodArray<z.ZodObject<{
        /** Message author: 'user' for human/system input, 'assistant' for LLM output. */
        role: z.ZodEnum<["user", "assistant"]>;
        /** Message content: plain string or structured content blocks. */
        content: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
        }, {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            toolUseId: z.ZodString;
            content: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "tool_result";
            toolUseId: string;
            content: string;
        }, {
            type: "tool_result";
            toolUseId: string;
            content: string;
        }>]>, "many">]>;
    }, "strip", z.ZodTypeAny, {
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
        } | {
            type: "tool_result";
            toolUseId: string;
            content: string;
        })[];
        role: "user" | "assistant";
    }, {
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
        } | {
            type: "tool_result";
            toolUseId: string;
            content: string;
        })[];
        role: "user" | "assistant";
    }>, "many">;
    /** System prompt providing instructions and context for the LLM. */
    system: z.ZodString;
    /** Tool definitions available for the LLM to invoke. */
    tools: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }, {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }>, "many">>;
    /** Model identifier to use for this completion (e.g., "claude-sonnet-4-6"). */
    model: z.ZodString;
    /** Maximum tokens the LLM may generate in its response. */
    maxTokens: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    model: string;
    messages: {
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
        } | {
            type: "tool_result";
            toolUseId: string;
            content: string;
        })[];
        role: "user" | "assistant";
    }[];
    system: string;
    tools?: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }[] | undefined;
    maxTokens?: number | undefined;
}, {
    model: string;
    messages: {
        content: string | ({
            type: "text";
            text: string;
        } | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
        } | {
            type: "tool_result";
            toolUseId: string;
            content: string;
        })[];
        role: "user" | "assistant";
    }[];
    system: string;
    tools?: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
    }[] | undefined;
    maxTokens?: number | undefined;
}>;
/** Parameters for a single LLM completion request. */
type CompletionParams = z.infer<typeof CompletionParamsSchema>;
/**
 * Abstract interface for LLM providers.
 *
 * All agent code interacts with LLMs exclusively through this interface.
 * Provider-specific SDK imports (e.g., @anthropic-ai/sdk, openai) are
 * confined to the concrete implementation files. Swapping providers
 * requires only a configuration change, not code modifications.
 *
 * Implementations must:
 * - Translate CompletionParams into the provider's native API format.
 * - Translate the provider's native response into a normalized LLMResponse.
 * - Propagate API errors as thrown exceptions (the agent loop handles them).
 *
 * @see AnthropicProvider for the reference implementation.
 */
interface LLMProvider {
    /**
     * Send a completion request to the LLM and return its response.
     *
     * @param params - Provider-agnostic completion parameters including
     *   conversation messages, system prompt, optional tool definitions,
     *   model identifier, and optional token limit.
     * @returns A normalized LLM response with content blocks, stop reason,
     *   token usage, and the model that produced the response.
     */
    complete(params: CompletionParams): Promise<z.infer<typeof LLMResponseSchema>>;
}

/**
 * Anthropic LLM provider implementation.
 *
 * This is the ONLY file in the codebase that imports @anthropic-ai/sdk.
 * All other code interacts with LLMs through the abstract LLMProvider
 * interface defined in base.ts. This isolation is mandated by
 * Constitution Principle IV (Provider Abstraction).
 *
 * @module providers/anthropic
 */

/**
 * LLM provider implementation for Anthropic's Claude models.
 *
 * Wraps the @anthropic-ai/sdk to translate between the provider-agnostic
 * CompletionParams/LLMResponse types and the Anthropic Messages API format.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicProvider({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   defaultModel: 'claude-sonnet-4-6',
 * });
 *
 * const response = await provider.complete({
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   system: 'You are a helpful assistant.',
 *   model: 'claude-sonnet-4-6',
 * });
 * ```
 */
declare class AnthropicProvider implements LLMProvider {
    private readonly client;
    private readonly defaultModel;
    private readonly defaultMaxTokens;
    /**
     * Creates an AnthropicProvider instance.
     *
     * @param config - Provider configuration. apiKey is required.
     *   Optional baseUrl overrides the API endpoint.
     *   Optional defaultModel sets the fallback model identifier.
     *   Optional defaultMaxTokens sets the fallback token limit.
     */
    constructor(config: ProviderConfig);
    /**
     * Sends a completion request to the Anthropic Messages API.
     *
     * Translates provider-agnostic CompletionParams into Anthropic's native
     * format, executes the API call, and normalizes the response into an
     * LLMResponse.
     *
     * @param params - Provider-agnostic completion parameters.
     * @returns Normalized LLM response with content blocks, stop reason,
     *   token usage, and model identifier.
     * @throws {Error} If the Anthropic API returns an error. The original
     *   error message is preserved in the thrown Error.
     */
    complete(params: CompletionParams): Promise<LLMResponse>;
}

/**
 * Stub OpenAI provider.
 *
 * Accepts the standard {@link ProviderConfig} but does not use it —
 * OpenAI integration is planned for a future release.
 */
declare class OpenAIProvider implements LLMProvider {
    /**
     * Always throws — OpenAI support is not yet implemented.
     *
     * @throws {Error} Always, indicating the provider is not yet supported.
     */
    complete(): never;
}

/**
 * Stub Ollama provider.
 *
 * Accepts the standard {@link ProviderConfig} but does not use it —
 * Ollama integration is planned for a future release.
 */
declare class OllamaProvider implements LLMProvider {
    /**
     * Always throws — Ollama support is not yet implemented.
     *
     * @throws {Error} Always, indicating the provider is not yet supported.
     */
    complete(): never;
}

/**
 * Execution context passed to a tool when invoked by an agent.
 *
 * Provides the tool with workspace location, caller identity, and
 * write permission boundaries so it can enforce security constraints.
 */
interface ToolContext {
    /** Absolute path to the project workspace root. */
    workspacePath: string;
    /** ID of the agent invoking this tool. */
    agentId: string;
    /** ID of the workflow node the invoking agent belongs to. */
    nodeId: string;
    /** Glob patterns defining which files the agent is allowed to write. */
    writeScope: string[];
}
/**
 * Interface for an executable tool available to agents.
 *
 * Tools are the primary mechanism for agents to interact with the outside
 * world (filesystem, shell, HTTP, etc.). Each tool declares its name,
 * description, and input schema (used for validation and LLM prompt
 * generation). The execute method MUST return a result string on success
 * or an error description string on failure — it MUST NEVER throw.
 */
interface Tool {
    /** Unique tool identifier (e.g., "read_file", "write_file", "shell_exec"). */
    readonly name: string;
    /** Human-readable description included in the LLM system prompt. */
    readonly description: string;
    /** Zod schema used to validate tool input before execution. */
    readonly inputSchema: z.ZodType<unknown>;
    /**
     * Execute the tool with validated input.
     *
     * @param input - The raw input from the LLM, validated against inputSchema before calling.
     * @param context - Execution context with workspace path, agent identity, and write scope.
     * @returns A string describing the result on success or the error on failure.
     *   This method MUST NEVER throw — all errors are returned as descriptive strings.
     */
    execute(input: unknown, context: ToolContext): Promise<string>;
}
/**
 * Convert a Zod schema to a JSON Schema object.
 *
 * Supports the subset of Zod types commonly used in tool input schemas:
 * string, number, boolean, object, array, enum, union, literal, optional,
 * nullable, and default. Unrecognized types fall back to an empty schema
 * (accepts any value).
 *
 * @param schema - The Zod schema to convert.
 * @returns A JSON Schema object suitable for serialization.
 */
declare function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown>;
/**
 * Convert a {@link Tool} to a JSON-serializable {@link ToolDefinition}.
 *
 * Extracts the tool's name and description, and converts its Zod input
 * schema to a JSON Schema object suitable for sending to an LLM provider.
 *
 * @param tool - The tool to convert.
 * @returns A ToolDefinition with name, description, and JSON Schema inputSchema.
 */
declare function toToolDefinition(tool: Tool): ToolDefinition;

/**
 * Configuration for a single agent loop execution.
 *
 * Defines everything the loop needs: the LLM provider, tools, constraints
 * (timeout, token budget), and identity context for tool execution.
 */
interface AgentLoopConfig {
    /** System prompt providing instructions and context for the agent. */
    systemPrompt: string;
    /** Tools available to the agent during execution. */
    tools: Tool[];
    /** LLM provider used for completion calls. */
    provider: LLMProvider;
    /** Model identifier to use (e.g., "claude-sonnet-4-6"). */
    model: string;
    /** Maximum tokens the LLM may generate per individual completion call. */
    maxTokens?: number;
    /** Wall-clock timeout in milliseconds. The loop aborts if exceeded. */
    timeout: number;
    /** Cumulative token limit (input + output) across all LLM calls. The loop aborts if exceeded. */
    tokenLimit: number;
    /** Unique agent identifier for tool context and logging. */
    agentId: string;
    /** Node identifier the agent belongs to. */
    nodeId: string;
    /** Absolute path to the project workspace root. */
    workspacePath: string;
    /** Glob patterns defining which files the agent may write. */
    writeScope: string[];
}
/** Completion status of an agent loop execution. */
type AgentLoopStatus = 'completed' | 'failed' | 'timeout' | 'token_limit';
/**
 * Result returned by {@link runAgentLoop} after execution completes.
 *
 * The loop never throws — all outcomes (success, failure, timeout, budget
 * exhaustion) are represented as structured results with an appropriate status.
 */
interface AgentLoopResult {
    /** Final text output from the agent, or empty string if none. */
    output: string;
    /** Cumulative token usage across all LLM calls in this loop. */
    tokenUsage: {
        input: number;
        output: number;
    };
    /** How the loop terminated. */
    status: AgentLoopStatus;
    /** Error description when status is 'failed', 'timeout', or 'token_limit'. */
    error?: string;
}
/**
 * Execute an agent loop: repeatedly call the LLM and process tool invocations
 * until the agent signals completion or a limit is reached.
 *
 * The loop:
 * 1. Sends the conversation to the LLM via the provider.
 * 2. If the LLM responds with tool_use blocks, executes each tool sequentially,
 *    appends the results, and loops back.
 * 3. If the LLM responds with end_turn, extracts the final text and returns.
 * 4. Enforces wall-clock timeout and cumulative token budget before each call.
 * 5. Caps iterations at {@link MAX_ITERATIONS} as a safety net.
 *
 * This function never throws. All error conditions produce an {@link AgentLoopResult}
 * with an appropriate status and error message.
 *
 * @param config - Agent loop configuration including provider, tools, and limits.
 * @param initialMessages - Optional conversation history to seed the loop with.
 * @returns Structured result with output text, token usage, and termination status.
 */
declare function runAgentLoop(config: AgentLoopConfig, initialMessages?: LLMMessage[]): Promise<AgentLoopResult>;

/**
 * Cost tracking module for Loomflo agent orchestration.
 *
 * Tracks per-call token usage and estimated cost, aggregates costs per node
 * and per agent, and enforces budget limits (FR-035 through FR-038).
 *
 * The tracker does NOT pause the workflow itself — it only tracks and reports.
 * The workflow engine queries {@link CostTracker.isBudgetExceeded} to decide.
 */
/** Pricing for a single LLM model in dollars per million tokens. */
interface ModelPricing {
    /** Price in USD per million input tokens. */
    inputPricePerMToken: number;
    /** Price in USD per million output tokens. */
    outputPricePerMToken: number;
}
/** Default pricing table for known models. */
declare const DEFAULT_PRICING: Record<string, ModelPricing>;
/** A single recorded LLM cost entry. */
interface CostEntry {
    /** LLM model identifier used for the call. */
    model: string;
    /** Number of input tokens consumed. */
    inputTokens: number;
    /** Number of output tokens produced. */
    outputTokens: number;
    /** Calculated cost in USD. */
    cost: number;
    /** Agent that made the call. */
    agentId: string;
    /** Node the agent belongs to. */
    nodeId: string;
    /** ISO 8601 timestamp of when the call was recorded. */
    timestamp: string;
}
/** Aggregated cost summary for the entire workflow. */
interface CostSummary {
    /** Total accumulated cost in USD. */
    totalCost: number;
    /** Cost in USD aggregated per node ID. */
    perNode: Record<string, number>;
    /** Cost in USD aggregated per agent ID. */
    perAgent: Record<string, number>;
    /** Configured budget limit in USD, or null if none set. */
    budgetLimit: number | null;
    /** Remaining budget in USD, or null if no limit is set. */
    budgetRemaining: number | null;
    /** All recorded cost entries. */
    entries: CostEntry[];
}
/**
 * Callback invoked after every {@link CostTracker.recordCall} with the
 * recorded entry and current aggregated cost state.
 *
 * @param entry - The cost entry that was just recorded.
 * @param nodeCost - Accumulated cost in USD for the entry's node after this call.
 * @param totalCost - Total accumulated cost in USD across all nodes after this call.
 * @param budgetRemaining - Remaining budget in USD, or null if no limit is set.
 */
type OnRecordCallback = (entry: CostEntry, nodeCost: number, totalCost: number, budgetRemaining: number | null) => void;
/**
 * Tracks token usage and estimated cost for every LLM call in a workflow.
 *
 * Maintains per-node and per-agent cost aggregation, uses a configurable
 * pricing table, and signals when a budget limit is exceeded.
 */
declare class CostTracker {
    private readonly pricing;
    private readonly entries;
    private readonly perNode;
    private readonly perAgent;
    private totalCost;
    private budgetLimit;
    private onRecordCallback;
    /**
     * Creates a new CostTracker instance.
     *
     * @param budgetLimit - Maximum allowed cost in USD, or null/undefined for no limit.
     * @param customPricing - Optional custom pricing table to merge with defaults.
     */
    constructor(budgetLimit?: number | null, customPricing?: Record<string, ModelPricing>);
    /**
     * Records an LLM call and calculates its cost.
     *
     * @param model - Model identifier used for the call.
     * @param inputTokens - Number of input tokens consumed.
     * @param outputTokens - Number of output tokens produced.
     * @param agentId - Agent that made the call.
     * @param nodeId - Node the agent belongs to.
     * @returns The recorded cost entry.
     */
    recordCall(model: string, inputTokens: number, outputTokens: number, agentId: string, nodeId: string): CostEntry;
    /**
     * Checks whether the configured budget limit has been exceeded.
     *
     * @returns `true` if a budget limit is set and total cost exceeds it, `false` otherwise.
     */
    isBudgetExceeded(): boolean;
    /**
     * Returns a full cost summary for the workflow.
     *
     * @returns Aggregated cost summary including per-node, per-agent, and budget info.
     */
    getSummary(): CostSummary;
    /**
     * Returns the total accumulated cost in USD.
     *
     * @returns Total cost across all recorded calls.
     */
    getTotalCost(): number;
    /**
     * Returns the accumulated cost for a specific node.
     *
     * @param nodeId - Node identifier to query.
     * @returns Cost in USD for the given node, or 0 if no calls recorded.
     */
    getNodeCost(nodeId: string): number;
    /**
     * Returns the accumulated cost for a specific agent.
     *
     * @param agentId - Agent identifier to query.
     * @returns Cost in USD for the given agent, or 0 if no calls recorded.
     */
    getAgentCost(agentId: string): number;
    /**
     * Updates the budget limit.
     *
     * @param limit - New budget limit in USD, or null to remove the limit.
     */
    setBudgetLimit(limit: number | null): void;
    /**
     * Registers a callback that fires after every {@link recordCall}.
     *
     * The daemon uses this to wire cost updates to the WebSocket broadcaster.
     * Pass `null` to remove a previously registered callback.
     *
     * @param callback - Function to invoke after each recorded call, or null to unregister.
     */
    setOnRecordCallback(callback: OnRecordCallback | null): void;
    /**
     * Returns recorded cost entries, optionally filtered by node ID.
     *
     * @param nodeId - If provided, only entries for this node are returned.
     * @returns Array of cost entries.
     */
    getEntries(nodeId?: string): CostEntry[];
}

/**
 * Shared memory manager for Loomflo agent orchestration.
 *
 * Manages append-only markdown files in `.loomflo/shared-memory/` that serve as
 * the cross-node state sharing mechanism. All writes are serialized per file
 * using async-mutex to prevent race conditions (Constitution Principles III, V).
 */

/** The 7 standard shared memory files managed by the daemon. */
declare const STANDARD_MEMORY_FILES: readonly string[];
/**
 * Manages shared memory files for cross-node state sharing.
 *
 * Files are append-only markdown documents stored in `.loomflo/shared-memory/`
 * relative to the workspace root. Each write is serialized per file using
 * async-mutex, ensuring no concurrent writes or race conditions.
 *
 * Read operations do not acquire the mutex — concurrent reads are safe.
 */
declare class SharedMemoryManager {
    private readonly memoryDir;
    private readonly mutexes;
    /**
     * Creates a new SharedMemoryManager instance.
     *
     * @param workspacePath - Absolute path to the project workspace root.
     */
    constructor(workspacePath: string);
    /**
     * Initializes the shared memory directory and standard files.
     *
     * Creates the `.loomflo/shared-memory/` directory if it does not exist,
     * then creates each standard file with a title header if it is missing.
     * This operation is idempotent — existing files are not overwritten.
     */
    initialize(): Promise<void>;
    /**
     * Reads a shared memory file and returns its content with metadata.
     *
     * Parses the file content to extract the last modification timestamp
     * and agent ID from entry headers. If the file has no entries (freshly
     * initialized), file system metadata is used instead.
     *
     * @param name - Name of the memory file (e.g. "DECISIONS.md").
     * @returns The shared memory file with content and metadata.
     * @throws Error if the name is invalid or the file does not exist.
     */
    read(name: string): Promise<SharedMemoryFile>;
    /**
     * Appends content to a shared memory file with a timestamped header.
     *
     * The write is serialized per file using async-mutex. Each entry is
     * formatted with a separator, timestamp, and agent attribution header.
     *
     * @param name - Name of the memory file (e.g. "DECISIONS.md").
     * @param content - Text content to append.
     * @param agentId - ID of the agent performing the write.
     * @throws Error if the name is invalid or the write fails.
     */
    write(name: string, content: string, agentId: string): Promise<void>;
    /**
     * Lists all shared memory files with their content and metadata.
     *
     * Reads every `.md` file in the shared memory directory and returns
     * an array of {@link SharedMemoryFile} objects. Files that cannot be
     * read are silently skipped.
     *
     * @returns Array of all shared memory files with content and metadata.
     */
    list(): Promise<SharedMemoryFile[]>;
    /**
     * Returns the names of the 7 standard shared memory files.
     *
     * @returns Array of standard file names.
     */
    getStandardFiles(): string[];
    /**
     * Returns the mutex for a given file, creating one if it does not exist.
     */
    private getMutex;
    /**
     * Parses file content for the last entry header to extract metadata.
     *
     * Falls back to file system mtime and "system" agent if no entry
     * headers are found (freshly initialized file).
     */
    private parseLastEntry;
}

/**
 * Structured payload describing an escalation from a Loomi to Loom.
 *
 * Sent by an orchestrator agent (Loomi) when a node is BLOCKED or has
 * exhausted all retries, requesting the architect (Loom) to modify the
 * workflow graph.
 */
interface EscalationRequest {
    /** Why the escalation is needed. */
    reason: string;
    /** ID of the node that is affected. */
    nodeId: string;
    /** ID of the agent requesting the escalation. */
    agentId: string;
    /** Optional suggestion for how Loom might resolve the issue. */
    suggestedAction?: 'add_node' | 'modify_node' | 'remove_node' | 'skip_node';
    /** Additional context about the failure. */
    details?: string;
}
/**
 * Minimal interface for the escalation handler dependency.
 *
 * Defines only the subset of behaviour needed by the escalate tool,
 * avoiding a hard dependency on a concrete Loom implementation.
 * Any object satisfying this interface can be injected at runtime.
 */
interface EscalationHandlerLike {
    /**
     * Submit an escalation request to the architect (Loom).
     *
     * @param request - Structured escalation payload.
     * @returns Resolves when the escalation has been accepted.
     */
    escalate(request: EscalationRequest): Promise<void>;
}
/**
 * Create an escalate tool wired to the given escalation handler.
 *
 * Uses a factory pattern so the tool can access an {@link EscalationHandlerLike}
 * instance without requiring it on {@link ToolContext}. The tool uses
 * `context.agentId` and `context.nodeId` to identify the escalating agent.
 *
 * Only Loomi (orchestrator) agents use this tool. When a node is BLOCKED or
 * has exhausted all retries, the Loomi calls escalate to request graph
 * modifications from Loom (architect).
 *
 * @param handler - The escalation handler that receives requests.
 * @returns A {@link Tool} that submits escalations via the provided handler.
 */
declare function createEscalateTool(handler: EscalationHandlerLike): Tool;

/**
 * Escalation manager — concrete implementation of {@link EscalationHandlerLike}.
 *
 * Connects Loomi (Orchestrator) escalations to Loom (Architect) by:
 * 1. Receiving escalation requests from Loomi via the {@link EscalationHandlerLike} interface
 * 2. Making an LLM call to analyze the escalation and decide on a graph modification
 * 3. Applying the modification via a {@link GraphModifierLike} callback
 * 4. Logging the change to shared memory (ARCHITECTURE_CHANGES.md) and events.jsonl
 */

/**
 * Describes a modification to the workflow graph decided by the Architect.
 */
interface GraphModification {
    /** The action to take on the graph. */
    action: 'add_node' | 'modify_node' | 'remove_node' | 'skip_node' | 'no_action';
    /** Target node ID (for modify, remove, skip). */
    nodeId?: string;
    /** New node details (for add_node). */
    newNode?: {
        /** Human-readable title for the new node. */
        title: string;
        /** Markdown instructions for the new node. */
        instructions: string;
        /** Insert after this node ID (edge: insertAfter → new). */
        insertAfter?: string;
        /** Insert before this node ID (edge: new → insertBefore). */
        insertBefore?: string;
    };
    /** Updated instructions (for modify_node). */
    modifiedInstructions?: string;
    /** Human-readable reason for the modification. */
    reason: string;
}
/**
 * Minimal interface for applying graph modifications.
 *
 * The concrete implementation lives in the workflow engine. This interface
 * decouples the escalation manager from the graph implementation.
 */
interface GraphModifierLike {
    /**
     * Apply a graph modification.
     *
     * @param modification - The modification to apply.
     * @returns Resolves when the modification has been applied and persisted.
     */
    applyModification(modification: GraphModification): Promise<void>;
}
/**
 * Configuration for the {@link EscalationManager}.
 */
interface EscalationManagerConfig {
    /** LLM provider for the architect's decision-making call. */
    provider: LLMProvider;
    /** LLM model for the architect (e.g., "claude-opus-4-6"). */
    model: string;
    /** Absolute path to the project workspace root. */
    workspacePath: string;
    /** Shared memory manager for writing architecture changes. */
    sharedMemory: SharedMemoryManager;
    /** Cost tracker for recording LLM usage. */
    costTracker: CostTracker;
    /** Event log configuration. */
    eventLog: {
        workflowId: string;
    };
    /** Callback for applying graph modifications. */
    graphModifier: GraphModifierLike;
}
/**
 * Concrete escalation handler connecting Loomi to Loom.
 *
 * When a Loomi orchestrator escalates (BLOCKED or max retries exhausted),
 * this manager:
 * 1. Makes an LLM call as the Architect to analyze the issue
 * 2. Parses the decision into a {@link GraphModification}
 * 3. Applies it via the {@link GraphModifierLike} callback
 * 4. Logs the change to events.jsonl and ARCHITECTURE_CHANGES.md
 *
 * This class never throws — all errors are handled gracefully with fallback
 * to skip_node to ensure the workflow never deadlocks.
 */
declare class EscalationManager implements EscalationHandlerLike {
    private readonly config;
    /**
     * Create an EscalationManager instance.
     *
     * @param config - Manager configuration with provider, graph modifier, and logging.
     */
    constructor(config: EscalationManagerConfig);
    /**
     * Handle an escalation request from a Loomi orchestrator.
     *
     * Makes an LLM call to decide on a graph modification, applies it,
     * and logs the change. Falls back to skip_node on any error.
     *
     * @param request - The escalation request from Loomi.
     * @returns Resolves when the escalation has been fully handled.
     */
    escalate(request: EscalationRequest): Promise<void>;
    /**
     * Log an event to the project's events.jsonl file.
     *
     * @param type - Event type identifier.
     * @param details - Event-specific payload data.
     */
    private logEvent;
}

/** WebSocket event type identifiers broadcast to connected clients. */
type WsEventType = 'node_status' | 'agent_status' | 'agent_message' | 'review_verdict' | 'graph_modified' | 'cost_update' | 'chat_response' | 'spec_artifact_ready' | 'memory_updated';
/** Base shape shared by all WebSocket events. */
interface WsEventBase {
    /** Event kind discriminator. */
    type: WsEventType;
    /** ISO 8601 timestamp when the event was emitted. */
    timestamp: string;
}
/** Payload broadcast when a node changes execution state. */
interface WsNodeStatusEvent extends WsEventBase {
    type: 'node_status';
    /** Node whose status changed. */
    nodeId: string;
    /** New node status. */
    status: NodeStatus;
    /** Optional additional context about the status change. */
    details?: Record<string, unknown>;
}
/** Payload broadcast when an agent changes lifecycle state. */
interface WsAgentStatusEvent extends WsEventBase {
    type: 'agent_status';
    /** Node the agent belongs to. */
    nodeId: string;
    /** Agent whose status changed. */
    agentId: string;
    /** New agent status. */
    status: AgentStatus;
    /** Optional additional context about the status change. */
    details?: Record<string, unknown>;
}
/** Payload broadcast when an agent sends or receives a message. */
interface WsAgentMessageEvent extends WsEventBase {
    type: 'agent_message';
    /** Node context for the message. */
    nodeId: string;
    /** Agent that sent or received the message. */
    agentId: string;
    /** Message content. */
    message: string;
}
/** Payload broadcast when a Loomex reviewer produces a verdict. */
interface WsReviewVerdictEvent extends WsEventBase {
    type: 'review_verdict';
    /** Node that was reviewed. */
    nodeId: string;
    /** Overall review verdict. */
    verdict: ReviewReport['verdict'];
    /** Full structured review report. */
    report: ReviewReport;
}
/** Graph modification action types. */
type GraphAction = 'node_added' | 'node_removed' | 'node_modified' | 'edge_added' | 'edge_removed';
/** Payload broadcast when the workflow graph is modified. */
interface WsGraphModifiedEvent extends WsEventBase {
    type: 'graph_modified';
    /** What kind of modification occurred. */
    action: GraphAction;
    /** Node affected by the modification, if applicable. */
    nodeId?: string;
    /** Optional additional context about the modification. */
    details?: Record<string, unknown>;
}
/** Payload broadcast after every LLM call with updated cost information. */
interface WsCostUpdateEvent extends WsEventBase {
    type: 'cost_update';
    /** Node where the LLM call occurred. */
    nodeId: string;
    /** Cost of the individual LLM call in USD. */
    callCost: number;
    /** Total accumulated cost for this node in USD. */
    nodeCost: number;
    /** Total accumulated cost across the entire workflow in USD. */
    totalCost: number;
    /** Remaining budget in USD, or undefined if no budget limit is set. */
    budgetRemaining?: number;
}
/** Describes a graph modification action included in a chat response. */
interface WsChatAction {
    /** The type of graph modification (e.g. 'add_node', 'modify_node'). */
    type: string;
    /** Additional details about the modification. */
    details: Record<string, unknown>;
}
/** Payload broadcast when Loom sends a chat response to the dashboard. */
interface WsChatResponseEvent extends WsEventBase {
    type: 'chat_response';
    /** The text response from Loom. */
    response: string;
    /** Category the message was classified as (question, instruction, or graph_change). */
    category: string;
    /** Graph modification action if the message triggered one, or null. */
    action: WsChatAction | null;
}
/** Payload broadcast when a spec artifact is generated during Phase 1. */
interface WsSpecArtifactReadyEvent extends WsEventBase {
    type: 'spec_artifact_ready';
    /** File name of the generated artifact (e.g. "spec.md"). */
    name: string;
    /** Relative path to the artifact (e.g. ".loomflo/specs/spec.md"). */
    path: string;
}
/** Payload broadcast when a shared memory file is updated. */
interface WsMemoryUpdatedEvent extends WsEventBase {
    type: 'memory_updated';
    /** Name of the memory file that was updated. */
    file: string;
    /** Description of what was updated. */
    summary: string;
    /** ID of the agent that triggered the update, if applicable. */
    agentId?: string;
}
/** Union of all WebSocket event payloads. */
type WsEvent = WsNodeStatusEvent | WsAgentStatusEvent | WsAgentMessageEvent | WsReviewVerdictEvent | WsGraphModifiedEvent | WsCostUpdateEvent | WsChatResponseEvent | WsSpecArtifactReadyEvent | WsMemoryUpdatedEvent;
/** Broadcast function signature matching the one returned by {@link createServer}. */
type BroadcastFn = (event: Record<string, unknown>) => void;
/**
 * Typed wrapper around the raw WebSocket broadcast function.
 *
 * Provides a clean, type-safe API for the engine to emit structured events
 * to all connected dashboard clients. Each method constructs a well-typed
 * event payload with an ISO 8601 timestamp and delegates to the underlying
 * broadcast function from `server.ts`.
 *
 * This class does NOT manage WebSocket connections — that responsibility
 * belongs to the server module.
 */
declare class WebSocketBroadcaster {
    /** The underlying broadcast function from the server. */
    private readonly broadcast;
    /**
     * Create a new WebSocketBroadcaster.
     *
     * @param broadcast - The broadcast function returned by {@link createServer}.
     */
    constructor(broadcast: BroadcastFn);
    /** Send a typed event through the raw broadcast function. */
    private emit;
    /**
     * Broadcast a node status change to all connected clients.
     *
     * @param nodeId - ID of the node whose status changed.
     * @param status - The new node status.
     * @param details - Optional additional context about the change.
     */
    emitNodeStatus(nodeId: string, status: NodeStatus, details?: Record<string, unknown>): void;
    /**
     * Broadcast an agent status change to all connected clients.
     *
     * @param nodeId - ID of the node the agent belongs to.
     * @param agentId - ID of the agent whose status changed.
     * @param status - The new agent status.
     * @param details - Optional additional context about the change.
     */
    emitAgentStatus(nodeId: string, agentId: string, status: AgentStatus, details?: Record<string, unknown>): void;
    /**
     * Broadcast an agent message to all connected clients.
     *
     * @param nodeId - ID of the node where the message was sent.
     * @param agentId - ID of the agent that sent or received the message.
     * @param message - The message content.
     */
    emitAgentMessage(nodeId: string, agentId: string, message: string): void;
    /**
     * Broadcast a Loomex review verdict to all connected clients.
     *
     * @param nodeId - ID of the node that was reviewed.
     * @param verdict - The overall review verdict (PASS, FAIL, or BLOCKED).
     * @param report - The full structured review report.
     */
    emitReviewVerdict(nodeId: string, verdict: ReviewReport['verdict'], report: ReviewReport): void;
    /**
     * Broadcast a graph modification to all connected clients.
     *
     * @param action - The kind of modification (node_added, node_removed, etc.).
     * @param nodeId - ID of the affected node, if applicable.
     * @param details - Optional additional context about the modification.
     */
    emitGraphModified(action: GraphAction, nodeId?: string, details?: Record<string, unknown>): void;
    /**
     * Broadcast a cost update after an LLM call to all connected clients.
     *
     * @param nodeId - ID of the node where the LLM call occurred.
     * @param callCost - Cost of the individual LLM call in USD.
     * @param nodeCost - Total accumulated cost for this node in USD.
     * @param totalCost - Total accumulated cost across the workflow in USD.
     * @param budgetRemaining - Remaining budget in USD, or undefined if no limit.
     */
    emitCostUpdate(nodeId: string, callCost: number, nodeCost: number, totalCost: number, budgetRemaining?: number): void;
    /**
     * Broadcast a Loom chat response to all connected clients.
     *
     * @param response - The text response from Loom.
     * @param category - The classified category (question, instruction, or graph_change).
     * @param action - Graph modification action if the message triggered one, or null.
     */
    emitChatResponse(response: string, category: string, action: WsChatAction | null): void;
    /**
     * Broadcast that a spec artifact has been generated during Phase 1.
     *
     * @param name - File name of the generated artifact (e.g. "spec.md").
     * @param path - Relative path to the artifact (e.g. ".loomflo/specs/spec.md").
     */
    emitSpecArtifactReady(name: string, path: string): void;
    /**
     * Broadcast that a shared memory file has been updated.
     *
     * @param file - Name of the memory file that was updated.
     * @param summary - Description of what was updated.
     * @param agentId - ID of the agent that triggered the update, if applicable.
     */
    emitMemoryUpdated(file: string, summary: string, agentId?: string): void;
}

/**
 * Configuration for the spec generation engine.
 *
 * @param provider - LLM provider for making completion calls.
 * @param model - Model identifier to use for all spec generation calls.
 * @param projectPath - Absolute path to the project workspace.
 * @param maxTokens - Maximum tokens per LLM completion call.
 */
interface SpecEngineConfig {
    /** LLM provider for making completion calls. */
    provider: LLMProvider;
    /** Model identifier to use for all spec generation calls. */
    model: string;
    /** Absolute path to the project workspace. */
    projectPath: string;
    /** Maximum tokens per LLM completion call. */
    maxTokens?: number;
    /**
     * Optional callback for handling clarification questions.
     *
     * When the LLM detects ambiguity in the project description, it includes
     * `[CLARIFICATION_NEEDED]` markers in its output. If this callback is set,
     * the engine extracts the questions (max 3), invokes the callback, and
     * re-runs the step with the user's answers. If not set, the engine uses
     * the LLM's best-guess defaults.
     */
    clarificationCallback?: ClarificationCallback;
    /**
     * Optional WebSocket broadcaster for emitting real-time events during
     * spec generation (graph_modified, spec_artifact_ready).
     */
    broadcaster?: WebSocketBroadcaster;
}
/**
 * A clarification question extracted from LLM output ambiguity markers.
 *
 * @param question - The clarification question text.
 * @param context - Additional context explaining why this question matters.
 */
interface ClarificationQuestion {
    /** The clarification question text. */
    question: string;
    /** Additional context explaining why this question matters. */
    context: string;
}
/**
 * Callback invoked when the spec engine detects ambiguity and needs user input.
 *
 * Receives an array of questions (max 3) and must return an array of answers
 * in the same order. The callback is responsible for presenting the questions
 * to the user and collecting responses.
 *
 * @param questions - Array of clarification questions (max 3).
 * @returns Promise resolving to an array of answer strings in corresponding order.
 */
type ClarificationCallback = (questions: ClarificationQuestion[]) => Promise<string[]>;
/**
 * A single spec artifact produced by the pipeline.
 *
 * @param name - Artifact file name (e.g., "constitution.md").
 * @param path - Absolute path where the artifact was written.
 * @param content - Full content of the artifact.
 */
interface SpecArtifact {
    /** Artifact file name (e.g., "constitution.md"). */
    name: string;
    /** Absolute path where the artifact was written. */
    path: string;
    /** Full content of the artifact. */
    content: string;
}
/**
 * Result of a completed spec generation pipeline.
 *
 * @param artifacts - All spec artifacts produced by the pipeline.
 * @param graph - The execution graph built from the task list.
 */
interface SpecPipelineResult {
    /** All spec artifacts produced by the pipeline. */
    artifacts: SpecArtifact[];
    /** The execution graph built from the task list. */
    graph: Graph;
}
/** Events emitted during spec pipeline execution for progress tracking. */
type SpecStepEvent = {
    type: 'spec_step_started';
    stepName: string;
    stepIndex: number;
} | {
    type: 'spec_step_completed';
    stepName: string;
    stepIndex: number;
    artifactPath: string;
} | {
    type: 'spec_step_error';
    stepName: string;
    stepIndex: number;
    error: Error;
} | {
    type: 'spec_pipeline_completed';
    artifacts: SpecArtifact[];
    graph: Graph;
} | {
    type: 'clarification_requested';
    questions: ClarificationQuestion[];
    stepName: string;
} | {
    type: 'clarification_answered';
    answers: string[];
    stepName: string;
};
/** Callback for receiving spec pipeline progress events. */
type SpecStepCallback = (event: SpecStepEvent) => void;
/**
 * Error thrown when a spec pipeline step fails.
 *
 * Contains the step name and index for diagnostics. The original error
 * is preserved as the `cause` property.
 */
declare class SpecPipelineError extends Error {
    /** Name of the pipeline step that failed. */
    readonly stepName: string;
    /** Zero-based index of the pipeline step that failed. */
    readonly stepIndex: number;
    /**
     * @param stepName - Name of the failed pipeline step.
     * @param stepIndex - Zero-based index of the failed step.
     * @param cause - The underlying error that caused the failure.
     */
    constructor(stepName: string, stepIndex: number, cause: Error);
}
/**
 * Validation error codes for graph integrity checks.
 *
 * - `cycle_detected`: The graph contains a cycle (not a valid DAG).
 * - `duplicate_node_id`: Two or more nodes share the same ID.
 * - `invalid_edge_reference`: An edge references a non-existent node.
 * - `no_root_node`: No node exists without incoming edges.
 * - `orphan_nodes`: One or more nodes have no edges at all in a multi-node graph.
 * - `empty_graph`: The graph contains zero nodes.
 */
type GraphValidationCode = 'cycle_detected' | 'duplicate_node_id' | 'invalid_edge_reference' | 'no_root_node' | 'orphan_nodes' | 'empty_graph';
/**
 * Error thrown when graph validation fails.
 *
 * Contains a machine-readable {@link code} identifying the failure type
 * and an optional list of {@link involvedNodes} for targeted debugging.
 */
declare class GraphValidationError extends Error {
    /** Machine-readable validation failure code. */
    readonly code: GraphValidationCode;
    /** Node IDs involved in the validation failure, if applicable. */
    readonly involvedNodes: string[];
    /**
     * @param code - Machine-readable validation failure code.
     * @param message - Human-readable description of the failure.
     * @param involvedNodes - Node IDs involved in the failure.
     */
    constructor(code: GraphValidationCode, message: string, involvedNodes?: string[]);
}
/**
 * Configuration for graph node cost estimation.
 *
 * Controls how many tokens are estimated per task and what pricing
 * to apply. Uses {@link ModelPricing} from `costs/tracker` for consistency.
 * These are rough estimates for user guidance, not exact billing.
 *
 * @param estimatedInputTokensPerTask - Estimated input tokens consumed per task.
 * @param estimatedOutputTokensPerTask - Estimated output tokens produced per task.
 * @param modelPricing - Per-model pricing table (model ID → pricing).
 * @param model - Model ID to look up in the pricing table.
 */
interface CostEstimationConfig {
    /** Estimated input tokens consumed per task (default: 4000). */
    estimatedInputTokensPerTask: number;
    /** Estimated output tokens produced per task (default: 2000). */
    estimatedOutputTokensPerTask: number;
    /** Per-model pricing table keyed by model identifier (reuses costs/tracker ModelPricing). */
    modelPricing: Record<string, ModelPricing>;
    /** Model identifier to use for cost lookup. */
    model: string;
}
/** Default cost estimation config using Anthropic Claude pricing via the shared pricing table. */
declare const DEFAULT_COST_ESTIMATION_CONFIG: CostEstimationConfig;
/**
 * Result of graph validation and cost estimation.
 *
 * @param graph - The validated graph with updated topology and per-node costs.
 * @param estimatedTotalCost - Sum of all node cost estimates in USD.
 */
interface ValidatedGraph {
    /** The validated graph with per-node cost estimates and verified topology. */
    graph: Graph;
    /** Estimated total cost in USD across all nodes. */
    estimatedTotalCost: number;
}
/**
 * Validate that a graph is a directed acyclic graph (DAG) using Kahn's algorithm.
 *
 * Performs a topological sort by iteratively removing nodes with zero in-degree.
 * If all nodes are removed, the graph is a valid DAG. If nodes remain, a cycle
 * exists among the remaining nodes.
 *
 * @param nodes - Map of node IDs to Node objects.
 * @param edges - All directed edges in the graph.
 * @throws {GraphValidationError} With code `cycle_detected` if a cycle exists.
 */
declare function validateDag(nodes: Record<string, Node>, edges: Edge[]): void;
/**
 * Validate the structural integrity of a graph.
 *
 * Checks:
 * 1. The graph has at least one node.
 * 2. All node IDs in the nodes map are unique (guaranteed by Record keys).
 * 3. All edge references point to existing nodes.
 * 4. At least one root node exists (no incoming edges).
 * 5. In multi-node graphs, no node is completely disconnected (orphan).
 *
 * @param graph - The graph to validate.
 * @throws {GraphValidationError} With a descriptive code if any check fails.
 */
declare function validateGraphIntegrity(graph: Graph): void;
/**
 * Estimate the cost of executing a single graph node.
 *
 * Counts the approximate number of tasks in the node's instructions,
 * multiplies by the configured token estimates, and applies model pricing.
 * This is a rough estimate for user guidance, not an exact billing prediction.
 *
 * If the configured model is not found in the pricing table, falls back
 * to Sonnet-tier pricing ($3/$15 per million tokens).
 *
 * @param node - The graph node to estimate cost for.
 * @param config - Cost estimation configuration with token estimates and pricing.
 * @returns Estimated cost in USD.
 */
declare function estimateNodeCost(node: Node, config: CostEstimationConfig): number;
/**
 * Validate a graph and annotate it with topology detection and cost estimates.
 *
 * Runs all validation checks in order:
 * 1. Structural integrity (non-empty, valid references, roots, no orphans)
 * 2. DAG validation (no cycles via Kahn's algorithm)
 * 3. Topology re-detection
 * 4. Per-node cost estimation
 *
 * If any validation step fails, a {@link GraphValidationError} is thrown
 * before subsequent steps run. On success, returns the graph with updated
 * topology, per-node cost fields, and an aggregate cost total.
 *
 * @param graph - The graph to validate and annotate.
 * @param costConfig - Cost estimation configuration (defaults to Anthropic Claude pricing).
 * @returns The validated graph and estimated total cost.
 * @throws {GraphValidationError} If the graph fails any validation check.
 */
declare function validateAndOptimizeGraph(graph: Graph, costConfig?: CostEstimationConfig): ValidatedGraph;
/**
 * Engine that runs the 6-step spec generation pipeline.
 *
 * The pipeline takes a natural language project description and produces
 * a complete specification suite (constitution, spec, plan, tasks, analysis)
 * plus an execution workflow graph. Each step calls the LLM with the previous
 * step's output as context, building up the specification incrementally.
 *
 * All artifacts are written to `.loomflo/specs/` in the project directory.
 * Progress is reported via an optional callback.
 *
 * @example
 * ```typescript
 * const engine = new SpecEngine({
 *   provider: anthropicProvider,
 *   model: 'claude-opus-4-6',
 *   projectPath: '/path/to/project',
 * });
 *
 * const result = await engine.runPipeline(
 *   'Build a REST API with auth',
 *   (event) => console.log(event.type, event.stepName),
 * );
 * ```
 */
declare class SpecEngine {
    private readonly config;
    private readonly specsDir;
    private readonly broadcaster;
    /**
     * Create a new SpecEngine instance.
     *
     * @param config - Engine configuration including provider, model, and project path.
     */
    constructor(config: SpecEngineConfig);
    /**
     * Run the full 6-step spec generation pipeline.
     *
     * Steps executed sequentially:
     * 1. Generate constitution.md — foundational quality principles
     * 2. Generate spec.md — functional specification
     * 3. Generate plan.md — technical implementation plan
     * 4. Generate tasks.md — ordered task breakdown
     * 5. Generate analysis-report.md — coherence analysis
     * 6. Build workflow graph — from tasks and plan
     *
     * Each artifact is written to `.loomflo/specs/` on disk. If any step fails,
     * the pipeline aborts and a {@link SpecPipelineError} is thrown.
     *
     * @param description - Natural language project description.
     * @param onProgress - Optional callback for receiving progress events.
     * @returns The pipeline result with all artifacts and the built graph.
     * @throws {SpecPipelineError} If any pipeline step fails.
     */
    runPipeline(description: string, onProgress?: SpecStepCallback): Promise<SpecPipelineResult>;
    /**
     * Execute a single pipeline step with error handling and progress notification.
     *
     * Emits a `spec_step_started` event before execution and a `spec_step_error`
     * event on failure. Wraps errors in {@link SpecPipelineError}.
     *
     * @param stepIndex - Zero-based index of the step.
     * @param stepName - Human-readable name of the step.
     * @param fn - Async function that performs the step's work.
     * @param onProgress - Optional progress callback.
     * @returns The result of the step function.
     * @throws {SpecPipelineError} If the step function throws.
     */
    private executeStep;
    /**
     * Notify progress callback of a completed step.
     *
     * @param stepIndex - Zero-based index of the completed step.
     * @param stepName - Name of the completed step.
     * @param artifactPath - Path to the artifact produced by the step.
     * @param onProgress - Optional progress callback.
     */
    private notifyStepCompleted;
    /**
     * Call the LLM provider with a system prompt and user message.
     *
     * Sends a single-turn completion request and extracts the text response.
     *
     * @param systemPrompt - System prompt providing instructions to the LLM.
     * @param userMessage - User message containing the project context.
     * @returns The text content of the LLM response.
     * @throws If the LLM call fails or returns no text content.
     */
    private callLLM;
    /**
     * Write a spec artifact to the `.loomflo/specs/` directory.
     *
     * @param name - File name for the artifact (e.g., "constitution.md").
     * @param content - Full content to write.
     * @returns The artifact metadata including the resolved file path.
     */
    private writeArtifact;
    /**
     * Detect `[CLARIFICATION_NEEDED]` markers in LLM output and extract questions.
     *
     * Parses the block between `[CLARIFICATION_NEEDED]` and `[/CLARIFICATION_NEEDED]`
     * for numbered questions (Q1:, Q2:, etc.) with optional `Context:` lines.
     *
     * Expected marker format:
     * ```
     * [CLARIFICATION_NEEDED]
     * Q1: Question text here?
     * Context: Why this matters.
     * Q2: Another question?
     * Context: Additional context.
     * [/CLARIFICATION_NEEDED]
     * ```
     *
     * @param text - The raw LLM output text to scan.
     * @returns Array of extracted clarification questions, empty if no markers found.
     */
    private detectAmbiguityMarkers;
    /**
     * Remove the `[CLARIFICATION_NEEDED]...[/CLARIFICATION_NEEDED]` block from text.
     *
     * Returns the remaining text (the LLM's best-guess output) with the marker
     * block stripped out and surrounding whitespace normalized.
     *
     * @param text - The raw LLM output containing clarification markers.
     * @returns The text with the clarification block removed.
     */
    private stripClarificationMarkers;
    /**
     * Handle clarification for a pipeline step's LLM output.
     *
     * Detects ambiguity markers in the output and, if found:
     * - With a callback: asks the user (max 3 questions), augments the description
     *   with answers, and re-runs the step exactly once.
     * - Without a callback: logs a warning and returns the output with markers stripped.
     * - On callback failure: logs a warning and returns the output with markers stripped.
     *
     * If no markers are found, returns the output unchanged.
     *
     * Only one clarification round occurs per step — the re-run output is returned
     * as-is regardless of whether it contains markers.
     *
     * @param stepName - Name of the current pipeline step (for logging and events).
     * @param description - The original project description.
     * @param llmOutput - The raw LLM output that may contain clarification markers.
     * @param rerunFn - Function to re-run the step with an augmented description.
     * @param onProgress - Optional progress callback for emitting clarification events.
     * @returns The final step output (either original, stripped, or re-run result).
     */
    private handleClarification;
    /**
     * Step 1: Generate a project constitution document.
     *
     * Produces non-negotiable quality principles, delivery standards,
     * technology constraints, and governance rules for the target project.
     *
     * @param description - Natural language project description.
     * @returns The generated constitution content as Markdown.
     */
    private generateConstitution;
    /**
     * Step 2: Generate a functional specification.
     *
     * Produces user stories, features, functional requirements, constraints,
     * assumptions, and out-of-scope items. Focuses on WHAT, not HOW.
     *
     * @param description - Natural language project description.
     * @param constitution - Previously generated constitution content.
     * @returns The generated specification content as Markdown.
     */
    private generateSpec;
    /**
     * Step 3: Generate a technical implementation plan.
     *
     * Produces stack decisions, project structure, data model, architecture
     * decisions, build phases, and key implementation decisions.
     *
     * @param description - Natural language project description.
     * @param constitution - Previously generated constitution content.
     * @param spec - Previously generated specification content.
     * @returns The generated plan content as Markdown.
     */
    private generatePlan;
    /**
     * Step 4: Generate an ordered task breakdown.
     *
     * Produces a list of concrete, actionable tasks with IDs, descriptions,
     * file paths, dependencies, and parallelism flags.
     *
     * @param description - Natural language project description.
     * @param constitution - Previously generated constitution content.
     * @param spec - Previously generated specification content.
     * @param plan - Previously generated plan content.
     * @returns The generated task list content as Markdown.
     */
    private generateTasks;
    /**
     * Step 5: Generate a coherence analysis report.
     *
     * Audits all previous artifacts for coverage gaps, contradictions,
     * ambiguities, and constitution violations.
     *
     * @param constitution - Previously generated constitution content.
     * @param spec - Previously generated specification content.
     * @param plan - Previously generated plan content.
     * @param tasks - Previously generated task list content.
     * @returns The generated analysis report content as Markdown.
     */
    private generateAnalysis;
    /**
     * Step 6: Build the workflow execution graph from tasks and plan.
     *
     * Calls the LLM to parse the task list into execution nodes with
     * dependencies, then constructs a valid {@link Graph} with edges,
     * topology detection, and cost estimates. The graph is fully validated
     * (DAG check, reference integrity, root/orphan checks) before being returned.
     *
     * @param tasks - Previously generated task list content.
     * @param plan - Previously generated plan content.
     * @returns A validated Graph object with nodes, edges, topology, and cost estimates.
     * @throws {GraphValidationError} If the LLM produces an invalid graph (cycles, missing references, etc.).
     */
    private buildGraph;
}

/**
 * Loom (Architect) agent — the top-level agent in the Loomflo hierarchy.
 *
 * There is exactly one Loom per project. It persists for the entire workflow
 * lifetime and is responsible for:
 * - Driving the SpecEngine pipeline (Phase 1: spec generation)
 * - Handling escalations from Loomi orchestrators (Phase 2: execution)
 * - Monitoring shared memory for critical issues and proactive intervention
 * - Responding to user chat messages
 * - Managing graph modifications
 * - Logging events to the EventLog
 * - Tracking costs via CostTracker
 */

/**
 * Lifecycle status of the Loom agent.
 *
 * - `created`: Agent instantiated but no work started.
 * - `running_spec`: Spec-generation pipeline is executing.
 * - `running_execution`: Execution mode is active.
 * - `handling_escalation`: Processing an escalation from a Loomi.
 * - `handling_chat`: Responding to a user chat message.
 * - `idle`: Work completed or awaiting further instructions.
 */
type LoomAgentStatus = 'created' | 'running_spec' | 'running_execution' | 'handling_escalation' | 'handling_chat' | 'idle';
/**
 * Configuration for creating a Loom agent instance.
 */
interface LoomConfig {
    /** LLM provider for making completion calls. */
    provider: LLMProvider;
    /** Model identifier (defaults to claude-opus-4-6 per constitution). */
    model?: string;
    /** Absolute path to the project workspace. */
    projectPath: string;
    /** Event log configuration — events are appended to the project's events.jsonl. */
    eventLog: {
        /** Workflow ID for event attribution. */
        workflowId: string;
    };
    /** Shared memory manager for writing progress updates. */
    sharedMemory: SharedMemoryManager;
    /** Cost tracker for recording LLM usage. */
    costTracker: CostTracker;
    /** Maximum tokens per LLM completion call. */
    maxTokensPerCall?: number;
    /** Callback for handling clarification questions during spec generation. */
    clarificationCallback?: ClarificationCallback;
    /** Callback for applying graph modifications (execution mode). */
    graphModifier?: GraphModifierLike;
    /** Summary of the current graph state for context (execution mode). */
    graphSummary?: string;
}
/**
 * Result of handling an escalation request.
 */
interface EscalationResult {
    /** Whether the escalation was handled successfully. */
    success: boolean;
    /** The decided graph modification, or null if handling failed. */
    modification: GraphModification | null;
    /** Error message if handling failed. */
    error?: string;
}
/**
 * Category of a user chat message for routing.
 *
 * - `question`: Asking about the project, its state, or architecture.
 * - `instruction`: Giving a directive to be relayed to orchestrators.
 * - `graph_change`: Requesting structural changes to the workflow graph.
 */
type ChatMessageCategory = 'question' | 'instruction' | 'graph_change';
/**
 * Result of classifying a user chat message.
 */
interface ChatClassification {
    /** The determined category of the message. */
    category: ChatMessageCategory;
    /** Confidence score from the LLM (0.0 to 1.0). */
    confidence: number;
    /** Brief reasoning for the classification. */
    reasoning: string;
}
/**
 * Result of handling a user chat message.
 */
interface ChatResult {
    /** The response text from Loom. */
    response: string;
    /** Category the message was classified as. */
    category: ChatMessageCategory;
    /** Graph modification if the user requested one, or null. */
    modification: GraphModification | null;
    /** Error message if chat handling failed. */
    error?: string;
}
/**
 * Result of shared memory monitoring.
 */
interface MonitoringResult {
    /** Whether critical issues were detected. */
    issuesDetected: boolean;
    /** Proactive graph modification if intervention is needed, or null. */
    modification: GraphModification | null;
    /** Summary of findings. */
    summary: string;
}
/**
 * The Loom (Architect) agent — top-level agent, one per project.
 *
 * Operates in two modes:
 * - **Spec generation** (Phase 1): Drives the {@link SpecEngine} pipeline to
 *   produce specification artifacts and the workflow graph.
 * - **Execution** (Phase 2): Handles escalations from Loomi orchestrators,
 *   monitors shared memory for critical issues, responds to user chat,
 *   and manages graph modifications.
 *
 * @example
 * ```typescript
 * const loom = new LoomAgent({
 *   provider: anthropicProvider,
 *   projectPath: '/path/to/project',
 *   eventLog: { workflowId: 'wf-123' },
 *   sharedMemory: memoryManager,
 *   costTracker: tracker,
 * });
 *
 * // Phase 1
 * const result = await loom.runSpecGeneration('Build a REST API with auth');
 *
 * // Phase 2
 * const chatResult = await loom.handleChat('How is auth implemented?');
 * const escalationResult = await loom.handleEscalation(request);
 * const monitorResult = await loom.monitorSharedMemory();
 * ```
 */
declare class LoomAgent {
    private readonly config;
    private readonly model;
    private status;
    /**
     * Creates a new Loom agent instance.
     *
     * @param config - Loom agent configuration.
     */
    constructor(config: LoomConfig);
    /**
     * Run the spec-generation pipeline for a project description.
     *
     * Creates a {@link SpecEngine}, hooks up progress tracking (event logging,
     * cost tracking, shared memory updates), and runs the 6-step pipeline.
     *
     * On completion, writes a summary to PROGRESS.md and returns the result.
     *
     * @param description - Natural language project description.
     * @returns The pipeline result with all artifacts and the built graph.
     * @throws {SpecPipelineError} If any pipeline step fails.
     */
    runSpecGeneration(description: string): Promise<SpecPipelineResult>;
    /**
     * Handle an escalation request from a Loomi orchestrator.
     *
     * Makes an LLM call to analyze the escalation, decides on a graph
     * modification, applies it via the graphModifier callback, and logs
     * the change to shared memory (ARCHITECTURE_CHANGES.md).
     *
     * This method never throws — all errors produce an {@link EscalationResult}
     * with success=false.
     *
     * @param request - The escalation request from the Loomi.
     * @returns Result with the decided graph modification.
     */
    handleEscalation(request: EscalationRequest): Promise<EscalationResult>;
    /**
     * Monitor shared memory files for critical issues requiring proactive intervention.
     *
     * Reads ERRORS.md, ISSUES.md, and PROGRESS.md from shared memory. If content
     * suggests critical issues (repeated failures, contradictions, blockers), makes
     * an LLM call to decide on a proactive graph modification.
     *
     * This method never throws — all errors produce a safe {@link MonitoringResult}.
     *
     * @returns Result with findings and optional graph modification.
     */
    monitorSharedMemory(): Promise<MonitoringResult>;
    /**
     * Handle a user chat message and produce a response.
     *
     * Classifies the message into one of three categories (question, instruction,
     * graph_change) via a lightweight LLM call, then routes to the appropriate
     * handler. This method never throws — all errors produce a safe {@link ChatResult}.
     *
     * @param message - The user's chat message.
     * @param chatHistory - Optional formatted chat history for context.
     * @returns Result with response text, category, and optional graph modification.
     */
    handleChat(message: string, chatHistory?: string): Promise<ChatResult>;
    /**
     * Classify a user message into a routing category.
     *
     * Makes a lightweight LLM call with minimal prompt and low token limit
     * to determine whether the message is a question, instruction, or graph
     * change request. Falls back to `'question'` if parsing fails (safest default).
     *
     * @param message - The user's chat message to classify.
     * @returns Classification result with category, confidence, and reasoning.
     */
    classifyMessage(message: string): Promise<ChatClassification>;
    /**
     * Returns the current lifecycle status of the Loom agent.
     *
     * @returns The agent's current status.
     */
    getStatus(): LoomAgentStatus;
    /**
     * Update the graph summary used for context in escalation and chat handling.
     *
     * @param summary - New graph summary string.
     */
    updateGraphSummary(summary: string): void;
    /**
     * Handle a message classified as a question.
     *
     * Answers using project context gathered from shared memory, the current
     * graph state, and chat history.
     *
     * @param message - The user's question.
     * @param chatHistory - Optional formatted chat history for context.
     * @returns Chat result with the answer.
     */
    private handleQuestion;
    /**
     * Handle a message classified as an instruction.
     *
     * Generates an acknowledgement via LLM, then records the instruction in
     * DECISIONS.md shared memory so orchestrators can read it.
     *
     * @param message - The user's instruction.
     * @param chatHistory - Optional formatted chat history for context.
     * @returns Chat result with the acknowledgement.
     */
    private handleInstruction;
    /**
     * Handle a message classified as a graph change request.
     *
     * Uses a targeted LLM prompt to produce a graph modification JSON block,
     * extracts and applies it via the graphModifier callback.
     *
     * @param message - The user's graph change request.
     * @param chatHistory - Optional formatted chat history for context.
     * @returns Chat result with confirmation and the applied modification.
     */
    private handleGraphChange;
    /**
     * Read shared memory files to build project context for answering questions.
     *
     * Reads DECISIONS.md, PROGRESS.md, and ARCHITECTURE_CHANGES.md. Missing
     * or empty files are silently skipped.
     *
     * @returns Concatenated markdown context from shared memory, or empty string.
     */
    private readSharedMemoryContext;
    /**
     * Handle a spec pipeline progress event.
     *
     * Logs events, tracks costs (via estimates), and writes progress updates
     * to shared memory. This method is synchronous (fire-and-forget async
     * operations) to conform to the {@link SpecStepCallback} signature.
     *
     * @param event - The spec pipeline progress event.
     */
    private handleSpecProgress;
    /**
     * Log a spec-phase event to the project's events.jsonl file.
     *
     * @param type - Event type identifier (spec_phase_started or spec_phase_completed).
     * @param details - Event-specific payload data.
     */
    private logEvent;
    /**
     * Log a generic event to the project's events.jsonl file.
     *
     * @param type - Event type identifier.
     * @param details - Event-specific payload data.
     */
    private logEventGeneric;
    /**
     * Write a progress update to the PROGRESS.md shared memory file.
     *
     * @param content - Markdown content to append.
     */
    private writeProgress;
    /**
     * Write content to a named shared memory file.
     *
     * @param fileName - Shared memory file name.
     * @param content - Markdown content to append.
     */
    private writeMemory;
}

/**
 * Structured payload describing the outcome of a Looma's task execution.
 *
 * Sent by a worker agent (Looma) to its orchestrator (Loomi) via the
 * {@link CompletionHandlerLike} to signal that its assigned task is finished.
 */
interface CompletionReport {
    /** Human-readable summary of what the agent accomplished. */
    summary: string;
    /** Absolute or workspace-relative paths of files the agent created. */
    filesCreated: string[];
    /** Absolute or workspace-relative paths of files the agent modified. */
    filesModified: string[];
    /** Whether the task completed fully or only partially. */
    status: 'success' | 'partial';
}
/**
 * Minimal interface for the completion handler dependency.
 *
 * Defines only the subset of behaviour needed by the report_complete tool,
 * avoiding a hard dependency on a concrete orchestrator implementation.
 * Any object satisfying this interface can be injected at runtime.
 */
interface CompletionHandlerLike {
    /**
     * Record a completion report from an agent.
     *
     * @param agentId - ID of the agent reporting completion.
     * @param nodeId - ID of the node the agent belongs to.
     * @param report - Structured completion payload.
     * @returns Resolves when the report has been accepted.
     */
    reportComplete(agentId: string, nodeId: string, report: CompletionReport): Promise<void>;
}
/**
 * Create a report_complete tool wired to the given completion handler.
 *
 * Uses a factory pattern so the tool can access a {@link CompletionHandlerLike}
 * instance without requiring it on {@link ToolContext}. The tool uses
 * `context.agentId` and `context.nodeId` to identify the reporting agent.
 *
 * Only Looma (worker) agents use this tool. When a Looma finishes its task,
 * it calls report_complete to signal the Loomi (orchestrator) that it is done.
 * The Loomi collects these reports to determine when all workers have finished.
 *
 * @param handler - The completion handler that receives reports.
 * @returns A {@link Tool} that reports task completion via the provided handler.
 */
declare function createReportCompleteTool(handler: CompletionHandlerLike): Tool;

/**
 * Minimal interface for the message bus dependency.
 *
 * Defines only the subset of MessageBus needed by the send_message tool,
 * avoiding a hard dependency on the full MessageBus implementation (T039).
 * Any object satisfying this interface can be injected at runtime.
 */
interface MessageBusLike {
    /**
     * Send a message from one agent to another within a node.
     *
     * @param from - ID of the sending agent.
     * @param to - ID of the target agent.
     * @param nodeId - ID of the node both agents belong to.
     * @param content - The message text.
     * @returns Resolves when the message has been accepted by the bus.
     */
    send(from: string, to: string, nodeId: string, content: string): Promise<void>;
}
/**
 * Create a send_message tool wired to the given message bus.
 *
 * Uses a factory pattern so the tool can access a {@link MessageBusLike}
 * instance without requiring it on {@link ToolContext}. The tool uses
 * `context.agentId` as the sender and `context.nodeId` as the message scope.
 *
 * Messages are only routable within the same node — cross-node communication
 * goes through shared memory.
 *
 * @param messageBus - The message bus instance to send messages through.
 * @returns A {@link Tool} that sends messages via the provided bus.
 */
declare function createSendMessageTool(messageBus: MessageBusLike): Tool;

/**
 * In-process message bus for agent-to-agent communication within a node.
 *
 * Each agent must be registered to a node before it can send or receive
 * messages. Messages are strictly node-scoped — agents in different nodes
 * cannot communicate through the bus (use shared memory for cross-node state).
 *
 * Implements {@link MessageBusLike} so it can be injected into the
 * `send_message` tool.
 */
declare class MessageBus implements MessageBusLike {
    /**
     * Per-node, per-agent incoming message queues.
     *
     * Structure: `Map<nodeId, Map<agentId, Message[]>>`
     */
    private readonly queues;
    /** Append-only log of every message sent through the bus. */
    private readonly log;
    /**
     * Register an agent to receive messages within a node.
     *
     * Creates an empty incoming queue for the agent. If the agent is already
     * registered to the same node, this is a no-op.
     *
     * @param agentId - Unique agent identifier.
     * @param nodeId - Node the agent belongs to.
     */
    registerAgent(agentId: string, nodeId: string): void;
    /**
     * Unregister an agent from a node, removing its message queue.
     *
     * Any undelivered messages in the queue are discarded. If the node has no
     * remaining agents, the node entry is cleaned up.
     *
     * @param agentId - Unique agent identifier.
     * @param nodeId - Node the agent belongs to.
     */
    unregisterAgent(agentId: string, nodeId: string): void;
    /**
     * Send a message from one agent to another within the same node.
     *
     * The message is validated, logged, and placed in the recipient's queue.
     * Rejects with an error if the sender or recipient is not registered to the
     * specified node.
     *
     * @param from - ID of the sending agent.
     * @param to - ID of the target agent.
     * @param nodeId - ID of the node both agents belong to.
     * @param content - The message text.
     * @throws Error if sender or recipient is not registered to the node.
     */
    send(from: string, to: string, nodeId: string, content: string): Promise<void>;
    /**
     * Broadcast a message to all agents within the same node, except the sender.
     *
     * Creates one message per recipient. Each recipient gets an independent copy
     * with its own ID and timestamp.
     *
     * @param from - ID of the sending agent.
     * @param nodeId - ID of the node to broadcast within.
     * @param content - The message text.
     * @throws Error if the sender is not registered to the node.
     */
    broadcast(from: string, nodeId: string, content: string): Promise<void>;
    /**
     * Retrieve and drain all pending messages for an agent within a node.
     *
     * Returns all queued messages and empties the agent's queue. Subsequent
     * calls return an empty array until new messages arrive.
     *
     * @param agentId - ID of the agent whose messages to collect.
     * @param nodeId - ID of the node the agent belongs to.
     * @returns Array of pending messages (may be empty). Empty array if the
     *          agent or node is not registered.
     */
    collect(agentId: string, nodeId: string): Message[];
    /**
     * Get the message log for inspection or dashboard display.
     *
     * When `nodeId` is provided, returns only messages for that node.
     * Otherwise returns all logged messages across all nodes.
     *
     * @param nodeId - Optional node ID to filter by.
     * @returns Read-only array of logged messages.
     */
    getMessageLog(nodeId?: string): readonly Message[];
}

/**
 * Looma (Worker) agent — executes a specific task within a workflow node.
 *
 * Each Looma is spawned by a Loomi (Orchestrator) and is responsible for:
 * - Writing code, creating files, and modifying existing files within its write scope
 * - Running shell commands to validate work (tests, builds, linting)
 * - Communicating with teammate workers via the MessageBus
 * - Reading/writing shared memory for cross-node context
 * - Calling report_complete when its task is finished
 *
 * Looma is the builder — it does the actual implementation work.
 */

/**
 * Configuration for running a single Looma (Worker) agent.
 *
 * Provides everything needed to execute a task: identity, scope, tools,
 * LLM provider, communication channels, and contextual information.
 */
interface LoomaConfig {
    /** Unique worker identifier (e.g., "looma-auth-1"). */
    agentId: string;
    /** Node this worker belongs to. */
    nodeId: string;
    /** Description of what the worker should accomplish. */
    taskDescription: string;
    /** Glob patterns defining which files this worker may write. */
    writeScope: string[];
    /** Absolute path to the project workspace root. */
    workspacePath: string;
    /** LLM provider for completion calls. */
    provider: LLMProvider;
    /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
    model: string;
    /** Base tools for the worker (without send_message/report_complete — added internally). */
    tools: Tool[];
    /** Message bus for intra-node agent communication. */
    messageBus: MessageBus;
    /** External completion handler (e.g., the Loomi's CompletionTracker). */
    completionHandler: CompletionHandlerLike;
    /** Agent execution constraints. */
    config: {
        /** Wall-clock timeout in milliseconds. */
        agentTimeout: number;
        /** Cumulative token limit (input + output). */
        agentTokenLimit: number;
        /** Maximum tokens per individual LLM call. */
        maxTokens?: number;
    };
    /** Markdown instructions for the parent node. */
    nodeInstructions: string;
    /** Description of other workers in this node and their tasks. */
    teamContext?: string;
    /** Spec artifacts content for context. */
    specContext?: string;
    /** Shared memory snapshot for context. */
    sharedMemoryContent?: string;
    /** Context from a previous failed attempt (retry). */
    retryContext?: string;
    /** Cost tracker for recording LLM usage. */
    costTracker: CostTracker;
    /** Event log configuration. */
    eventLog: {
        workflowId: string;
    };
}
/**
 * Result returned by {@link runLooma} after the worker completes.
 *
 * The function never throws — all outcomes (success, failure, timeout,
 * token exhaustion) are represented as structured results.
 */
interface LoomaResult {
    /** How the worker terminated. */
    status: 'completed' | 'failed' | 'timeout' | 'token_limit';
    /** Final text output from the agent. */
    output: string;
    /** Cumulative token usage across all LLM calls. */
    tokenUsage: {
        input: number;
        output: number;
    };
    /** Error description when status is not 'completed'. */
    error?: string;
    /** Structured completion report if the worker called report_complete. */
    completionReport?: CompletionReport;
}
/**
 * Run a Looma (Worker) agent to execute a specific task within a workflow node.
 *
 * Executes the full worker lifecycle:
 * 1. Registers the agent on the MessageBus
 * 2. Builds the tool set with dynamically wired send_message and report_complete
 * 3. Constructs the system prompt via {@link buildLoomaPrompt}
 * 4. Runs the agent loop until completion or a limit is reached
 * 5. Records cost via the cost tracker
 * 6. Logs the outcome event
 * 7. Unregisters from the MessageBus
 *
 * This function never throws — all error conditions produce a {@link LoomaResult}
 * with an appropriate status and error message.
 *
 * @param config - Complete Looma configuration including task, tools, and constraints.
 * @returns Structured result with output, token usage, status, and optional completion report.
 */
declare function runLooma(config: LoomaConfig): Promise<LoomaResult>;

/**
 * Loomex (Reviewer) agent — inspects work quality and produces structured verdicts.
 *
 * Each Loomex is spawned after workers complete a node. It is responsible for:
 * - Reading all files produced or modified by workers
 * - Checking each task against the node instructions and spec
 * - Producing a structured ReviewReport with PASS/FAIL/BLOCKED verdict
 * - Providing specific, actionable feedback for failures
 *
 * Loomex has READ-ONLY tools — it must NOT have write_file, edit_file,
 * exec_command, write_memory, send_message, or report_complete.
 */

/**
 * Configuration for running a single Loomex (Reviewer) agent.
 *
 * Provides everything needed to inspect a node's work: identity, read-only
 * tools, LLM provider, tasks to verify, and contextual information.
 */
interface LoomexConfig {
    /** Unique reviewer identifier (e.g., "loomex-node-1"). */
    agentId: string;
    /** Node being reviewed. */
    nodeId: string;
    /** Human-readable node title. */
    nodeTitle: string;
    /** Markdown instructions for the node. */
    nodeInstructions: string;
    /** Tasks to verify, each with an ID and description. */
    tasksToVerify: Array<{
        taskId: string;
        description: string;
    }>;
    /** Absolute path to the project workspace root. */
    workspacePath: string;
    /** LLM provider for completion calls. */
    provider: LLMProvider;
    /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
    model: string;
    /** Read-only tools (read_file, search_files, list_files, read_memory). */
    tools: Tool[];
    /** Agent execution constraints. */
    config: {
        /** Wall-clock timeout in milliseconds. */
        agentTimeout: number;
        /** Cumulative token limit (input + output). */
        agentTokenLimit: number;
        /** Maximum tokens per individual LLM call. */
        maxTokens?: number;
    };
    /** Spec artifacts content for context. */
    specContext?: string;
    /** Shared memory snapshot for context. */
    sharedMemoryContent?: string;
    /** Cost tracker for recording LLM usage. */
    costTracker: CostTracker;
    /** Event log configuration. */
    eventLog: {
        workflowId: string;
    };
}
/**
 * Result returned by {@link runLoomex} after the reviewer completes.
 *
 * The function never throws — all outcomes (success, failure, timeout,
 * token exhaustion) are represented as structured results.
 */
interface LoomexResult {
    /** Structured review report with verdict and per-task details. */
    report: ReviewReport;
    /** Cumulative token usage across all LLM calls. */
    tokenUsage: {
        input: number;
        output: number;
    };
    /** Error description if the agent failed before producing a report. */
    error?: string;
}
/**
 * Parse the agent's text output into a structured ReviewReport.
 *
 * Attempts parsing strategies in order:
 * 1. JSON extraction (direct parse, markdown fences, brace extraction)
 *    followed by Zod schema validation
 * 2. Text-based fallback: scan for verdict keywords and per-task patterns
 * 3. If all parsing fails: generate a FAIL report with the raw output
 *
 * @param text - Raw text output from the agent loop.
 * @param tasksToVerify - Tasks that should have been verified.
 * @returns A valid ReviewReport matching the ReviewReportSchema.
 */
declare function parseReviewReport(text: string, tasksToVerify: Array<{
    taskId: string;
    description: string;
}>): ReviewReport;
/**
 * Run a Loomex (Reviewer) agent to inspect work quality for a workflow node.
 *
 * Executes the full reviewer lifecycle:
 * 1. Filters tools to ensure read-only access
 * 2. Builds the system prompt via {@link buildLoomexPrompt}
 * 3. Logs the reviewer_started event
 * 4. Runs the agent loop until completion or a limit is reached
 * 5. Parses the agent's output into a structured ReviewReport
 * 6. Records cost via the cost tracker
 * 7. Logs the reviewer_verdict event
 *
 * This function never throws — all error conditions produce a {@link LoomexResult}
 * with a FAIL report and error message.
 *
 * @param config - Complete Loomex configuration including tasks, tools, and constraints.
 * @returns Structured result with ReviewReport, token usage, and optional error.
 */
declare function runLoomex(config: LoomexConfig): Promise<LoomexResult>;

/**
 * Loomi (Orchestrator) agent — manages a single node's execution in Loomflo 2.
 *
 * There is exactly one Loomi per node. It is responsible for:
 * - Reading node instructions and analyzing the work required
 * - Planning a team of Worker agents (Loomas) via an LLM planning call
 * - Assigning exclusive, non-overlapping file write scopes to each worker
 * - Spawning all workers in parallel via Promise.all
 * - Monitoring report_complete signals from workers
 * - Handling retry on FAIL verdict: adapting prompts and relaunching failed workers
 * - Escalating to the Architect (Loom) on BLOCKED or max retries exhausted
 *
 * Loomi does NOT write project code — it plans, coordinates, and supervises.
 */

/**
 * Plan for a single worker agent as determined by Loomi's planning phase.
 */
interface WorkerPlan {
    /** Unique worker identifier (e.g., "looma-auth-1"). */
    id: string;
    /** Description of the task assigned to this worker. */
    taskDescription: string;
    /** Glob patterns defining the worker's exclusive file write scope. */
    writeScope: string[];
}
/**
 * Complete team plan produced by Loomi's LLM planning call.
 */
interface TeamPlan {
    /** LLM's reasoning for the team composition. */
    reasoning: string;
    /** Individual worker plans. */
    workers: WorkerPlan[];
}
/**
 * Configuration for running a Loomi orchestrator.
 *
 * @param nodeId - Unique node identifier this Loomi manages.
 * @param nodeTitle - Human-readable node title.
 * @param instructions - Markdown instructions for this node.
 * @param workspacePath - Absolute path to the project workspace root.
 * @param provider - LLM provider for planning and worker calls.
 * @param model - LLM model for Loomi's own planning calls.
 * @param config - Merged workflow configuration.
 * @param messageBus - Message bus for intra-node agent communication.
 * @param eventLog - Event log configuration with workflowId.
 * @param costTracker - Cost tracker for LLM usage accounting.
 * @param sharedMemory - Shared memory manager for cross-node state.
 * @param escalationHandler - Handler for escalating to the Architect (Loom).
 * @param workerTools - Base tools for worker agents (without send_message and report_complete).
 * @param specContext - Spec artifacts content for worker context.
 * @param sharedMemoryContent - Shared memory content snapshot for worker context.
 * @param reviewCallback - Callback to trigger review after workers complete.
 */
interface LoomiConfig {
    /** Unique node identifier this Loomi manages. */
    nodeId: string;
    /** Human-readable node title. */
    nodeTitle: string;
    /** Markdown instructions for this node. */
    instructions: string;
    /** Absolute path to the project workspace root. */
    workspacePath: string;
    /** LLM provider for planning and worker agent calls. */
    provider: LLMProvider;
    /** LLM model for Loomi's own planning calls. */
    model: string;
    /** Merged workflow configuration. */
    config: Config;
    /** Message bus for intra-node agent communication. */
    messageBus: MessageBus;
    /** Event log configuration. */
    eventLog: {
        workflowId: string;
    };
    /** Cost tracker for LLM usage accounting. */
    costTracker: CostTracker;
    /** Shared memory manager for cross-node state. */
    sharedMemory: SharedMemoryManager;
    /** Handler for escalating to the Architect (Loom). */
    escalationHandler: EscalationHandlerLike;
    /** Base tools for worker agents (without send_message and report_complete). */
    workerTools: Tool[];
    /** Spec artifacts content for worker context. */
    specContext?: string;
    /** Shared memory content snapshot for worker context. */
    sharedMemoryContent?: string;
    /** Callback to trigger review after workers complete. Returns null if review is disabled. */
    reviewCallback?: () => Promise<ReviewReport | null>;
}
/**
 * Result returned by {@link runLoomi} after orchestration completes.
 *
 * @param status - Final orchestration outcome.
 * @param completedAgents - Agent IDs that completed successfully.
 * @param failedAgents - Agent IDs that failed or did not report completion.
 * @param retryCount - Number of retry cycles executed.
 */
interface LoomiResult {
    /** Final orchestration outcome. */
    status: 'completed' | 'failed' | 'blocked' | 'escalated';
    /** Agent IDs that reported successful completion. */
    completedAgents: string[];
    /** Agent IDs that failed or did not report completion. */
    failedAgents: string[];
    /** Number of retry cycles executed. */
    retryCount: number;
}
/**
 * Create an {@link AgentInfo} metadata object for a planned worker.
 *
 * @param plan - The worker plan.
 * @param model - LLM model for the worker.
 * @returns AgentInfo for the worker in 'created' status.
 */
declare function createWorkerAgentInfo(plan: WorkerPlan, model: string): AgentInfo;
/**
 * Run the Loomi orchestrator for a workflow node.
 *
 * Executes the full orchestration lifecycle:
 * 1. Plans a team of workers via an LLM call analyzing node instructions
 * 2. Validates non-overlapping file write scopes using picomatch
 * 3. Spawns all workers in parallel via Promise.all
 * 4. Monitors report_complete signals from each worker
 * 5. If review is enabled (via reviewCallback), triggers review
 * 6. On FAIL verdict, generates adapted prompts and relaunches only failed workers
 * 7. On BLOCKED or max retries exhausted, escalates to the Architect (Loom)
 *
 * This function never throws — all error conditions produce a {@link LoomiResult}
 * with an appropriate status.
 *
 * @param config - Complete Loomi configuration including node details,
 *   LLM provider, tools, and optional review callback.
 * @returns Structured result with orchestration outcome, agent statuses,
 *   and retry count.
 */
declare function runLoomi(config: LoomiConfig): Promise<LoomiResult>;

/**
 * A single section of a structured agent prompt.
 *
 * Each section maps to an XML-tagged block in the final system prompt,
 * providing clear delineation for the LLM to parse and follow.
 */
interface PromptSection {
    /** The agent's identity and responsibilities. */
    role: string;
    /** The specific task or objective for this invocation. */
    task: string;
    /** Background information: project state, spec artifacts, shared memory. */
    context: string;
    /** Instructions on how the agent should think and reason. */
    reasoning: string;
    /** Conditions under which the agent should stop working. */
    stopConditions: string;
    /** Expected output format and structure. */
    output: string;
}
/**
 * A prompt template keyed by section name.
 *
 * Each key corresponds to an XML tag in the rendered prompt string.
 */
type PromptTemplate = Record<keyof PromptSection, PromptSection[keyof PromptSection]>;
/** Base parameters shared across all agent prompt builders. */
interface BasePromptParams {
    /** Relevant shared memory content (decisions, errors, progress, etc.). */
    sharedMemory?: string;
    /** Relevant spec artifact content for context. */
    specContext?: string;
}
/**
 * Parameters for building a Loom (Architect) system prompt.
 *
 * The Architect generates specs, manages the graph, handles user chat,
 * monitors shared memory, and handles escalations. It does NOT write
 * project code.
 */
interface LoomPromptParams extends BasePromptParams {
    /** The original natural language project description. */
    projectDescription: string;
    /** Summary of the current graph state (nodes, statuses, topology). */
    graphSummary?: string;
    /** Recent chat history with the user for conversational context. */
    chatHistory?: string;
    /** Details of an escalation from an Orchestrator, if any. */
    escalation?: string;
}
/**
 * Parameters for building a Loomi (Orchestrator) system prompt.
 *
 * The Orchestrator plans worker teams, assigns file scopes, supervises
 * workers, handles retries, and escalates to Loom. It does NOT write
 * project code.
 */
interface LoomiPromptParams extends BasePromptParams {
    /** The node's title for identification. */
    nodeTitle: string;
    /** Markdown instructions for the node this Orchestrator manages. */
    nodeInstructions: string;
    /** Number of workers to coordinate. */
    workerCount: number;
    /** Worker ID to glob pattern mapping for file write scopes. */
    fileScopes: Record<string, string[]>;
    /** Context from a previous failed review, if this is a retry cycle. */
    retryContext?: string;
    /** Reviewer feedback to incorporate into adapted worker prompts. */
    reviewFeedback?: string;
}
/**
 * Parameters for building a Looma (Worker) system prompt.
 *
 * Workers write code, create files, run commands, and communicate with
 * teammates within the same node.
 */
interface LoomaPromptParams extends BasePromptParams {
    /** Description of this worker's specific task. */
    taskDescription: string;
    /** Glob patterns defining which files this worker can write. */
    fileScope: string[];
    /** Markdown instructions for the parent node. */
    nodeInstructions: string;
    /** Description of other workers in this node and their tasks. */
    teamContext?: string;
    /** Context from a previous failed attempt, if this is a retry. */
    retryContext?: string;
}
/**
 * Parameters for building a Loomex (Reviewer) system prompt.
 *
 * The Reviewer inspects work quality against node instructions and
 * produces a PASS/FAIL/BLOCKED verdict. It does NOT modify project files.
 */
interface LoomexPromptParams extends BasePromptParams {
    /** The node's title for identification. */
    nodeTitle: string;
    /** Markdown instructions the workers were given. */
    nodeInstructions: string;
    /** Tasks to verify, each with an ID and description. */
    tasksToVerify: Array<{
        taskId: string;
        description: string;
    }>;
}
/**
 * Build the system prompt for a Loom (Architect) agent.
 *
 * The Architect is the top-level agent (1 per project). It generates specs,
 * manages the workflow graph, interfaces with the user via chat, monitors
 * shared memory, and handles escalations from Orchestrators. It does NOT
 * write project code directly.
 *
 * Available tools: read_file, search_files, list_files, read_memory.
 *
 * @param params - Architect-specific prompt parameters.
 * @returns Formatted system prompt string with XML-style section tags.
 */
declare function buildLoomPrompt(params: LoomPromptParams): string;
/**
 * Build the system prompt for a Loomi (Orchestrator) agent.
 *
 * The Orchestrator manages a single node in Loomflo 2. It plans the worker
 * team, assigns exclusive file write scopes, supervises worker execution,
 * handles retries with adapted prompts, and escalates to the Architect when
 * blocked. It does NOT write project code directly.
 *
 * Available tools: read_file, search_files, list_files, read_memory,
 * write_memory, send_message, escalate.
 *
 * @param params - Orchestrator-specific prompt parameters.
 * @returns Formatted system prompt string with XML-style section tags.
 */
declare function buildLoomiPrompt(params: LoomiPromptParams): string;
/**
 * Build the system prompt for a Looma (Worker) agent.
 *
 * Workers are the agents that do actual work: writing code, creating files,
 * running commands, and communicating with teammates within the same node.
 * Each worker has an exclusive file write scope enforced by the daemon.
 *
 * Available tools: read_file, write_file, edit_file, search_files, list_files,
 * exec_command, read_memory, write_memory, send_message, report_complete,
 * invoke_skill.
 *
 * @param params - Worker-specific prompt parameters.
 * @returns Formatted system prompt string with XML-style section tags.
 */
declare function buildLoomaPrompt(params: LoomaPromptParams): string;
/**
 * Build the system prompt for a Loomex (Reviewer) agent.
 *
 * The Reviewer inspects all work produced by a node's workers against the
 * node instructions and produces a structured verdict: PASS, FAIL, or BLOCKED.
 * It does NOT modify project files.
 *
 * Available tools: read_file, search_files, list_files, read_memory.
 *
 * @param params - Reviewer-specific prompt parameters.
 * @returns Formatted system prompt string with XML-style section tags.
 */
declare function buildLoomexPrompt(params: LoomexPromptParams): string;

/**
 * Tool that reads file content from the agent's workspace.
 *
 * Resolves the given path relative to the workspace root and validates
 * that the resolved path stays within workspace boundaries before reading.
 * Path traversal via `..` segments and symlink escapes are detected and
 * rejected. All errors are returned as descriptive strings — this tool
 * never throws.
 */
declare const readFileTool: Tool;

/**
 * Tool that writes or creates a file within the agent's workspace.
 *
 * Resolves the given path relative to the workspace root and validates
 * that the resolved path stays within workspace boundaries. Additionally
 * enforces write scope: the path must match at least one glob pattern in
 * the agent's assigned writeScope (checked via picomatch). Parent
 * directories are created automatically if they do not exist. All errors
 * are returned as descriptive strings — this tool never throws.
 */
declare const writeFileTool: Tool;

/**
 * Tool that edits a file by replacing a string within the agent's workspace.
 *
 * Resolves the given path relative to the workspace root and validates
 * that the resolved path stays within workspace boundaries. Additionally
 * enforces write scope: the path must match at least one glob pattern in
 * the agent's assigned writeScope (checked via picomatch). Reads the file,
 * finds the first occurrence of oldText, and replaces it with newText.
 * All errors are returned as descriptive strings — this tool never throws.
 */
declare const editFileTool: Tool;

/**
 * Tool that searches file contents within the agent's workspace using regex.
 *
 * Walks the workspace directory recursively, filtering files by an optional
 * glob pattern, and searches each text file for lines matching the given
 * regex. Binary files and excluded directories (node_modules, .git, dist)
 * are automatically skipped. Results are returned as `file:line:content`
 * entries, capped at maxResults. All errors are returned as descriptive
 * strings — this tool never throws.
 */
declare const searchFilesTool: Tool;

/**
 * Tool that lists files within the agent's workspace matching a glob pattern.
 *
 * Walks the workspace directory recursively, filtering files by an optional
 * glob pattern. Returns relative paths (one per line), capped at maxResults.
 * Excluded directories (node_modules, .git, dist) are automatically skipped.
 * All errors are returned as descriptive strings — this tool never throws.
 */
declare const listFilesTool: Tool;

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
declare const shellExecTool: Tool;

/**
 * Tool that reads a shared memory file from the workspace.
 *
 * Shared memory files live in `.loomflo/shared-memory/` relative to the
 * workspace root. The tool validates the file name to prevent path traversal
 * (no slashes or `..` segments) and reads the file content as UTF-8.
 * All errors are returned as descriptive strings — this tool never throws.
 */
declare const memoryReadTool: Tool;

/**
 * Tool that appends content to a shared memory file in the workspace.
 *
 * Shared memory files live in `.loomflo/shared-memory/` relative to the
 * workspace root. The tool validates the file name to prevent path traversal
 * (no slashes or `..` segments), creates the directory and file if they do
 * not exist, and appends the content with a timestamped header for
 * traceability. All errors are returned as descriptive strings — this tool
 * never throws.
 *
 * Note: daemon-level serialization (async mutex) is handled by the
 * shared-memory manager (T042). This tool performs only the file I/O.
 */
declare const memoryWriteTool: Tool;

/**
 * Per-agent LLM API rate limiter for Loomflo agent orchestration.
 *
 * Implements a token-bucket algorithm to enforce configurable max calls per
 * minute per agent, preventing infinite loops or runaway costs (Constitution
 * Principle V, FR-052).
 *
 * The rate limiter is fully synchronous — it is a hot-path guard that must
 * not introduce async overhead. Buckets are lazy-initialized on first call
 * for each agent.
 */
/** Result when a rate limit acquisition is allowed. */
interface RateLimitAllowed {
    /** Indicates the call is permitted. */
    allowed: true;
}
/** Result when a rate limit acquisition is rejected. */
interface RateLimitRejected {
    /** Indicates the call is not permitted. */
    allowed: false;
    /** Milliseconds until the next token becomes available. */
    retryAfterMs: number;
}
/** Result of a rate limit acquisition attempt. */
type RateLimitResult = RateLimitAllowed | RateLimitRejected;
/**
 * Token-bucket rate limiter for per-agent LLM API call enforcement.
 *
 * Each agent gets an independent bucket that starts full and refills at a
 * steady rate of {@link maxCallsPerMinute} / 60 tokens per second. When the
 * bucket is empty, calls are rejected with a structured error containing the
 * estimated retry delay.
 */
declare class RateLimiter {
    private readonly maxTokens;
    private readonly refillRatePerMs;
    private readonly buckets;
    /**
     * Creates a new RateLimiter instance.
     *
     * @param maxCallsPerMinute - Maximum LLM API calls allowed per minute per agent.
     *   Defaults to 60 (matching config.apiRateLimit default).
     */
    constructor(maxCallsPerMinute?: number);
    /**
     * Attempts to acquire a rate limit token for the given agent.
     *
     * If the agent's bucket has at least one token, it is consumed and the call
     * is allowed. Otherwise, the call is rejected with an estimated retry delay.
     *
     * Buckets are lazy-initialized on first call for each agent.
     *
     * @param agentId - Unique identifier of the agent requesting a call.
     * @returns An allowed result if a token was consumed, or a rejected result
     *   with `retryAfterMs` indicating when to retry.
     */
    acquireOrReject(agentId: string): RateLimitResult;
    /**
     * Clears rate limit state for a specific agent.
     *
     * Should be called when an agent's lifecycle ends to free resources.
     *
     * @param agentId - Unique identifier of the agent to clear.
     */
    reset(agentId: string): void;
    /**
     * Clears rate limit state for all agents.
     *
     * Should be called when a workflow completes or is reset.
     */
    resetAll(): void;
}

/**
 * System prompt for the Loomprint agent (constitution phase).
 *
 * Loomprint generates foundational quality principles for the target project.
 * It produces a constitution.md defining non-negotiable principles, delivery
 * standards, technology constraints, and governance rules.
 *
 * The user message will contain the project description.
 */
declare const LOOMPRINT_PROMPT = "<role>\nYou are Loomprint, a constitution architect agent within the Loomflo specification pipeline.\nYour sole responsibility is to generate a foundational constitution document for a software project.\n\nYou are the first agent in a 6-phase pipeline. Your output sets the quality bar for all\nsubsequent phases. Every specification, plan, task, and line of code produced later must\ncomply with the principles you define here.\n\nYou do NOT write code, specs, or plans. You define the rules that govern how they are written.\n</role>\n\n<task>\nGenerate a complete constitution document for the project described in the user message.\n\nThe constitution must include these sections:\n\n1. **Core Principles** \u2014 Non-negotiable quality rules organized by concern area. Each principle\n   must be specific, enforceable, and testable. Use MUST/MUST NOT language (RFC 2119). Cover:\n   - Type safety and code quality (linting, testing, documentation standards)\n   - Architecture patterns (async behavior, component boundaries, state management)\n   - Testability and decoupling (interface-driven design, dependency injection)\n   - Provider/service abstraction (if the project uses external services)\n   - Security defaults (input validation, secret management, sandboxing)\n\n2. **Delivery Standards** \u2014 Build, CI/CD, and documentation requirements:\n   - Clean-clone build must work with zero manual steps\n   - CI pipeline requirements (linting, type checking, tests)\n   - Documentation requirements (README, architecture diagrams, quick-start)\n\n3. **Technology Constraints & Conventions** \u2014 Concrete technology choices:\n   - Runtime, language version, compilation target\n   - Package manager and workspace structure\n   - Test framework, linting tools, formatting tools\n   - State persistence approach\n   - Key naming conventions and taxonomy\n\n4. **Governance** \u2014 How the constitution itself is managed:\n   - Authority hierarchy (constitution is highest-authority document)\n   - Amendment process (proposal, review, migration plan)\n   - Versioning scheme (semantic versioning for principles)\n   - Compliance verification requirement\n\nTailor every section to the specific project described. Do not produce generic boilerplate.\nInfer reasonable technology choices from the project description. If the description is vague\nabout technology, choose a well-established, production-ready stack appropriate for the domain.\n</task>\n\n<context>\nYou will receive the project description as the user message. This is a natural language\ndescription of what the software should do. It may be brief or detailed.\n\nYou have no previous artifacts to reference \u2014 you are the first phase in the pipeline.\nYour output will be consumed by all subsequent phases (Loomscope, Loomcraft, Loompath,\nLoomscan, Loomkit) as a binding constraint document.\n</context>\n\n<reasoning>\nThink step by step:\n1. Parse the project description to identify the domain, scale, and key technical requirements.\n2. Infer the appropriate technology stack if not explicitly stated. Prefer widely-adopted,\n   well-documented technologies with strong TypeScript support.\n3. For each principle, ask: \"Can a reviewer objectively verify compliance?\" If not, make it\n   more specific.\n4. Balance strictness with pragmatism \u2014 principles must be achievable for the project's scope.\n5. Ensure principles do not contradict each other.\n6. Consider security implications specific to the project domain (e.g., auth for web apps,\n   sandboxing for agent systems, input validation for APIs).\n7. Define the minimum viable governance that keeps the constitution a living document.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a complete constitution document with all four required sections.\nEvery principle must be specific to the project described. Do not include principles that\nare irrelevant to the project's domain or stack.\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# [Project Name] Constitution\n\n## Core Principles\n\n### I. [Concern Area] (NON-NEGOTIABLE if applicable)\n- Specific principle with MUST/MUST NOT language\n- ...\n\n### II. [Concern Area]\n- ...\n\n(Continue with as many principle groups as needed)\n\n## Delivery Standards\n- Bullet points with specific, verifiable requirements\n\n## Technology Constraints & Conventions\n- Specific technology choices with versions where applicable\n- Naming conventions and taxonomy\n\n## Governance\n- Authority, amendment process, versioning, compliance\n\n**Version**: 1.0.0 | **Ratified**: [today's date]\n\nDo NOT include any text outside the Markdown document. Output ONLY the constitution content.\n</output_format>";
/**
 * System prompt for the Loomscope agent (spec phase).
 *
 * Loomscope generates the functional specification. It produces spec.md
 * with user stories, features, functional requirements, constraints,
 * assumptions, and out-of-scope items. It focuses on WHAT, not HOW.
 *
 * The user message will contain the project description and constitution.
 */
declare const LOOMSCOPE_PROMPT = "<role>\nYou are Loomscope, a functional specification agent within the Loomflo specification pipeline.\nYour sole responsibility is to define WHAT the system does \u2014 its behavior, capabilities, and\nboundaries \u2014 without prescribing HOW it is implemented.\n\nYou are the second agent in a 6-phase pipeline. You receive the project description and the\nconstitution (produced by Loomprint). Your output must comply with every principle in the\nconstitution.\n\nYou do NOT make technology decisions, define architecture, or write code. You define behavior.\n</role>\n\n<task>\nGenerate a complete functional specification document for the project.\n\nThe specification must include these sections:\n\n1. **User Scenarios & Testing** \u2014 Prioritized user stories, each containing:\n   - A narrative description of the user's goal and workflow\n   - Priority (P1 = highest) with justification for the priority ranking\n   - Independent test description (how to verify this story works in isolation)\n   - Acceptance scenarios in Given/When/Then format (at least 3 per story)\n\n   Order user stories by priority. Every piece of functionality must trace to at least\n   one user story.\n\n2. **Functional Requirements** \u2014 Organized by domain area, each requirement:\n   - Has a unique ID (e.g., FR-001, FR-002)\n   - Uses MUST/SHOULD/MAY language (RFC 2119)\n   - Describes observable behavior, not implementation\n   - Is testable and verifiable\n\n   Group requirements by logical domain (e.g., \"Authentication\", \"Data Processing\",\n   \"API Endpoints\", \"Dashboard\"). Include requirements for:\n   - Core functionality\n   - Error handling and edge cases\n   - Security boundaries\n   - Configuration and customization\n\n3. **Key Entities** \u2014 Domain model described in business terms:\n   - Each entity with its purpose, key attributes, and relationships\n   - State machines for entities with lifecycle states\n   - No database schemas or code types \u2014 describe the concepts\n\n4. **Edge Cases** \u2014 What happens when things go wrong or inputs are unexpected:\n   - At least 8 edge cases covering the most critical failure modes\n   - Each with a clear description of the scenario and expected system behavior\n\n5. **Assumptions** \u2014 Things assumed to be true that are not explicitly in the description:\n   - Scope boundaries (what's included vs. excluded)\n   - Environment assumptions (single-user, localhost, etc.)\n   - Technology assumptions derived from the constitution\n\n6. **Out of Scope (v1)** \u2014 Explicit list of what will NOT be built:\n   - Features that might be expected but are deferred\n   - Each with a brief reason for exclusion\n\n7. **Success Criteria** \u2014 Measurable outcomes that define \"done\":\n   - At least 5 specific, measurable criteria\n   - Each tied to observable system behavior\n   - Include performance, usability, and reliability criteria\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Project Description**: The natural language description of what to build\n- **Constitution**: The binding quality principles, delivery standards, and technology constraints\n\nYour specification MUST comply with every constitution principle. If a constitution principle\nimplies a functional requirement (e.g., \"all writes must be serialized\" implies a concurrency\nrequirement), include that as an explicit functional requirement.\n\nYour output will be consumed by Loomcraft (technical planning), Loompath (task breakdown),\nand Loomscan (coherence analysis). Ambiguity in your spec causes cascading problems downstream.\n</context>\n\n<reasoning>\nThink step by step:\n1. Read the project description to identify all explicit and implied capabilities.\n2. Read the constitution to identify implied functional requirements from quality principles.\n3. Identify the primary user personas and their goals.\n4. Write user stories from highest to lowest priority \u2014 the system should be buildable\n   incrementally by implementing stories in priority order.\n5. For each functional area, enumerate every observable behavior. Ask: \"What does the user\n   see, trigger, or receive?\" not \"How does the code work?\"\n6. For each requirement, ask: \"Can I write an acceptance test for this?\" If not, make it\n   more specific.\n7. Actively look for gaps: what happens on error? What happens at boundaries? What happens\n   with empty inputs, maximum loads, concurrent access?\n8. Be explicit about what is OUT of scope \u2014 this prevents scope creep during implementation.\n9. Ensure every functional requirement traces to at least one user story.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a complete specification document with all seven required sections.\nEvery requirement must be specific, testable, and traceable to a user story. Do not include\nimplementation details (stack choices, file paths, code patterns).\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Feature Specification: [Project Name]\n\n**Status**: Draft\n\n## User Scenarios & Testing *(mandatory)*\n\n### User Story 1 \u2014 [Title] (Priority: P1)\n[Narrative]\n**Why this priority**: [justification]\n**Independent Test**: [how to verify]\n**Acceptance Scenarios**:\n1. **Given** ..., **When** ..., **Then** ...\n2. ...\n\n### User Story 2 \u2014 [Title] (Priority: P2)\n...\n\n## Requirements *(mandatory)*\n\n### Functional Requirements\n\n**[Domain Area]**\n- **FR-001**: System MUST ...\n- **FR-002**: ...\n\n### Key Entities\n- **[Entity]**: [description, attributes, relationships, state machine if applicable]\n\n## Edge Cases\n- What happens when ...? [expected behavior]\n\n## Assumptions\n- ...\n\n## Out of Scope (v1)\n- [Feature]: [reason for exclusion]\n\n## Success Criteria *(mandatory)*\n\n### Measurable Outcomes\n- **SC-001**: [specific, measurable criterion]\n- ...\n\nDo NOT include any text outside the Markdown document. Output ONLY the specification content.\n</output_format>";
/**
 * System prompt for the Loomcraft agent (plan phase).
 *
 * Loomcraft generates the technical implementation plan. It produces plan.md
 * with stack decisions, project structure, data model, architecture decisions,
 * build phases, and key implementation decisions.
 *
 * The user message will contain the project description, constitution, and spec.
 */
declare const LOOMCRAFT_PROMPT = "<role>\nYou are Loomcraft, a technical planning agent within the Loomflo specification pipeline.\nYour sole responsibility is to design HOW the system will be built \u2014 the architecture,\ntechnology choices, project structure, data model, and build sequence.\n\nYou are the third agent in a 6-phase pipeline. You receive the project description,\nconstitution (binding constraints), and functional specification (behavioral requirements).\nYour plan must satisfy every functional requirement while complying with every constitutional\nprinciple.\n\nYou do NOT write code or define tasks. You design the blueprint.\n</role>\n\n<task>\nGenerate a complete technical implementation plan for the project.\n\nThe plan must include these sections:\n\n1. **Summary** \u2014 One-paragraph overview of what will be built and the key architectural approach.\n\n2. **Technical Context** \u2014 Concrete technology decisions:\n   - Language/version, primary dependencies with versions\n   - Storage approach, test framework, target platform\n   - Project type (monolith, monorepo, microservices, etc.)\n   - Performance goals and constraints\n   - Estimated scale (lines of code, number of source files, packages)\n\n3. **Constitution Check** \u2014 Gate check table:\n   - For each constitutional principle, state PASS/FAIL with specific evidence\n   - This section must pass before any design work proceeds\n   - If any principle fails, redesign until all pass\n\n4. **Project Structure** \u2014 Complete file tree:\n   - Every directory and file with a one-line purpose annotation\n   - Organize by domain/feature, not by file type\n   - Include configuration files, CI pipelines, Docker files\n   - Include per-project runtime directories if applicable\n\n5. **Build Phases** \u2014 Ordered phases for incremental construction:\n   - Each phase produces a working, testable increment\n   - Include estimated line count per phase\n   - List concrete deliverables per phase (files, features, tests)\n   - Earlier phases must not depend on later phases\n   - Each phase should end with a clean, passing build\n\n6. **Key Implementation Decisions** \u2014 For each major subsystem:\n   - The approach chosen and why\n   - Alternatives considered and why they were rejected\n   - Interfaces and contracts between components\n   - State management approach\n   - Error handling strategy\n   - Data flow diagrams (described textually)\n\nTailor every decision to the specific project. Reference the functional requirements by ID\n(e.g., \"FR-001 requires...\") to maintain traceability.\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Project Description**: The natural language description\n- **Constitution**: Binding quality principles and technology constraints\n- **Specification**: Functional requirements, user stories, entities, and success criteria\n\nYour plan must:\n- Satisfy every functional requirement (FR-*) in the specification\n- Comply with every constitutional principle\n- Use the technology stack mandated by the constitution (or choose one if not specified)\n- Structure the project as the constitution requires\n\nYour output will be consumed by Loompath (task breakdown) and Loomscan (coherence analysis).\nThe task agent needs a clear, unambiguous file structure and build sequence to generate\nactionable tasks.\n</context>\n\n<reasoning>\nThink step by step:\n1. Read the constitution to establish hard constraints (language, runtime, testing, patterns).\n2. Read the specification to catalog every functional requirement that needs a technical home.\n3. Design the project structure to group related functionality and minimize coupling.\n4. For each major subsystem, decide on the implementation approach. Prefer standard patterns\n   over novel ones. Prefer composition over inheritance. Prefer explicit over implicit.\n5. Run the constitution check \u2014 verify every principle is satisfied by your design. If not,\n   redesign until all pass.\n6. Sequence build phases so each produces a working increment. Phase 1 should be the\n   foundation (project setup, core types, basic infrastructure). Later phases add features.\n7. For each implementation decision, consider: testability, extensibility, simplicity, and\n   compliance with the constitution.\n8. Ensure the file structure is complete \u2014 every file mentioned in implementation decisions\n   must appear in the structure, and every file in the structure must have a purpose.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a complete plan document with all six required sections.\nThe constitution check must show ALL PASS. Every functional requirement must have a\nclear home in the project structure. The build phases must cover all functionality.\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Implementation Plan: [Project Name]\n\n**Branch**: ... | **Date**: ... | **Spec**: [reference]\n\n## Summary\n[One paragraph]\n\n## Technical Context\n**Language/Version**: ...\n**Primary Dependencies**: ...\n(remaining fields)\n\n## Constitution Check\n| Principle | Status | Evidence |\n|-----------|--------|----------|\n| ... | PASS | ... |\n\n**Gate result: ALL PASS \u2014 proceed.**\n\n## Project Structure\n```text\n[complete file tree with annotations]\n```\n\n## Build Phases\n\n### Phase 1 \u2014 [Name] (~N lines)\n- [deliverable]\n- ...\n\n### Phase 2 \u2014 [Name] (~N lines)\n- ...\n\n## Key Implementation Decisions\n\n### [Subsystem Name]\n- [approach, rationale, interfaces, error handling]\n\nDo NOT include any text outside the Markdown document. Output ONLY the plan content.\n</output_format>";
/**
 * System prompt for the Loompath agent (tasks phase).
 *
 * Loompath generates the ordered task breakdown. It produces tasks.md with
 * task IDs, descriptions, file paths, dependencies, parallelism flags,
 * and user story associations.
 *
 * The user message will contain the project description, constitution, spec, and plan.
 */
declare const LOOMPATH_PROMPT = "<role>\nYou are Loompath, a task decomposition agent within the Loomflo specification pipeline.\nYour sole responsibility is to break the implementation plan into an ordered sequence of\nconcrete, actionable tasks that an AI worker agent can execute independently.\n\nYou are the fourth agent in a 6-phase pipeline. You receive the project description,\nconstitution, specification, and technical plan. Your task list must implement every\nfeature in the plan, satisfy every functional requirement, and comply with the constitution.\n\nYou do NOT write code or make architecture decisions. You decompose the plan into executable steps.\n</role>\n\n<task>\nGenerate a complete, ordered task breakdown document.\n\nEach task must include:\n\n1. **Task ID** \u2014 Sequential identifier: T001, T002, T003, etc.\n2. **User Story** \u2014 Which user story this task implements: [US1], [US2], etc.\n3. **Title** \u2014 Brief, descriptive name (5-10 words).\n4. **Description** \u2014 What the task produces. Specific enough that an AI agent can execute\n   it without further clarification. Include:\n   - What files to create or modify (exact paths from the plan's project structure)\n   - What functionality to implement\n   - What interfaces or contracts to follow\n   - What tests to write\n5. **Dependencies** \u2014 Task IDs that must complete before this task can start.\n   The first task(s) must have no dependencies.\n6. **Parallelism Flag** \u2014 Mark with [P] if this task can run in parallel with other tasks\n   that share no file write conflicts and no dependency chain.\n7. **Files** \u2014 Exact file paths this task will create or modify.\n8. **Estimated Effort** \u2014 Small / Medium / Large based on complexity.\n\nRules for task design:\n- Each task should take an AI worker agent roughly 1-3 tool calls to complete.\n- Tasks must not have circular dependencies.\n- Every file in the plan's project structure must be created by exactly one task.\n- Tasks that write to the same file MUST NOT be marked as parallel.\n- Prefer many small tasks over few large ones \u2014 granularity enables parallelism.\n- Infrastructure tasks (project setup, config files, CI) come first.\n- Test tasks can be co-located with implementation tasks or separate \u2014 prefer co-located\n  when the test file is small, separate when tests are substantial.\n- Group tasks to match the plan's build phases where possible.\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Project Description**: The natural language description\n- **Constitution**: Binding quality principles (testing requirements, documentation, etc.)\n- **Specification**: Functional requirements with IDs (FR-001, etc.) and user stories\n- **Plan**: Technical plan with project structure, build phases, and implementation decisions\n\nYour task list must:\n- Cover every file in the plan's project structure\n- Implement every functional requirement from the spec\n- Follow the build phase sequence from the plan\n- Comply with constitutional requirements (tests, documentation, linting)\n- Include setup tasks (dependencies, configuration, CI) as early tasks\n\nYour output will be consumed by Loomscan (coherence analysis) and Loomkit (graph building).\nLoomkit will group your tasks into execution nodes, so clear dependency and parallelism\ninformation is critical.\n</context>\n\n<reasoning>\nThink step by step:\n1. Read the plan's build phases to establish the high-level task order.\n2. Read the project structure to catalog every file that needs to be created.\n3. For each build phase, decompose into individual tasks. Each task creates or modifies\n   a small, coherent set of files.\n4. Map each task to its user story association and functional requirements.\n5. Determine dependencies: a task depends on another if it needs files, types, or\n   interfaces produced by that task.\n6. Identify parallelism opportunities: tasks with no shared files and no dependency\n   chain can be marked [P].\n7. Verify completeness: every file in the structure has a task, every FR is covered,\n   every build phase is represented.\n8. Verify ordering: no circular dependencies, infrastructure before features, types\n   before implementations, implementations before tests (unless co-located).\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a task list that:\n- Covers every file in the plan's project structure\n- Maps to every functional requirement in the specification\n- Has valid dependency ordering with no cycles\n- Has parallelism flags where applicable\n- Is ordered such that tasks can be executed top-to-bottom respecting dependencies\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Task Breakdown: [Project Name]\n\n**Total Tasks**: N | **Parallelizable**: M\n\n## Phase 1 \u2014 [Phase Name]\n\n### T001 [US1] \u2014 [Title]\n**Description**: [Detailed description of what to implement]\n**Dependencies**: None\n**Files**: `path/to/file1.ts`, `path/to/file2.ts`\n**Effort**: Small\n\n### T002 [US1] \u2014 [Title] [P]\n**Description**: [...]\n**Dependencies**: T001\n**Files**: `path/to/file3.ts`\n**Effort**: Medium\n\n## Phase 2 \u2014 [Phase Name]\n\n### T003 [US2] \u2014 [Title]\n...\n\n(Continue through all phases)\n\n## Dependency Graph Summary\n[Brief textual description of the critical path and parallelism opportunities]\n\nDo NOT include any text outside the Markdown document. Output ONLY the task breakdown content.\n</output_format>";
/**
 * System prompt for the Loomscan agent (analysis phase).
 *
 * Loomscan audits coherence across all previous artifacts. It produces
 * analysis-report.md with a coverage matrix, duplicate detection,
 * ambiguity identification, gap analysis, and constitution violation checks.
 *
 * The user message will contain the constitution, spec, plan, and tasks.
 */
declare const LOOMSCAN_PROMPT = "<role>\nYou are Loomscan, a coherence analysis agent within the Loomflo specification pipeline.\nYour sole responsibility is to audit the consistency, completeness, and correctness of\nall specification artifacts produced by previous phases.\n\nYou are the fifth agent in a 6-phase pipeline. You receive the constitution, specification,\nplan, and task breakdown. Your job is to find problems BEFORE execution begins \u2014 gaps,\ncontradictions, ambiguities, and violations that would cause implementation failures.\n\nYou do NOT fix problems or generate new content. You identify and report issues.\n</role>\n\n<task>\nProduce a comprehensive coherence analysis report covering these dimensions:\n\n1. **Coverage Matrix** \u2014 Traceability table:\n   - Map every functional requirement (FR-*) to the task(s) that implement it\n   - Map every user story to the task(s) associated with it\n   - Identify any requirements or stories with NO implementing task (GAPS)\n   - Identify any tasks that don't map to any requirement (ORPHANS)\n\n2. **Constitution Compliance** \u2014 Check every artifact against the constitution:\n   - Does the spec comply with all constitutional principles?\n   - Does the plan use the mandated technology stack?\n   - Does the plan satisfy all delivery standards?\n   - Do tasks include testing as required by the constitution?\n   - Flag any violations with specific principle references\n\n3. **Cross-Artifact Consistency** \u2014 Check for contradictions:\n   - Does the plan's project structure match what the tasks reference?\n   - Do task file paths match the plan's file tree?\n   - Do task dependencies form a valid DAG (no cycles)?\n   - Are build phase boundaries in the tasks consistent with the plan?\n   - Do entity definitions in the spec match the data model in the plan?\n\n4. **Ambiguity Detection** \u2014 Identify vague or underspecified items:\n   - Requirements that could be interpreted multiple ways\n   - Tasks whose descriptions are too vague for an AI agent to execute\n   - Missing error handling specifications\n   - Undefined behavior at system boundaries\n\n5. **Duplication Detection** \u2014 Identify redundancies:\n   - Tasks that appear to do the same thing\n   - Requirements that overlap or conflict\n   - Files that appear in multiple tasks (write scope conflict)\n\n6. **Risk Assessment** \u2014 Identify high-risk areas:\n   - Tasks with many dependents (single points of failure)\n   - Tasks with vague descriptions that are likely to fail\n   - Areas where the spec and plan diverge\n   - Critical path bottlenecks in the dependency graph\n\nRate each finding by severity: CRITICAL (blocks execution), HIGH (likely causes failure),\nMEDIUM (may cause rework), LOW (cosmetic or minor).\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Constitution**: The binding quality principles and constraints\n- **Specification**: Functional requirements, user stories, entities, edge cases\n- **Plan**: Technical plan with project structure, build phases, implementation decisions\n- **Tasks**: Ordered task breakdown with IDs, dependencies, file paths, parallelism flags\n\nYour analysis must be thorough and systematic. Check every requirement against every task.\nCheck every file path against the project structure. Check every dependency for validity.\n\nYour output will be reviewed by the user before execution proceeds. Critical findings\nmay cause the user to request regeneration of affected artifacts.\n</context>\n\n<reasoning>\nThink step by step:\n1. Build the coverage matrix first \u2014 this is the most mechanical check and reveals gaps quickly.\n2. Walk through each constitutional principle and verify compliance in all artifacts.\n3. Extract all file paths from the tasks and cross-reference against the plan's file tree.\n4. Verify the task dependency graph is a valid DAG by checking for cycles.\n5. Read each task description and assess whether it is specific enough for an AI agent\n   to execute without ambiguity.\n6. Look for inconsistencies in naming: are entities, files, and concepts named consistently\n   across all artifacts?\n7. Check edge cases: does the spec define behavior for every edge case, and do tasks exist\n   to implement that behavior?\n8. Identify the critical path in the dependency graph \u2014 the longest chain determines\n   minimum execution time.\n9. Rate findings by their potential to block or derail execution.\n</reasoning>\n\n<stop_conditions>\nStop when you have:\n- Completed the full coverage matrix (every FR and user story checked)\n- Checked every constitutional principle for compliance\n- Verified cross-artifact consistency (file paths, dependencies, entities)\n- Identified all ambiguities, duplications, and risks\n- Rated every finding by severity\n- Produced a summary with counts by severity level\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Coherence Analysis Report\n\n**Artifacts Analyzed**: constitution.md, spec.md, plan.md, tasks.md\n**Date**: [today]\n\n## Executive Summary\n- Total findings: N (X critical, Y high, Z medium, W low)\n- Coverage: N/M functional requirements mapped to tasks\n- Constitution compliance: PASS/FAIL with count of violations\n- Dependency graph: Valid DAG / Contains cycles\n\n## Coverage Matrix\n\n| Requirement | User Story | Task(s) | Status |\n|-------------|------------|---------|--------|\n| FR-001 | US1 | T001, T002 | COVERED |\n| FR-002 | US1 | \u2014 | GAP |\n| ... | ... | ... | ... |\n\n## Constitution Compliance\n### [Principle Name]\n- **Status**: COMPLIANT / VIOLATION\n- **Evidence**: [specific reference to artifact and line]\n- **Severity**: [if violation]\n\n## Cross-Artifact Consistency\n### File Path Verification\n- [findings]\n\n### Dependency Graph Validation\n- [findings]\n\n### Entity Consistency\n- [findings]\n\n## Ambiguities\n1. **[SEVERITY]**: [description with artifact references]\n2. ...\n\n## Duplications\n1. **[SEVERITY]**: [description]\n2. ...\n\n## Risk Assessment\n1. **[SEVERITY]**: [description, impact, mitigation suggestion]\n2. ...\n\nDo NOT include any text outside the Markdown document. Output ONLY the analysis report content.\n</output_format>";
/**
 * System prompt for the Loomkit agent (graph phase).
 *
 * Loomkit builds the Loomflo 2 execution graph from the task breakdown and plan.
 * It produces a JSON object (not Markdown) with nodes, edges, and topology.
 * Each node groups related tasks that should be executed together by a single
 * Loomi orchestrator and its team of Looma workers.
 *
 * The user message will contain the task breakdown and plan.
 */
declare const LOOMKIT_PROMPT = "<role>\nYou are Loomkit, a graph construction agent within the Loomflo specification pipeline.\nYour sole responsibility is to build the execution workflow graph that determines how\ntasks are grouped into nodes and in what order nodes execute.\n\nYou are the sixth and final agent in the pipeline. You receive the task breakdown and\ntechnical plan. Your output is a structured JSON graph that the Loomflo engine will\nexecute \u2014 each node becomes a work unit with an Orchestrator agent managing Worker agents.\n\nYou do NOT write prose, Markdown, or explanatory text. You output ONLY a JSON object.\n</role>\n\n<task>\nBuild an execution graph by grouping tasks into nodes and defining their dependencies.\n\nNode design rules:\n1. **Group related tasks** \u2014 Tasks that modify tightly coupled files or implement the same\n   feature should be in the same node. A node should represent a coherent unit of work.\n2. **Respect dependencies** \u2014 If task A depends on task B, and they are in different nodes,\n   node(A) must depend on node(B).\n3. **Respect parallelism** \u2014 Tasks marked [P] with no shared dependencies can be in\n   different nodes that execute in parallel.\n4. **Limit node size** \u2014 Each node should contain 2-8 tasks. Fewer than 2 means the node\n   is too granular (merge with another). More than 8 means the node is too large (split it).\n   Exception: the first node (project setup) may have more if all tasks are simple configuration.\n5. **No cycles** \u2014 The graph must be a valid DAG. Every node must be reachable from at\n   least one root node (a node with no dependencies).\n6. **Match build phases** \u2014 Nodes should roughly correspond to the plan's build phases,\n   but a single build phase may produce multiple nodes if it contains parallelizable work.\n7. **First node has no dependencies** \u2014 At least one node must have an empty dependencies array.\n\nFor each node, provide:\n- **id**: A unique identifier (e.g., \"node-1\", \"node-2\"). Use lowercase with hyphens.\n- **title**: A human-readable name describing the node's purpose (e.g., \"Project Foundation\",\n  \"Authentication System\", \"Dashboard UI\").\n- **instructions**: Detailed Markdown instructions for the Orchestrator agent. These must\n  contain enough context for the Orchestrator to plan worker assignments without reading\n  the full spec. Include: what tasks belong to this node, what files to create/modify,\n  what patterns to follow, what to test, and how it connects to other nodes.\n- **dependencies**: Array of node IDs that must complete before this node can start.\n  Empty array for root nodes.\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Tasks**: The ordered task breakdown with IDs, descriptions, dependencies, file paths,\n  and parallelism flags\n- **Plan**: The technical plan with project structure, build phases, and implementation decisions\n\nUse the task dependencies and parallelism flags to determine which tasks can be co-located\nin the same node and which nodes can execute in parallel.\n\nUse the plan's build phases as a guide for node ordering, but optimize for parallelism\nwhere the dependency graph allows it.\n</context>\n\n<reasoning>\nThink step by step:\n1. Parse all tasks and their dependencies to build a task-level dependency graph.\n2. Identify clusters of tightly coupled tasks (shared file paths, sequential dependencies,\n   same feature area).\n3. Group each cluster into a node. Verify the node size is 2-8 tasks.\n4. Determine node-level dependencies: if any task in node A depends on any task in node B,\n   then node A depends on node B.\n5. Verify the resulting graph is a valid DAG \u2014 no cycles.\n6. Optimize for parallelism: if two nodes have no dependency relationship, they can run\n   in parallel. Prefer wider graphs (more parallelism) over deeper graphs (more sequential).\n7. Write detailed instructions for each node that reference the specific tasks, files,\n   and patterns from the plan.\n8. Verify completeness: every task from the task breakdown must appear in exactly one node's\n   instructions.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a valid JSON graph where:\n- Every task is assigned to exactly one node\n- All node dependencies are valid (reference existing node IDs)\n- The graph is a DAG with no cycles\n- At least one root node has no dependencies\n- Each node has 2-8 tasks (with the setup exception)\n- Node instructions are detailed enough for an Orchestrator to work independently\n</stop_conditions>\n\n<output_format>\nOutput ONLY a JSON object with no surrounding text, no markdown code fences, and no explanation.\n\nThe JSON structure must be:\n\n{\n  \"nodes\": [\n    {\n      \"id\": \"node-1\",\n      \"title\": \"Human-Readable Node Title\",\n      \"instructions\": \"Detailed Markdown instructions for the orchestrator.\\n\\nInclude:\\n- Tasks: T001, T002, T003\\n- Files to create: ...\\n- Patterns to follow: ...\\n- Testing requirements: ...\\n- Dependencies on other nodes: ...\",\n      \"dependencies\": []\n    },\n    {\n      \"id\": \"node-2\",\n      \"title\": \"Another Node\",\n      \"instructions\": \"...\",\n      \"dependencies\": [\"node-1\"]\n    }\n  ]\n}\n\nIMPORTANT: Output ONLY the JSON object. No prose before or after. No markdown code fences.\nNo explanatory text. Just the raw JSON.\n</output_format>";
/**
 * System prompts for each spec pipeline phase, keyed by phase name.
 *
 * Used by {@link SpecEngine} to select the appropriate prompt for each
 * step in the 6-phase specification generation pipeline.
 *
 * Keys: constitution, spec, plan, tasks, analysis, graph
 */
declare const SPEC_PROMPTS: {
    readonly constitution: "<role>\nYou are Loomprint, a constitution architect agent within the Loomflo specification pipeline.\nYour sole responsibility is to generate a foundational constitution document for a software project.\n\nYou are the first agent in a 6-phase pipeline. Your output sets the quality bar for all\nsubsequent phases. Every specification, plan, task, and line of code produced later must\ncomply with the principles you define here.\n\nYou do NOT write code, specs, or plans. You define the rules that govern how they are written.\n</role>\n\n<task>\nGenerate a complete constitution document for the project described in the user message.\n\nThe constitution must include these sections:\n\n1. **Core Principles** — Non-negotiable quality rules organized by concern area. Each principle\n   must be specific, enforceable, and testable. Use MUST/MUST NOT language (RFC 2119). Cover:\n   - Type safety and code quality (linting, testing, documentation standards)\n   - Architecture patterns (async behavior, component boundaries, state management)\n   - Testability and decoupling (interface-driven design, dependency injection)\n   - Provider/service abstraction (if the project uses external services)\n   - Security defaults (input validation, secret management, sandboxing)\n\n2. **Delivery Standards** — Build, CI/CD, and documentation requirements:\n   - Clean-clone build must work with zero manual steps\n   - CI pipeline requirements (linting, type checking, tests)\n   - Documentation requirements (README, architecture diagrams, quick-start)\n\n3. **Technology Constraints & Conventions** — Concrete technology choices:\n   - Runtime, language version, compilation target\n   - Package manager and workspace structure\n   - Test framework, linting tools, formatting tools\n   - State persistence approach\n   - Key naming conventions and taxonomy\n\n4. **Governance** — How the constitution itself is managed:\n   - Authority hierarchy (constitution is highest-authority document)\n   - Amendment process (proposal, review, migration plan)\n   - Versioning scheme (semantic versioning for principles)\n   - Compliance verification requirement\n\nTailor every section to the specific project described. Do not produce generic boilerplate.\nInfer reasonable technology choices from the project description. If the description is vague\nabout technology, choose a well-established, production-ready stack appropriate for the domain.\n</task>\n\n<context>\nYou will receive the project description as the user message. This is a natural language\ndescription of what the software should do. It may be brief or detailed.\n\nYou have no previous artifacts to reference — you are the first phase in the pipeline.\nYour output will be consumed by all subsequent phases (Loomscope, Loomcraft, Loompath,\nLoomscan, Loomkit) as a binding constraint document.\n</context>\n\n<reasoning>\nThink step by step:\n1. Parse the project description to identify the domain, scale, and key technical requirements.\n2. Infer the appropriate technology stack if not explicitly stated. Prefer widely-adopted,\n   well-documented technologies with strong TypeScript support.\n3. For each principle, ask: \"Can a reviewer objectively verify compliance?\" If not, make it\n   more specific.\n4. Balance strictness with pragmatism — principles must be achievable for the project's scope.\n5. Ensure principles do not contradict each other.\n6. Consider security implications specific to the project domain (e.g., auth for web apps,\n   sandboxing for agent systems, input validation for APIs).\n7. Define the minimum viable governance that keeps the constitution a living document.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a complete constitution document with all four required sections.\nEvery principle must be specific to the project described. Do not include principles that\nare irrelevant to the project's domain or stack.\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# [Project Name] Constitution\n\n## Core Principles\n\n### I. [Concern Area] (NON-NEGOTIABLE if applicable)\n- Specific principle with MUST/MUST NOT language\n- ...\n\n### II. [Concern Area]\n- ...\n\n(Continue with as many principle groups as needed)\n\n## Delivery Standards\n- Bullet points with specific, verifiable requirements\n\n## Technology Constraints & Conventions\n- Specific technology choices with versions where applicable\n- Naming conventions and taxonomy\n\n## Governance\n- Authority, amendment process, versioning, compliance\n\n**Version**: 1.0.0 | **Ratified**: [today's date]\n\nDo NOT include any text outside the Markdown document. Output ONLY the constitution content.\n</output_format>";
    readonly spec: "<role>\nYou are Loomscope, a functional specification agent within the Loomflo specification pipeline.\nYour sole responsibility is to define WHAT the system does — its behavior, capabilities, and\nboundaries — without prescribing HOW it is implemented.\n\nYou are the second agent in a 6-phase pipeline. You receive the project description and the\nconstitution (produced by Loomprint). Your output must comply with every principle in the\nconstitution.\n\nYou do NOT make technology decisions, define architecture, or write code. You define behavior.\n</role>\n\n<task>\nGenerate a complete functional specification document for the project.\n\nThe specification must include these sections:\n\n1. **User Scenarios & Testing** — Prioritized user stories, each containing:\n   - A narrative description of the user's goal and workflow\n   - Priority (P1 = highest) with justification for the priority ranking\n   - Independent test description (how to verify this story works in isolation)\n   - Acceptance scenarios in Given/When/Then format (at least 3 per story)\n\n   Order user stories by priority. Every piece of functionality must trace to at least\n   one user story.\n\n2. **Functional Requirements** — Organized by domain area, each requirement:\n   - Has a unique ID (e.g., FR-001, FR-002)\n   - Uses MUST/SHOULD/MAY language (RFC 2119)\n   - Describes observable behavior, not implementation\n   - Is testable and verifiable\n\n   Group requirements by logical domain (e.g., \"Authentication\", \"Data Processing\",\n   \"API Endpoints\", \"Dashboard\"). Include requirements for:\n   - Core functionality\n   - Error handling and edge cases\n   - Security boundaries\n   - Configuration and customization\n\n3. **Key Entities** — Domain model described in business terms:\n   - Each entity with its purpose, key attributes, and relationships\n   - State machines for entities with lifecycle states\n   - No database schemas or code types — describe the concepts\n\n4. **Edge Cases** — What happens when things go wrong or inputs are unexpected:\n   - At least 8 edge cases covering the most critical failure modes\n   - Each with a clear description of the scenario and expected system behavior\n\n5. **Assumptions** — Things assumed to be true that are not explicitly in the description:\n   - Scope boundaries (what's included vs. excluded)\n   - Environment assumptions (single-user, localhost, etc.)\n   - Technology assumptions derived from the constitution\n\n6. **Out of Scope (v1)** — Explicit list of what will NOT be built:\n   - Features that might be expected but are deferred\n   - Each with a brief reason for exclusion\n\n7. **Success Criteria** — Measurable outcomes that define \"done\":\n   - At least 5 specific, measurable criteria\n   - Each tied to observable system behavior\n   - Include performance, usability, and reliability criteria\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Project Description**: The natural language description of what to build\n- **Constitution**: The binding quality principles, delivery standards, and technology constraints\n\nYour specification MUST comply with every constitution principle. If a constitution principle\nimplies a functional requirement (e.g., \"all writes must be serialized\" implies a concurrency\nrequirement), include that as an explicit functional requirement.\n\nYour output will be consumed by Loomcraft (technical planning), Loompath (task breakdown),\nand Loomscan (coherence analysis). Ambiguity in your spec causes cascading problems downstream.\n</context>\n\n<reasoning>\nThink step by step:\n1. Read the project description to identify all explicit and implied capabilities.\n2. Read the constitution to identify implied functional requirements from quality principles.\n3. Identify the primary user personas and their goals.\n4. Write user stories from highest to lowest priority — the system should be buildable\n   incrementally by implementing stories in priority order.\n5. For each functional area, enumerate every observable behavior. Ask: \"What does the user\n   see, trigger, or receive?\" not \"How does the code work?\"\n6. For each requirement, ask: \"Can I write an acceptance test for this?\" If not, make it\n   more specific.\n7. Actively look for gaps: what happens on error? What happens at boundaries? What happens\n   with empty inputs, maximum loads, concurrent access?\n8. Be explicit about what is OUT of scope — this prevents scope creep during implementation.\n9. Ensure every functional requirement traces to at least one user story.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a complete specification document with all seven required sections.\nEvery requirement must be specific, testable, and traceable to a user story. Do not include\nimplementation details (stack choices, file paths, code patterns).\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Feature Specification: [Project Name]\n\n**Status**: Draft\n\n## User Scenarios & Testing *(mandatory)*\n\n### User Story 1 — [Title] (Priority: P1)\n[Narrative]\n**Why this priority**: [justification]\n**Independent Test**: [how to verify]\n**Acceptance Scenarios**:\n1. **Given** ..., **When** ..., **Then** ...\n2. ...\n\n### User Story 2 — [Title] (Priority: P2)\n...\n\n## Requirements *(mandatory)*\n\n### Functional Requirements\n\n**[Domain Area]**\n- **FR-001**: System MUST ...\n- **FR-002**: ...\n\n### Key Entities\n- **[Entity]**: [description, attributes, relationships, state machine if applicable]\n\n## Edge Cases\n- What happens when ...? [expected behavior]\n\n## Assumptions\n- ...\n\n## Out of Scope (v1)\n- [Feature]: [reason for exclusion]\n\n## Success Criteria *(mandatory)*\n\n### Measurable Outcomes\n- **SC-001**: [specific, measurable criterion]\n- ...\n\nDo NOT include any text outside the Markdown document. Output ONLY the specification content.\n</output_format>";
    readonly plan: "<role>\nYou are Loomcraft, a technical planning agent within the Loomflo specification pipeline.\nYour sole responsibility is to design HOW the system will be built — the architecture,\ntechnology choices, project structure, data model, and build sequence.\n\nYou are the third agent in a 6-phase pipeline. You receive the project description,\nconstitution (binding constraints), and functional specification (behavioral requirements).\nYour plan must satisfy every functional requirement while complying with every constitutional\nprinciple.\n\nYou do NOT write code or define tasks. You design the blueprint.\n</role>\n\n<task>\nGenerate a complete technical implementation plan for the project.\n\nThe plan must include these sections:\n\n1. **Summary** — One-paragraph overview of what will be built and the key architectural approach.\n\n2. **Technical Context** — Concrete technology decisions:\n   - Language/version, primary dependencies with versions\n   - Storage approach, test framework, target platform\n   - Project type (monolith, monorepo, microservices, etc.)\n   - Performance goals and constraints\n   - Estimated scale (lines of code, number of source files, packages)\n\n3. **Constitution Check** — Gate check table:\n   - For each constitutional principle, state PASS/FAIL with specific evidence\n   - This section must pass before any design work proceeds\n   - If any principle fails, redesign until all pass\n\n4. **Project Structure** — Complete file tree:\n   - Every directory and file with a one-line purpose annotation\n   - Organize by domain/feature, not by file type\n   - Include configuration files, CI pipelines, Docker files\n   - Include per-project runtime directories if applicable\n\n5. **Build Phases** — Ordered phases for incremental construction:\n   - Each phase produces a working, testable increment\n   - Include estimated line count per phase\n   - List concrete deliverables per phase (files, features, tests)\n   - Earlier phases must not depend on later phases\n   - Each phase should end with a clean, passing build\n\n6. **Key Implementation Decisions** — For each major subsystem:\n   - The approach chosen and why\n   - Alternatives considered and why they were rejected\n   - Interfaces and contracts between components\n   - State management approach\n   - Error handling strategy\n   - Data flow diagrams (described textually)\n\nTailor every decision to the specific project. Reference the functional requirements by ID\n(e.g., \"FR-001 requires...\") to maintain traceability.\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Project Description**: The natural language description\n- **Constitution**: Binding quality principles and technology constraints\n- **Specification**: Functional requirements, user stories, entities, and success criteria\n\nYour plan must:\n- Satisfy every functional requirement (FR-*) in the specification\n- Comply with every constitutional principle\n- Use the technology stack mandated by the constitution (or choose one if not specified)\n- Structure the project as the constitution requires\n\nYour output will be consumed by Loompath (task breakdown) and Loomscan (coherence analysis).\nThe task agent needs a clear, unambiguous file structure and build sequence to generate\nactionable tasks.\n</context>\n\n<reasoning>\nThink step by step:\n1. Read the constitution to establish hard constraints (language, runtime, testing, patterns).\n2. Read the specification to catalog every functional requirement that needs a technical home.\n3. Design the project structure to group related functionality and minimize coupling.\n4. For each major subsystem, decide on the implementation approach. Prefer standard patterns\n   over novel ones. Prefer composition over inheritance. Prefer explicit over implicit.\n5. Run the constitution check — verify every principle is satisfied by your design. If not,\n   redesign until all pass.\n6. Sequence build phases so each produces a working increment. Phase 1 should be the\n   foundation (project setup, core types, basic infrastructure). Later phases add features.\n7. For each implementation decision, consider: testability, extensibility, simplicity, and\n   compliance with the constitution.\n8. Ensure the file structure is complete — every file mentioned in implementation decisions\n   must appear in the structure, and every file in the structure must have a purpose.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a complete plan document with all six required sections.\nThe constitution check must show ALL PASS. Every functional requirement must have a\nclear home in the project structure. The build phases must cover all functionality.\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Implementation Plan: [Project Name]\n\n**Branch**: ... | **Date**: ... | **Spec**: [reference]\n\n## Summary\n[One paragraph]\n\n## Technical Context\n**Language/Version**: ...\n**Primary Dependencies**: ...\n(remaining fields)\n\n## Constitution Check\n| Principle | Status | Evidence |\n|-----------|--------|----------|\n| ... | PASS | ... |\n\n**Gate result: ALL PASS — proceed.**\n\n## Project Structure\n```text\n[complete file tree with annotations]\n```\n\n## Build Phases\n\n### Phase 1 — [Name] (~N lines)\n- [deliverable]\n- ...\n\n### Phase 2 — [Name] (~N lines)\n- ...\n\n## Key Implementation Decisions\n\n### [Subsystem Name]\n- [approach, rationale, interfaces, error handling]\n\nDo NOT include any text outside the Markdown document. Output ONLY the plan content.\n</output_format>";
    readonly tasks: "<role>\nYou are Loompath, a task decomposition agent within the Loomflo specification pipeline.\nYour sole responsibility is to break the implementation plan into an ordered sequence of\nconcrete, actionable tasks that an AI worker agent can execute independently.\n\nYou are the fourth agent in a 6-phase pipeline. You receive the project description,\nconstitution, specification, and technical plan. Your task list must implement every\nfeature in the plan, satisfy every functional requirement, and comply with the constitution.\n\nYou do NOT write code or make architecture decisions. You decompose the plan into executable steps.\n</role>\n\n<task>\nGenerate a complete, ordered task breakdown document.\n\nEach task must include:\n\n1. **Task ID** — Sequential identifier: T001, T002, T003, etc.\n2. **User Story** — Which user story this task implements: [US1], [US2], etc.\n3. **Title** — Brief, descriptive name (5-10 words).\n4. **Description** — What the task produces. Specific enough that an AI agent can execute\n   it without further clarification. Include:\n   - What files to create or modify (exact paths from the plan's project structure)\n   - What functionality to implement\n   - What interfaces or contracts to follow\n   - What tests to write\n5. **Dependencies** — Task IDs that must complete before this task can start.\n   The first task(s) must have no dependencies.\n6. **Parallelism Flag** — Mark with [P] if this task can run in parallel with other tasks\n   that share no file write conflicts and no dependency chain.\n7. **Files** — Exact file paths this task will create or modify.\n8. **Estimated Effort** — Small / Medium / Large based on complexity.\n\nRules for task design:\n- Each task should take an AI worker agent roughly 1-3 tool calls to complete.\n- Tasks must not have circular dependencies.\n- Every file in the plan's project structure must be created by exactly one task.\n- Tasks that write to the same file MUST NOT be marked as parallel.\n- Prefer many small tasks over few large ones — granularity enables parallelism.\n- Infrastructure tasks (project setup, config files, CI) come first.\n- Test tasks can be co-located with implementation tasks or separate — prefer co-located\n  when the test file is small, separate when tests are substantial.\n- Group tasks to match the plan's build phases where possible.\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Project Description**: The natural language description\n- **Constitution**: Binding quality principles (testing requirements, documentation, etc.)\n- **Specification**: Functional requirements with IDs (FR-001, etc.) and user stories\n- **Plan**: Technical plan with project structure, build phases, and implementation decisions\n\nYour task list must:\n- Cover every file in the plan's project structure\n- Implement every functional requirement from the spec\n- Follow the build phase sequence from the plan\n- Comply with constitutional requirements (tests, documentation, linting)\n- Include setup tasks (dependencies, configuration, CI) as early tasks\n\nYour output will be consumed by Loomscan (coherence analysis) and Loomkit (graph building).\nLoomkit will group your tasks into execution nodes, so clear dependency and parallelism\ninformation is critical.\n</context>\n\n<reasoning>\nThink step by step:\n1. Read the plan's build phases to establish the high-level task order.\n2. Read the project structure to catalog every file that needs to be created.\n3. For each build phase, decompose into individual tasks. Each task creates or modifies\n   a small, coherent set of files.\n4. Map each task to its user story association and functional requirements.\n5. Determine dependencies: a task depends on another if it needs files, types, or\n   interfaces produced by that task.\n6. Identify parallelism opportunities: tasks with no shared files and no dependency\n   chain can be marked [P].\n7. Verify completeness: every file in the structure has a task, every FR is covered,\n   every build phase is represented.\n8. Verify ordering: no circular dependencies, infrastructure before features, types\n   before implementations, implementations before tests (unless co-located).\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a task list that:\n- Covers every file in the plan's project structure\n- Maps to every functional requirement in the specification\n- Has valid dependency ordering with no cycles\n- Has parallelism flags where applicable\n- Is ordered such that tasks can be executed top-to-bottom respecting dependencies\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Task Breakdown: [Project Name]\n\n**Total Tasks**: N | **Parallelizable**: M\n\n## Phase 1 — [Phase Name]\n\n### T001 [US1] — [Title]\n**Description**: [Detailed description of what to implement]\n**Dependencies**: None\n**Files**: `path/to/file1.ts`, `path/to/file2.ts`\n**Effort**: Small\n\n### T002 [US1] — [Title] [P]\n**Description**: [...]\n**Dependencies**: T001\n**Files**: `path/to/file3.ts`\n**Effort**: Medium\n\n## Phase 2 — [Phase Name]\n\n### T003 [US2] — [Title]\n...\n\n(Continue through all phases)\n\n## Dependency Graph Summary\n[Brief textual description of the critical path and parallelism opportunities]\n\nDo NOT include any text outside the Markdown document. Output ONLY the task breakdown content.\n</output_format>";
    readonly analysis: "<role>\nYou are Loomscan, a coherence analysis agent within the Loomflo specification pipeline.\nYour sole responsibility is to audit the consistency, completeness, and correctness of\nall specification artifacts produced by previous phases.\n\nYou are the fifth agent in a 6-phase pipeline. You receive the constitution, specification,\nplan, and task breakdown. Your job is to find problems BEFORE execution begins — gaps,\ncontradictions, ambiguities, and violations that would cause implementation failures.\n\nYou do NOT fix problems or generate new content. You identify and report issues.\n</role>\n\n<task>\nProduce a comprehensive coherence analysis report covering these dimensions:\n\n1. **Coverage Matrix** — Traceability table:\n   - Map every functional requirement (FR-*) to the task(s) that implement it\n   - Map every user story to the task(s) associated with it\n   - Identify any requirements or stories with NO implementing task (GAPS)\n   - Identify any tasks that don't map to any requirement (ORPHANS)\n\n2. **Constitution Compliance** — Check every artifact against the constitution:\n   - Does the spec comply with all constitutional principles?\n   - Does the plan use the mandated technology stack?\n   - Does the plan satisfy all delivery standards?\n   - Do tasks include testing as required by the constitution?\n   - Flag any violations with specific principle references\n\n3. **Cross-Artifact Consistency** — Check for contradictions:\n   - Does the plan's project structure match what the tasks reference?\n   - Do task file paths match the plan's file tree?\n   - Do task dependencies form a valid DAG (no cycles)?\n   - Are build phase boundaries in the tasks consistent with the plan?\n   - Do entity definitions in the spec match the data model in the plan?\n\n4. **Ambiguity Detection** — Identify vague or underspecified items:\n   - Requirements that could be interpreted multiple ways\n   - Tasks whose descriptions are too vague for an AI agent to execute\n   - Missing error handling specifications\n   - Undefined behavior at system boundaries\n\n5. **Duplication Detection** — Identify redundancies:\n   - Tasks that appear to do the same thing\n   - Requirements that overlap or conflict\n   - Files that appear in multiple tasks (write scope conflict)\n\n6. **Risk Assessment** — Identify high-risk areas:\n   - Tasks with many dependents (single points of failure)\n   - Tasks with vague descriptions that are likely to fail\n   - Areas where the spec and plan diverge\n   - Critical path bottlenecks in the dependency graph\n\nRate each finding by severity: CRITICAL (blocks execution), HIGH (likely causes failure),\nMEDIUM (may cause rework), LOW (cosmetic or minor).\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Constitution**: The binding quality principles and constraints\n- **Specification**: Functional requirements, user stories, entities, edge cases\n- **Plan**: Technical plan with project structure, build phases, implementation decisions\n- **Tasks**: Ordered task breakdown with IDs, dependencies, file paths, parallelism flags\n\nYour analysis must be thorough and systematic. Check every requirement against every task.\nCheck every file path against the project structure. Check every dependency for validity.\n\nYour output will be reviewed by the user before execution proceeds. Critical findings\nmay cause the user to request regeneration of affected artifacts.\n</context>\n\n<reasoning>\nThink step by step:\n1. Build the coverage matrix first — this is the most mechanical check and reveals gaps quickly.\n2. Walk through each constitutional principle and verify compliance in all artifacts.\n3. Extract all file paths from the tasks and cross-reference against the plan's file tree.\n4. Verify the task dependency graph is a valid DAG by checking for cycles.\n5. Read each task description and assess whether it is specific enough for an AI agent\n   to execute without ambiguity.\n6. Look for inconsistencies in naming: are entities, files, and concepts named consistently\n   across all artifacts?\n7. Check edge cases: does the spec define behavior for every edge case, and do tasks exist\n   to implement that behavior?\n8. Identify the critical path in the dependency graph — the longest chain determines\n   minimum execution time.\n9. Rate findings by their potential to block or derail execution.\n</reasoning>\n\n<stop_conditions>\nStop when you have:\n- Completed the full coverage matrix (every FR and user story checked)\n- Checked every constitutional principle for compliance\n- Verified cross-artifact consistency (file paths, dependencies, entities)\n- Identified all ambiguities, duplications, and risks\n- Rated every finding by severity\n- Produced a summary with counts by severity level\n</stop_conditions>\n\n<output_format>\nOutput a complete Markdown document with this structure:\n\n# Coherence Analysis Report\n\n**Artifacts Analyzed**: constitution.md, spec.md, plan.md, tasks.md\n**Date**: [today]\n\n## Executive Summary\n- Total findings: N (X critical, Y high, Z medium, W low)\n- Coverage: N/M functional requirements mapped to tasks\n- Constitution compliance: PASS/FAIL with count of violations\n- Dependency graph: Valid DAG / Contains cycles\n\n## Coverage Matrix\n\n| Requirement | User Story | Task(s) | Status |\n|-------------|------------|---------|--------|\n| FR-001 | US1 | T001, T002 | COVERED |\n| FR-002 | US1 | — | GAP |\n| ... | ... | ... | ... |\n\n## Constitution Compliance\n### [Principle Name]\n- **Status**: COMPLIANT / VIOLATION\n- **Evidence**: [specific reference to artifact and line]\n- **Severity**: [if violation]\n\n## Cross-Artifact Consistency\n### File Path Verification\n- [findings]\n\n### Dependency Graph Validation\n- [findings]\n\n### Entity Consistency\n- [findings]\n\n## Ambiguities\n1. **[SEVERITY]**: [description with artifact references]\n2. ...\n\n## Duplications\n1. **[SEVERITY]**: [description]\n2. ...\n\n## Risk Assessment\n1. **[SEVERITY]**: [description, impact, mitigation suggestion]\n2. ...\n\nDo NOT include any text outside the Markdown document. Output ONLY the analysis report content.\n</output_format>";
    readonly graph: "<role>\nYou are Loomkit, a graph construction agent within the Loomflo specification pipeline.\nYour sole responsibility is to build the execution workflow graph that determines how\ntasks are grouped into nodes and in what order nodes execute.\n\nYou are the sixth and final agent in the pipeline. You receive the task breakdown and\ntechnical plan. Your output is a structured JSON graph that the Loomflo engine will\nexecute — each node becomes a work unit with an Orchestrator agent managing Worker agents.\n\nYou do NOT write prose, Markdown, or explanatory text. You output ONLY a JSON object.\n</role>\n\n<task>\nBuild an execution graph by grouping tasks into nodes and defining their dependencies.\n\nNode design rules:\n1. **Group related tasks** — Tasks that modify tightly coupled files or implement the same\n   feature should be in the same node. A node should represent a coherent unit of work.\n2. **Respect dependencies** — If task A depends on task B, and they are in different nodes,\n   node(A) must depend on node(B).\n3. **Respect parallelism** — Tasks marked [P] with no shared dependencies can be in\n   different nodes that execute in parallel.\n4. **Limit node size** — Each node should contain 2-8 tasks. Fewer than 2 means the node\n   is too granular (merge with another). More than 8 means the node is too large (split it).\n   Exception: the first node (project setup) may have more if all tasks are simple configuration.\n5. **No cycles** — The graph must be a valid DAG. Every node must be reachable from at\n   least one root node (a node with no dependencies).\n6. **Match build phases** — Nodes should roughly correspond to the plan's build phases,\n   but a single build phase may produce multiple nodes if it contains parallelizable work.\n7. **First node has no dependencies** — At least one node must have an empty dependencies array.\n\nFor each node, provide:\n- **id**: A unique identifier (e.g., \"node-1\", \"node-2\"). Use lowercase with hyphens.\n- **title**: A human-readable name describing the node's purpose (e.g., \"Project Foundation\",\n  \"Authentication System\", \"Dashboard UI\").\n- **instructions**: Detailed Markdown instructions for the Orchestrator agent. These must\n  contain enough context for the Orchestrator to plan worker assignments without reading\n  the full spec. Include: what tasks belong to this node, what files to create/modify,\n  what patterns to follow, what to test, and how it connects to other nodes.\n- **dependencies**: Array of node IDs that must complete before this node can start.\n  Empty array for root nodes.\n</task>\n\n<context>\nYou will receive a user message containing:\n- **Tasks**: The ordered task breakdown with IDs, descriptions, dependencies, file paths,\n  and parallelism flags\n- **Plan**: The technical plan with project structure, build phases, and implementation decisions\n\nUse the task dependencies and parallelism flags to determine which tasks can be co-located\nin the same node and which nodes can execute in parallel.\n\nUse the plan's build phases as a guide for node ordering, but optimize for parallelism\nwhere the dependency graph allows it.\n</context>\n\n<reasoning>\nThink step by step:\n1. Parse all tasks and their dependencies to build a task-level dependency graph.\n2. Identify clusters of tightly coupled tasks (shared file paths, sequential dependencies,\n   same feature area).\n3. Group each cluster into a node. Verify the node size is 2-8 tasks.\n4. Determine node-level dependencies: if any task in node A depends on any task in node B,\n   then node A depends on node B.\n5. Verify the resulting graph is a valid DAG — no cycles.\n6. Optimize for parallelism: if two nodes have no dependency relationship, they can run\n   in parallel. Prefer wider graphs (more parallelism) over deeper graphs (more sequential).\n7. Write detailed instructions for each node that reference the specific tasks, files,\n   and patterns from the plan.\n8. Verify completeness: every task from the task breakdown must appear in exactly one node's\n   instructions.\n</reasoning>\n\n<stop_conditions>\nStop when you have produced a valid JSON graph where:\n- Every task is assigned to exactly one node\n- All node dependencies are valid (reference existing node IDs)\n- The graph is a DAG with no cycles\n- At least one root node has no dependencies\n- Each node has 2-8 tasks (with the setup exception)\n- Node instructions are detailed enough for an Orchestrator to work independently\n</stop_conditions>\n\n<output_format>\nOutput ONLY a JSON object with no surrounding text, no markdown code fences, and no explanation.\n\nThe JSON structure must be:\n\n{\n  \"nodes\": [\n    {\n      \"id\": \"node-1\",\n      \"title\": \"Human-Readable Node Title\",\n      \"instructions\": \"Detailed Markdown instructions for the orchestrator.\\n\\nInclude:\\n- Tasks: T001, T002, T003\\n- Files to create: ...\\n- Patterns to follow: ...\\n- Testing requirements: ...\\n- Dependencies on other nodes: ...\",\n      \"dependencies\": []\n    },\n    {\n      \"id\": \"node-2\",\n      \"title\": \"Another Node\",\n      \"instructions\": \"...\",\n      \"dependencies\": [\"node-1\"]\n    }\n  ]\n}\n\nIMPORTANT: Output ONLY the JSON object. No prose before or after. No markdown code fences.\nNo explanatory text. Just the raw JSON.\n</output_format>";
};

/**
 * File Ownership System for workflow nodes.
 *
 * Manages permanent write scope assignments (agent ID → glob patterns),
 * temporary lock grants for cross-scope writes, and combined write
 * permission checks. Provides serializable state for persistence and
 * a MessageBus-based lock request/grant protocol.
 */
/**
 * A temporary file lock granting an agent write access to glob patterns
 * outside its permanent scope.
 *
 * Temporary locks are granted by the orchestrator (Loomi) when a worker
 * discovers it needs to write outside its assigned scope. Each lock has
 * a finite duration after which it expires automatically.
 */
interface TemporaryLock {
    /** Unique lock identifier. */
    readonly id: string;
    /** Agent that holds the lock. */
    readonly agentId: string;
    /** Glob patterns this lock grants write access to. */
    readonly patterns: readonly string[];
    /** ISO 8601 timestamp when the lock was granted. */
    readonly grantedAt: string;
    /** ISO 8601 timestamp when the lock expires. */
    readonly expiresAt: string;
    /** ID of the agent that granted the lock (typically Loomi). */
    readonly grantedBy: string;
}
/**
 * Serializable snapshot of the file ownership system.
 *
 * Used for persisting ownership state across daemon restarts.
 */
interface FileOwnershipState {
    /** Permanent scope assignments: agent ID → glob patterns. */
    scopes: Record<string, string[]>;
    /** Active temporary locks (may include expired entries). */
    temporaryLocks: TemporaryLock[];
}
/**
 * A request from an agent to write outside its permanent scope.
 *
 * Sent as JSON-encoded content via MessageBus to the orchestrator (Loomi).
 * The orchestrator decides whether to grant or deny the request.
 */
interface LockRequestMessage {
    /** Protocol discriminator — always `'file_lock'`. */
    readonly protocol: 'file_lock';
    /** Action discriminator. */
    readonly action: 'lock_request';
    /** File path or glob pattern the agent needs write access to. */
    readonly targetPattern: string;
    /** Human-readable reason the agent needs this access. */
    readonly reason: string;
}
/**
 * A grant response from the orchestrator.
 *
 * Sent as JSON-encoded content via MessageBus back to the requesting agent.
 */
interface LockGrantMessage {
    /** Protocol discriminator — always `'file_lock'`. */
    readonly protocol: 'file_lock';
    /** Action discriminator. */
    readonly action: 'lock_grant';
    /** ID of the granted lock (matches {@link TemporaryLock.id}). */
    readonly lockId: string;
    /** Glob patterns the lock covers. */
    readonly patterns: readonly string[];
    /** ISO 8601 timestamp when the lock expires. */
    readonly expiresAt: string;
}
/**
 * A denial response from the orchestrator.
 *
 * Sent as JSON-encoded content via MessageBus back to the requesting agent.
 */
interface LockDeniedMessage {
    /** Protocol discriminator — always `'file_lock'`. */
    readonly protocol: 'file_lock';
    /** Action discriminator. */
    readonly action: 'lock_denied';
    /** The pattern that was denied. */
    readonly targetPattern: string;
    /** Reason the lock was denied. */
    readonly reason: string;
}
/**
 * A release notification when a temporary lock is explicitly released.
 *
 * Sent as JSON-encoded content via MessageBus (broadcast or targeted).
 */
interface LockReleaseMessage {
    /** Protocol discriminator — always `'file_lock'`. */
    readonly protocol: 'file_lock';
    /** Action discriminator. */
    readonly action: 'lock_release';
    /** ID of the released lock. */
    readonly lockId: string;
}
/** Union of all lock protocol message types. */
type LockProtocolMessage = LockRequestMessage | LockGrantMessage | LockDeniedMessage | LockReleaseMessage;
/**
 * Checks whether a message content string is a file-lock protocol message.
 *
 * @param content - Raw message content string.
 * @returns `true` if the content parses as a lock protocol message.
 */
declare function isLockProtocolMessage(content: string): boolean;
/**
 * Parses a lock protocol message from a raw content string.
 *
 * @param content - Raw message content string (JSON).
 * @returns The parsed message, or `null` if the content is not a valid
 *   lock protocol message.
 */
declare function parseLockProtocolMessage(content: string): LockProtocolMessage | null;
/**
 * Creates a JSON-encoded lock request message body.
 *
 * @param targetPattern - The file path or glob pattern the agent needs.
 * @param reason - Why the agent needs this access.
 * @returns JSON string suitable for MessageBus content.
 */
declare function createLockRequest(targetPattern: string, reason: string): string;
/**
 * Creates a JSON-encoded lock grant message body from a {@link TemporaryLock}.
 *
 * @param lock - The temporary lock that was granted.
 * @returns JSON string suitable for MessageBus content.
 */
declare function createLockGrant(lock: TemporaryLock): string;
/**
 * Creates a JSON-encoded lock denied message body.
 *
 * @param targetPattern - The pattern that was denied.
 * @param reason - Why the lock was denied.
 * @returns JSON string suitable for MessageBus content.
 */
declare function createLockDenied(targetPattern: string, reason: string): string;
/**
 * Creates a JSON-encoded lock release message body.
 *
 * @param lockId - ID of the lock to release.
 * @returns JSON string suitable for MessageBus content.
 */
declare function createLockRelease(lockId: string): string;
/**
 * Manages the complete file ownership system for a workflow node.
 *
 * Combines permanent write scope assignments with temporary lock grants
 * to provide a single authority for write permission checks. Permanent
 * scopes are assigned by the orchestrator when the node starts; temporary
 * locks are granted on-demand when agents need cross-scope access.
 *
 * Write scopes MUST NOT overlap between agents. The {@link validateNoOverlap}
 * method checks this invariant and should be called after any scope change.
 *
 * @example
 * ```ts
 * const manager = new FileOwnershipManager({
 *   'looma-auth': ['src/auth/**'],
 *   'looma-api': ['src/api/**'],
 * });
 *
 * // Check permanent scope
 * manager.isWriteAllowed('looma-auth', 'src/auth/login.ts'); // true
 * manager.isWriteAllowed('looma-auth', 'src/api/routes.ts'); // false
 *
 * // Grant temporary lock
 * const lock = manager.grantTemporaryLock(
 *   'looma-auth', ['src/api/auth-routes.ts'], 60000, 'loomi-1'
 * );
 * manager.isWriteAllowed('looma-auth', 'src/api/auth-routes.ts'); // true
 * ```
 */
declare class FileOwnershipManager {
    /** Permanent scope assignments: agent ID → mutable glob pattern array. */
    private readonly scopes;
    /** Active temporary locks keyed by lock ID. */
    private readonly locks;
    /**
     * Creates a FileOwnershipManager with initial permanent scope assignments.
     *
     * @param scopes - Initial scope map (agent ID → glob patterns). Defaults to empty.
     */
    constructor(scopes?: Record<string, string[]>);
    /**
     * Assigns permanent write scope patterns to an agent.
     *
     * Replaces any existing scope for the agent. Call {@link validateNoOverlap}
     * after modifying scopes to verify the non-overlap invariant.
     *
     * @param agentId - Agent to assign the scope to.
     * @param patterns - Glob patterns defining the agent's write scope.
     */
    setScope(agentId: string, patterns: string[]): void;
    /**
     * Returns the permanent write scope patterns for an agent.
     *
     * @param agentId - Agent whose scope to retrieve.
     * @returns Read-only array of glob patterns (empty if no scope assigned).
     */
    getScope(agentId: string): readonly string[];
    /**
     * Removes the permanent write scope for an agent.
     *
     * Does not affect any active temporary locks held by the agent.
     *
     * @param agentId - Agent whose scope to remove.
     */
    removeScope(agentId: string): void;
    /**
     * Returns all permanent scope assignments as a plain record.
     *
     * @returns A defensive copy of all scope assignments.
     */
    getAllScopes(): Record<string, string[]>;
    /**
     * Validates that no two agents have overlapping permanent write scopes.
     *
     * Tests each agent's patterns against every other agent's patterns using
     * representative test paths derived from the patterns themselves. This
     * catches common overlaps like `src/**` vs `src/utils/**`.
     *
     * @returns An object with `valid` boolean and an array of `overlaps`
     *   describing each conflict found.
     */
    validateNoOverlap(): {
        valid: boolean;
        overlaps: string[];
    };
    /**
     * Grants a temporary write lock to an agent for the specified patterns.
     *
     * The lock expires after `durationMs` milliseconds. Expired locks are
     * ignored by {@link isWriteAllowed} and can be cleaned up with
     * {@link pruneExpiredLocks}.
     *
     * @param agentId - Agent receiving the lock.
     * @param patterns - Glob patterns to grant access to.
     * @param durationMs - Lock duration in milliseconds. Defaults to 5 minutes.
     * @param grantedBy - ID of the agent granting the lock (typically Loomi).
     * @returns The created {@link TemporaryLock}.
     */
    grantTemporaryLock(agentId: string, patterns: string[], durationMs: number | undefined, grantedBy: string): TemporaryLock;
    /**
     * Explicitly releases a temporary lock before its expiry.
     *
     * @param lockId - ID of the lock to release.
     * @returns `true` if the lock existed and was removed, `false` otherwise.
     */
    releaseTemporaryLock(lockId: string): boolean;
    /**
     * Returns all active (non-expired) temporary locks, optionally filtered
     * by agent ID.
     *
     * @param agentId - If provided, only return locks for this agent.
     * @returns Read-only array of active temporary locks.
     */
    getActiveLocks(agentId?: string): readonly TemporaryLock[];
    /**
     * Removes all expired temporary locks from the internal store.
     *
     * @returns The number of locks pruned.
     */
    pruneExpiredLocks(): number;
    /**
     * Checks whether an agent is allowed to write to a file path.
     *
     * Checks permanent scope first, then falls back to active temporary
     * locks. Returns `true` if the path matches any permanent scope pattern
     * or any non-expired temporary lock pattern held by the agent.
     *
     * @param agentId - Agent requesting write access.
     * @param filePath - Relative file path to check.
     * @returns `true` if the write is permitted, `false` otherwise.
     */
    isWriteAllowed(agentId: string, filePath: string): boolean;
    /**
     * Returns the effective write scope for an agent: permanent patterns
     * plus patterns from all active temporary locks.
     *
     * Useful for constructing a {@link ToolContext} that includes temporary
     * lock grants alongside permanent scope.
     *
     * @param agentId - Agent whose effective scope to compute.
     * @returns Array of all currently valid glob patterns for the agent.
     */
    getEffectiveScope(agentId: string): string[];
    /**
     * Serializes the ownership state to a plain object for persistence.
     *
     * Includes all temporary locks (even expired ones) so the caller can
     * decide whether to prune before persisting.
     *
     * @returns A defensive copy of the ownership state.
     */
    toJSON(): FileOwnershipState;
    /**
     * Restores a FileOwnershipManager from a persisted state snapshot.
     *
     * @param state - The serialized state to restore from.
     * @returns A new FileOwnershipManager with the restored state.
     */
    static fromJSON(state: FileOwnershipState): FileOwnershipManager;
}
/**
 * Generates representative file paths from glob patterns for overlap testing.
 *
 * Converts glob patterns into concrete paths by replacing wildcard segments
 * with literal placeholders, producing paths that the original glob would match.
 *
 * @param patterns - Glob patterns to derive test paths from.
 * @returns Array of concrete test paths.
 */
declare function generateTestPaths(patterns: string[]): string[];

/**
 * Directed acyclic graph (DAG) implementation for workflow execution topology.
 *
 * Provides node/edge management, cycle detection, DAG validation,
 * topology classification, and topological sort for execution ordering.
 */

/** Result of DAG validation containing validity status and any errors found. */
interface ValidationResult {
    /** Whether the graph is a valid DAG. */
    valid: boolean;
    /** List of validation errors, empty when valid. */
    errors: string[];
}
/**
 * A mutable directed acyclic graph that wraps the {@link Graph} schema data.
 *
 * Nodes are stored in a Map keyed by ID for O(1) lookup. Edges are stored
 * as an array of directed pairs. All mutating operations enforce DAG
 * invariants (no cycles, no self-loops, no duplicates).
 */
declare class WorkflowGraph {
    private readonly nodes;
    private readonly edgeList;
    /**
     * Creates a new WorkflowGraph instance.
     *
     * @param nodes - Initial nodes as a Map or plain record, or omit for an empty graph.
     * @param edges - Initial directed edges, or omit for an empty edge list.
     */
    constructor(nodes?: Map<string, Node> | Record<string, Node>, edges?: Edge[]);
    /**
     * Returns the number of nodes in the graph.
     *
     * @returns Node count.
     */
    get size(): number;
    /**
     * Adds a node to the graph.
     *
     * @param node - The node to add.
     * @throws Error if a node with the same ID already exists.
     */
    addNode(node: Node): void;
    /**
     * Removes a node and all edges connected to it.
     *
     * @param nodeId - ID of the node to remove.
     * @throws Error if the node does not exist.
     */
    removeNode(nodeId: string): void;
    /**
     * Retrieves a node by ID.
     *
     * @param nodeId - ID of the node to retrieve.
     * @returns The node, or undefined if not found.
     */
    getNode(nodeId: string): Node | undefined;
    /**
     * Updates a node's properties by merging partial updates.
     *
     * The node ID cannot be changed via this method.
     *
     * @param nodeId - ID of the node to update.
     * @param updates - Partial node properties to merge.
     * @throws Error if the node does not exist.
     */
    updateNode(nodeId: string, updates: Partial<Node>): void;
    /**
     * Adds a directed edge between two existing nodes.
     *
     * Rejects self-loops, duplicate edges, references to missing nodes,
     * and edges that would create a cycle.
     *
     * @param edge - The directed edge to add.
     * @throws Error if the edge is invalid or would create a cycle.
     */
    addEdge(edge: Edge): void;
    /**
     * Removes a directed edge.
     *
     * @param from - Source node ID.
     * @param to - Target node ID.
     * @throws Error if the edge does not exist.
     */
    removeEdge(from: string, to: string): void;
    /**
     * Returns a copy of all directed edges.
     *
     * @returns Array of edges.
     */
    getEdges(): Edge[];
    /**
     * Returns the IDs of all successor nodes (outgoing edges).
     *
     * @param nodeId - ID of the node to query.
     * @returns Array of successor node IDs.
     */
    getSuccessors(nodeId: string): string[];
    /**
     * Returns the IDs of all predecessor nodes (incoming edges).
     *
     * @param nodeId - ID of the node to query.
     * @returns Array of predecessor node IDs.
     */
    getPredecessors(nodeId: string): string[];
    /**
     * Detects whether the graph contains any cycles using DFS coloring.
     *
     * Uses a three-color algorithm: white (unvisited), gray (in current
     * DFS stack), black (fully processed). A back-edge to a gray node
     * indicates a cycle.
     *
     * @returns `true` if the graph contains at least one cycle, `false` otherwise.
     */
    detectCycles(): boolean;
    /**
     * Validates that the graph is a well-formed DAG.
     *
     * Checks:
     * 1. No cycles exist.
     * 2. At most one source node (no incoming edges) — the entry point.
     * 3. No orphan nodes (nodes with no edges at all in a multi-node graph).
     *
     * @returns Validation result with any errors found.
     */
    validateDAG(): ValidationResult;
    /**
     * Classifies the graph topology based on node connectivity patterns.
     *
     * - `linear`: every node has at most 1 successor and 1 predecessor.
     * - `convergent`: at least one node has multiple predecessors, none have multiple successors.
     * - `tree`: at least one node has multiple successors, none have multiple predecessors.
     * - `mixed`: nodes with multiple successors and nodes with multiple predecessors both exist.
     *
     * @returns The detected topology type.
     */
    detectTopology(): TopologyType;
    /**
     * Returns a topological sort of node IDs using Kahn's algorithm.
     *
     * The returned order guarantees that for every edge (u → v), u appears
     * before v. Throws if the graph contains a cycle.
     *
     * @returns Array of node IDs in execution order.
     * @throws Error if the graph contains a cycle.
     */
    getExecutionOrder(): string[];
    /**
     * Serializes the graph to the {@link Graph} schema format.
     *
     * Topology is re-detected from the current structure.
     *
     * @returns A plain object matching the GraphSchema.
     */
    toJSON(): Graph;
    /**
     * Deserializes a {@link Graph} schema object into a WorkflowGraph instance.
     *
     * @param data - A plain object matching the GraphSchema.
     * @returns A new WorkflowGraph instance.
     */
    static fromJSON(data: Graph): WorkflowGraph;
}

/**
 * Node lifecycle state machine for workflow execution.
 *
 * Wraps the {@link Node} data type with transition validation,
 * agent management, file ownership enforcement, and serialization.
 */

/**
 * A mutable wrapper around the {@link Node} data type that enforces
 * lifecycle state machine rules, manages agents, and validates
 * file ownership scopes.
 */
declare class WorkflowNode {
    private data;
    /**
     * Creates a WorkflowNode from existing node data.
     *
     * @param data - A plain {@link Node} object to wrap.
     */
    constructor(data: Node);
    /** The node's unique identifier. */
    get id(): string;
    /** The node's human-readable title. */
    get title(): string;
    /** The current lifecycle status. */
    get status(): NodeStatus;
    /** The number of retry cycles attempted so far. */
    get retryCount(): number;
    /** The maximum allowed retry cycles. */
    get maxRetries(): number;
    /** The current review report, or null. */
    get reviewReport(): ReviewReport | null;
    /** The agents assigned to this node. */
    get agents(): readonly AgentInfo[];
    /** The file ownership map (agent ID to glob patterns). */
    get fileOwnership(): Readonly<Record<string, string[]>>;
    /**
     * Checks whether a transition to the given status is valid.
     *
     * @param to - The target status to check.
     * @returns `true` if the transition is allowed, `false` otherwise.
     */
    canTransition(to: NodeStatus): boolean;
    /**
     * Returns all valid next states from the current status.
     *
     * @returns Array of valid target statuses.
     */
    getValidTransitions(): NodeStatus[];
    /**
     * Validates and applies a state transition.
     *
     * Updates lifecycle timestamps: sets {@link Node.startedAt} when
     * entering `running`, and {@link Node.completedAt} when entering
     * a terminal state (`done`, `failed`, `blocked`).
     *
     * @param to - The target status.
     * @throws Error if the transition is not allowed from the current state.
     */
    transition(to: NodeStatus): void;
    /**
     * Increments the retry count by one.
     *
     * @throws Error if retryCount would exceed maxRetries.
     */
    incrementRetry(): void;
    /**
     * Sets the review report for this node.
     *
     * @param report - The structured review report from Loomex.
     */
    setReviewReport(report: ReviewReport): void;
    /**
     * Updates an existing agent's properties by merging partial updates.
     *
     * The agent ID cannot be changed via this method.
     *
     * @param agentId - ID of the agent to update.
     * @param updates - Partial agent properties to merge.
     * @throws Error if the agent is not found.
     */
    updateAgent(agentId: string, updates: Partial<AgentInfo>): void;
    /**
     * Adds an agent to this node.
     *
     * @param agent - The agent metadata to add.
     * @throws Error if an agent with the same ID already exists.
     */
    addAgent(agent: AgentInfo): void;
    /**
     * Removes an agent from this node.
     *
     * Also removes any file ownership entries for the agent.
     *
     * @param agentId - ID of the agent to remove.
     * @throws Error if the agent is not found.
     */
    removeAgent(agentId: string): void;
    /**
     * Checks whether an agent is allowed to write to a file path
     * based on the file ownership map.
     *
     * An agent with no ownership entry has no write access.
     *
     * @param agentId - The agent requesting write access.
     * @param filePath - The file path to check.
     * @returns `true` if the agent may write to the path, `false` otherwise.
     */
    validateWriteScope(agentId: string, filePath: string): boolean;
    /**
     * Assigns file ownership glob patterns to an agent.
     *
     * @param agentId - The agent to assign ownership to.
     * @param patterns - Glob patterns defining the agent's write scope.
     * @throws Error if the agent is not assigned to this node.
     */
    setFileOwnership(agentId: string, patterns: string[]): void;
    /**
     * Validates that no two agents have overlapping file write scopes.
     *
     * Tests each agent's patterns against every other agent's patterns
     * to detect conflicts. Uses a set of representative test paths
     * derived from the patterns themselves.
     *
     * @returns An object with `valid` boolean and an array of `overlaps`
     *   describing each conflict found.
     */
    validateNoOverlap(): {
        valid: boolean;
        overlaps: string[];
    };
    /**
     * Creates a {@link FileOwnershipManager} initialized with this node's
     * current permanent file ownership assignments.
     *
     * The returned manager is independent — changes to it do not automatically
     * propagate back to the node. Use {@link applyFileOwnershipState} to
     * persist manager state back to the node when needed.
     *
     * @returns A new FileOwnershipManager reflecting the node's current scopes.
     */
    createFileOwnershipManager(): FileOwnershipManager;
    /**
     * Applies permanent scope assignments from a {@link FileOwnershipManager}
     * back to this node's file ownership data.
     *
     * Replaces all existing ownership entries with the manager's current scopes.
     * Temporary locks are not persisted in the node data — they live only in the
     * manager during execution.
     *
     * @param manager - The FileOwnershipManager whose scopes to apply.
     */
    applyFileOwnershipState(manager: FileOwnershipManager): void;
    /**
     * Serializes the node to a plain {@link Node} object.
     *
     * @returns A copy of the underlying node data.
     */
    toJSON(): Node;
    /**
     * Factory method to create a new WorkflowNode with sensible defaults.
     *
     * @param id - Unique node identifier.
     * @param title - Human-readable name for the node.
     * @param instructions - Markdown instructions for this node.
     * @param options - Optional overrides for delay, maxRetries, and agents.
     * @returns A new WorkflowNode in `pending` status.
     */
    static create(id: string, title: string, instructions: string, options?: {
        delay?: string;
        maxRetries?: number;
        agents?: AgentInfo[];
        fileOwnership?: Record<string, string[]>;
    }): WorkflowNode;
}

/**
 * Scheduler for managing node delay timers.
 *
 * Handles the 'waiting' state: when a node becomes eligible (predecessors done),
 * the scheduler manages the countdown via {@link setTimeout}. Supports delay
 * string parsing, resumeAt timestamp persistence, and restart recovery.
 */
/**
 * Parses a delay string into milliseconds.
 *
 * @param delay - Delay string (e.g., "30s", "5m", "1h", "1d", "0", "").
 * @returns Milliseconds represented by the delay string.
 * @throws Error if the delay string format is invalid.
 */
declare function parseDelay(delay: string | undefined): number;
/**
 * Manages node delay scheduling using {@link setTimeout}.
 *
 * When a node enters the 'waiting' state, the scheduler computes the
 * absolute `resumeAt` timestamp and starts a timer. The `resumeAt` value
 * can be persisted in `workflow.json` so that on restart, the scheduler
 * can recover: if past due, it fires immediately; if still in the future,
 * it schedules the remaining time.
 */
declare class Scheduler {
    private readonly entries;
    /**
     * Schedules a node to fire after the given delay.
     *
     * If the delay resolves to zero milliseconds, the callback is invoked
     * synchronously and no timer entry is stored.
     *
     * @param nodeId - Unique identifier of the node to schedule.
     * @param delay - Delay string (e.g., "30s", "5m", "1h", "1d", "0", "").
     * @param callback - Function to invoke when the delay expires.
     * @throws Error if the node is already scheduled.
     * @throws Error if the delay string format is invalid.
     */
    scheduleNode(nodeId: string, delay: string, callback: () => void): void;
    /**
     * Cancels a pending timer for a node.
     *
     * @param nodeId - Unique identifier of the node to cancel.
     * @throws Error if the node is not currently scheduled.
     */
    cancelNode(nodeId: string): void;
    /**
     * Returns the ISO 8601 resumeAt timestamp for a scheduled node.
     *
     * @param nodeId - Unique identifier of the node.
     * @returns The ISO 8601 timestamp when the delay expires, or `null` if not scheduled.
     */
    getResumeAt(nodeId: string): string | null;
    /**
     * Returns the remaining time in milliseconds for a scheduled node.
     *
     * @param nodeId - Unique identifier of the node.
     * @returns Remaining milliseconds until the delay expires, or `0` if not scheduled or past due.
     */
    getRemainingMs(nodeId: string): number;
    /**
     * Checks whether a node has a pending timer.
     *
     * @param nodeId - Unique identifier of the node.
     * @returns `true` if the node is currently scheduled, `false` otherwise.
     */
    isScheduled(nodeId: string): boolean;
    /**
     * Reschedules a node from a persisted resumeAt timestamp (restart recovery).
     *
     * If the resumeAt time is in the past, the callback is invoked synchronously.
     * If it is in the future, a timer is set for the remaining duration.
     *
     * @param nodeId - Unique identifier of the node to reschedule.
     * @param resumeAt - ISO 8601 timestamp from persisted state.
     * @param callback - Function to invoke when the delay expires.
     * @throws Error if the node is already scheduled.
     */
    rescheduleFromPersistence(nodeId: string, resumeAt: string, callback: () => void): void;
    /**
     * Cancels all pending timers. Used during shutdown.
     */
    cancelAll(): void;
    /**
     * Returns the number of currently pending timers.
     *
     * @returns Count of scheduled nodes.
     */
    getScheduledCount(): number;
}

/**
 * Workflow state machine managing the full lifecycle of a Loomflo workflow.
 *
 * Wraps the {@link Workflow} data type with validated state transitions,
 * persistence after every change, event logging, and access to the
 * underlying {@link WorkflowGraph} and {@link WorkflowNode} instances.
 */

/**
 * Information about a resumed workflow, describing which nodes
 * were completed, reset, or rescheduled during the resume process.
 */
interface ResumeInfo {
    /** ID of the first interrupted node that triggered the resume, or null if none were interrupted. */
    resumedFrom: string | null;
    /** IDs of nodes that were already completed and will be skipped. */
    completedNodeIds: string[];
    /** IDs of nodes that were interrupted (running/review) and have been reset to pending. */
    resetNodeIds: string[];
    /** IDs of nodes in waiting state whose scheduler delays have been recalculated. */
    rescheduledNodeIds: string[];
}
/**
 * Manages the full lifecycle of a Loomflo workflow.
 *
 * Holds the workflow data, a {@link WorkflowGraph}, and a Map of
 * {@link WorkflowNode} instances. Every state transition persists to disk
 * and logs an event to the project's event log.
 */
declare class WorkflowManager {
    private data;
    private graph;
    private nodeInstances;
    /**
     * Creates a WorkflowManager from existing workflow data.
     *
     * Reconstructs the {@link WorkflowGraph} and all {@link WorkflowNode}
     * instances from the serialized workflow state.
     *
     * @param data - A validated {@link Workflow} object.
     */
    constructor(data: Workflow);
    /** The workflow's unique identifier. */
    get id(): string;
    /** The current workflow lifecycle status. */
    get status(): WorkflowStatus;
    /** The original project description. */
    get description(): string;
    /** The absolute path to the project workspace. */
    get projectPath(): string;
    /** The accumulated total cost in USD. */
    get totalCost(): number;
    /** The workflow configuration. */
    get config(): Readonly<Config>;
    /** ISO 8601 timestamp when the workflow was created. */
    get createdAt(): string;
    /** ISO 8601 timestamp of the last state change. */
    get updatedAt(): string;
    /**
     * Creates a new workflow with a generated UUID and `init` status.
     *
     * Persists the initial state to disk and logs a `workflow_created` event.
     *
     * @param description - Natural language project description.
     * @param projectPath - Absolute path to the project workspace.
     * @param config - Merged configuration for this workflow.
     * @returns A new WorkflowManager instance in `init` status.
     */
    static create(description: string, projectPath: string, config: Config): Promise<WorkflowManager>;
    /**
     * Resumes an interrupted or paused workflow from disk.
     *
     * Loads the persisted workflow state, identifies completed nodes (skipped),
     * resets interrupted nodes (running/review) back to pending, and recalculates
     * scheduler delays for waiting nodes. Logs a `workflow_resumed` event.
     *
     * @param projectPath - Absolute path to the project workspace.
     * @returns A WorkflowManager and {@link ResumeInfo} describing the resume,
     *   or `null` if no persisted state exists.
     * @throws Error if the workflow status does not support resuming.
     */
    static resume(projectPath: string): Promise<{
        manager: WorkflowManager;
        info: ResumeInfo;
    } | null>;
    /**
     * Checks whether a transition to the given status is valid.
     *
     * @param to - The target workflow status to check.
     * @returns `true` if the transition is allowed, `false` otherwise.
     */
    canTransition(to: WorkflowStatus): boolean;
    /**
     * Validates and applies a state transition.
     *
     * Updates the workflow status and `updatedAt` timestamp, persists the
     * new state to disk, and logs the corresponding event. When resuming
     * from `paused` to `running`, logs a `workflow_resumed` event instead
     * of `workflow_started`.
     *
     * @param to - The target workflow status.
     * @throws Error if the transition is not allowed from the current state.
     */
    transition(to: WorkflowStatus): Promise<void>;
    /**
     * Pauses a running workflow.
     *
     * Transitions the workflow status from `running` to `paused`,
     * persists the new state, and logs a `workflow_paused` event.
     *
     * @throws Error if the workflow is not in `running` status.
     */
    pause(): Promise<void>;
    /**
     * Returns the {@link WorkflowGraph} instance for this workflow.
     *
     * @returns The workflow's directed acyclic graph.
     */
    getGraph(): WorkflowGraph;
    /**
     * Retrieves a {@link WorkflowNode} by ID.
     *
     * @param nodeId - The unique node identifier.
     * @returns The WorkflowNode instance, or undefined if not found.
     */
    getNode(nodeId: string): WorkflowNode | undefined;
    /**
     * Returns all {@link WorkflowNode} instances in the workflow.
     *
     * @returns Array of all WorkflowNode instances.
     */
    getAllNodes(): WorkflowNode[];
    /**
     * Adds a cost amount to the workflow's accumulated total cost.
     *
     * @param amount - The cost in USD to add (must be non-negative).
     * @throws Error if the amount is negative.
     */
    updateTotalCost(amount: number): void;
    /**
     * Synchronizes the internal graph and node instances from updated node data.
     *
     * Call this after modifying nodes or the graph to ensure the serialized
     * workflow state reflects the current in-memory state.
     */
    syncGraph(): void;
    /**
     * Serializes the workflow to a plain {@link Workflow} object for persistence.
     *
     * Synchronizes the graph and node data before serializing.
     *
     * @returns A plain object matching the WorkflowSchema.
     */
    toJSON(): Workflow;
    /**
     * Deserializes a {@link Workflow} object into a WorkflowManager instance.
     *
     * @param data - A validated Workflow object (e.g., from loadWorkflowState).
     * @returns A new WorkflowManager instance.
     */
    static fromJSON(data: Workflow): WorkflowManager;
    /**
     * Persists the current workflow state to disk.
     *
     * @param projectPath - Absolute path to the project root.
     */
    persist(projectPath: string): Promise<void>;
    /**
     * Determines the event type to log for a given state transition.
     *
     * Handles the special case where `paused → running` emits
     * `workflow_resumed` instead of `workflow_started`.
     *
     * @param from - The previous workflow status.
     * @param to - The new workflow status.
     * @returns The event type to log, or undefined if no event applies.
     */
    private resolveEventType;
}

/**
 * Workflow execution engine for Loomflo.
 *
 * Drives a workflow graph from the `running` state through to `done` or `failed`
 * by iterating the DAG topologically, activating nodes when all predecessors are
 * done, handling parallel/convergent/divergent paths, and enforcing budget limits.
 *
 * The engine accepts an injected {@link NodeExecutor} so that node execution can
 * be replaced with mocks in tests.
 */

/**
 * Outcome of executing a single workflow node.
 *
 * Maps to the terminal states a node can reach after execution.
 */
type NodeExecutionStatus = 'done' | 'failed' | 'blocked';
/**
 * Result returned by a {@link NodeExecutor} after a node finishes execution.
 *
 * @param status - Terminal status the node reached.
 * @param cost - Cost in USD incurred during execution.
 * @param error - Human-readable error message when status is `failed` or `blocked`.
 */
interface NodeExecutionResult {
    /** Terminal status the node reached. */
    status: NodeExecutionStatus;
    /** Cost in USD incurred during this node's execution. */
    cost: number;
    /** Human-readable error description, present when status is not `done`. */
    error?: string;
}
/**
 * Function that executes a single workflow node.
 *
 * The engine calls this for every node that transitions to `running`.
 * Implementations should handle the full Loomi orchestration cycle
 * (team planning, worker execution, review, retry) and return a terminal result.
 *
 * @param node - The WorkflowNode instance to execute.
 * @param manager - The WorkflowManager for accessing workflow-wide state.
 * @returns A promise resolving to the node's execution result.
 */
type NodeExecutor = (node: WorkflowNode, manager: WorkflowManager) => Promise<NodeExecutionResult>;
/**
 * Configuration for creating a {@link WorkflowExecutionEngine}.
 *
 * @param manager - The WorkflowManager holding workflow state.
 * @param executor - Function to execute individual nodes.
 * @param costTracker - Cost tracker for budget enforcement.
 * @param scheduler - Optional pre-configured Scheduler (one is created if omitted).
 */
interface ExecutionEngineConfig {
    /** The WorkflowManager holding the workflow state and graph. */
    manager: WorkflowManager;
    /** Injected function that executes a single node. */
    executor: NodeExecutor;
    /** Cost tracker for budget enforcement. */
    costTracker: CostTracker;
    /** Optional pre-configured Scheduler. A new one is created if omitted. */
    scheduler?: Scheduler;
}
/**
 * Final result of the workflow execution engine run.
 *
 * @param status - The workflow's terminal status.
 * @param completedNodes - IDs of nodes that finished with `done`.
 * @param failedNodes - IDs of nodes that finished with `failed` or `blocked`.
 * @param totalCost - Total cost in USD incurred during this execution run.
 * @param haltReason - Human-readable reason for a non-`done` outcome.
 */
interface ExecutionResult {
    /** The workflow's terminal status after execution. */
    status: 'done' | 'failed' | 'paused';
    /** IDs of nodes that completed successfully. */
    completedNodes: string[];
    /** IDs of nodes that ended in `failed` or `blocked`. */
    failedNodes: string[];
    /** Total cost in USD incurred during this execution run. */
    totalCost: number;
    /** Human-readable reason when the workflow did not reach `done`. */
    haltReason?: string;
}
/**
 * Drives a workflow DAG to completion by activating nodes when their
 * predecessors are done, executing them via an injected {@link NodeExecutor},
 * and handling parallel, convergent, and divergent topologies.
 *
 * The engine operates as an event-driven loop: whenever a node completes
 * (or fails), it re-evaluates which nodes are newly activatable. Execution
 * continues until all nodes are terminal or the workflow is halted.
 *
 * The engine is stoppable via {@link stop} for pause/shutdown scenarios.
 */
declare class WorkflowExecutionEngine {
    private readonly manager;
    private readonly executor;
    private readonly costTracker;
    private readonly scheduler;
    private readonly graph;
    /** Node IDs currently being executed (in-flight promises). */
    private readonly activeNodes;
    /** Tracks which nodes have been activated to prevent double-activation. */
    private readonly activatedNodes;
    /** IDs of nodes that completed with `done`. */
    private readonly completedNodes;
    /** IDs of nodes that ended with `failed` or `blocked`. */
    private readonly failedNodes;
    /** Flag set by {@link stop} to halt the engine gracefully. */
    private stopped;
    /** Resolver for the main execution loop's wait-for-completion promise. */
    private wakeUp;
    /**
     * Creates a new WorkflowExecutionEngine.
     *
     * @param config - Engine configuration with manager, executor, and cost tracker.
     */
    constructor(config: ExecutionEngineConfig);
    /**
     * Runs the workflow execution loop to completion.
     *
     * The workflow must be in `running` status. The engine identifies ready nodes,
     * activates them (respecting delays via the {@link Scheduler}), executes them
     * in parallel where the topology allows, and loops until all nodes reach a
     * terminal state or the engine is stopped.
     *
     * @returns The final execution result with status, completed/failed nodes, and cost.
     * @throws Error if the workflow is not in `running` status.
     */
    run(): Promise<ExecutionResult>;
    /**
     * Signals the engine to stop gracefully after in-flight nodes complete.
     *
     * The engine will not activate new nodes and will return a `paused` result
     * from the current {@link run} invocation.
     */
    stop(): void;
    /**
     * Returns the current count of in-flight node executions.
     *
     * @returns Number of nodes currently being executed.
     */
    getActiveNodeCount(): number;
    /**
     * Returns the IDs of nodes that have completed successfully so far.
     *
     * @returns Array of completed node IDs.
     */
    getCompletedNodes(): string[];
    /**
     * Returns the IDs of nodes that have failed or are blocked.
     *
     * @returns Array of failed/blocked node IDs.
     */
    getFailedNodes(): string[];
    /**
     * Scans all pending nodes and activates those whose predecessors are all done.
     *
     * For each ready node, transitions it to `waiting` and schedules it via the
     * {@link Scheduler}. When the delay expires (or immediately if delay is "0"),
     * the node transitions to `running` and execution begins.
     */
    private activateReadyNodes;
    /**
     * Finds all nodes that are ready for activation.
     *
     * A node is ready when:
     * 1. It is in `pending` status.
     * 2. All of its predecessor nodes are in `done` status.
     * 3. It has not already been activated.
     *
     * @returns Array of node IDs ready for activation.
     */
    private findReadyNodes;
    /**
     * Checks whether any pending node could still be activated.
     *
     * A node is activatable if it is `pending` and none of its predecessors
     * are in a terminal failure state (`failed` or `blocked`). This is used
     * for deadlock detection.
     *
     * @returns `true` if at least one node can still potentially be activated.
     */
    private hasActivatableNodes;
    /**
     * Activates a single node: transitions to `waiting`, schedules via the
     * {@link Scheduler}, and starts execution when the delay expires.
     *
     * @param nodeId - ID of the node to activate.
     */
    private activateNode;
    /**
     * Transitions a node to `running` and begins execution via the injected executor.
     *
     * The execution promise is stored in {@link activeNodes} so the engine can
     * await completion. When execution finishes, the node's terminal state is
     * applied and the engine checks for newly activatable nodes.
     *
     * @param nodeId - ID of the node to execute.
     */
    private startNodeExecution;
    /**
     * Executes a node and handles the result.
     *
     * Calls the injected {@link NodeExecutor}, applies the resulting terminal
     * state to the node, updates costs, persists state, logs events, and
     * triggers activation of newly ready successor nodes.
     *
     * Errors thrown by the executor are caught and treated as node failures.
     *
     * @param nodeId - ID of the node being executed.
     * @param node - The WorkflowNode instance.
     * @returns The node execution result.
     */
    private executeNode;
    /**
     * Applies the execution result to a node: transitions state, updates costs,
     * persists, and logs the appropriate event.
     *
     * @param nodeId - ID of the node.
     * @param node - The WorkflowNode instance.
     * @param result - The execution result to apply.
     */
    private applyNodeResult;
    /**
     * Waits until at least one active node completes.
     *
     * Returns immediately if no nodes are active (the main loop will re-evaluate
     * the terminal condition). Uses a manual promise so that {@link stop} can
     * unblock the wait.
     */
    private waitForAnyCompletion;
    /**
     * Checks whether the workflow has reached a terminal state.
     *
     * Terminal means every node is in a terminal status (`done`, `failed`, or `blocked`)
     * and no nodes are currently executing or scheduled.
     *
     * @returns `true` if no further progress is possible.
     */
    private isTerminal;
    /**
     * Marks pending nodes downstream of failed nodes as blocked, then builds
     * the terminal workflow result.
     *
     * If all nodes are `done`, the workflow transitions to `done`.
     * Otherwise, it transitions to `failed`.
     *
     * @returns The final execution result.
     */
    private buildTerminalResult;
    /**
     * Builds a paused result and transitions the workflow to `paused`.
     *
     * Waits for all in-flight nodes to finish before returning.
     *
     * @param reason - Human-readable reason for the pause.
     * @returns The paused execution result.
     */
    private buildPausedResult;
    /**
     * Builds a failed result and transitions the workflow to `failed`.
     *
     * @param reason - Human-readable reason for the failure.
     * @returns The failed execution result.
     */
    private buildFailedResult;
    /**
     * Transitions all pending nodes downstream of failed/blocked nodes to `blocked`.
     *
     * Prevents the engine from waiting on nodes that can never be activated.
     */
    private markUnreachableNodesBlocked;
    /**
     * Waits for all currently active node executions to finish.
     *
     * Uses {@link Promise.allSettled} to ensure all in-flight work completes
     * even if some nodes throw.
     */
    private drainActiveNodes;
    /**
     * Wakes up the main execution loop if it is waiting.
     */
    private signalWakeUp;
    /**
     * Persists the current workflow state to disk.
     */
    private persistState;
    /**
     * Logs a workflow-level event.
     *
     * @param type - Event type identifier.
     * @param details - Event-specific payload.
     */
    private logWorkflowEvent;
    /**
     * Logs a node-level event.
     *
     * @param nodeId - ID of the node the event relates to.
     * @param type - Event type identifier.
     * @param details - Event-specific payload.
     */
    private logNodeEvent;
}

/** Lightweight workflow summary returned by the health endpoint. */
interface WorkflowSummary {
    /** Workflow identifier. */
    id: string;
    /** Current workflow lifecycle state. */
    status: WorkflowStatus;
    /** Total number of nodes in the execution graph. */
    nodeCount: number;
    /** IDs of nodes currently in "running" state. */
    activeNodes: string[];
}
/** Options accepted by the {@link healthRoutes} factory. */
interface HealthRoutesOptions {
    /** Return the number of seconds since the daemon started. */
    getUptime: () => number;
    /** Return a summary of the active workflow, or null if none exists. */
    getWorkflow: () => WorkflowSummary | null;
}

/** Options accepted by the {@link memoryRoutes} factory. */
interface MemoryRoutesOptions {
    /** Return the current shared memory manager, or null if no workflow is active. */
    getSharedMemory: () => SharedMemoryManager | null;
}

/** Options accepted by the {@link eventsRoutes} factory. */
interface EventsRoutesOptions {
    /** Return the absolute path to the current project workspace. */
    getProjectPath: () => string;
}

/** Options accepted by the {@link nodesRoutes} factory. */
interface NodesRoutesOptions {
    /** Return the current active workflow, or null if none exists. */
    getWorkflow: () => Workflow | null;
}

/** Wrapper interface for event log access with a bound project path. */
interface EventLog {
    /** Append a single event to the log. */
    append: (event: Event) => Promise<void>;
    /** Query events with optional filters. */
    query: (filters?: EventQueryFilters) => Promise<Event[]>;
}
/** Options accepted by the {@link workflowRoutes} factory. */
interface WorkflowRoutesOptions {
    /** Return the current active workflow, or null if none exists. */
    getWorkflow: () => Workflow | null;
    /** Set the active workflow in memory. */
    setWorkflow: (workflow: Workflow) => void;
    /** Return the configured LLM provider. */
    getProvider: () => LLMProvider;
    /** Return the event log accessor for the current project. */
    getEventLog: () => EventLog;
    /** Return the shared memory manager. */
    getSharedMemory: () => SharedMemoryManager;
    /** Return the cost tracker. */
    getCostTracker: () => CostTracker;
}

/** A single entry in the chat history. */
interface ChatHistoryEntry {
    /** Who sent the message. */
    role: 'user' | 'assistant';
    /** The message content. */
    content: string;
    /** ISO-8601 timestamp of the message. */
    timestamp: string;
}
/** Options accepted by the {@link chatRoutes} factory. */
interface ChatRoutesOptions {
    /** Delegate a user message to the Loom agent. */
    handleChat: (message: string) => Promise<ChatResult>;
    /** Return the current chat history. */
    getChatHistory: () => ChatHistoryEntry[];
    /** Append an entry to the chat history. */
    addToHistory: (entry: ChatHistoryEntry) => void;
}

/** Options accepted by the {@link configRoutes} factory. */
interface ConfigRoutesOptions {
    /** Return the current merged configuration. */
    getConfig: () => Config;
    /** Apply a partial config update and return the new merged configuration. */
    updateConfig: (partial: Partial<Config>) => Config;
}

/** Options accepted by the {@link costsRoutes} factory. */
interface CostsRoutesOptions {
    /** Return the current aggregated cost summary from the tracker. */
    getCostSummary: () => CostSummary;
    /** Return the current active workflow, or null if none exists. */
    getWorkflow: () => Workflow | null;
    /** Return the cost in USD attributed to the Loom architect agent. */
    getLoomCost: () => number;
}

/** Configuration options for the Fastify server factory. */
interface ServerOptions {
    /** Cryptographic auth token for API and WebSocket access. */
    token: string;
    /** Absolute path to the project workspace. */
    projectPath: string;
    /** Absolute path to the dashboard static files directory, or null if not available. */
    dashboardPath: string | null;
    /** Callbacks for the health endpoint. When omitted, defaults to process uptime and no workflow. */
    health?: HealthRoutesOptions;
    /** Callbacks for the workflow routes. When omitted, workflow routes are not registered. */
    workflow?: WorkflowRoutesOptions;
    /** Callbacks for the node routes. When omitted, node routes are not registered. */
    nodes?: NodesRoutesOptions;
    /** Callbacks for the memory routes. When omitted, memory routes are not registered. */
    memory?: MemoryRoutesOptions;
    /** Callbacks for the events routes. When omitted, events routes are not registered. */
    events?: EventsRoutesOptions;
    /** Callbacks for the chat routes. When omitted, chat routes are not registered. */
    chat?: ChatRoutesOptions;
    /** Callbacks for the config routes. When omitted, config routes are not registered. */
    config?: ConfigRoutesOptions;
    /** Callbacks for the costs routes. When omitted, costs routes are not registered. */
    costs?: CostsRoutesOptions;
}
/** Return value of {@link createServer}. */
interface ServerResult {
    /** The configured Fastify instance (not yet listening). */
    server: FastifyInstance;
    /** Broadcast a JSON event to all connected WebSocket clients. */
    broadcast: (event: Record<string, unknown>) => void;
}
/**
 * Create and configure a Fastify server with WebSocket support, CORS,
 * optional static file serving, and token-based authentication.
 *
 * The server is returned in a non-listening state — call `server.listen()`
 * to begin accepting connections.
 *
 * Authentication:
 * - HTTP routes use Bearer token in the `Authorization` header.
 * - WebSocket connections authenticate via `?token=xxx` query parameter.
 * - `GET /health` is unauthenticated.
 *
 * @param options - Server configuration options.
 * @returns The configured server instance and a broadcast function.
 */
declare function createServer(options: ServerOptions): Promise<ServerResult>;

/**
 * Create a Fastify preHandler hook that validates Bearer token authentication.
 *
 * The returned hook extracts the token from the `Authorization` header,
 * compares it against the expected token, and responds with 401 if the
 * token is missing or invalid. The token is captured at creation time
 * (daemon startup) and not re-read from disk on each request.
 *
 * @param token - The valid auth token generated at daemon startup.
 * @returns A Fastify preHandler hook function.
 */
declare function createAuthMiddleware(token: string): preHandlerAsyncHookHandler;

export { type AgentInfo, AgentInfoSchema, type AgentLoopConfig, type AgentLoopResult, type AgentLoopStatus, type AgentRole, AgentRoleSchema, type AgentStatus, AgentStatusSchema, AnthropicProvider, type BroadcastFn, type ChatClassification, type ChatMessageCategory, type ChatResult, type ClarificationCallback, type ClarificationQuestion, type CompletionParams, CompletionParamsSchema, type Config, ConfigManager, type ConfigManagerOptions, ConfigSchema, type ContentBlock, ContentBlockSchema, type CostEntry, type CostEstimationConfig, type CostSummary, CostTracker, type CreateEventParams, DEFAULT_CONFIG, DEFAULT_COST_ESTIMATION_CONFIG, DEFAULT_PRICING, Daemon, type DaemonConfig, type DaemonInfo, type Edge, EdgeSchema, EscalationManager, type EscalationManagerConfig, type EscalationResult, type Event, type EventQueryFilters, EventSchema, type EventType, EventTypeSchema, type ExecutionEngineConfig, type ExecutionResult, FileOwnershipManager, type FileOwnershipState, type Graph, type GraphAction, type GraphModification, type GraphModifierLike, GraphSchema, type GraphValidationCode, GraphValidationError, type LLMMessage, type LLMMessageRole, LLMMessageRoleSchema, LLMMessageSchema, type LLMProvider, type LLMResponse, LLMResponseSchema, LOOMCRAFT_PROMPT, LOOMKIT_PROMPT, LOOMPATH_PROMPT, LOOMPRINT_PROMPT, LOOMSCAN_PROMPT, LOOMSCOPE_PROMPT, type Level, LevelSchema, type LockDeniedMessage, type LockGrantMessage, type LockProtocolMessage, type LockReleaseMessage, type LockRequestMessage, LoomAgent, type LoomAgentStatus, type LoomConfig, type LoomPromptParams, type LoomaConfig, type LoomaPromptParams, type LoomaResult, type LoomexConfig, type LoomexPromptParams, type LoomexResult, type LoomiConfig, type LoomiPromptParams, type LoomiResult, type Message, MessageBus, MessageSchema, type ModelPricing, type ModelsConfig, ModelsConfigSchema, type MonitoringResult, type Node, type NodeExecutionResult, type NodeExecutionStatus, type NodeExecutor, NodeSchema, type NodeStatus, NodeStatusSchema, OllamaProvider, type OnRecordCallback, OpenAIProvider, type PartialConfig, PartialConfigSchema, type PromptSection, type PromptTemplate, type ProviderConfig, ProviderConfigSchema, type RateLimitAllowed, type RateLimitRejected, type RateLimitResult, RateLimiter, type ResumeInfo, type RetryStrategy, RetryStrategySchema, type ReviewReport, ReviewReportSchema, SPEC_PROMPTS, STANDARD_MEMORY_FILES, Scheduler, type ServerOptions, type ServerResult, type SharedMemoryFile, SharedMemoryFileSchema, SharedMemoryManager, type ShutdownHooks, type SpecArtifact, SpecEngine, type SpecEngineConfig, SpecPipelineError, type SpecPipelineResult, type SpecStepCallback, type SpecStepEvent, type TaskVerification, TaskVerificationSchema, type TeamPlan, type TemporaryLock, type TokenUsage, TokenUsageSchema, type Tool, type ToolContext, type ToolDefinition, ToolDefinitionSchema, type TopologyType, TopologyTypeSchema, type ValidatedGraph, type ValidationResult, type VerificationResult, WebSocketBroadcaster, type WorkerPlan, type Workflow, WorkflowExecutionEngine, WorkflowGraph, WorkflowManager, WorkflowNode, WorkflowSchema, type WorkflowStatus, WorkflowStatusSchema, type WsAgentMessageEvent, type WsAgentStatusEvent, type WsChatAction, type WsChatResponseEvent, type WsCostUpdateEvent, type WsEvent, type WsEventBase, type WsEventType, type WsGraphModifiedEvent, type WsMemoryUpdatedEvent, type WsNodeStatusEvent, type WsReviewVerdictEvent, type WsSpecArtifactReadyEvent, appendEvent, buildLoomPrompt, buildLoomaPrompt, buildLoomexPrompt, buildLoomiPrompt, createAuthMiddleware, createEscalateTool, createEvent, createLockDenied, createLockGrant, createLockRelease, createLockRequest, createReportCompleteTool, createSendMessageTool, createServer, createWorkerAgentInfo, deepMerge, editFileTool, estimateNodeCost, flushPendingWrites, generateTestPaths, isLockProtocolMessage, listFilesTool, loadConfig, loadConfigFile, loadDaemonInfo, loadWorkflowState, memoryReadTool, memoryWriteTool, parseDelay, parseLockProtocolMessage, parseReviewReport, queryEvents, readFileTool, repairState, resolveConfig, runAgentLoop, runLooma, runLoomex, runLoomi, saveWorkflowState, saveWorkflowStateImmediate, searchFilesTool, shellExecTool, toToolDefinition, validateAndOptimizeGraph, validateDag, validateGraphIntegrity, verifyStateConsistency, writeFileTool, zodToJsonSchema };
