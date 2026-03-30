// src/config.ts
import { EventEmitter } from "events";
import { watch } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
var LevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal("custom")]);
var RetryStrategySchema = z.union([z.literal("adaptive"), z.literal("same")]);
var ModelsConfigSchema = z.object({
  /** LLM model for the Loom (Architect) agent. */
  loom: z.string().default("claude-opus-4-6"),
  /** LLM model for the Loomi (Orchestrator) agent. */
  loomi: z.string().default("claude-sonnet-4-6"),
  /** LLM model for the Looma (Worker) agent. */
  looma: z.string().default("claude-sonnet-4-6"),
  /** LLM model for the Loomex (Reviewer) agent. */
  loomex: z.string().default("claude-sonnet-4-6")
});
var ConfigSchema = z.object({
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
  dashboardPort: z.number().int().min(1).max(65535).default(3e3),
  /** Whether to automatically open the dashboard in a browser on daemon start. */
  dashboardAutoOpen: z.boolean().default(true),
  /** Wall-clock timeout per agent call in milliseconds (default: 10 minutes). */
  agentTimeout: z.number().int().positive().default(6e5),
  /** Maximum tokens per agent LLM call. */
  agentTokenLimit: z.number().int().positive().default(1e5),
  /** Maximum LLM API calls per minute per agent (rate limiting). */
  apiRateLimit: z.number().int().positive().default(60)
});
var PartialConfigSchema = ConfigSchema.partial();
var DEFAULT_CONFIG = ConfigSchema.parse({});
var LEVEL_PRESETS = {
  1: {
    reviewerEnabled: false,
    maxRetriesPerNode: 0,
    maxLoomasPerLoomi: 1,
    models: {
      loom: "claude-sonnet-4-6",
      loomi: "claude-sonnet-4-6",
      looma: "claude-sonnet-4-6",
      loomex: "claude-sonnet-4-6"
    }
  },
  2: {
    reviewerEnabled: true,
    maxRetriesPerNode: 1,
    maxLoomasPerLoomi: 2,
    models: {
      loom: "claude-opus-4-6",
      loomi: "claude-sonnet-4-6",
      looma: "claude-opus-4-6",
      loomex: "claude-sonnet-4-6"
    }
  },
  3: {
    reviewerEnabled: true,
    maxRetriesPerNode: 2,
    maxLoomasPerLoomi: null,
    models: {
      loom: "claude-opus-4-6",
      loomi: "claude-opus-4-6",
      looma: "claude-opus-4-6",
      loomex: "claude-opus-4-6"
    }
  }
};
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    if (sourceValue === void 0) {
      continue;
    }
    if (sourceValue === null) {
      result[key] = null;
      continue;
    }
    const targetValue = result[key];
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
      continue;
    }
    result[key] = sourceValue;
  }
  return result;
}
async function loadConfigFile(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw new Error(
      `Failed to read config file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in config file at ${filePath}`);
  }
  const result = PartialConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config in ${filePath}: ${result.error.message}`);
  }
  return parsed;
}
function getLevelPreset(level) {
  if (level === "custom") {
    return {};
  }
  return LEVEL_PRESETS[level];
}
async function loadConfig(options = {}) {
  const { projectPath, overrides = {} } = options;
  const globalPath = join(homedir(), ".loomflo", "config.json");
  const globalConfig = await loadConfigFile(globalPath);
  let projectConfig = {};
  if (projectPath) {
    projectConfig = await loadConfigFile(join(projectPath, ".loomflo", "config.json"));
  }
  const resolvedLevel = overrides.level ?? projectConfig.level ?? globalConfig.level ?? DEFAULT_CONFIG.level;
  const levelPreset = getLevelPreset(resolvedLevel);
  let merged = deepMerge(DEFAULT_CONFIG, levelPreset);
  merged = deepMerge(merged, globalConfig);
  merged = deepMerge(merged, projectConfig);
  merged = deepMerge(merged, overrides);
  return ConfigSchema.parse(merged);
}
function resolveConfig(globalConfig, projectConfig, overrides) {
  const resolvedLevel = overrides.level ?? projectConfig.level ?? globalConfig.level ?? DEFAULT_CONFIG.level;
  const levelPreset = getLevelPreset(resolvedLevel);
  let merged = deepMerge(DEFAULT_CONFIG, levelPreset);
  merged = deepMerge(merged, globalConfig);
  merged = deepMerge(merged, projectConfig);
  merged = deepMerge(merged, overrides);
  return ConfigSchema.parse(merged);
}
var ConfigManager = class _ConfigManager extends EventEmitter {
  /** Current fully-resolved configuration. */
  config;
  /** Cached global-level partial config from the last load/reload. */
  globalConfig;
  /** Current project-level partial config (updated by updateConfig and reload). */
  projectFileConfig;
  /** Path to the project root, or undefined if no project context. */
  projectPath;
  /** CLI/programmatic overrides (immutable after construction). */
  overrides;
  /** Active file system watcher, or null if not watching. */
  watcher = null;
  /** Debounce timer for file watch events. */
  debounceTimer = null;
  /** Flag to skip the next watcher-triggered reload after our own persist. */
  skipNextReload = false;
  /** Debounce delay in milliseconds for file watch events. */
  static DEBOUNCE_MS = 75;
  /**
   * Private constructor — use {@link ConfigManager.create} instead.
   *
   * @param config - Initial fully-resolved configuration.
   * @param globalConfig - Initial global-level partial config.
   * @param projectFileConfig - Initial project-level partial config.
   * @param projectPath - Project root path.
   * @param overrides - CLI/programmatic overrides.
   */
  constructor(config, globalConfig, projectFileConfig, projectPath, overrides) {
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
  static async create(options = {}) {
    const { projectPath, overrides = {} } = options;
    const globalPath = join(homedir(), ".loomflo", "config.json");
    const globalConfig = await loadConfigFile(globalPath);
    let projectFileConfig = {};
    if (projectPath) {
      projectFileConfig = await loadConfigFile(
        join(projectPath, ".loomflo", "config.json")
      );
    }
    const config = resolveConfig(globalConfig, projectFileConfig, overrides);
    const manager = new _ConfigManager(
      config,
      globalConfig,
      projectFileConfig,
      projectPath,
      overrides
    );
    manager.startWatching();
    return manager;
  }
  /**
   * Return the current fully-resolved configuration.
   *
   * @returns The current merged configuration object.
   */
  getConfig() {
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
  updateConfig(partial) {
    this.projectFileConfig = deepMerge(
      this.projectFileConfig,
      partial
    );
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
  async reload() {
    const globalPath = join(homedir(), ".loomflo", "config.json");
    this.globalConfig = await loadConfigFile(globalPath);
    if (this.projectPath) {
      this.projectFileConfig = await loadConfigFile(
        join(this.projectPath, ".loomflo", "config.json")
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
  destroy() {
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
  startWatching() {
    if (!this.projectPath) return;
    const configDir = join(this.projectPath, ".loomflo");
    try {
      this.watcher = watch(
        configDir,
        (_eventType, filename) => {
          if (filename === "config.json") {
            this.handleFileChange();
          }
        }
      );
      this.watcher.on("error", () => {
        this.stopWatching();
      });
    } catch {
    }
  }
  /** Stop the file system watcher if active. */
  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
  /**
   * Handle a file change event from the watcher.
   * Debounces rapid events and triggers a config reload.
   */
  handleFileChange() {
    if (this.skipNextReload) {
      this.skipNextReload = false;
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reload().catch(() => {
      });
    }, _ConfigManager.DEBOUNCE_MS);
  }
  /**
   * Persist the current project-level config to the project config file.
   * Runs asynchronously in the background; errors are silently ignored
   * since the in-memory config is already up-to-date.
   */
  persistProjectConfig() {
    if (!this.projectPath) return;
    this.skipNextReload = true;
    const configDir = join(this.projectPath, ".loomflo");
    const configPath = join(configDir, "config.json");
    const content = JSON.stringify(this.projectFileConfig, null, 2) + "\n";
    void mkdir(configDir, { recursive: true }).then(() => writeFile(configPath, content, "utf-8")).catch(() => {
    });
  }
};

// src/types.ts
import { z as z2 } from "zod";
var WorkflowStatusSchema = z2.enum([
  "init",
  "spec",
  "building",
  "running",
  "paused",
  "done",
  "failed"
]);
var NodeStatusSchema = z2.enum([
  "pending",
  "waiting",
  "running",
  "review",
  "done",
  "failed",
  "blocked"
]);
var AgentRoleSchema = z2.enum(["loom", "loomi", "looma", "loomex"]);
var AgentStatusSchema = z2.enum([
  "created",
  "running",
  "completed",
  "failed"
]);
var TopologyTypeSchema = z2.enum([
  "linear",
  "divergent",
  "convergent",
  "tree",
  "mixed"
]);
var EventTypeSchema = z2.enum([
  "workflow_created",
  "workflow_started",
  "workflow_paused",
  "workflow_resumed",
  "workflow_completed",
  "spec_phase_started",
  "spec_phase_completed",
  "graph_built",
  "graph_modified",
  "node_started",
  "node_completed",
  "node_failed",
  "node_blocked",
  "agent_created",
  "agent_completed",
  "agent_failed",
  "reviewer_started",
  "reviewer_verdict",
  "retry_triggered",
  "escalation_triggered",
  "message_sent",
  "cost_tracked",
  "memory_updated"
]);
var EdgeSchema = z2.object({
  /** Source node ID. */
  from: z2.string(),
  /** Target node ID. */
  to: z2.string()
});
var TaskVerificationSchema = z2.object({
  /** Identifier of the verified task. */
  taskId: z2.string(),
  /** Task-level verification result. */
  status: z2.enum(["pass", "fail", "blocked"]),
  /** Explanation of what was found during verification. */
  details: z2.string()
});
var TextBlockSchema = z2.object({
  /** Block type discriminator. */
  type: z2.literal("text"),
  /** The text content. */
  text: z2.string()
});
var ToolUseBlockSchema = z2.object({
  /** Block type discriminator. */
  type: z2.literal("tool_use"),
  /** Unique tool-use invocation ID. */
  id: z2.string(),
  /** Tool name being invoked. */
  name: z2.string(),
  /** Tool input arguments. */
  input: z2.record(z2.string(), z2.unknown())
});
var ToolResultBlockSchema = z2.object({
  /** Block type discriminator. */
  type: z2.literal("tool_result"),
  /** ID of the tool-use invocation this result responds to. */
  toolUseId: z2.string(),
  /** Tool execution result as a string. */
  content: z2.string()
});
var ContentBlockSchema = z2.discriminatedUnion("type", [
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema
]);
var ToolDefinitionSchema = z2.object({
  /** Tool identifier (e.g., "read_file"). */
  name: z2.string(),
  /** Human-readable description included in the LLM prompt. */
  description: z2.string(),
  /** JSON Schema describing the tool's input parameters. */
  inputSchema: z2.record(z2.string(), z2.unknown())
});
var SharedMemoryFileSchema = z2.object({
  /** File name (e.g., "DECISIONS.md"). */
  name: z2.string(),
  /** Full path within .loomflo/shared-memory/. */
  path: z2.string(),
  /** Current file content (Markdown). */
  content: z2.string(),
  /** Agent ID that last wrote to this file. */
  lastModifiedBy: z2.string(),
  /** ISO 8601 timestamp of last modification. */
  lastModifiedAt: z2.string().datetime()
});
var TokenUsageSchema = z2.object({
  /** Number of input tokens consumed. */
  input: z2.number().int().nonnegative(),
  /** Number of output tokens produced. */
  output: z2.number().int().nonnegative()
});
var AgentInfoSchema = z2.object({
  /** Unique agent identifier (e.g., "looma-auth-1"). */
  id: z2.string(),
  /** Agent role in the workflow. */
  role: AgentRoleSchema,
  /** LLM model identifier (e.g., "claude-sonnet-4-6"). */
  model: z2.string(),
  /** Current agent lifecycle state. */
  status: AgentStatusSchema,
  /** Glob patterns defining the agent's file write permissions. */
  writeScope: z2.array(z2.string()),
  /** Description of the agent's assigned task. */
  taskDescription: z2.string(),
  /** Cumulative token usage for this agent's LLM calls. */
  tokenUsage: TokenUsageSchema,
  /** Cumulative cost in USD for this agent's LLM calls. */
  cost: z2.number().nonnegative()
});
var ReviewReportSchema = z2.object({
  /** Overall review verdict. */
  verdict: z2.enum(["PASS", "FAIL", "BLOCKED"]),
  /** Per-task verification results. */
  tasksVerified: z2.array(TaskVerificationSchema),
  /** Detailed findings: what works, what's missing, what's blocked. */
  details: z2.string(),
  /** Specific recommended actions for retry or escalation. */
  recommendation: z2.string(),
  /** ISO 8601 timestamp when the review was produced. */
  createdAt: z2.string().datetime()
});
var MessageSchema = z2.object({
  /** Unique message identifier. */
  id: z2.string().uuid(),
  /** Sender agent ID. */
  from: z2.string(),
  /** Recipient agent ID. */
  to: z2.string(),
  /** Node context (messages are node-scoped). */
  nodeId: z2.string(),
  /** Message body. */
  content: z2.string(),
  /** ISO 8601 timestamp when the message was sent. */
  timestamp: z2.string().datetime()
});
var EventSchema = z2.object({
  /** ISO 8601 precise timestamp. */
  ts: z2.string().datetime(),
  /** Event type identifier. */
  type: EventTypeSchema,
  /** Workflow this event belongs to. */
  workflowId: z2.string(),
  /** Node this event relates to, or null for workflow-level events. */
  nodeId: z2.string().nullable(),
  /** Agent this event relates to, or null for node/workflow-level events. */
  agentId: z2.string().nullable(),
  /** Event-specific payload data. */
  details: z2.record(z2.string(), z2.unknown())
});
var LLMResponseSchema = z2.object({
  /** Response content blocks. */
  content: z2.array(ContentBlockSchema),
  /** Reason the LLM stopped generating. */
  stopReason: z2.enum(["end_turn", "tool_use"]),
  /** Token usage for this response. */
  usage: z2.object({
    /** Input tokens consumed. */
    inputTokens: z2.number().int().nonnegative(),
    /** Output tokens produced. */
    outputTokens: z2.number().int().nonnegative()
  }),
  /** Model identifier that produced this response. */
  model: z2.string()
});
var NodeSchema = z2.object({
  /** Unique node identifier (e.g., "node-1"). */
  id: z2.string(),
  /** Human-readable node name (e.g., "Setup Authentication"). */
  title: z2.string(),
  /** Current node execution state. */
  status: NodeStatusSchema,
  /** Markdown instructions for this node. */
  instructions: z2.string(),
  /** Delay before activation (e.g., "0", "30m", "1h", "1d"). */
  delay: z2.string(),
  /** ISO 8601 timestamp when the delay expires, or null. */
  resumeAt: z2.string().datetime().nullable(),
  /** Agents assigned to this node. */
  agents: z2.array(AgentInfoSchema),
  /** Agent ID to glob patterns mapping for write scope enforcement. */
  fileOwnership: z2.record(z2.string(), z2.array(z2.string())),
  /** Number of retry cycles attempted. */
  retryCount: z2.number().int().nonnegative(),
  /** Maximum allowed retry cycles (from config). */
  maxRetries: z2.number().int().nonnegative(),
  /** Loomex review report, or null if no review has run. */
  reviewReport: ReviewReportSchema.nullable(),
  /** Total accumulated cost in USD for this node (including retries). */
  cost: z2.number().nonnegative(),
  /** ISO 8601 timestamp when the node started running, or null. */
  startedAt: z2.string().datetime().nullable(),
  /** ISO 8601 timestamp when the node finished, or null. */
  completedAt: z2.string().datetime().nullable()
});
var GraphSchema = z2.object({
  /** All nodes keyed by node ID. */
  nodes: z2.record(z2.string(), NodeSchema),
  /** Directed edges connecting nodes. */
  edges: z2.array(EdgeSchema),
  /** Graph topology classification. */
  topology: TopologyTypeSchema
});
var WorkflowSchema = z2.object({
  /** Unique workflow identifier. */
  id: z2.string().uuid(),
  /** Current workflow lifecycle state. */
  status: WorkflowStatusSchema,
  /** Original natural language project description. */
  description: z2.string(),
  /** Absolute path to the project workspace. */
  projectPath: z2.string(),
  /** The directed execution graph. */
  graph: GraphSchema,
  /** Merged configuration (global + project + CLI). */
  config: ConfigSchema,
  /** ISO 8601 timestamp when the workflow was created. */
  createdAt: z2.string().datetime(),
  /** ISO 8601 timestamp of the last state change. */
  updatedAt: z2.string().datetime(),
  /** Accumulated cost in USD across all nodes. */
  totalCost: z2.number().nonnegative()
});

// src/persistence/events.ts
import { mkdir as mkdir2, appendFile, readFile as readFile2 } from "fs/promises";
import { join as join2 } from "path";
var LOOMFLO_DIR = ".loomflo";
var EVENTS_FILE = "events.jsonl";
function createEvent(params) {
  return {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    type: params.type,
    workflowId: params.workflowId,
    nodeId: params.nodeId ?? null,
    agentId: params.agentId ?? null,
    details: params.details ?? {}
  };
}
async function appendEvent(projectPath, event) {
  const dir = join2(projectPath, LOOMFLO_DIR);
  await mkdir2(dir, { recursive: true });
  const filePath = join2(dir, EVENTS_FILE);
  const line = JSON.stringify(event) + "\n";
  await appendFile(filePath, line, { encoding: "utf-8" });
}
async function queryEvents(projectPath, filters) {
  const filePath = join2(projectPath, LOOMFLO_DIR, EVENTS_FILE);
  let raw;
  try {
    raw = await readFile2(filePath, { encoding: "utf-8" });
  } catch {
    return [];
  }
  const lines = raw.split("\n");
  let events = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.warn(`events.jsonl line ${String(i + 1)}: invalid JSON, skipping`);
      continue;
    }
    const result = EventSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`events.jsonl line ${String(i + 1)}: schema validation failed, skipping`);
      continue;
    }
    events.push(result.data);
  }
  if (filters) {
    events = applyFilters(events, filters);
  }
  return events;
}
function applyFilters(events, filters) {
  let result = events;
  if (filters.type !== void 0) {
    const types = new Set(
      Array.isArray(filters.type) ? filters.type : [filters.type]
    );
    result = result.filter((e) => types.has(e.type));
  }
  if (filters.nodeId !== void 0) {
    result = result.filter((e) => e.nodeId === filters.nodeId);
  }
  if (filters.agentId !== void 0) {
    result = result.filter((e) => e.agentId === filters.agentId);
  }
  if (filters.after !== void 0) {
    const after = filters.after;
    result = result.filter((e) => e.ts >= after);
  }
  if (filters.before !== void 0) {
    const before = filters.before;
    result = result.filter((e) => e.ts < before);
  }
  if (filters.limit !== void 0 && filters.limit > 0) {
    result = result.slice(-filters.limit);
  }
  return result;
}

// src/persistence/state.ts
import { mkdir as mkdir3, readFile as readFile3, rename, writeFile as writeFile2 } from "fs/promises";
import { dirname, join as join3 } from "path";
var LOOMFLO_DIR2 = ".loomflo";
var WORKFLOW_FILE = "workflow.json";
var DEBOUNCE_MS = 300;
var pendingWrites = /* @__PURE__ */ new Map();
function getWorkflowPath(projectPath) {
  return join3(projectPath, LOOMFLO_DIR2, WORKFLOW_FILE);
}
async function atomicWrite(filePath, workflow) {
  const dir = dirname(filePath);
  await mkdir3(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const content = JSON.stringify(workflow, null, 2);
  await writeFile2(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}
async function loadWorkflowState(projectPath) {
  const filePath = getWorkflowPath(projectPath);
  let content;
  try {
    content = await readFile3(filePath, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Failed to read workflow state at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in workflow state at ${filePath}`);
  }
  const result = WorkflowSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid workflow state in ${filePath}: ${result.error.message}`
    );
  }
  return result.data;
}
async function saveWorkflowState(projectPath, workflow) {
  return new Promise((resolve, reject) => {
    const existing = pendingWrites.get(projectPath);
    if (existing) {
      clearTimeout(existing.timer);
      existing.workflow = workflow;
      existing.resolvers.push({ resolve, reject });
      existing.timer = setTimeout(() => void executePendingWrite(projectPath), DEBOUNCE_MS);
    } else {
      const pending = {
        timer: setTimeout(() => void executePendingWrite(projectPath), DEBOUNCE_MS),
        workflow,
        resolvers: [{ resolve, reject }]
      };
      pendingWrites.set(projectPath, pending);
    }
  });
}
async function executePendingWrite(projectPath) {
  const pending = pendingWrites.get(projectPath);
  if (!pending) {
    return;
  }
  pendingWrites.delete(projectPath);
  const { workflow, resolvers } = pending;
  try {
    await atomicWrite(getWorkflowPath(projectPath), workflow);
    for (const { resolve } of resolvers) {
      resolve();
    }
  } catch (error) {
    for (const { reject } of resolvers) {
      reject(error);
    }
  }
}
async function saveWorkflowStateImmediate(projectPath, workflow) {
  const existing = pendingWrites.get(projectPath);
  if (existing) {
    clearTimeout(existing.timer);
    pendingWrites.delete(projectPath);
    try {
      await atomicWrite(getWorkflowPath(projectPath), workflow);
      for (const { resolve } of existing.resolvers) {
        resolve();
      }
    } catch (error) {
      for (const { reject } of existing.resolvers) {
        reject(error);
      }
      throw error;
    }
    return;
  }
  await atomicWrite(getWorkflowPath(projectPath), workflow);
}
async function flushPendingWrites() {
  const projectPaths = [...pendingWrites.keys()];
  const writePromises = [];
  for (const projectPath of projectPaths) {
    const pending = pendingWrites.get(projectPath);
    if (!pending) {
      continue;
    }
    clearTimeout(pending.timer);
    writePromises.push(executePendingWrite(projectPath));
  }
  await Promise.all(writePromises);
}
var EVENT_TO_NODE_STATUS = /* @__PURE__ */ new Map([
  ["node_started", "running"],
  ["node_completed", "done"],
  ["node_failed", "failed"],
  ["node_blocked", "blocked"]
]);
var NODE_EVENT_TYPES = [
  "node_started",
  "node_completed",
  "node_failed",
  "node_blocked"
];
async function verifyStateConsistency(projectPath) {
  const issues = [];
  let recoverable = true;
  let workflow;
  try {
    workflow = await loadWorkflowState(projectPath);
  } catch (error) {
    return {
      valid: false,
      issues: [
        `Workflow state corrupted: ${error instanceof Error ? error.message : String(error)}`
      ],
      recoverable: false
    };
  }
  const events = await queryEvents(projectPath);
  if (workflow === null) {
    const hasEvents = events.length > 0;
    if (hasEvents) {
      issues.push("workflow.json is missing but events.jsonl contains events");
      recoverable = false;
    }
    return { valid: !hasEvents, issues, recoverable };
  }
  const workflowEvents = events.filter((e) => e.workflowId === workflow.id);
  if (events.length > 0 && workflowEvents.length === 0) {
    issues.push(
      `events.jsonl contains events but none reference workflow ${workflow.id}`
    );
    recoverable = false;
  }
  const lastEventByNode = buildLastEventByNode(workflowEvents);
  for (const [nodeId, node] of Object.entries(workflow.graph.nodes)) {
    const lastEvent = lastEventByNode.get(nodeId);
    if (lastEvent === void 0) {
      if (node.status !== "pending" && node.status !== "waiting") {
        issues.push(
          `Node "${nodeId}" has status "${node.status}" but no events were logged for it`
        );
      }
      continue;
    }
    const expectedStatus = EVENT_TO_NODE_STATUS.get(lastEvent.type);
    if (expectedStatus !== void 0 && node.status !== expectedStatus) {
      issues.push(
        `Node "${nodeId}" has status "${node.status}" but last event is "${lastEvent.type}" (expected "${expectedStatus}")`
      );
    }
    if (node.status === "done") {
      const hasCompletionEvent = workflowEvents.some(
        (e) => e.nodeId === nodeId && e.type === "node_completed"
      );
      if (!hasCompletionEvent) {
        issues.push(
          `Node "${nodeId}" is marked as done but has no node_completed event`
        );
      }
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    recoverable: recoverable && issues.length > 0
  };
}
async function repairState(projectPath) {
  const verification = await verifyStateConsistency(projectPath);
  if (verification.valid) {
    return verification;
  }
  if (!verification.recoverable) {
    return verification;
  }
  const workflow = await loadWorkflowState(projectPath);
  if (workflow === null) {
    return verification;
  }
  const events = await queryEvents(projectPath);
  const workflowEvents = events.filter((e) => e.workflowId === workflow.id);
  const lastEventByNode = buildLastEventByNode(workflowEvents);
  let repaired = false;
  for (const [nodeId, node] of Object.entries(workflow.graph.nodes)) {
    const lastEvent = lastEventByNode.get(nodeId);
    if (lastEvent === void 0) {
      continue;
    }
    const expectedStatus = EVENT_TO_NODE_STATUS.get(lastEvent.type);
    if (expectedStatus !== void 0 && node.status !== expectedStatus) {
      node.status = expectedStatus;
      repaired = true;
    }
  }
  if (repaired) {
    workflow.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveWorkflowStateImmediate(projectPath, workflow);
  }
  return verifyStateConsistency(projectPath);
}
function buildLastEventByNode(events) {
  const nodeEventTypes = new Set(NODE_EVENT_TYPES);
  const lastEventByNode = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.nodeId !== null && nodeEventTypes.has(event.type)) {
      lastEventByNode.set(event.nodeId, event);
    }
  }
  return lastEventByNode;
}

// src/daemon.ts
import { randomBytes } from "crypto";
import { mkdir as mkdir4, readFile as readFile4, unlink, writeFile as writeFile3 } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join4 } from "path";
import Fastify from "fastify";
var LOOMFLO_HOME_DIR = ".loomflo";
var DAEMON_FILE = "daemon.json";
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_PORT = 3e3;
var TOKEN_BYTES = 32;
var GRACEFUL_SHUTDOWN_TIMEOUT_MS = 3e4;
var Daemon = class {
  port;
  host;
  projectPath;
  server = null;
  info = null;
  shutdownHooks = null;
  shuttingDown = false;
  /**
   * Create a new Daemon instance.
   *
   * @param config - Daemon configuration options.
   */
  constructor(config) {
    this.port = config.port ?? DEFAULT_PORT;
    this.host = config.host ?? DEFAULT_HOST;
    this.projectPath = config.projectPath;
    const ALLOWED_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
    if (!ALLOWED_HOSTS.has(this.host)) {
      throw new Error(
        `Daemon host must be one of ${[...ALLOWED_HOSTS].join(", ")}, got '${this.host}'. Use 0.0.0.0 only inside containers where network isolation is provided by the runtime.`
      );
    }
  }
  /**
   * Register shutdown hooks for graceful shutdown coordination.
   *
   * These hooks allow the daemon to coordinate with the execution engine
   * during shutdown: stop dispatching new calls, wait for active calls,
   * mark interrupted nodes, and persist final state.
   *
   * @param hooks - Callback interface for shutdown coordination.
   */
  setShutdownHooks(hooks) {
    this.shutdownHooks = hooks;
  }
  /**
   * Whether the daemon is currently in the process of shutting down.
   *
   * @returns True if graceful shutdown has been initiated.
   */
  get isShuttingDown() {
    return this.shuttingDown;
  }
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
  async start() {
    if (this.server) {
      throw new Error("Daemon is already running");
    }
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    this.server = Fastify({ logger: false });
    await this.server.listen({ port: this.port, host: this.host });
    this.info = {
      port: this.port,
      host: this.host,
      token,
      pid: process.pid
    };
    await writeDaemonFile(this.info);
    return this.info;
  }
  /**
   * Stop the daemon immediately.
   *
   * Flushes any pending state writes, closes the Fastify server,
   * and removes `~/.loomflo/daemon.json`. Does NOT wait for active
   * agent calls to finish. Use {@link gracefulShutdown} for orderly shutdown.
   */
  async stop() {
    await flushPendingWrites();
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    await removeDaemonFile();
    this.info = null;
    this.shuttingDown = false;
  }
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
  async gracefulShutdown(timeoutMs = GRACEFUL_SHUTDOWN_TIMEOUT_MS) {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    if (!this.shutdownHooks) {
      await this.stop();
      return;
    }
    const { stopDispatching, waitForActiveCalls, getWorkflow, markNodesInterrupted } = this.shutdownHooks;
    stopDispatching();
    try {
      await Promise.race([
        waitForActiveCalls(),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ]);
    } catch {
    }
    const interruptedNodeIds = markNodesInterrupted();
    const workflow = getWorkflow();
    if (workflow !== null && this.projectPath) {
      for (const nodeId of interruptedNodeIds) {
        const event = createEvent({
          type: "node_failed",
          workflowId: workflow.id,
          nodeId,
          details: { reason: "daemon_shutdown", interrupted: true }
        });
        await appendEvent(this.projectPath, event);
      }
      await saveWorkflowStateImmediate(this.projectPath, workflow);
    }
    await flushPendingWrites();
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    await removeDaemonFile();
    this.info = null;
    this.shuttingDown = false;
  }
  /**
   * Get runtime information about the daemon if it is running.
   *
   * @returns The daemon info, or null if the daemon is not running.
   */
  getInfo() {
    return this.info;
  }
  /**
   * Check whether the daemon is currently running.
   *
   * @returns True if the daemon server is active.
   */
  isRunning() {
    return this.server !== null;
  }
};
function getDaemonFilePath() {
  return join4(homedir2(), LOOMFLO_HOME_DIR, DAEMON_FILE);
}
async function writeDaemonFile(info) {
  const dir = join4(homedir2(), LOOMFLO_HOME_DIR);
  await mkdir4(dir, { recursive: true });
  await writeFile3(getDaemonFilePath(), JSON.stringify(info, null, 2), {
    encoding: "utf-8",
    mode: 384
  });
}
async function removeDaemonFile() {
  try {
    await unlink(getDaemonFilePath());
  } catch (error) {
    const code = error.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}
async function loadDaemonInfo() {
  const filePath = getDaemonFilePath();
  let content;
  try {
    content = await readFile4(filePath, "utf-8");
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Failed to read daemon info at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in daemon info at ${filePath}`);
  }
  return parsed;
}

export {
  LevelSchema,
  RetryStrategySchema,
  ModelsConfigSchema,
  ConfigSchema,
  PartialConfigSchema,
  DEFAULT_CONFIG,
  deepMerge,
  loadConfigFile,
  loadConfig,
  resolveConfig,
  ConfigManager,
  WorkflowStatusSchema,
  NodeStatusSchema,
  AgentRoleSchema,
  AgentStatusSchema,
  TopologyTypeSchema,
  EventTypeSchema,
  EdgeSchema,
  TaskVerificationSchema,
  ContentBlockSchema,
  ToolDefinitionSchema,
  SharedMemoryFileSchema,
  TokenUsageSchema,
  AgentInfoSchema,
  ReviewReportSchema,
  MessageSchema,
  EventSchema,
  LLMResponseSchema,
  NodeSchema,
  GraphSchema,
  WorkflowSchema,
  createEvent,
  appendEvent,
  queryEvents,
  loadWorkflowState,
  saveWorkflowState,
  saveWorkflowStateImmediate,
  flushPendingWrites,
  verifyStateConsistency,
  repairState,
  Daemon,
  loadDaemonInfo
};
