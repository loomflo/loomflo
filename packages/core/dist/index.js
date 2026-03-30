import {
  AgentInfoSchema,
  AgentRoleSchema,
  AgentStatusSchema,
  ConfigManager,
  ConfigSchema,
  ContentBlockSchema,
  DEFAULT_CONFIG,
  Daemon,
  EdgeSchema,
  EventSchema,
  EventTypeSchema,
  GraphSchema,
  LLMResponseSchema,
  LevelSchema,
  MessageSchema,
  ModelsConfigSchema,
  NodeSchema,
  NodeStatusSchema,
  PartialConfigSchema,
  RetryStrategySchema,
  ReviewReportSchema,
  SharedMemoryFileSchema,
  TaskVerificationSchema,
  TokenUsageSchema,
  ToolDefinitionSchema,
  TopologyTypeSchema,
  WorkflowSchema,
  WorkflowStatusSchema,
  appendEvent,
  createEvent,
  deepMerge,
  flushPendingWrites,
  loadConfig,
  loadConfigFile,
  loadDaemonInfo,
  loadWorkflowState,
  queryEvents,
  repairState,
  resolveConfig,
  saveWorkflowState,
  saveWorkflowStateImmediate,
  verifyStateConsistency
} from "./chunk-7M4TNMD3.js";

// src/providers/base.ts
import { z } from "zod";
var LLMMessageRoleSchema = z.enum(["user", "assistant"]);
var LLMMessageSchema = z.object({
  /** Message author: 'user' for human/system input, 'assistant' for LLM output. */
  role: LLMMessageRoleSchema,
  /** Message content: plain string or structured content blocks. */
  content: z.union([z.string(), z.array(ContentBlockSchema)])
});
var ProviderConfigSchema = z.object({
  /** API key for authentication (e.g., ANTHROPIC_API_KEY value). */
  apiKey: z.string().min(1),
  /** Base URL override for the provider API (e.g., custom proxy or local endpoint). */
  baseUrl: z.string().url().optional(),
  /** Default model identifier (e.g., "claude-sonnet-4-6", "gpt-4o"). */
  defaultModel: z.string().optional(),
  /** Default maximum tokens for completions. */
  defaultMaxTokens: z.number().int().positive().optional(),
  /** Additional provider-specific options passed through without validation. */
  options: z.record(z.string(), z.unknown()).optional()
});
var CompletionParamsSchema = z.object({
  /** Conversation message history sent to the LLM. */
  messages: z.array(LLMMessageSchema),
  /** System prompt providing instructions and context for the LLM. */
  system: z.string(),
  /** Tool definitions available for the LLM to invoke. */
  tools: z.array(ToolDefinitionSchema).optional(),
  /** Model identifier to use for this completion (e.g., "claude-sonnet-4-6"). */
  model: z.string(),
  /** Maximum tokens the LLM may generate in its response. */
  maxTokens: z.number().int().positive().optional()
});

// src/providers/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
var DEFAULT_MAX_TOKENS = 8192;
var DEFAULT_MODEL = "claude-sonnet-4-6";
function toAnthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      ...tool.inputSchema
    }
  }));
}
function toAnthropicContent(content) {
  if (typeof content === "string") {
    return content;
  }
  return content.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content
        };
    }
  });
}
function toAnthropicMessages(messages) {
  return messages.map((msg) => ({
    role: msg.role,
    content: toAnthropicContent(msg.content)
  }));
}
function fromAnthropicContent(blocks) {
  const result = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        result.push({ type: "text", text: block.text });
        break;
      case "tool_use":
        result.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input
        });
        break;
    }
  }
  return result;
}
function fromAnthropicStopReason(stopReason) {
  if (stopReason === "tool_use") {
    return "tool_use";
  }
  return "end_turn";
}
var AnthropicProvider = class {
  client;
  defaultModel;
  defaultMaxTokens;
  /**
   * Creates an AnthropicProvider instance.
   *
   * @param config - Provider configuration. apiKey is required.
   *   Optional baseUrl overrides the API endpoint.
   *   Optional defaultModel sets the fallback model identifier.
   *   Optional defaultMaxTokens sets the fallback token limit.
   */
  constructor(config) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...config.baseUrl ? { baseURL: config.baseUrl } : {}
    });
    this.defaultModel = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  }
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
  async complete(params) {
    const model = params.model || this.defaultModel;
    const maxTokens = params.maxTokens ?? this.defaultMaxTokens;
    const requestParams = {
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: toAnthropicMessages(params.messages),
      ...params.tools?.length ? { tools: toAnthropicTools(params.tools) } : {}
    };
    try {
      const response = await this.client.messages.create(requestParams);
      return {
        content: fromAnthropicContent(response.content),
        stopReason: fromAnthropicStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        },
        model: response.model
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(
          `Anthropic API error (${String(error.status)}): ${error.message}`
        );
      }
      throw error;
    }
  }
};

// src/providers/openai.ts
var OpenAIProvider = class {
  /**
   * Always throws — OpenAI support is not yet implemented.
   *
   * @throws {Error} Always, indicating the provider is not yet supported.
   */
  complete() {
    throw new Error(
      "OpenAI provider is not yet supported. Planned for a future release."
    );
  }
};

// src/providers/ollama.ts
var OllamaProvider = class {
  /**
   * Always throws — Ollama support is not yet implemented.
   *
   * @throws {Error} Always, indicating the provider is not yet supported.
   */
  complete() {
    throw new Error(
      "Ollama provider is not yet supported. Planned for a future release."
    );
  }
};

// src/tools/base.ts
import "zod";
function zodToJsonSchema(schema) {
  return processSchema(schema);
}
function processSchema(schema) {
  const def = schema._def;
  const typeName = def["typeName"];
  switch (typeName) {
    case "ZodString":
      return processString(def);
    case "ZodNumber":
      return processNumber(def);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodObject":
      return processObject(def);
    case "ZodArray":
      return processArray(def);
    case "ZodEnum":
      return processEnum(def);
    case "ZodNativeEnum":
      return processNativeEnum(def);
    case "ZodLiteral":
      return processLiteral(def);
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return processUnion(def);
    case "ZodOptional":
      return processSchema(def["innerType"]);
    case "ZodNullable":
      return { ...processSchema(def["innerType"]), nullable: true };
    case "ZodDefault":
      return processDefault(def);
    case "ZodRecord":
      return processRecord(def);
    case "ZodEffects":
      return processSchema(def["schema"]);
    default:
      return {};
  }
}
function processString(def) {
  const result = { type: "string" };
  const checks = def["checks"];
  if (checks) {
    for (const check of checks) {
      if (check["kind"] === "min") result["minLength"] = check["value"];
      if (check["kind"] === "max") result["maxLength"] = check["value"];
      if (check["kind"] === "regex") result["pattern"] = String(check["regex"]);
    }
  }
  return result;
}
function processNumber(def) {
  const checks = def["checks"];
  const result = { type: "number" };
  if (checks) {
    for (const check of checks) {
      if (check["kind"] === "int") result["type"] = "integer";
      if (check["kind"] === "min") result["minimum"] = check["value"];
      if (check["kind"] === "max") result["maximum"] = check["value"];
    }
  }
  return result;
}
function processObject(def) {
  const shape = def["shape"];
  if (!shape) return { type: "object" };
  const shapeObj = shape();
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(shapeObj)) {
    properties[key] = processSchema(value);
    if (!isOptional(value)) {
      required.push(key);
    }
  }
  const result = { type: "object", properties, additionalProperties: false };
  if (required.length > 0) {
    result["required"] = required;
  }
  return result;
}
function isOptional(schema) {
  const def = schema._def;
  const typeName = def["typeName"];
  if (typeName === "ZodOptional" || typeName === "ZodDefault") return true;
  return false;
}
function processArray(def) {
  const itemType = def["type"];
  const result = { type: "array" };
  if (itemType) {
    result["items"] = processSchema(itemType);
  }
  return result;
}
function processEnum(def) {
  const values = def["values"];
  return { type: "string", enum: values };
}
function processNativeEnum(def) {
  const enumObj = def["values"];
  const values = Object.values(enumObj).filter(
    (v) => typeof v === "string" || typeof v === "number"
  );
  return { enum: values };
}
function processLiteral(def) {
  const value = def["value"];
  return { enum: [value] };
}
function processUnion(def) {
  const options = def["options"];
  return { oneOf: options.map((opt) => processSchema(opt)) };
}
function processDefault(def) {
  const innerSchema = processSchema(def["innerType"]);
  const defaultValueFn = def["defaultValue"];
  if (defaultValueFn) {
    innerSchema["default"] = defaultValueFn();
  }
  return innerSchema;
}
function processRecord(def) {
  const valueType = def["valueType"];
  const result = { type: "object" };
  if (valueType) {
    result["additionalProperties"] = processSchema(valueType);
  }
  return result;
}
function toToolDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema)
  };
}

// src/agents/base-agent.ts
var MAX_ITERATIONS = 100;
async function runAgentLoop(config, initialMessages) {
  const startTime = Date.now();
  const tokenUsage = { input: 0, output: 0 };
  const messages = initialMessages ? [...initialMessages] : [];
  const toolDefinitions = config.tools.map(toToolDefinition);
  const toolMap = new Map(config.tools.map((t) => [t.name, t]));
  const toolContext = {
    workspacePath: config.workspacePath,
    agentId: config.agentId,
    nodeId: config.nodeId,
    writeScope: config.writeScope
  };
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= config.timeout) {
      return {
        output: extractTextOutput(messages),
        tokenUsage,
        status: "timeout",
        error: `Agent exceeded wall-clock timeout of ${String(config.timeout)}ms (elapsed: ${String(elapsed)}ms)`
      };
    }
    const totalTokens = tokenUsage.input + tokenUsage.output;
    if (totalTokens >= config.tokenLimit) {
      return {
        output: extractTextOutput(messages),
        tokenUsage,
        status: "token_limit",
        error: `Agent exceeded token limit of ${String(config.tokenLimit)} (used: ${String(totalTokens)})`
      };
    }
    const params = {
      messages,
      system: config.systemPrompt,
      model: config.model,
      ...toolDefinitions.length > 0 && { tools: toolDefinitions },
      ...config.maxTokens !== void 0 && { maxTokens: config.maxTokens }
    };
    let response;
    try {
      response = await config.provider.complete(params);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        output: extractTextOutput(messages),
        tokenUsage,
        status: "failed",
        error: `LLM call failed: ${errorMessage}`
      };
    }
    tokenUsage.input += response.usage.inputTokens;
    tokenUsage.output += response.usage.outputTokens;
    messages.push({ role: "assistant", content: response.content });
    if (response.stopReason === "end_turn") {
      return {
        output: extractTextFromBlocks(response.content),
        tokenUsage,
        status: "completed"
      };
    }
    const toolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use"
    );
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const tool = toolMap.get(toolUse.name);
      let resultContent;
      if (!tool) {
        resultContent = `Error: Unknown tool "${toolUse.name}". Available tools: ${config.tools.map((t) => t.name).join(", ")}`;
      } else {
        const parseResult = tool.inputSchema.safeParse(toolUse.input);
        if (!parseResult.success) {
          resultContent = `Error: Invalid input for tool "${toolUse.name}": ${parseResult.error.message}`;
        } else {
          resultContent = await tool.execute(parseResult.data, toolContext);
        }
      }
      toolResults.push({
        type: "tool_result",
        toolUseId: toolUse.id,
        content: resultContent
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
  return {
    output: extractTextOutput(messages),
    tokenUsage,
    status: "failed",
    error: `Agent exceeded maximum iteration limit of ${String(MAX_ITERATIONS)}`
  };
}
function extractTextFromBlocks(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
function extractTextOutput(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg === void 0) continue;
    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      return extractTextFromBlocks(msg.content);
    }
  }
  return "";
}

// src/agents/escalation.ts
var ESCALATION_AGENT_ID = "loom-escalation";
function buildEscalationSystemPrompt() {
  return [
    "You are Loom, the Architect agent in the Loomflo framework.",
    "An Orchestrator (Loomi) has submitted an escalation to you. A node in the workflow has failed or is blocked.",
    "",
    "Your task is to decide how to modify the workflow graph to work around the issue.",
    "The workflow must NEVER deadlock \u2014 you must always choose an action that allows forward progress.",
    "",
    "Available actions:",
    "- add_node: Insert a new node to handle the work differently. Specify title, instructions, and where to insert.",
    "- modify_node: Change the instructions of the failed node so a retry has a better chance. Specify the nodeId and new instructions.",
    "- remove_node: Remove the failed node if its work is not critical. Specify the nodeId.",
    "- skip_node: Mark the node as done (skipped) and move on. Use when the node's work can be deferred or is optional. Specify the nodeId.",
    "- no_action: No graph change needed \u2014 the issue will resolve on its own or is informational only.",
    "",
    "Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):",
    "{",
    '  "action": "add_node|modify_node|remove_node|skip_node|no_action",',
    '  "nodeId": "target-node-id (for modify/remove/skip, omit for add/no_action)",',
    '  "newNode": {',
    '    "title": "Node Title (for add_node only)",',
    '    "instructions": "Markdown instructions (for add_node only)",',
    '    "insertAfter": "node-id (optional)",',
    '    "insertBefore": "node-id (optional)"',
    "  },",
    '  "modifiedInstructions": "New instructions (for modify_node only)",',
    '  "reason": "Brief explanation of why you chose this action"',
    "}"
  ].join("\n");
}
function buildEscalationUserMessage(request) {
  const parts = [
    "## Escalation Report",
    "",
    `**Node:** ${request.nodeId}`,
    `**Agent:** ${request.agentId}`,
    `**Reason:** ${request.reason}`
  ];
  if (request.suggestedAction !== void 0) {
    parts.push(`**Suggested Action:** ${request.suggestedAction}`);
  }
  if (request.details !== void 0 && request.details.length > 0) {
    parts.push("", "**Details:**", request.details);
  }
  return parts.join("\n");
}
function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== void 0) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
  throw new Error("Failed to extract JSON from LLM response");
}
function parseModification(text, nodeId) {
  try {
    const json = extractJson(text);
    const action = json["action"];
    const validActions = /* @__PURE__ */ new Set(["add_node", "modify_node", "remove_node", "skip_node", "no_action"]);
    if (action === void 0 || !validActions.has(action)) {
      return {
        action: "skip_node",
        nodeId,
        reason: `LLM returned invalid action "${String(action)}" \u2014 defaulting to skip_node for forward progress`
      };
    }
    const modification = {
      action,
      reason: typeof json["reason"] === "string" ? json["reason"] : "No reason provided"
    };
    if (typeof json["nodeId"] === "string") {
      modification.nodeId = json["nodeId"];
    }
    if (action === "add_node" && typeof json["newNode"] === "object" && json["newNode"] !== null) {
      const newNode = json["newNode"];
      modification.newNode = {
        title: typeof newNode["title"] === "string" ? newNode["title"] : "Recovery Node",
        instructions: typeof newNode["instructions"] === "string" ? newNode["instructions"] : ""
      };
      if (typeof newNode["insertAfter"] === "string") {
        modification.newNode.insertAfter = newNode["insertAfter"];
      }
      if (typeof newNode["insertBefore"] === "string") {
        modification.newNode.insertBefore = newNode["insertBefore"];
      }
    }
    if (action === "modify_node" && typeof json["modifiedInstructions"] === "string") {
      modification.modifiedInstructions = json["modifiedInstructions"];
    }
    return modification;
  } catch {
    return {
      action: "skip_node",
      nodeId,
      reason: "Failed to parse LLM escalation response \u2014 defaulting to skip_node for forward progress"
    };
  }
}
var EscalationManager = class {
  config;
  /**
   * Create an EscalationManager instance.
   *
   * @param config - Manager configuration with provider, graph modifier, and logging.
   */
  constructor(config) {
    this.config = config;
  }
  /**
   * Handle an escalation request from a Loomi orchestrator.
   *
   * Makes an LLM call to decide on a graph modification, applies it,
   * and logs the change. Falls back to skip_node on any error.
   *
   * @param request - The escalation request from Loomi.
   * @returns Resolves when the escalation has been fully handled.
   */
  async escalate(request) {
    await this.logEvent("escalation_triggered", {
      nodeId: request.nodeId,
      agentId: request.agentId,
      reason: request.reason,
      suggestedAction: request.suggestedAction ?? null,
      details: request.details ?? null
    });
    let modification;
    try {
      const systemPrompt = buildEscalationSystemPrompt();
      const userMessage = buildEscalationUserMessage(request);
      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: userMessage }],
        system: systemPrompt,
        model: this.config.model
      });
      this.config.costTracker.recordCall(
        this.config.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        ESCALATION_AGENT_ID,
        request.nodeId
      );
      const textBlocks = response.content.filter(
        (block) => block.type === "text"
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");
      modification = parseModification(responseText, request.nodeId);
    } catch {
      modification = {
        action: "skip_node",
        nodeId: request.nodeId,
        reason: "Escalation LLM call failed \u2014 defaulting to skip_node for forward progress"
      };
    }
    if (modification.action === "no_action") {
      await this.logEvent("graph_modified", {
        action: "no_action",
        nodeId: modification.nodeId ?? request.nodeId,
        reason: modification.reason
      });
    }
    try {
      if (modification.action !== "no_action") {
        await this.config.graphModifier.applyModification(modification);
      }
    } catch {
      await this.logEvent("graph_modified", {
        action: modification.action,
        nodeId: modification.nodeId ?? request.nodeId,
        reason: modification.reason,
        error: "Graph modification application failed"
      });
      return;
    }
    await this.logEvent("graph_modified", {
      action: modification.action,
      nodeId: modification.nodeId ?? request.nodeId,
      reason: modification.reason,
      ...modification.newNode !== void 0 && { newNodeTitle: modification.newNode.title }
    });
    const changeParts = [
      `## Escalation: ${modification.action}`,
      `**Node:** ${modification.nodeId ?? request.nodeId}`,
      `**Reason:** ${modification.reason}`,
      `**Escalated by:** ${request.agentId}`,
      `**Original escalation:** ${request.reason}`
    ];
    if (modification.newNode !== void 0) {
      changeParts.push(`**New Node Title:** ${modification.newNode.title}`);
      changeParts.push(`**New Node Instructions:** ${modification.newNode.instructions}`);
      if (modification.newNode.insertAfter !== void 0) {
        changeParts.push(`**Insert after:** ${modification.newNode.insertAfter}`);
      }
      if (modification.newNode.insertBefore !== void 0) {
        changeParts.push(`**Insert before:** ${modification.newNode.insertBefore}`);
      }
    }
    if (modification.modifiedInstructions !== void 0) {
      changeParts.push(`**Modified Instructions:** ${modification.modifiedInstructions}`);
    }
    changeParts.push(`**Timestamp:** ${(/* @__PURE__ */ new Date()).toISOString()}`, "");
    const changeEntry = changeParts.join("\n");
    try {
      await this.config.sharedMemory.write(
        "ARCHITECTURE_CHANGES.md",
        changeEntry,
        ESCALATION_AGENT_ID
      );
    } catch {
    }
  }
  /**
   * Log an event to the project's events.jsonl file.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload data.
   */
  async logEvent(type, details) {
    try {
      const event = createEvent({
        type,
        workflowId: this.config.eventLog.workflowId,
        agentId: ESCALATION_AGENT_ID,
        details
      });
      await appendEvent(this.config.workspacePath, event);
    } catch {
    }
  }
};

// src/spec/spec-engine.ts
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

// src/costs/tracker.ts
var DEFAULT_PRICING = {
  "claude-opus-4-6": { inputPricePerMToken: 15, outputPricePerMToken: 75 },
  "claude-sonnet-4-6": { inputPricePerMToken: 3, outputPricePerMToken: 15 }
};
var FALLBACK_PRICING = {
  inputPricePerMToken: 3,
  outputPricePerMToken: 15
};
var CostTracker = class {
  pricing;
  entries = [];
  perNode = /* @__PURE__ */ new Map();
  perAgent = /* @__PURE__ */ new Map();
  totalCost = 0;
  budgetLimit;
  onRecordCallback = null;
  /**
   * Creates a new CostTracker instance.
   *
   * @param budgetLimit - Maximum allowed cost in USD, or null/undefined for no limit.
   * @param customPricing - Optional custom pricing table to merge with defaults.
   */
  constructor(budgetLimit, customPricing) {
    this.budgetLimit = budgetLimit ?? null;
    this.pricing = { ...DEFAULT_PRICING, ...customPricing };
  }
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
  recordCall(model, inputTokens, outputTokens, agentId, nodeId) {
    const pricing = this.pricing[model] ?? FALLBACK_PRICING;
    const cost = (inputTokens * pricing.inputPricePerMToken + outputTokens * pricing.outputPricePerMToken) / 1e6;
    const entry = {
      model,
      inputTokens,
      outputTokens,
      cost,
      agentId,
      nodeId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.entries.push(entry);
    this.totalCost += cost;
    this.perNode.set(nodeId, (this.perNode.get(nodeId) ?? 0) + cost);
    this.perAgent.set(agentId, (this.perAgent.get(agentId) ?? 0) + cost);
    if (this.onRecordCallback) {
      const nodeCost = this.perNode.get(nodeId) ?? 0;
      const budgetRemaining = this.budgetLimit !== null ? Math.max(0, this.budgetLimit - this.totalCost) : null;
      this.onRecordCallback(entry, nodeCost, this.totalCost, budgetRemaining);
    }
    return entry;
  }
  /**
   * Checks whether the configured budget limit has been exceeded.
   *
   * @returns `true` if a budget limit is set and total cost exceeds it, `false` otherwise.
   */
  isBudgetExceeded() {
    if (this.budgetLimit === null) {
      return false;
    }
    return this.totalCost >= this.budgetLimit;
  }
  /**
   * Returns a full cost summary for the workflow.
   *
   * @returns Aggregated cost summary including per-node, per-agent, and budget info.
   */
  getSummary() {
    return {
      totalCost: this.totalCost,
      perNode: Object.fromEntries(this.perNode),
      perAgent: Object.fromEntries(this.perAgent),
      budgetLimit: this.budgetLimit,
      budgetRemaining: this.budgetLimit !== null ? Math.max(0, this.budgetLimit - this.totalCost) : null,
      entries: [...this.entries]
    };
  }
  /**
   * Returns the total accumulated cost in USD.
   *
   * @returns Total cost across all recorded calls.
   */
  getTotalCost() {
    return this.totalCost;
  }
  /**
   * Returns the accumulated cost for a specific node.
   *
   * @param nodeId - Node identifier to query.
   * @returns Cost in USD for the given node, or 0 if no calls recorded.
   */
  getNodeCost(nodeId) {
    return this.perNode.get(nodeId) ?? 0;
  }
  /**
   * Returns the accumulated cost for a specific agent.
   *
   * @param agentId - Agent identifier to query.
   * @returns Cost in USD for the given agent, or 0 if no calls recorded.
   */
  getAgentCost(agentId) {
    return this.perAgent.get(agentId) ?? 0;
  }
  /**
   * Updates the budget limit.
   *
   * @param limit - New budget limit in USD, or null to remove the limit.
   */
  setBudgetLimit(limit) {
    this.budgetLimit = limit;
  }
  /**
   * Registers a callback that fires after every {@link recordCall}.
   *
   * The daemon uses this to wire cost updates to the WebSocket broadcaster.
   * Pass `null` to remove a previously registered callback.
   *
   * @param callback - Function to invoke after each recorded call, or null to unregister.
   */
  setOnRecordCallback(callback) {
    this.onRecordCallback = callback;
  }
  /**
   * Returns recorded cost entries, optionally filtered by node ID.
   *
   * @param nodeId - If provided, only entries for this node are returned.
   * @returns Array of cost entries.
   */
  getEntries(nodeId) {
    if (nodeId !== void 0) {
      return this.entries.filter((e) => e.nodeId === nodeId);
    }
    return [...this.entries];
  }
};

// src/spec/prompts.ts
var LOOMPRINT_PROMPT = `<role>
You are Loomprint, a constitution architect agent within the Loomflo specification pipeline.
Your sole responsibility is to generate a foundational constitution document for a software project.

You are the first agent in a 6-phase pipeline. Your output sets the quality bar for all
subsequent phases. Every specification, plan, task, and line of code produced later must
comply with the principles you define here.

You do NOT write code, specs, or plans. You define the rules that govern how they are written.
</role>

<task>
Generate a complete constitution document for the project described in the user message.

The constitution must include these sections:

1. **Core Principles** \u2014 Non-negotiable quality rules organized by concern area. Each principle
   must be specific, enforceable, and testable. Use MUST/MUST NOT language (RFC 2119). Cover:
   - Type safety and code quality (linting, testing, documentation standards)
   - Architecture patterns (async behavior, component boundaries, state management)
   - Testability and decoupling (interface-driven design, dependency injection)
   - Provider/service abstraction (if the project uses external services)
   - Security defaults (input validation, secret management, sandboxing)

2. **Delivery Standards** \u2014 Build, CI/CD, and documentation requirements:
   - Clean-clone build must work with zero manual steps
   - CI pipeline requirements (linting, type checking, tests)
   - Documentation requirements (README, architecture diagrams, quick-start)

3. **Technology Constraints & Conventions** \u2014 Concrete technology choices:
   - Runtime, language version, compilation target
   - Package manager and workspace structure
   - Test framework, linting tools, formatting tools
   - State persistence approach
   - Key naming conventions and taxonomy

4. **Governance** \u2014 How the constitution itself is managed:
   - Authority hierarchy (constitution is highest-authority document)
   - Amendment process (proposal, review, migration plan)
   - Versioning scheme (semantic versioning for principles)
   - Compliance verification requirement

Tailor every section to the specific project described. Do not produce generic boilerplate.
Infer reasonable technology choices from the project description. If the description is vague
about technology, choose a well-established, production-ready stack appropriate for the domain.
</task>

<context>
You will receive the project description as the user message. This is a natural language
description of what the software should do. It may be brief or detailed.

You have no previous artifacts to reference \u2014 you are the first phase in the pipeline.
Your output will be consumed by all subsequent phases (Loomscope, Loomcraft, Loompath,
Loomscan, Loomkit) as a binding constraint document.
</context>

<reasoning>
Think step by step:
1. Parse the project description to identify the domain, scale, and key technical requirements.
2. Infer the appropriate technology stack if not explicitly stated. Prefer widely-adopted,
   well-documented technologies with strong TypeScript support.
3. For each principle, ask: "Can a reviewer objectively verify compliance?" If not, make it
   more specific.
4. Balance strictness with pragmatism \u2014 principles must be achievable for the project's scope.
5. Ensure principles do not contradict each other.
6. Consider security implications specific to the project domain (e.g., auth for web apps,
   sandboxing for agent systems, input validation for APIs).
7. Define the minimum viable governance that keeps the constitution a living document.
</reasoning>

<stop_conditions>
Stop when you have produced a complete constitution document with all four required sections.
Every principle must be specific to the project described. Do not include principles that
are irrelevant to the project's domain or stack.
</stop_conditions>

<output_format>
Output a complete Markdown document with this structure:

# [Project Name] Constitution

## Core Principles

### I. [Concern Area] (NON-NEGOTIABLE if applicable)
- Specific principle with MUST/MUST NOT language
- ...

### II. [Concern Area]
- ...

(Continue with as many principle groups as needed)

## Delivery Standards
- Bullet points with specific, verifiable requirements

## Technology Constraints & Conventions
- Specific technology choices with versions where applicable
- Naming conventions and taxonomy

## Governance
- Authority, amendment process, versioning, compliance

**Version**: 1.0.0 | **Ratified**: [today's date]

Do NOT include any text outside the Markdown document. Output ONLY the constitution content.
</output_format>`;
var LOOMSCOPE_PROMPT = `<role>
You are Loomscope, a functional specification agent within the Loomflo specification pipeline.
Your sole responsibility is to define WHAT the system does \u2014 its behavior, capabilities, and
boundaries \u2014 without prescribing HOW it is implemented.

You are the second agent in a 6-phase pipeline. You receive the project description and the
constitution (produced by Loomprint). Your output must comply with every principle in the
constitution.

You do NOT make technology decisions, define architecture, or write code. You define behavior.
</role>

<task>
Generate a complete functional specification document for the project.

The specification must include these sections:

1. **User Scenarios & Testing** \u2014 Prioritized user stories, each containing:
   - A narrative description of the user's goal and workflow
   - Priority (P1 = highest) with justification for the priority ranking
   - Independent test description (how to verify this story works in isolation)
   - Acceptance scenarios in Given/When/Then format (at least 3 per story)

   Order user stories by priority. Every piece of functionality must trace to at least
   one user story.

2. **Functional Requirements** \u2014 Organized by domain area, each requirement:
   - Has a unique ID (e.g., FR-001, FR-002)
   - Uses MUST/SHOULD/MAY language (RFC 2119)
   - Describes observable behavior, not implementation
   - Is testable and verifiable

   Group requirements by logical domain (e.g., "Authentication", "Data Processing",
   "API Endpoints", "Dashboard"). Include requirements for:
   - Core functionality
   - Error handling and edge cases
   - Security boundaries
   - Configuration and customization

3. **Key Entities** \u2014 Domain model described in business terms:
   - Each entity with its purpose, key attributes, and relationships
   - State machines for entities with lifecycle states
   - No database schemas or code types \u2014 describe the concepts

4. **Edge Cases** \u2014 What happens when things go wrong or inputs are unexpected:
   - At least 8 edge cases covering the most critical failure modes
   - Each with a clear description of the scenario and expected system behavior

5. **Assumptions** \u2014 Things assumed to be true that are not explicitly in the description:
   - Scope boundaries (what's included vs. excluded)
   - Environment assumptions (single-user, localhost, etc.)
   - Technology assumptions derived from the constitution

6. **Out of Scope (v1)** \u2014 Explicit list of what will NOT be built:
   - Features that might be expected but are deferred
   - Each with a brief reason for exclusion

7. **Success Criteria** \u2014 Measurable outcomes that define "done":
   - At least 5 specific, measurable criteria
   - Each tied to observable system behavior
   - Include performance, usability, and reliability criteria
</task>

<context>
You will receive a user message containing:
- **Project Description**: The natural language description of what to build
- **Constitution**: The binding quality principles, delivery standards, and technology constraints

Your specification MUST comply with every constitution principle. If a constitution principle
implies a functional requirement (e.g., "all writes must be serialized" implies a concurrency
requirement), include that as an explicit functional requirement.

Your output will be consumed by Loomcraft (technical planning), Loompath (task breakdown),
and Loomscan (coherence analysis). Ambiguity in your spec causes cascading problems downstream.
</context>

<reasoning>
Think step by step:
1. Read the project description to identify all explicit and implied capabilities.
2. Read the constitution to identify implied functional requirements from quality principles.
3. Identify the primary user personas and their goals.
4. Write user stories from highest to lowest priority \u2014 the system should be buildable
   incrementally by implementing stories in priority order.
5. For each functional area, enumerate every observable behavior. Ask: "What does the user
   see, trigger, or receive?" not "How does the code work?"
6. For each requirement, ask: "Can I write an acceptance test for this?" If not, make it
   more specific.
7. Actively look for gaps: what happens on error? What happens at boundaries? What happens
   with empty inputs, maximum loads, concurrent access?
8. Be explicit about what is OUT of scope \u2014 this prevents scope creep during implementation.
9. Ensure every functional requirement traces to at least one user story.
</reasoning>

<stop_conditions>
Stop when you have produced a complete specification document with all seven required sections.
Every requirement must be specific, testable, and traceable to a user story. Do not include
implementation details (stack choices, file paths, code patterns).
</stop_conditions>

<output_format>
Output a complete Markdown document with this structure:

# Feature Specification: [Project Name]

**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 \u2014 [Title] (Priority: P1)
[Narrative]
**Why this priority**: [justification]
**Independent Test**: [how to verify]
**Acceptance Scenarios**:
1. **Given** ..., **When** ..., **Then** ...
2. ...

### User Story 2 \u2014 [Title] (Priority: P2)
...

## Requirements *(mandatory)*

### Functional Requirements

**[Domain Area]**
- **FR-001**: System MUST ...
- **FR-002**: ...

### Key Entities
- **[Entity]**: [description, attributes, relationships, state machine if applicable]

## Edge Cases
- What happens when ...? [expected behavior]

## Assumptions
- ...

## Out of Scope (v1)
- [Feature]: [reason for exclusion]

## Success Criteria *(mandatory)*

### Measurable Outcomes
- **SC-001**: [specific, measurable criterion]
- ...

Do NOT include any text outside the Markdown document. Output ONLY the specification content.
</output_format>`;
var LOOMCRAFT_PROMPT = `<role>
You are Loomcraft, a technical planning agent within the Loomflo specification pipeline.
Your sole responsibility is to design HOW the system will be built \u2014 the architecture,
technology choices, project structure, data model, and build sequence.

You are the third agent in a 6-phase pipeline. You receive the project description,
constitution (binding constraints), and functional specification (behavioral requirements).
Your plan must satisfy every functional requirement while complying with every constitutional
principle.

You do NOT write code or define tasks. You design the blueprint.
</role>

<task>
Generate a complete technical implementation plan for the project.

The plan must include these sections:

1. **Summary** \u2014 One-paragraph overview of what will be built and the key architectural approach.

2. **Technical Context** \u2014 Concrete technology decisions:
   - Language/version, primary dependencies with versions
   - Storage approach, test framework, target platform
   - Project type (monolith, monorepo, microservices, etc.)
   - Performance goals and constraints
   - Estimated scale (lines of code, number of source files, packages)

3. **Constitution Check** \u2014 Gate check table:
   - For each constitutional principle, state PASS/FAIL with specific evidence
   - This section must pass before any design work proceeds
   - If any principle fails, redesign until all pass

4. **Project Structure** \u2014 Complete file tree:
   - Every directory and file with a one-line purpose annotation
   - Organize by domain/feature, not by file type
   - Include configuration files, CI pipelines, Docker files
   - Include per-project runtime directories if applicable

5. **Build Phases** \u2014 Ordered phases for incremental construction:
   - Each phase produces a working, testable increment
   - Include estimated line count per phase
   - List concrete deliverables per phase (files, features, tests)
   - Earlier phases must not depend on later phases
   - Each phase should end with a clean, passing build

6. **Key Implementation Decisions** \u2014 For each major subsystem:
   - The approach chosen and why
   - Alternatives considered and why they were rejected
   - Interfaces and contracts between components
   - State management approach
   - Error handling strategy
   - Data flow diagrams (described textually)

Tailor every decision to the specific project. Reference the functional requirements by ID
(e.g., "FR-001 requires...") to maintain traceability.
</task>

<context>
You will receive a user message containing:
- **Project Description**: The natural language description
- **Constitution**: Binding quality principles and technology constraints
- **Specification**: Functional requirements, user stories, entities, and success criteria

Your plan must:
- Satisfy every functional requirement (FR-*) in the specification
- Comply with every constitutional principle
- Use the technology stack mandated by the constitution (or choose one if not specified)
- Structure the project as the constitution requires

Your output will be consumed by Loompath (task breakdown) and Loomscan (coherence analysis).
The task agent needs a clear, unambiguous file structure and build sequence to generate
actionable tasks.
</context>

<reasoning>
Think step by step:
1. Read the constitution to establish hard constraints (language, runtime, testing, patterns).
2. Read the specification to catalog every functional requirement that needs a technical home.
3. Design the project structure to group related functionality and minimize coupling.
4. For each major subsystem, decide on the implementation approach. Prefer standard patterns
   over novel ones. Prefer composition over inheritance. Prefer explicit over implicit.
5. Run the constitution check \u2014 verify every principle is satisfied by your design. If not,
   redesign until all pass.
6. Sequence build phases so each produces a working increment. Phase 1 should be the
   foundation (project setup, core types, basic infrastructure). Later phases add features.
7. For each implementation decision, consider: testability, extensibility, simplicity, and
   compliance with the constitution.
8. Ensure the file structure is complete \u2014 every file mentioned in implementation decisions
   must appear in the structure, and every file in the structure must have a purpose.
</reasoning>

<stop_conditions>
Stop when you have produced a complete plan document with all six required sections.
The constitution check must show ALL PASS. Every functional requirement must have a
clear home in the project structure. The build phases must cover all functionality.
</stop_conditions>

<output_format>
Output a complete Markdown document with this structure:

# Implementation Plan: [Project Name]

**Branch**: ... | **Date**: ... | **Spec**: [reference]

## Summary
[One paragraph]

## Technical Context
**Language/Version**: ...
**Primary Dependencies**: ...
(remaining fields)

## Constitution Check
| Principle | Status | Evidence |
|-----------|--------|----------|
| ... | PASS | ... |

**Gate result: ALL PASS \u2014 proceed.**

## Project Structure
\`\`\`text
[complete file tree with annotations]
\`\`\`

## Build Phases

### Phase 1 \u2014 [Name] (~N lines)
- [deliverable]
- ...

### Phase 2 \u2014 [Name] (~N lines)
- ...

## Key Implementation Decisions

### [Subsystem Name]
- [approach, rationale, interfaces, error handling]

Do NOT include any text outside the Markdown document. Output ONLY the plan content.
</output_format>`;
var LOOMPATH_PROMPT = `<role>
You are Loompath, a task decomposition agent within the Loomflo specification pipeline.
Your sole responsibility is to break the implementation plan into an ordered sequence of
concrete, actionable tasks that an AI worker agent can execute independently.

You are the fourth agent in a 6-phase pipeline. You receive the project description,
constitution, specification, and technical plan. Your task list must implement every
feature in the plan, satisfy every functional requirement, and comply with the constitution.

You do NOT write code or make architecture decisions. You decompose the plan into executable steps.
</role>

<task>
Generate a complete, ordered task breakdown document.

Each task must include:

1. **Task ID** \u2014 Sequential identifier: T001, T002, T003, etc.
2. **User Story** \u2014 Which user story this task implements: [US1], [US2], etc.
3. **Title** \u2014 Brief, descriptive name (5-10 words).
4. **Description** \u2014 What the task produces. Specific enough that an AI agent can execute
   it without further clarification. Include:
   - What files to create or modify (exact paths from the plan's project structure)
   - What functionality to implement
   - What interfaces or contracts to follow
   - What tests to write
5. **Dependencies** \u2014 Task IDs that must complete before this task can start.
   The first task(s) must have no dependencies.
6. **Parallelism Flag** \u2014 Mark with [P] if this task can run in parallel with other tasks
   that share no file write conflicts and no dependency chain.
7. **Files** \u2014 Exact file paths this task will create or modify.
8. **Estimated Effort** \u2014 Small / Medium / Large based on complexity.

Rules for task design:
- Each task should take an AI worker agent roughly 1-3 tool calls to complete.
- Tasks must not have circular dependencies.
- Every file in the plan's project structure must be created by exactly one task.
- Tasks that write to the same file MUST NOT be marked as parallel.
- Prefer many small tasks over few large ones \u2014 granularity enables parallelism.
- Infrastructure tasks (project setup, config files, CI) come first.
- Test tasks can be co-located with implementation tasks or separate \u2014 prefer co-located
  when the test file is small, separate when tests are substantial.
- Group tasks to match the plan's build phases where possible.
</task>

<context>
You will receive a user message containing:
- **Project Description**: The natural language description
- **Constitution**: Binding quality principles (testing requirements, documentation, etc.)
- **Specification**: Functional requirements with IDs (FR-001, etc.) and user stories
- **Plan**: Technical plan with project structure, build phases, and implementation decisions

Your task list must:
- Cover every file in the plan's project structure
- Implement every functional requirement from the spec
- Follow the build phase sequence from the plan
- Comply with constitutional requirements (tests, documentation, linting)
- Include setup tasks (dependencies, configuration, CI) as early tasks

Your output will be consumed by Loomscan (coherence analysis) and Loomkit (graph building).
Loomkit will group your tasks into execution nodes, so clear dependency and parallelism
information is critical.
</context>

<reasoning>
Think step by step:
1. Read the plan's build phases to establish the high-level task order.
2. Read the project structure to catalog every file that needs to be created.
3. For each build phase, decompose into individual tasks. Each task creates or modifies
   a small, coherent set of files.
4. Map each task to its user story association and functional requirements.
5. Determine dependencies: a task depends on another if it needs files, types, or
   interfaces produced by that task.
6. Identify parallelism opportunities: tasks with no shared files and no dependency
   chain can be marked [P].
7. Verify completeness: every file in the structure has a task, every FR is covered,
   every build phase is represented.
8. Verify ordering: no circular dependencies, infrastructure before features, types
   before implementations, implementations before tests (unless co-located).
</reasoning>

<stop_conditions>
Stop when you have produced a task list that:
- Covers every file in the plan's project structure
- Maps to every functional requirement in the specification
- Has valid dependency ordering with no cycles
- Has parallelism flags where applicable
- Is ordered such that tasks can be executed top-to-bottom respecting dependencies
</stop_conditions>

<output_format>
Output a complete Markdown document with this structure:

# Task Breakdown: [Project Name]

**Total Tasks**: N | **Parallelizable**: M

## Phase 1 \u2014 [Phase Name]

### T001 [US1] \u2014 [Title]
**Description**: [Detailed description of what to implement]
**Dependencies**: None
**Files**: \`path/to/file1.ts\`, \`path/to/file2.ts\`
**Effort**: Small

### T002 [US1] \u2014 [Title] [P]
**Description**: [...]
**Dependencies**: T001
**Files**: \`path/to/file3.ts\`
**Effort**: Medium

## Phase 2 \u2014 [Phase Name]

### T003 [US2] \u2014 [Title]
...

(Continue through all phases)

## Dependency Graph Summary
[Brief textual description of the critical path and parallelism opportunities]

Do NOT include any text outside the Markdown document. Output ONLY the task breakdown content.
</output_format>`;
var LOOMSCAN_PROMPT = `<role>
You are Loomscan, a coherence analysis agent within the Loomflo specification pipeline.
Your sole responsibility is to audit the consistency, completeness, and correctness of
all specification artifacts produced by previous phases.

You are the fifth agent in a 6-phase pipeline. You receive the constitution, specification,
plan, and task breakdown. Your job is to find problems BEFORE execution begins \u2014 gaps,
contradictions, ambiguities, and violations that would cause implementation failures.

You do NOT fix problems or generate new content. You identify and report issues.
</role>

<task>
Produce a comprehensive coherence analysis report covering these dimensions:

1. **Coverage Matrix** \u2014 Traceability table:
   - Map every functional requirement (FR-*) to the task(s) that implement it
   - Map every user story to the task(s) associated with it
   - Identify any requirements or stories with NO implementing task (GAPS)
   - Identify any tasks that don't map to any requirement (ORPHANS)

2. **Constitution Compliance** \u2014 Check every artifact against the constitution:
   - Does the spec comply with all constitutional principles?
   - Does the plan use the mandated technology stack?
   - Does the plan satisfy all delivery standards?
   - Do tasks include testing as required by the constitution?
   - Flag any violations with specific principle references

3. **Cross-Artifact Consistency** \u2014 Check for contradictions:
   - Does the plan's project structure match what the tasks reference?
   - Do task file paths match the plan's file tree?
   - Do task dependencies form a valid DAG (no cycles)?
   - Are build phase boundaries in the tasks consistent with the plan?
   - Do entity definitions in the spec match the data model in the plan?

4. **Ambiguity Detection** \u2014 Identify vague or underspecified items:
   - Requirements that could be interpreted multiple ways
   - Tasks whose descriptions are too vague for an AI agent to execute
   - Missing error handling specifications
   - Undefined behavior at system boundaries

5. **Duplication Detection** \u2014 Identify redundancies:
   - Tasks that appear to do the same thing
   - Requirements that overlap or conflict
   - Files that appear in multiple tasks (write scope conflict)

6. **Risk Assessment** \u2014 Identify high-risk areas:
   - Tasks with many dependents (single points of failure)
   - Tasks with vague descriptions that are likely to fail
   - Areas where the spec and plan diverge
   - Critical path bottlenecks in the dependency graph

Rate each finding by severity: CRITICAL (blocks execution), HIGH (likely causes failure),
MEDIUM (may cause rework), LOW (cosmetic or minor).
</task>

<context>
You will receive a user message containing:
- **Constitution**: The binding quality principles and constraints
- **Specification**: Functional requirements, user stories, entities, edge cases
- **Plan**: Technical plan with project structure, build phases, implementation decisions
- **Tasks**: Ordered task breakdown with IDs, dependencies, file paths, parallelism flags

Your analysis must be thorough and systematic. Check every requirement against every task.
Check every file path against the project structure. Check every dependency for validity.

Your output will be reviewed by the user before execution proceeds. Critical findings
may cause the user to request regeneration of affected artifacts.
</context>

<reasoning>
Think step by step:
1. Build the coverage matrix first \u2014 this is the most mechanical check and reveals gaps quickly.
2. Walk through each constitutional principle and verify compliance in all artifacts.
3. Extract all file paths from the tasks and cross-reference against the plan's file tree.
4. Verify the task dependency graph is a valid DAG by checking for cycles.
5. Read each task description and assess whether it is specific enough for an AI agent
   to execute without ambiguity.
6. Look for inconsistencies in naming: are entities, files, and concepts named consistently
   across all artifacts?
7. Check edge cases: does the spec define behavior for every edge case, and do tasks exist
   to implement that behavior?
8. Identify the critical path in the dependency graph \u2014 the longest chain determines
   minimum execution time.
9. Rate findings by their potential to block or derail execution.
</reasoning>

<stop_conditions>
Stop when you have:
- Completed the full coverage matrix (every FR and user story checked)
- Checked every constitutional principle for compliance
- Verified cross-artifact consistency (file paths, dependencies, entities)
- Identified all ambiguities, duplications, and risks
- Rated every finding by severity
- Produced a summary with counts by severity level
</stop_conditions>

<output_format>
Output a complete Markdown document with this structure:

# Coherence Analysis Report

**Artifacts Analyzed**: constitution.md, spec.md, plan.md, tasks.md
**Date**: [today]

## Executive Summary
- Total findings: N (X critical, Y high, Z medium, W low)
- Coverage: N/M functional requirements mapped to tasks
- Constitution compliance: PASS/FAIL with count of violations
- Dependency graph: Valid DAG / Contains cycles

## Coverage Matrix

| Requirement | User Story | Task(s) | Status |
|-------------|------------|---------|--------|
| FR-001 | US1 | T001, T002 | COVERED |
| FR-002 | US1 | \u2014 | GAP |
| ... | ... | ... | ... |

## Constitution Compliance
### [Principle Name]
- **Status**: COMPLIANT / VIOLATION
- **Evidence**: [specific reference to artifact and line]
- **Severity**: [if violation]

## Cross-Artifact Consistency
### File Path Verification
- [findings]

### Dependency Graph Validation
- [findings]

### Entity Consistency
- [findings]

## Ambiguities
1. **[SEVERITY]**: [description with artifact references]
2. ...

## Duplications
1. **[SEVERITY]**: [description]
2. ...

## Risk Assessment
1. **[SEVERITY]**: [description, impact, mitigation suggestion]
2. ...

Do NOT include any text outside the Markdown document. Output ONLY the analysis report content.
</output_format>`;
var LOOMKIT_PROMPT = `<role>
You are Loomkit, a graph construction agent within the Loomflo specification pipeline.
Your sole responsibility is to build the execution workflow graph that determines how
tasks are grouped into nodes and in what order nodes execute.

You are the sixth and final agent in the pipeline. You receive the task breakdown and
technical plan. Your output is a structured JSON graph that the Loomflo engine will
execute \u2014 each node becomes a work unit with an Orchestrator agent managing Worker agents.

You do NOT write prose, Markdown, or explanatory text. You output ONLY a JSON object.
</role>

<task>
Build an execution graph by grouping tasks into nodes and defining their dependencies.

Node design rules:
1. **Group related tasks** \u2014 Tasks that modify tightly coupled files or implement the same
   feature should be in the same node. A node should represent a coherent unit of work.
2. **Respect dependencies** \u2014 If task A depends on task B, and they are in different nodes,
   node(A) must depend on node(B).
3. **Respect parallelism** \u2014 Tasks marked [P] with no shared dependencies can be in
   different nodes that execute in parallel.
4. **Limit node size** \u2014 Each node should contain 2-8 tasks. Fewer than 2 means the node
   is too granular (merge with another). More than 8 means the node is too large (split it).
   Exception: the first node (project setup) may have more if all tasks are simple configuration.
5. **No cycles** \u2014 The graph must be a valid DAG. Every node must be reachable from at
   least one root node (a node with no dependencies).
6. **Match build phases** \u2014 Nodes should roughly correspond to the plan's build phases,
   but a single build phase may produce multiple nodes if it contains parallelizable work.
7. **First node has no dependencies** \u2014 At least one node must have an empty dependencies array.

For each node, provide:
- **id**: A unique identifier (e.g., "node-1", "node-2"). Use lowercase with hyphens.
- **title**: A human-readable name describing the node's purpose (e.g., "Project Foundation",
  "Authentication System", "Dashboard UI").
- **instructions**: Detailed Markdown instructions for the Orchestrator agent. These must
  contain enough context for the Orchestrator to plan worker assignments without reading
  the full spec. Include: what tasks belong to this node, what files to create/modify,
  what patterns to follow, what to test, and how it connects to other nodes.
- **dependencies**: Array of node IDs that must complete before this node can start.
  Empty array for root nodes.
</task>

<context>
You will receive a user message containing:
- **Tasks**: The ordered task breakdown with IDs, descriptions, dependencies, file paths,
  and parallelism flags
- **Plan**: The technical plan with project structure, build phases, and implementation decisions

Use the task dependencies and parallelism flags to determine which tasks can be co-located
in the same node and which nodes can execute in parallel.

Use the plan's build phases as a guide for node ordering, but optimize for parallelism
where the dependency graph allows it.
</context>

<reasoning>
Think step by step:
1. Parse all tasks and their dependencies to build a task-level dependency graph.
2. Identify clusters of tightly coupled tasks (shared file paths, sequential dependencies,
   same feature area).
3. Group each cluster into a node. Verify the node size is 2-8 tasks.
4. Determine node-level dependencies: if any task in node A depends on any task in node B,
   then node A depends on node B.
5. Verify the resulting graph is a valid DAG \u2014 no cycles.
6. Optimize for parallelism: if two nodes have no dependency relationship, they can run
   in parallel. Prefer wider graphs (more parallelism) over deeper graphs (more sequential).
7. Write detailed instructions for each node that reference the specific tasks, files,
   and patterns from the plan.
8. Verify completeness: every task from the task breakdown must appear in exactly one node's
   instructions.
</reasoning>

<stop_conditions>
Stop when you have produced a valid JSON graph where:
- Every task is assigned to exactly one node
- All node dependencies are valid (reference existing node IDs)
- The graph is a DAG with no cycles
- At least one root node has no dependencies
- Each node has 2-8 tasks (with the setup exception)
- Node instructions are detailed enough for an Orchestrator to work independently
</stop_conditions>

<output_format>
Output ONLY a JSON object with no surrounding text, no markdown code fences, and no explanation.

The JSON structure must be:

{
  "nodes": [
    {
      "id": "node-1",
      "title": "Human-Readable Node Title",
      "instructions": "Detailed Markdown instructions for the orchestrator.\\n\\nInclude:\\n- Tasks: T001, T002, T003\\n- Files to create: ...\\n- Patterns to follow: ...\\n- Testing requirements: ...\\n- Dependencies on other nodes: ...",
      "dependencies": []
    },
    {
      "id": "node-2",
      "title": "Another Node",
      "instructions": "...",
      "dependencies": ["node-1"]
    }
  ]
}

IMPORTANT: Output ONLY the JSON object. No prose before or after. No markdown code fences.
No explanatory text. Just the raw JSON.
</output_format>`;
var SPEC_PROMPTS = {
  constitution: LOOMPRINT_PROMPT,
  spec: LOOMSCOPE_PROMPT,
  plan: LOOMCRAFT_PROMPT,
  tasks: LOOMPATH_PROMPT,
  analysis: LOOMSCAN_PROMPT,
  graph: LOOMKIT_PROMPT
};

// src/spec/spec-engine.ts
var SpecPipelineError = class extends Error {
  /** Name of the pipeline step that failed. */
  stepName;
  /** Zero-based index of the pipeline step that failed. */
  stepIndex;
  /**
   * @param stepName - Name of the failed pipeline step.
   * @param stepIndex - Zero-based index of the failed step.
   * @param cause - The underlying error that caused the failure.
   */
  constructor(stepName, stepIndex, cause) {
    super(
      `Spec pipeline failed at step ${String(stepIndex)} (${stepName}): ${cause.message}`,
      { cause }
    );
    this.name = "SpecPipelineError";
    this.stepName = stepName;
    this.stepIndex = stepIndex;
  }
};
var GraphValidationError = class extends Error {
  /** Machine-readable validation failure code. */
  code;
  /** Node IDs involved in the validation failure, if applicable. */
  involvedNodes;
  /**
   * @param code - Machine-readable validation failure code.
   * @param message - Human-readable description of the failure.
   * @param involvedNodes - Node IDs involved in the failure.
   */
  constructor(code, message, involvedNodes = []) {
    super(message);
    this.name = "GraphValidationError";
    this.code = code;
    this.involvedNodes = involvedNodes;
  }
};
var DEFAULT_COST_ESTIMATION_CONFIG = {
  estimatedInputTokensPerTask: 4e3,
  estimatedOutputTokensPerTask: 2e3,
  modelPricing: DEFAULT_PRICING,
  model: "claude-sonnet-4-6"
};
var CLARIFICATION_MARKER_START = "[CLARIFICATION_NEEDED]";
var CLARIFICATION_MARKER_END = "[/CLARIFICATION_NEEDED]";
var MAX_CLARIFICATION_QUESTIONS = 3;
function extractResponseText(response) {
  const parts = [];
  for (const block of response.content) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }
  const text = parts.join("\n");
  if (text.length === 0) {
    throw new Error("LLM response contained no text content");
  }
  return text;
}
function extractJson2(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch?.[1] != null) {
    return JSON.parse(codeBlockMatch[1]);
  }
  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch?.[0] != null) {
    return JSON.parse(jsonObjectMatch[0]);
  }
  return JSON.parse(text);
}
function validateGraphDefinition(value) {
  if (typeof value !== "object" || value === null) {
    throw new Error("Graph definition must be an object");
  }
  const obj = value;
  if (!Array.isArray(obj["nodes"])) {
    throw new Error('Graph definition must have a "nodes" array');
  }
  for (const node of obj["nodes"]) {
    if (typeof node !== "object" || node === null) {
      throw new Error("Each graph node must be an object");
    }
    const n = node;
    if (typeof n["id"] !== "string" || n["id"].length === 0) {
      throw new Error('Each graph node must have a non-empty string "id"');
    }
    if (typeof n["title"] !== "string" || n["title"].length === 0) {
      throw new Error(`Graph node "${n["id"]}" must have a non-empty string "title"`);
    }
    if (typeof n["instructions"] !== "string") {
      throw new Error(`Graph node "${n["id"]}" must have a string "instructions"`);
    }
    if (!Array.isArray(n["dependencies"])) {
      throw new Error(`Graph node "${n["id"]}" must have a "dependencies" array`);
    }
    for (const dep of n["dependencies"]) {
      if (typeof dep !== "string") {
        throw new Error(`Graph node "${n["id"]}" dependencies must be strings`);
      }
    }
  }
  return value;
}
function detectTopology(nodeIds, edges) {
  if (edges.length === 0) {
    return "linear";
  }
  const outDegree = /* @__PURE__ */ new Map();
  const inDegree = /* @__PURE__ */ new Map();
  for (const id of nodeIds) {
    outDegree.set(id, 0);
    inDegree.set(id, 0);
  }
  for (const edge of edges) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  let divergentCount = 0;
  let convergentCount = 0;
  for (const count of outDegree.values()) {
    if (count > 1) divergentCount++;
  }
  for (const count of inDegree.values()) {
    if (count > 1) convergentCount++;
  }
  if (divergentCount === 0 && convergentCount === 0) return "linear";
  if (divergentCount > 0 && convergentCount === 0) {
    return divergentCount === 1 ? "divergent" : "tree";
  }
  if (divergentCount === 0 && convergentCount > 0) return "convergent";
  return "mixed";
}
function countTasksInInstructions(instructions) {
  const numberedItems = instructions.match(/^\s*\d+\.\s/gm);
  if (numberedItems != null && numberedItems.length > 0) {
    return numberedItems.length;
  }
  const bulletItems = instructions.match(/^\s*[-*]\s/gm);
  if (bulletItems != null && bulletItems.length > 0) {
    return bulletItems.length;
  }
  const headings = instructions.match(/^#+\s/gm);
  if (headings != null && headings.length > 0) {
    return headings.length;
  }
  return 1;
}
function validateDag(nodes, edges) {
  const nodeIds = Object.keys(nodes);
  const inDegree = /* @__PURE__ */ new Map();
  const adjacency = /* @__PURE__ */ new Map();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }
  const queue = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }
  let visited = 0;
  let current = queue.shift();
  while (current != null) {
    visited++;
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
    current = queue.shift();
  }
  if (visited !== nodeIds.length) {
    const cycleNodes = [...inDegree.entries()].filter(([, degree]) => degree > 0).map(([id]) => id);
    throw new GraphValidationError(
      "cycle_detected",
      `Graph contains a cycle involving nodes: ${cycleNodes.join(", ")}`,
      cycleNodes
    );
  }
}
function validateGraphIntegrity(graph) {
  const nodeIds = new Set(Object.keys(graph.nodes));
  if (nodeIds.size === 0) {
    throw new GraphValidationError(
      "empty_graph",
      "Graph must contain at least one node"
    );
  }
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new GraphValidationError(
        "invalid_edge_reference",
        `Edge references non-existent source node "${edge.from}"`,
        [edge.from]
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new GraphValidationError(
        "invalid_edge_reference",
        `Edge references non-existent target node "${edge.to}"`,
        [edge.to]
      );
    }
  }
  const nodesWithIncoming = new Set(graph.edges.map((e) => e.to));
  const rootNodes = [...nodeIds].filter((id) => !nodesWithIncoming.has(id));
  if (rootNodes.length === 0) {
    throw new GraphValidationError(
      "no_root_node",
      "Graph must have at least one root node (no incoming edges)"
    );
  }
  if (nodeIds.size > 1) {
    const nodesWithOutgoing = new Set(graph.edges.map((e) => e.from));
    const connectedNodes = /* @__PURE__ */ new Set([...nodesWithIncoming, ...nodesWithOutgoing]);
    const orphanNodes = [...nodeIds].filter((id) => !connectedNodes.has(id));
    if (orphanNodes.length > 0) {
      throw new GraphValidationError(
        "orphan_nodes",
        `Graph contains orphan nodes with no edges: ${orphanNodes.join(", ")}`,
        orphanNodes
      );
    }
  }
}
function estimateNodeCost(node, config) {
  const taskCount = countTasksInInstructions(node.instructions);
  const totalInputTokens = taskCount * config.estimatedInputTokensPerTask;
  const totalOutputTokens = taskCount * config.estimatedOutputTokensPerTask;
  const pricing = config.modelPricing[config.model] ?? {
    inputPricePerMToken: 3,
    outputPricePerMToken: 15
  };
  return totalInputTokens * pricing.inputPricePerMToken / 1e6 + totalOutputTokens * pricing.outputPricePerMToken / 1e6;
}
function validateAndOptimizeGraph(graph, costConfig = DEFAULT_COST_ESTIMATION_CONFIG) {
  validateGraphIntegrity(graph);
  validateDag(graph.nodes, graph.edges);
  const topology = detectTopology(Object.keys(graph.nodes), graph.edges);
  let estimatedTotalCost = 0;
  for (const node of Object.values(graph.nodes)) {
    node.cost = estimateNodeCost(node, costConfig);
    estimatedTotalCost += node.cost;
  }
  return {
    graph: { ...graph, topology },
    estimatedTotalCost
  };
}
function createNodeFromDefinition(def) {
  return {
    id: def.id,
    title: def.title,
    status: "pending",
    instructions: def.instructions,
    delay: "0",
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 3,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null
  };
}
var SpecEngine = class {
  config;
  specsDir;
  broadcaster;
  /**
   * Create a new SpecEngine instance.
   *
   * @param config - Engine configuration including provider, model, and project path.
   */
  constructor(config) {
    this.config = config;
    this.specsDir = join(config.projectPath, ".loomflo", "specs");
    this.broadcaster = config.broadcaster;
  }
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
  async runPipeline(description, onProgress) {
    await mkdir(this.specsDir, { recursive: true });
    const artifacts = [];
    const constitution = await this.executeStep(
      0,
      "constitution",
      async () => {
        const output = await this.generateConstitution(description);
        return this.handleClarification(
          "constitution",
          description,
          output,
          (augmented) => this.generateConstitution(augmented),
          onProgress
        );
      },
      onProgress
    );
    const constitutionArtifact = await this.writeArtifact("constitution.md", constitution);
    artifacts.push(constitutionArtifact);
    this.broadcaster?.emitSpecArtifactReady("constitution.md", ".loomflo/specs/constitution.md");
    this.notifyStepCompleted(0, "constitution", constitutionArtifact.path, onProgress);
    const spec = await this.executeStep(
      1,
      "spec",
      async () => {
        const output = await this.generateSpec(description, constitution);
        return this.handleClarification(
          "spec",
          description,
          output,
          (augmented) => this.generateSpec(augmented, constitution),
          onProgress
        );
      },
      onProgress
    );
    const specArtifact = await this.writeArtifact("spec.md", spec);
    artifacts.push(specArtifact);
    this.broadcaster?.emitSpecArtifactReady("spec.md", ".loomflo/specs/spec.md");
    this.notifyStepCompleted(1, "spec", specArtifact.path, onProgress);
    const plan = await this.executeStep(
      2,
      "plan",
      () => this.generatePlan(description, constitution, spec),
      onProgress
    );
    const planArtifact = await this.writeArtifact("plan.md", plan);
    artifacts.push(planArtifact);
    this.broadcaster?.emitSpecArtifactReady("plan.md", ".loomflo/specs/plan.md");
    this.notifyStepCompleted(2, "plan", planArtifact.path, onProgress);
    const tasks = await this.executeStep(
      3,
      "tasks",
      () => this.generateTasks(description, constitution, spec, plan),
      onProgress
    );
    const tasksArtifact = await this.writeArtifact("tasks.md", tasks);
    artifacts.push(tasksArtifact);
    this.broadcaster?.emitSpecArtifactReady("tasks.md", ".loomflo/specs/tasks.md");
    this.notifyStepCompleted(3, "tasks", tasksArtifact.path, onProgress);
    const analysis = await this.executeStep(
      4,
      "analysis",
      () => this.generateAnalysis(constitution, spec, plan, tasks),
      onProgress
    );
    const analysisArtifact = await this.writeArtifact("analysis-report.md", analysis);
    artifacts.push(analysisArtifact);
    this.broadcaster?.emitSpecArtifactReady("analysis-report.md", ".loomflo/specs/analysis-report.md");
    this.notifyStepCompleted(4, "analysis", analysisArtifact.path, onProgress);
    const graph = await this.executeStep(
      5,
      "graph",
      () => this.buildGraph(tasks, plan),
      onProgress
    );
    this.notifyStepCompleted(5, "graph", this.specsDir, onProgress);
    onProgress?.({
      type: "spec_pipeline_completed",
      artifacts,
      graph
    });
    return { artifacts, graph };
  }
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
  async executeStep(stepIndex, stepName, fn, onProgress) {
    onProgress?.({ type: "spec_step_started", stepName, stepIndex });
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onProgress?.({ type: "spec_step_error", stepName, stepIndex, error });
      throw new SpecPipelineError(stepName, stepIndex, error);
    }
  }
  /**
   * Notify progress callback of a completed step.
   *
   * @param stepIndex - Zero-based index of the completed step.
   * @param stepName - Name of the completed step.
   * @param artifactPath - Path to the artifact produced by the step.
   * @param onProgress - Optional progress callback.
   */
  notifyStepCompleted(stepIndex, stepName, artifactPath, onProgress) {
    onProgress?.({
      type: "spec_step_completed",
      stepName,
      stepIndex,
      artifactPath
    });
  }
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
  async callLLM(systemPrompt, userMessage) {
    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: userMessage }],
      system: systemPrompt,
      model: this.config.model,
      maxTokens: this.config.maxTokens
    });
    return extractResponseText(response);
  }
  /**
   * Write a spec artifact to the `.loomflo/specs/` directory.
   *
   * @param name - File name for the artifact (e.g., "constitution.md").
   * @param content - Full content to write.
   * @returns The artifact metadata including the resolved file path.
   */
  async writeArtifact(name, content) {
    const artifactPath = join(this.specsDir, name);
    await writeFile(artifactPath, content, "utf-8");
    return { name, path: artifactPath, content };
  }
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
  detectAmbiguityMarkers(text) {
    const startIdx = text.indexOf(CLARIFICATION_MARKER_START);
    const endIdx = text.indexOf(CLARIFICATION_MARKER_END);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      return [];
    }
    const block = text.substring(startIdx + CLARIFICATION_MARKER_START.length, endIdx).trim();
    if (block.length === 0) {
      return [];
    }
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const questions = [];
    let currentQuestion = null;
    let currentContext = "";
    for (const line of lines) {
      const qMatch = /^Q\d+:\s*(.+)$/.exec(line);
      const cMatch = /^Context:\s*(.+)$/.exec(line);
      if (qMatch?.[1] != null) {
        if (currentQuestion !== null) {
          questions.push({ question: currentQuestion, context: currentContext });
        }
        currentQuestion = qMatch[1];
        currentContext = "";
      } else if (cMatch?.[1] != null) {
        currentContext = cMatch[1];
      }
    }
    if (currentQuestion !== null) {
      questions.push({ question: currentQuestion, context: currentContext });
    }
    return questions;
  }
  /**
   * Remove the `[CLARIFICATION_NEEDED]...[/CLARIFICATION_NEEDED]` block from text.
   *
   * Returns the remaining text (the LLM's best-guess output) with the marker
   * block stripped out and surrounding whitespace normalized.
   *
   * @param text - The raw LLM output containing clarification markers.
   * @returns The text with the clarification block removed.
   */
  stripClarificationMarkers(text) {
    const startIdx = text.indexOf(CLARIFICATION_MARKER_START);
    const endIdx = text.indexOf(CLARIFICATION_MARKER_END);
    if (startIdx === -1 || endIdx === -1) {
      return text;
    }
    const before = text.substring(0, startIdx);
    const after = text.substring(endIdx + CLARIFICATION_MARKER_END.length);
    return (before + after).trim();
  }
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
  async handleClarification(stepName, description, llmOutput, rerunFn, onProgress) {
    const questions = this.detectAmbiguityMarkers(llmOutput);
    if (questions.length === 0) {
      return llmOutput;
    }
    const limitedQuestions = questions.slice(0, MAX_CLARIFICATION_QUESTIONS);
    if (this.config.clarificationCallback == null) {
      console.warn(
        `[SpecEngine] Clarification needed in "${stepName}" step but no callback configured. Using LLM defaults.`
      );
      return this.stripClarificationMarkers(llmOutput);
    }
    onProgress?.({
      type: "clarification_requested",
      questions: limitedQuestions,
      stepName
    });
    let answers;
    try {
      answers = await this.config.clarificationCallback(limitedQuestions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[SpecEngine] Clarification callback failed in "${stepName}" step: ${message}. Using LLM defaults.`
      );
      return this.stripClarificationMarkers(llmOutput);
    }
    onProgress?.({
      type: "clarification_answered",
      answers,
      stepName
    });
    const clarificationLines = limitedQuestions.map((q, i) => `Q: ${q.question}
A: ${answers[i] ?? "No answer provided"}`).join("\n\n");
    const augmentedDescription = [
      description,
      "",
      "## Clarifications",
      clarificationLines
    ].join("\n");
    return rerunFn(augmentedDescription);
  }
  /**
   * Step 1: Generate a project constitution document.
   *
   * Produces non-negotiable quality principles, delivery standards,
   * technology constraints, and governance rules for the target project.
   *
   * @param description - Natural language project description.
   * @returns The generated constitution content as Markdown.
   */
  async generateConstitution(description) {
    return this.callLLM(
      SPEC_PROMPTS.constitution,
      `Generate a constitution for the following project:

${description}`
    );
  }
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
  async generateSpec(description, constitution) {
    const userMessage = [
      "Generate a functional specification for the following project.",
      "",
      "## Project Description",
      description,
      "",
      "## Constitution",
      constitution
    ].join("\n");
    return this.callLLM(SPEC_PROMPTS.spec, userMessage);
  }
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
  async generatePlan(description, constitution, spec) {
    const userMessage = [
      "Generate a technical implementation plan for the following project.",
      "",
      "## Project Description",
      description,
      "",
      "## Constitution",
      constitution,
      "",
      "## Specification",
      spec
    ].join("\n");
    return this.callLLM(SPEC_PROMPTS.plan, userMessage);
  }
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
  async generateTasks(description, constitution, spec, plan) {
    const userMessage = [
      "Generate an ordered task breakdown for the following project.",
      "",
      "## Project Description",
      description,
      "",
      "## Constitution",
      constitution,
      "",
      "## Specification",
      spec,
      "",
      "## Plan",
      plan
    ].join("\n");
    return this.callLLM(SPEC_PROMPTS.tasks, userMessage);
  }
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
  async generateAnalysis(constitution, spec, plan, tasks) {
    const userMessage = [
      "Analyze the coherence of the following specification artifacts.",
      "",
      "## Constitution",
      constitution,
      "",
      "## Specification",
      spec,
      "",
      "## Plan",
      plan,
      "",
      "## Tasks",
      tasks
    ].join("\n");
    return this.callLLM(SPEC_PROMPTS.analysis, userMessage);
  }
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
  async buildGraph(tasks, plan) {
    const userMessage = [
      "Build an execution workflow graph from the following tasks and plan.",
      "",
      "## Tasks",
      tasks,
      "",
      "## Plan",
      plan
    ].join("\n");
    const responseText = await this.callLLM(SPEC_PROMPTS.graph, userMessage);
    const parsed = extractJson2(responseText);
    const graphDef = validateGraphDefinition(parsed);
    const seenIds = /* @__PURE__ */ new Set();
    for (const def of graphDef.nodes) {
      if (seenIds.has(def.id)) {
        throw new GraphValidationError(
          "duplicate_node_id",
          `Duplicate node ID "${def.id}" in LLM graph output`,
          [def.id]
        );
      }
      seenIds.add(def.id);
    }
    const nodes = {};
    for (const def of graphDef.nodes) {
      nodes[def.id] = createNodeFromDefinition(def);
      this.broadcaster?.emitGraphModified("node_added", def.id, {
        title: def.title,
        instructionsSummary: def.instructions.slice(0, 120)
      });
    }
    const edges = [];
    for (const def of graphDef.nodes) {
      for (const depId of def.dependencies) {
        if (!seenIds.has(depId)) {
          throw new GraphValidationError(
            "invalid_edge_reference",
            `Graph node "${def.id}" depends on unknown node "${depId}"`,
            [def.id, depId]
          );
        }
        edges.push({ from: depId, to: def.id });
        this.broadcaster?.emitGraphModified("edge_added", def.id, {
          from: depId,
          to: def.id
        });
      }
    }
    const topology = detectTopology(Array.from(seenIds), edges);
    const rawGraph = { nodes, edges, topology };
    const costConfig = {
      ...DEFAULT_COST_ESTIMATION_CONFIG,
      model: this.config.model
    };
    const { graph } = validateAndOptimizeGraph(rawGraph, costConfig);
    return graph;
  }
};

// src/agents/loom.ts
var DEFAULT_LOOM_MODEL = "claude-opus-4-6";
var LOOM_AGENT_ID = "loom";
var MONITORED_MEMORY_FILES = ["ERRORS.md", "ISSUES.md", "PROGRESS.md"];
var CLASSIFICATION_MAX_TOKENS = 150;
var CONTEXT_MEMORY_FILES = ["DECISIONS.md", "PROGRESS.md", "ARCHITECTURE_CHANGES.md"];
function buildEscalationHandlingPrompt() {
  return [
    "You are Loom, the Architect agent in the Loomflo AI agent orchestration framework.",
    "An Orchestrator agent (Loomi) has escalated an issue to you because a node is blocked or has exhausted all retries.",
    "",
    "Your job is to decide how to modify the workflow graph to resolve the issue and ensure forward progress.",
    "The workflow must NEVER deadlock.",
    "",
    "Available actions:",
    "- add_node: Insert a new node to handle the work differently.",
    "- modify_node: Change the failed node's instructions for a fresh approach.",
    "- remove_node: Remove the node if its work is not critical.",
    "- skip_node: Mark as done and move on (for optional or deferrable work).",
    "- no_action: No graph change needed.",
    "",
    "Respond with ONLY a JSON object:",
    '{"action": "...", "nodeId": "...", "newNode": {"title": "...", "instructions": "...", "insertAfter": "...", "insertBefore": "..."}, "modifiedInstructions": "...", "reason": "..."}',
    "Include only the fields relevant to your chosen action."
  ].join("\n");
}
function buildMonitoringPrompt() {
  return [
    "You are Loom, the Architect agent monitoring the Loomflo workflow for critical issues.",
    "",
    "Review the shared memory content below. Look for:",
    "- Repeated failures or errors that suggest a systemic problem",
    "- Contradictions between agents or decisions",
    "- Blockers that agents have reported but not escalated",
    "- Architecture issues that need proactive intervention",
    "",
    "If you detect a critical issue requiring graph modification, respond with a JSON object:",
    '{"issuesDetected": true, "action": "add_node|modify_node|remove_node|skip_node", "nodeId": "...", "reason": "...", "summary": "..."}',
    "",
    "If no critical issues are found, respond with:",
    '{"issuesDetected": false, "summary": "Brief summary of current state"}'
  ].join("\n");
}
function buildClassificationPrompt() {
  return [
    "Classify the following user message into exactly one category:",
    "- question: Asking about the project, its state, architecture, or progress.",
    '- instruction: Giving a directive or preference (e.g., "use bcrypt", "prefer PostgreSQL").',
    '- graph_change: Requesting structural workflow changes (e.g., "add a node", "remove the docs step").',
    "",
    "Respond with ONLY a JSON object:",
    '{"category": "question|instruction|graph_change", "confidence": 0.0-1.0, "reasoning": "brief explanation"}'
  ].join("\n");
}
function buildQuestionHandlingPrompt() {
  return [
    "You are Loom, the Architect agent in the Loomflo framework.",
    "A developer is asking you a question about their project.",
    "",
    "Answer using the project context provided (shared memory, graph state, specifications).",
    "Be informative, specific, and concise.",
    "Reference concrete details from the context when available."
  ].join("\n");
}
function buildInstructionHandlingPrompt() {
  return [
    "You are Loom, the Architect agent in the Loomflo framework.",
    "A developer has given you an instruction or directive about their project.",
    "",
    "Your job is to:",
    "1. Acknowledge the instruction clearly.",
    "2. Explain how it will be applied (which nodes or agents it affects).",
    "3. Confirm that the instruction has been recorded in project decisions.",
    "",
    "Be concise and action-oriented."
  ].join("\n");
}
function buildGraphChangeHandlingPrompt() {
  return [
    "You are Loom, the Architect agent in the Loomflo framework.",
    "A developer has requested a structural change to the workflow graph.",
    "",
    "Analyze the request and respond with:",
    "1. A brief confirmation of the change.",
    "2. A JSON block describing the modification:",
    "```json",
    '{"graphChange": {"action": "add_node|modify_node|remove_node|skip_node", "nodeId": "...", "newNode": {"title": "...", "instructions": "...", "insertAfter": "...", "insertBefore": "..."}, "modifiedInstructions": "...", "reason": "..."}}',
    "```",
    "Include only the fields relevant to the action."
  ].join("\n");
}
function extractJson3(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== void 0) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
    }
  }
  return null;
}
function parseGraphModification(json, fallbackNodeId) {
  const action = json["action"];
  const validActions = /* @__PURE__ */ new Set(["add_node", "modify_node", "remove_node", "skip_node", "no_action"]);
  const modification = {
    action: action !== void 0 && validActions.has(action) ? action : "skip_node",
    reason: typeof json["reason"] === "string" ? json["reason"] : "No reason provided"
  };
  if (typeof json["nodeId"] === "string") {
    modification.nodeId = json["nodeId"];
  } else if (modification.action !== "add_node" && modification.action !== "no_action") {
    modification.nodeId = fallbackNodeId;
  }
  if (modification.action === "add_node" && typeof json["newNode"] === "object" && json["newNode"] !== null) {
    const newNode = json["newNode"];
    modification.newNode = {
      title: typeof newNode["title"] === "string" ? newNode["title"] : "Recovery Node",
      instructions: typeof newNode["instructions"] === "string" ? newNode["instructions"] : ""
    };
    if (typeof newNode["insertAfter"] === "string") {
      modification.newNode.insertAfter = newNode["insertAfter"];
    }
    if (typeof newNode["insertBefore"] === "string") {
      modification.newNode.insertBefore = newNode["insertBefore"];
    }
  }
  if (modification.action === "modify_node" && typeof json["modifiedInstructions"] === "string") {
    modification.modifiedInstructions = json["modifiedInstructions"];
  }
  return modification;
}
var LoomAgent = class {
  config;
  model;
  status = "created";
  /**
   * Creates a new Loom agent instance.
   *
   * @param config - Loom agent configuration.
   */
  constructor(config) {
    this.config = config;
    this.model = config.model ?? DEFAULT_LOOM_MODEL;
  }
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
  async runSpecGeneration(description) {
    this.status = "running_spec";
    await this.logEvent("spec_phase_started", {
      phase: "pipeline",
      description: description.slice(0, 200)
    });
    await this.writeProgress(
      `## Spec Generation Started
Generating specification for project.
Phase: pipeline
`
    );
    const engine = new SpecEngine({
      provider: this.config.provider,
      model: this.model,
      projectPath: this.config.projectPath,
      maxTokens: this.config.maxTokensPerCall,
      clarificationCallback: this.config.clarificationCallback
    });
    const onProgress = (event) => {
      this.handleSpecProgress(event);
    };
    try {
      const result = await engine.runPipeline(description, onProgress);
      await this.logEvent("spec_phase_completed", {
        phase: "pipeline",
        artifactCount: result.artifacts.length,
        nodeCount: Object.keys(result.graph.nodes).length,
        topology: result.graph.topology
      });
      const nodeCount = Object.keys(result.graph.nodes).length;
      const edgeCount = result.graph.edges.length;
      await this.writeProgress(
        `## Spec Generation Completed
Artifacts: ${String(result.artifacts.length)}
Graph: ${String(nodeCount)} nodes, ${String(edgeCount)} edges (${result.graph.topology})
`
      );
      this.status = "idle";
      return result;
    } catch (error) {
      this.status = "idle";
      const message = error instanceof Error ? error.message : String(error);
      await this.logEvent("spec_phase_completed", {
        phase: "pipeline",
        error: message
      });
      await this.writeProgress(
        `## Spec Generation Failed
Error: ${message}
`
      );
      throw error;
    }
  }
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
  async handleEscalation(request) {
    this.status = "handling_escalation";
    try {
      await this.logEventGeneric("escalation_triggered", {
        nodeId: request.nodeId,
        agentId: request.agentId,
        reason: request.reason,
        suggestedAction: request.suggestedAction ?? null
      });
      const userMessage = [
        "## Escalation Report",
        `**Node:** ${request.nodeId}`,
        `**Agent:** ${request.agentId}`,
        `**Reason:** ${request.reason}`,
        request.suggestedAction !== void 0 ? `**Suggested:** ${request.suggestedAction}` : "",
        request.details !== void 0 ? `
**Details:**
${request.details}` : "",
        this.config.graphSummary !== void 0 ? `
## Current Graph
${this.config.graphSummary}` : ""
      ].filter((l) => l.length > 0).join("\n");
      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: userMessage }],
        system: buildEscalationHandlingPrompt(),
        model: this.model
      });
      this.config.costTracker.recordCall(
        this.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        LOOM_AGENT_ID,
        request.nodeId
      );
      const textBlocks = response.content.filter(
        (block) => block.type === "text"
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");
      const json = extractJson3(responseText);
      const modification = json !== null ? parseGraphModification(json, request.nodeId) : {
        action: "skip_node",
        nodeId: request.nodeId,
        reason: "Failed to parse architect response \u2014 skipping node for forward progress"
      };
      if (this.config.graphModifier !== void 0 && modification.action !== "no_action") {
        try {
          await this.config.graphModifier.applyModification(modification);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.writeProgress(`## Escalation \u2014 Graph modification failed
${msg}
`);
        }
      }
      await this.logEventGeneric("graph_modified", {
        action: modification.action,
        nodeId: modification.nodeId ?? request.nodeId,
        reason: modification.reason
      });
      const changeEntry = [
        `## Escalation Resolution: ${modification.action}`,
        `**Node:** ${modification.nodeId ?? request.nodeId}`,
        `**Reason:** ${modification.reason}`,
        `**Original Issue:** ${request.reason}`,
        `**Timestamp:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
        ""
      ].join("\n");
      await this.writeMemory("ARCHITECTURE_CHANGES.md", changeEntry);
      this.status = "idle";
      return { success: true, modification };
    } catch (err) {
      this.status = "idle";
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, modification: null, error: message };
    }
  }
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
  async monitorSharedMemory() {
    try {
      const memoryContents = [];
      for (const fileName of MONITORED_MEMORY_FILES) {
        try {
          const file = await this.config.sharedMemory.read(fileName);
          if (file.content.length > 0) {
            memoryContents.push(`## ${fileName}
${file.content}`);
          }
        } catch {
        }
      }
      if (memoryContents.length === 0) {
        return { issuesDetected: false, modification: null, summary: "No shared memory content to monitor" };
      }
      const userMessage = memoryContents.join("\n\n");
      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: userMessage }],
        system: buildMonitoringPrompt(),
        model: this.model
      });
      this.config.costTracker.recordCall(
        this.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        LOOM_AGENT_ID,
        null
      );
      const textBlocks = response.content.filter(
        (block) => block.type === "text"
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");
      const json = extractJson3(responseText);
      if (json === null) {
        return { issuesDetected: false, modification: null, summary: "Could not parse monitoring response" };
      }
      const issuesDetected = json["issuesDetected"] === true;
      const summary = typeof json["summary"] === "string" ? json["summary"] : "No summary";
      if (!issuesDetected) {
        return { issuesDetected: false, modification: null, summary };
      }
      const modification = parseGraphModification(json, "");
      if (this.config.graphModifier !== void 0 && modification.action !== "no_action") {
        try {
          await this.config.graphModifier.applyModification(modification);
          await this.logEventGeneric("graph_modified", {
            action: modification.action,
            nodeId: modification.nodeId ?? "proactive",
            reason: modification.reason,
            source: "monitoring"
          });
        } catch {
        }
      }
      return { issuesDetected: true, modification, summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { issuesDetected: false, modification: null, summary: `Monitoring error: ${message}` };
    }
  }
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
  async handleChat(message, chatHistory) {
    this.status = "handling_chat";
    try {
      const classification = await this.classifyMessage(message);
      let result;
      switch (classification.category) {
        case "question":
          result = await this.handleQuestion(message, chatHistory);
          break;
        case "instruction":
          result = await this.handleInstruction(message, chatHistory);
          break;
        case "graph_change":
          result = await this.handleGraphChange(message, chatHistory);
          break;
      }
      await this.logEventGeneric("message_sent", {
        direction: "outbound",
        category: classification.category,
        confidence: classification.confidence,
        content: result.response.slice(0, 500)
      });
      this.status = "idle";
      return result;
    } catch (err) {
      this.status = "idle";
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        response: `I encountered an error processing your message: ${errorMsg}`,
        category: "question",
        modification: null,
        error: errorMsg
      };
    }
  }
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
  async classifyMessage(message) {
    try {
      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: message }],
        system: buildClassificationPrompt(),
        model: this.model,
        maxTokens: CLASSIFICATION_MAX_TOKENS
      });
      this.config.costTracker.recordCall(
        this.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        LOOM_AGENT_ID,
        null
      );
      const textBlocks = response.content.filter(
        (block) => block.type === "text"
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");
      const json = extractJson3(responseText);
      if (json !== null) {
        const category = json["category"];
        const validCategories = /* @__PURE__ */ new Set(["question", "instruction", "graph_change"]);
        if (validCategories.has(category)) {
          return {
            category,
            confidence: typeof json["confidence"] === "number" ? json["confidence"] : 0.5,
            reasoning: typeof json["reasoning"] === "string" ? json["reasoning"] : ""
          };
        }
      }
      return { category: "question", confidence: 0, reasoning: "Classification parsing failed \u2014 defaulting to question" };
    } catch {
      return { category: "question", confidence: 0, reasoning: "Classification call failed \u2014 defaulting to question" };
    }
  }
  /**
   * Returns the current lifecycle status of the Loom agent.
   *
   * @returns The agent's current status.
   */
  getStatus() {
    return this.status;
  }
  /**
   * Update the graph summary used for context in escalation and chat handling.
   *
   * @param summary - New graph summary string.
   */
  updateGraphSummary(summary) {
    this.config.graphSummary = summary;
  }
  // ==========================================================================
  // Chat Routing Handlers (Private)
  // ==========================================================================
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
  async handleQuestion(message, chatHistory) {
    const contextParts = [message];
    if (chatHistory !== void 0 && chatHistory.length > 0) {
      contextParts.unshift(`## Previous Chat
${chatHistory}

## New Message`);
    }
    if (this.config.graphSummary !== void 0) {
      contextParts.push(`

## Current Workflow Graph
${this.config.graphSummary}`);
    }
    const memoryContext = await this.readSharedMemoryContext();
    if (memoryContext.length > 0) {
      contextParts.push(`

## Project Context (Shared Memory)
${memoryContext}`);
    }
    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: contextParts.join("\n") }],
      system: buildQuestionHandlingPrompt(),
      model: this.model
    });
    this.config.costTracker.recordCall(
      this.model,
      response.usage.inputTokens,
      response.usage.outputTokens,
      LOOM_AGENT_ID,
      null
    );
    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    );
    return {
      response: textBlocks.map((b) => b.text).join("\n").trim(),
      category: "question",
      modification: null
    };
  }
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
  async handleInstruction(message, chatHistory) {
    const contextParts = [message];
    if (chatHistory !== void 0 && chatHistory.length > 0) {
      contextParts.unshift(`## Previous Chat
${chatHistory}

## New Message`);
    }
    if (this.config.graphSummary !== void 0) {
      contextParts.push(`

## Current Workflow Graph
${this.config.graphSummary}`);
    }
    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: contextParts.join("\n") }],
      system: buildInstructionHandlingPrompt(),
      model: this.model
    });
    this.config.costTracker.recordCall(
      this.model,
      response.usage.inputTokens,
      response.usage.outputTokens,
      LOOM_AGENT_ID,
      null
    );
    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    );
    const responseText = textBlocks.map((b) => b.text).join("\n").trim();
    const decisionEntry = [
      `## Developer Instruction`,
      `**Instruction:** ${message}`,
      `**Timestamp:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
      ""
    ].join("\n");
    await this.writeMemory("DECISIONS.md", decisionEntry);
    return {
      response: responseText,
      category: "instruction",
      modification: null
    };
  }
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
  async handleGraphChange(message, chatHistory) {
    const contextParts = [message];
    if (chatHistory !== void 0 && chatHistory.length > 0) {
      contextParts.unshift(`## Previous Chat
${chatHistory}

## New Message`);
    }
    if (this.config.graphSummary !== void 0) {
      contextParts.push(`

## Current Workflow Graph
${this.config.graphSummary}`);
    }
    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: contextParts.join("\n") }],
      system: buildGraphChangeHandlingPrompt(),
      model: this.model
    });
    this.config.costTracker.recordCall(
      this.model,
      response.usage.inputTokens,
      response.usage.outputTokens,
      LOOM_AGENT_ID,
      null
    );
    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    );
    const responseText = textBlocks.map((b) => b.text).join("\n");
    let modification = null;
    const graphChangeMatch = /```json\s*\n?\s*\{[\s\S]*?"graphChange"[\s\S]*?\}\s*\n?\s*```/i.exec(responseText);
    if (graphChangeMatch !== null) {
      const changeJson = extractJson3(graphChangeMatch[0]);
      if (changeJson !== null && typeof changeJson["graphChange"] === "object" && changeJson["graphChange"] !== null) {
        modification = parseGraphModification(
          changeJson["graphChange"],
          ""
        );
        if (this.config.graphModifier !== void 0 && modification.action !== "no_action") {
          try {
            await this.config.graphModifier.applyModification(modification);
            await this.logEventGeneric("graph_modified", {
              action: modification.action,
              nodeId: modification.nodeId ?? "chat-requested",
              reason: modification.reason,
              source: "chat"
            });
          } catch {
          }
        }
      }
    }
    const cleanResponse = responseText.replace(/```json[\s\S]*?```/g, "").trim();
    return {
      response: cleanResponse,
      category: "graph_change",
      modification
    };
  }
  // ==========================================================================
  // Private Helpers
  // ==========================================================================
  /**
   * Read shared memory files to build project context for answering questions.
   *
   * Reads DECISIONS.md, PROGRESS.md, and ARCHITECTURE_CHANGES.md. Missing
   * or empty files are silently skipped.
   *
   * @returns Concatenated markdown context from shared memory, or empty string.
   */
  async readSharedMemoryContext() {
    const parts = [];
    for (const fileName of CONTEXT_MEMORY_FILES) {
      try {
        const file = await this.config.sharedMemory.read(fileName);
        if (file.content.length > 0) {
          parts.push(`### ${fileName}
${file.content}`);
        }
      } catch {
      }
    }
    return parts.join("\n\n");
  }
  /**
   * Handle a spec pipeline progress event.
   *
   * Logs events, tracks costs (via estimates), and writes progress updates
   * to shared memory. This method is synchronous (fire-and-forget async
   * operations) to conform to the {@link SpecStepCallback} signature.
   *
   * @param event - The spec pipeline progress event.
   */
  handleSpecProgress(event) {
    switch (event.type) {
      case "spec_step_started":
        void this.logEvent("spec_phase_started", {
          phase: event.stepName,
          stepIndex: event.stepIndex
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} \u2014 started
`
        );
        break;
      case "spec_step_completed":
        void this.logEvent("spec_phase_completed", {
          phase: event.stepName,
          stepIndex: event.stepIndex,
          artifactPath: event.artifactPath
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} \u2014 completed
`
        );
        break;
      case "spec_step_error":
        void this.logEvent("spec_phase_completed", {
          phase: event.stepName,
          stepIndex: event.stepIndex,
          error: event.error.message
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} \u2014 failed: ${event.error.message}
`
        );
        break;
      case "clarification_requested":
        void this.writeProgress(
          `### Clarification requested in ${event.stepName} (${String(event.questions.length)} questions)
`
        );
        break;
      case "clarification_answered":
        void this.writeProgress(
          `### Clarification answered in ${event.stepName}
`
        );
        break;
      case "spec_pipeline_completed":
        break;
    }
  }
  /**
   * Log a spec-phase event to the project's events.jsonl file.
   *
   * @param type - Event type identifier (spec_phase_started or spec_phase_completed).
   * @param details - Event-specific payload data.
   */
  async logEvent(type, details) {
    const event = createEvent({
      type,
      workflowId: this.config.eventLog.workflowId,
      agentId: LOOM_AGENT_ID,
      details
    });
    await appendEvent(this.config.projectPath, event);
  }
  /**
   * Log a generic event to the project's events.jsonl file.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload data.
   */
  async logEventGeneric(type, details) {
    try {
      const event = createEvent({
        type,
        workflowId: this.config.eventLog.workflowId,
        agentId: LOOM_AGENT_ID,
        details
      });
      await appendEvent(this.config.projectPath, event);
    } catch {
    }
  }
  /**
   * Write a progress update to the PROGRESS.md shared memory file.
   *
   * @param content - Markdown content to append.
   */
  async writeProgress(content) {
    await this.config.sharedMemory.write("PROGRESS.md", content, LOOM_AGENT_ID);
  }
  /**
   * Write content to a named shared memory file.
   *
   * @param fileName - Shared memory file name.
   * @param content - Markdown content to append.
   */
  async writeMemory(fileName, content) {
    try {
      await this.config.sharedMemory.write(fileName, content, LOOM_AGENT_ID);
    } catch {
    }
  }
};

// src/tools/report-complete.ts
import { z as z3 } from "zod";
var ReportCompleteInputSchema = z3.object({
  /** Summary of what was accomplished. */
  summary: z3.string().describe("Summary of what was accomplished during the task"),
  /** Files created during the task (paths relative to workspace root). */
  filesCreated: z3.array(z3.string()).optional().default([]).describe("List of file paths created during the task"),
  /** Files modified during the task (paths relative to workspace root). */
  filesModified: z3.array(z3.string()).optional().default([]).describe("List of file paths modified during the task"),
  /** Whether the task completed fully or only partially. */
  status: z3.enum(["success", "partial"]).optional().default("success").describe('Completion status: "success" for full completion, "partial" for incomplete work')
});
function createReportCompleteTool(handler) {
  return {
    name: "report_complete",
    description: "Signal the orchestrator (Loomi) that this worker agent has finished its task. Provide a summary of what was done, lists of files created and modified, and a status indicating success or partial completion. This tool should be called exactly once when the assigned task is complete.",
    inputSchema: ReportCompleteInputSchema,
    async execute(input, context) {
      try {
        const parsed = ReportCompleteInputSchema.parse(input);
        const report = {
          summary: parsed.summary,
          filesCreated: parsed.filesCreated,
          filesModified: parsed.filesModified,
          status: parsed.status
        };
        try {
          await handler.reportComplete(context.agentId, context.nodeId, report);
        } catch {
          return `Error: failed to report completion for agent "${context.agentId}" in node "${context.nodeId}" \u2014 the handler rejected the report`;
        }
        const filesSummary = [];
        if (report.filesCreated.length > 0) {
          filesSummary.push(`created: ${report.filesCreated.join(", ")}`);
        }
        if (report.filesModified.length > 0) {
          filesSummary.push(`modified: ${report.filesModified.join(", ")}`);
        }
        return `Completion reported \u2014 agent: ${context.agentId}, node: ${context.nodeId}, status: ${report.status}` + (filesSummary.length > 0 ? `, ${filesSummary.join("; ")}` : "");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    }
  };
}

// src/tools/send-message.ts
import { randomUUID } from "crypto";
import { z as z4 } from "zod";
var SendMessageInputSchema = z4.object({
  /** Target agent ID within the same node. */
  to: z4.string().describe("Target agent ID within the same node"),
  /** Message text to send. */
  content: z4.string().describe("Message text to send to the target agent")
});
function createSendMessageTool(messageBus) {
  return {
    name: "send_message",
    description: "Send a message to another agent within the same node. Provide the target agent ID and the message content. Messages are only routable within the same node \u2014 use shared memory for cross-node communication. Returns a confirmation with message details.",
    inputSchema: SendMessageInputSchema,
    async execute(input, context) {
      try {
        const { to, content } = SendMessageInputSchema.parse(input);
        const messageId = randomUUID();
        try {
          await messageBus.send(context.agentId, to, context.nodeId, content);
        } catch {
          return `Error: failed to send message to agent "${to}" \u2014 the message bus rejected the delivery`;
        }
        return `Message sent \u2014 id: ${messageId}, from: ${context.agentId}, to: ${to}, node: ${context.nodeId}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    }
  };
}

// src/agents/prompts.ts
var TOOL_LISTS = {
  loom: "read_file, search_files, list_files, read_memory",
  loomi: "read_file, search_files, list_files, read_memory, write_memory, send_message, escalate",
  looma: "read_file, write_file, edit_file, search_files, list_files, exec_command, read_memory, write_memory, send_message, report_complete, invoke_skill",
  loomex: "read_file, search_files, list_files, read_memory"
};
function renderPrompt(section) {
  const parts = [];
  const entries = [
    ["role", section.role],
    ["task", section.task],
    ["context", section.context],
    ["reasoning", section.reasoning],
    ["stop_conditions", section.stopConditions],
    ["output_format", section.output]
  ];
  for (const [tag, content] of entries) {
    if (content.length > 0) {
      parts.push(`<${tag}>
${content}
</${tag}>`);
    }
  }
  return parts.join("\n\n");
}
function contextBlock(label, value) {
  if (value === void 0 || value.length === 0) return "";
  return `## ${label}
${value}`;
}
function buildLoomPrompt(params) {
  const contextParts = [
    contextBlock("Project Description", params.projectDescription),
    contextBlock("Graph State", params.graphSummary),
    contextBlock("Shared Memory", params.sharedMemory),
    contextBlock("Spec Artifacts", params.specContext),
    contextBlock("Chat History", params.chatHistory),
    contextBlock("Escalation", params.escalation)
  ].filter((part) => part.length > 0);
  const section = {
    role: [
      "You are Loom, the Architect agent.",
      "You are the top-level agent for this project. There is exactly one Loom per project.",
      "",
      "Your responsibilities:",
      "- Generate and refine specification artifacts (constitution, spec, plan, tasks, analysis, workflow graph)",
      "- Manage the workflow graph: insert, remove, or modify nodes and edges",
      "- Interface with the user via conversational chat",
      "- Monitor shared memory for critical issues and react proactively",
      "- Handle escalations from Orchestrator agents (Loomi)",
      "- Route user messages to the appropriate action: answer questions, relay instructions, or modify the graph",
      "",
      "You do NOT write project code. You plan, coordinate, and communicate.",
      "",
      `Available tools: ${TOOL_LISTS.loom}`
    ].join("\n"),
    task: [
      "Analyze the current project state and act according to the situation:",
      "- If generating specs: produce complete, coherent specification artifacts based on the project description.",
      "- If responding to user chat: answer questions accurately, relay instructions to the relevant Orchestrator, or modify the graph as requested.",
      "- If handling an escalation: assess the blocked/failed node, decide whether to modify the graph (add, remove, or change nodes), relay updated instructions, or skip the problematic task with a logged explanation.",
      "- If monitoring shared memory: detect critical issues (repeated failures, contradictions, blockers) and intervene without waiting for formal escalation.",
      "",
      "Always prioritize project coherence and forward progress. The workflow must never deadlock."
    ].join("\n"),
    context: contextParts.join("\n\n"),
    reasoning: [
      "Think step by step:",
      "1. Assess the current situation: what phase is the project in, what is the immediate need?",
      "2. Determine the appropriate action category: spec generation, chat response, escalation handling, or proactive intervention.",
      "3. Consider the impact of your action on the overall workflow graph and downstream nodes.",
      "4. If modifying the graph, validate that the result is a valid DAG with no cycles or orphan nodes.",
      "5. If relaying instructions, ensure they are specific and actionable for the receiving Orchestrator.",
      "6. When asking the user clarification questions, limit to a maximum of 3 questions. Use reasonable defaults for remaining ambiguity."
    ].join("\n"),
    stopConditions: [
      "Stop when one of the following is true:",
      "- Spec generation is complete and all artifacts have been produced.",
      "- A user query has been fully answered.",
      "- An escalation has been resolved (graph modified, instructions relayed, or task skipped with explanation).",
      "- A proactive intervention has been applied and logged to shared memory."
    ].join("\n"),
    output: [
      "Respond with clear, structured text.",
      "",
      "For spec generation: produce the artifact content directly.",
      "For chat responses: provide a concise, informative answer.",
      "For graph modifications: describe the change made (nodes added/removed/modified, edges updated) and the rationale.",
      "For escalation resolution: explain the decision and any graph changes.",
      "",
      "Always be specific about what changed and why."
    ].join("\n")
  };
  return renderPrompt(section);
}
function buildLoomiPrompt(params) {
  const fileScopeLines = Object.entries(params.fileScopes).map(([workerId, patterns]) => `- ${workerId}: ${patterns.join(", ")}`).join("\n");
  const contextParts = [
    contextBlock("Node Instructions", params.nodeInstructions),
    `## Worker File Scopes
${fileScopeLines}`,
    contextBlock("Shared Memory", params.sharedMemory),
    contextBlock("Spec Artifacts", params.specContext),
    contextBlock("Retry Context", params.retryContext),
    contextBlock("Reviewer Feedback", params.reviewFeedback)
  ].filter((part) => part.length > 0);
  const section = {
    role: [
      `You are Loomi, the Orchestrator agent for node "${params.nodeTitle}".`,
      "You manage one node in the execution phase. There is exactly one Loomi per node.",
      "",
      "Your responsibilities:",
      `- Plan and coordinate a team of ${String(params.workerCount)} Worker agent(s) (Looma)`,
      "- Assign each worker a specific task with an exclusive file write scope",
      "- Supervise worker execution and monitor progress via messages",
      "- Handle retries when the Reviewer reports FAIL: adapt prompts with feedback and relaunch only failed workers",
      "- Escalate to the Architect (Loom) when blocked or when max retries are exhausted",
      "- Write progress updates to shared memory for cross-node visibility",
      "",
      "You do NOT write project code. You plan, assign, supervise, and escalate.",
      "",
      `Available tools: ${TOOL_LISTS.loomi}`
    ].join("\n"),
    task: [
      `Orchestrate the completion of node "${params.nodeTitle}".`,
      "",
      "Your workflow:",
      "1. Read and understand the node instructions and spec context.",
      "2. Break the work into discrete tasks, one per worker.",
      "3. Assign each worker a clear task description and exclusive file write scope. Write scopes must NOT overlap between workers.",
      "4. Monitor worker progress through messages. Respond to worker questions and unblock them when possible.",
      "5. When all workers report complete, signal that the node is ready for review.",
      "6. If a retry cycle is needed (reviewer returned FAIL), incorporate the feedback into adapted worker prompts and relaunch only the workers whose tasks failed.",
      "7. If the node is blocked or max retries are exhausted, escalate to the Architect with a clear description of the problem and what was attempted."
    ].join("\n"),
    context: contextParts.join("\n\n"),
    reasoning: [
      "Think step by step:",
      "1. Analyze the node instructions to identify discrete, parallelizable tasks.",
      "2. Map each task to specific files that need to be created or modified.",
      "3. Ensure file write scopes are exclusive \u2014 no two workers may write to the same file.",
      "4. If this is a retry cycle, identify exactly which tasks failed and why based on the reviewer feedback.",
      "5. For retries, adapt the worker prompts to address the specific failure points. Do not simply repeat the same instructions.",
      "6. Consider dependencies between tasks: if worker B needs output from worker A, sequence accordingly or have them communicate via messages.",
      "7. Before escalating, verify that all retry options have been exhausted and clearly articulate what alternatives were considered."
    ].join("\n"),
    stopConditions: [
      "Stop when one of the following is true:",
      "- All workers have reported complete and the node is ready for review.",
      "- An escalation has been sent to the Architect (Loom) because the node is blocked or retries are exhausted.",
      "- You have assigned all tasks and are waiting for workers to complete (no further orchestration needed)."
    ].join("\n"),
    output: [
      "When assigning tasks to workers, provide:",
      "- A clear, specific task description",
      "- The exact file write scope (glob patterns)",
      "- Any relevant context from the spec or shared memory",
      "- References to other workers they may need to coordinate with",
      "",
      "When escalating, provide:",
      "- What the node was trying to accomplish",
      "- What was attempted (including retry details)",
      "- The specific blocker or failure",
      "- Suggested resolution if you have one",
      "",
      "Write concise progress updates to shared memory at key milestones."
    ].join("\n")
  };
  return renderPrompt(section);
}
function buildLoomaPrompt(params) {
  const contextParts = [
    contextBlock("Node Instructions", params.nodeInstructions),
    contextBlock("Shared Memory", params.sharedMemory),
    contextBlock("Spec Artifacts", params.specContext),
    contextBlock("Team Context", params.teamContext),
    contextBlock("Retry Context", params.retryContext)
  ].filter((part) => part.length > 0);
  const section = {
    role: [
      "You are Looma, a Worker agent.",
      "You are responsible for executing a specific task within a workflow node.",
      "",
      "Your responsibilities:",
      "- Write code, create files, and modify existing files within your assigned write scope",
      "- Run shell commands to validate your work (tests, builds, linting)",
      "- Communicate with teammate workers in your node via messages when coordination is needed",
      "- Read shared memory for cross-node context (decisions, architecture changes, known issues)",
      "- Write updates to shared memory when you make decisions or encounter issues that affect other nodes",
      "- Call report_complete when your task is fully done",
      "",
      "You CAN write project code. You are the builder.",
      "",
      `Available tools: ${TOOL_LISTS.looma}`
    ].join("\n"),
    task: [
      params.taskDescription,
      "",
      "## File Write Scope",
      `You may ONLY write to files matching these patterns: ${params.fileScope.join(", ")}`,
      "Write attempts outside this scope will be rejected by the daemon.",
      "You have read access to ALL project files."
    ].join("\n"),
    context: contextParts.join("\n\n"),
    reasoning: [
      "Think step by step:",
      "1. Read the existing codebase to understand conventions, patterns, and dependencies before writing new code.",
      "2. Plan your implementation: identify which files to create or modify and in what order.",
      "3. Write clean, well-structured code that follows the project's established patterns and conventions.",
      "4. Validate your work by running relevant commands (tests, type checks, linting) after making changes.",
      "5. If you need information or output from a teammate worker, send them a message and wait for a response rather than guessing.",
      "6. If you encounter a blocker outside your scope, communicate it to your Orchestrator via a message rather than attempting workarounds.",
      "7. Write to shared memory if you make architectural decisions or encounter issues that other nodes should know about."
    ].join("\n"),
    stopConditions: [
      "Stop when one of the following is true:",
      "- Your assigned task is fully complete, validated, and you have called report_complete.",
      "- You are blocked on something outside your control and have communicated this to your Orchestrator.",
      "",
      "Do NOT call report_complete until:",
      "- All files in your scope have been created or modified as required.",
      "- Your code compiles and passes any relevant checks.",
      "- You have verified your work is consistent with the node instructions and spec."
    ].join("\n"),
    output: [
      "Produce working code and files as specified in your task description.",
      "",
      "When calling report_complete, include a summary of:",
      "- What files were created or modified",
      "- Key implementation decisions made",
      "- Any known limitations or follow-up items",
      "",
      "When writing to shared memory, be concise and factual. Include the node and task context so other agents can understand the relevance."
    ].join("\n")
  };
  return renderPrompt(section);
}
function buildLoomexPrompt(params) {
  const taskListLines = params.tasksToVerify.map((t) => `- [${t.taskId}]: ${t.description}`).join("\n");
  const contextParts = [
    contextBlock("Node Instructions", params.nodeInstructions),
    `## Tasks to Verify
${taskListLines}`,
    contextBlock("Shared Memory", params.sharedMemory),
    contextBlock("Spec Artifacts", params.specContext)
  ].filter((part) => part.length > 0);
  const section = {
    role: [
      `You are Loomex, the Reviewer agent for node "${params.nodeTitle}".`,
      "You inspect the quality of work produced by Worker agents against the node instructions.",
      "",
      "Your responsibilities:",
      "- Read and verify all files produced or modified by the workers",
      "- Check that each task was completed correctly according to the node instructions and spec",
      "- Produce a structured verdict: PASS, FAIL, or BLOCKED",
      "- Provide specific, actionable feedback for any failures",
      "",
      "You do NOT modify project files. You only read and assess.",
      "",
      `Available tools: ${TOOL_LISTS.loomex}`
    ].join("\n"),
    task: [
      `Review all work produced for node "${params.nodeTitle}".`,
      "",
      "For each task, verify:",
      "1. The required files exist and contain the expected content.",
      "2. The implementation matches the node instructions and spec requirements.",
      "3. The code follows project conventions (naming, structure, patterns).",
      "4. There are no obvious bugs, missing error handling, or security issues.",
      "5. Files that should work together are consistent (imports, interfaces, types)."
    ].join("\n"),
    context: contextParts.join("\n\n"),
    reasoning: [
      "Think step by step:",
      "1. Read the node instructions carefully to understand what was expected.",
      "2. For each task, identify the specific deliverables (files, functions, features).",
      "3. Read each deliverable file and assess it against the requirements.",
      "4. Check cross-file consistency: do imports resolve? Do interfaces match? Are types compatible?",
      "5. Look for common issues: missing exports, incomplete implementations, hardcoded values that should be configurable.",
      "6. Determine a per-task verdict (pass/fail/blocked) and an overall verdict.",
      "7. For any failure, provide specific feedback: what is wrong, where, and what the expected behavior should be.",
      "8. Use BLOCKED only when the task is fundamentally impossible given the current state (e.g., missing dependency that cannot be resolved within this node)."
    ].join("\n"),
    stopConditions: [
      "Stop when you have:",
      "- Verified every task listed in your review scope.",
      "- Produced a verdict for each task and an overall verdict.",
      "- Provided specific feedback for any FAIL or BLOCKED verdicts."
    ].join("\n"),
    output: [
      "Produce a structured review report with:",
      "",
      "1. **Overall Verdict**: PASS, FAIL, or BLOCKED",
      "2. **Per-Task Results**: For each task:",
      "   - Task ID",
      "   - Verdict: pass, fail, or blocked",
      "   - Details: what was checked and what was found",
      "3. **Details**: Summary of what works, what is missing, and what is blocked",
      "4. **Recommendation**: Specific actions for the Orchestrator to take on retry or escalation",
      "",
      'Be precise and actionable. Vague feedback like "code quality is poor" is not helpful.',
      'Instead: "Function `validateInput` in `src/auth.ts` does not validate email format as required by the spec."'
    ].join("\n")
  };
  return renderPrompt(section);
}

// src/agents/looma.ts
var CompletionCapture = class {
  captured;
  forward;
  /**
   * @param forward - External handler to forward reports to (e.g., Loomi's CompletionTracker).
   */
  constructor(forward) {
    this.forward = forward;
  }
  /**
   * Record a completion report, capturing it locally and forwarding to the external handler.
   *
   * @param agentId - ID of the agent reporting completion.
   * @param nodeId - ID of the node the agent belongs to.
   * @param report - Structured completion payload.
   * @returns Resolves when the external handler has accepted the report.
   */
  async reportComplete(agentId, nodeId, report) {
    this.captured = report;
    await this.forward.reportComplete(agentId, nodeId, report);
  }
  /**
   * Get the captured completion report, if one was filed.
   *
   * @returns The completion report, or undefined if report_complete was not called.
   */
  getReport() {
    return this.captured;
  }
};
function buildToolSet(baseTools, messageBus, capture) {
  const dynamicNames = /* @__PURE__ */ new Set(["send_message", "report_complete"]);
  const filtered = baseTools.filter((t) => !dynamicNames.has(t.name));
  return [
    ...filtered,
    createSendMessageTool(messageBus),
    createReportCompleteTool(capture)
  ];
}
async function logEvent(config, type, details) {
  const event = createEvent({
    type,
    workflowId: config.eventLog.workflowId,
    nodeId: config.nodeId,
    agentId: config.agentId,
    details
  });
  await appendEvent(config.workspacePath, event);
}
async function runLooma(config) {
  const capture = new CompletionCapture(config.completionHandler);
  config.messageBus.registerAgent(config.agentId, config.nodeId);
  try {
    const tools = buildToolSet(config.tools, config.messageBus, capture);
    const systemPrompt = buildLoomaPrompt({
      taskDescription: config.taskDescription,
      fileScope: config.writeScope,
      nodeInstructions: config.nodeInstructions,
      teamContext: config.teamContext,
      specContext: config.specContext,
      sharedMemory: config.sharedMemoryContent,
      retryContext: config.retryContext
    });
    await logEvent(config, "agent_created", {
      role: "looma",
      taskDescription: config.taskDescription,
      writeScope: config.writeScope
    });
    let loopResult;
    try {
      loopResult = await runAgentLoop({
        systemPrompt,
        tools,
        provider: config.provider,
        model: config.model,
        maxTokens: config.config.maxTokens,
        timeout: config.config.agentTimeout,
        tokenLimit: config.config.agentTokenLimit,
        agentId: config.agentId,
        nodeId: config.nodeId,
        workspacePath: config.workspacePath,
        writeScope: config.writeScope
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await logEvent(config, "agent_failed", { error: errorMessage });
      return {
        status: "failed",
        output: "",
        tokenUsage: { input: 0, output: 0 },
        error: `Agent loop threw unexpectedly: ${errorMessage}`
      };
    }
    config.costTracker.recordCall(
      config.model,
      loopResult.tokenUsage.input,
      loopResult.tokenUsage.output,
      config.agentId,
      config.nodeId
    );
    const eventType = loopResult.status === "completed" ? "agent_completed" : "agent_failed";
    await logEvent(config, eventType, {
      loopStatus: loopResult.status,
      tokenUsage: loopResult.tokenUsage,
      ...loopResult.error !== void 0 && { error: loopResult.error }
    });
    const result = {
      status: loopResult.status,
      output: loopResult.output,
      tokenUsage: loopResult.tokenUsage
    };
    if (loopResult.error !== void 0) {
      result.error = loopResult.error;
    }
    const completionReport = capture.getReport();
    if (completionReport !== void 0) {
      result.completionReport = completionReport;
    }
    return result;
  } finally {
    config.messageBus.unregisterAgent(config.agentId, config.nodeId);
  }
}

// src/agents/loomex.ts
var FORBIDDEN_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "exec_command",
  "write_memory",
  "send_message",
  "report_complete"
]);
function filterReadOnlyTools(tools) {
  return tools.filter((t) => !FORBIDDEN_TOOLS.has(t.name));
}
async function logEvent2(config, type, details) {
  const event = createEvent({
    type,
    workflowId: config.eventLog.workflowId,
    nodeId: config.nodeId,
    agentId: config.agentId,
    details
  });
  await appendEvent(config.workspacePath, event);
}
function createFailReport(errorMessage, tasksToVerify) {
  return {
    verdict: "FAIL",
    tasksVerified: tasksToVerify.map((t) => ({
      taskId: t.taskId,
      status: "fail",
      details: "Review could not be completed."
    })),
    details: errorMessage,
    recommendation: "Re-run the reviewer after resolving the underlying issue.",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function extractJson4(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== void 0) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
    }
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
    }
  }
  return null;
}
function extractVerdict(text) {
  const verdictMatch = /\b(?:overall\s+)?verdict\s*:\s*(PASS|FAIL|BLOCKED)\b/i.exec(text);
  if (verdictMatch?.[1] !== void 0) {
    return verdictMatch[1].toUpperCase();
  }
  const standaloneMatch = /\*\*?(PASS|FAIL|BLOCKED)\*?\*?/i.exec(text);
  if (standaloneMatch?.[1] !== void 0) {
    return standaloneMatch[1].toUpperCase();
  }
  return null;
}
function extractTaskStatuses(text, tasksToVerify) {
  const results = [];
  for (const task of tasksToVerify) {
    const escapedId = task.taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const taskPattern = new RegExp(
      `${escapedId}[^\\n]*?(?:status|verdict|result)?\\s*[:\u2014\\-]\\s*(pass|fail|blocked)`,
      "i"
    );
    const match = taskPattern.exec(text);
    if (match?.[1] !== void 0) {
      const status = match[1].toLowerCase();
      const detailStart = text.indexOf(match[0]);
      const detailEnd = text.indexOf("\n", detailStart + match[0].length);
      const detail = detailEnd !== -1 ? text.slice(detailStart, detailEnd).trim() : match[0].trim();
      results.push({
        taskId: task.taskId,
        status,
        details: detail
      });
    } else {
      results.push({
        taskId: task.taskId,
        status: "fail",
        details: "Could not determine task status from reviewer output."
      });
    }
  }
  return results;
}
function parseTextBased(text, tasksToVerify) {
  const verdict = extractVerdict(text) ?? "FAIL";
  const tasksVerified = extractTaskStatuses(text, tasksToVerify);
  const recommendationMatch = /(?:recommendation|suggested action|next steps?)\s*[:—]\s*([^\n]+(?:\n(?!##|\*\*)[^\n]+)*)/i.exec(text);
  const recommendation = recommendationMatch?.[1]?.trim() ?? "Review the detailed findings above.";
  return {
    verdict,
    tasksVerified,
    details: text.slice(0, 2e3),
    recommendation,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function parseReviewReport(text, tasksToVerify) {
  if (text.length === 0) {
    return createFailReport(
      "Reviewer produced no output.",
      tasksToVerify
    );
  }
  const json = extractJson4(text);
  if (json !== null) {
    const parseResult = ReviewReportSchema.safeParse(json);
    if (parseResult.success) {
      return parseResult.data;
    }
    const partial = json;
    if (typeof partial["verdict"] === "string") {
      const verdictUpper = partial["verdict"].toUpperCase();
      if (verdictUpper === "PASS" || verdictUpper === "FAIL" || verdictUpper === "BLOCKED") {
        const tasksVerified = Array.isArray(partial["tasksVerified"]) ? salvageTaskVerifications(partial["tasksVerified"], tasksToVerify) : tasksToVerify.map((t) => ({
          taskId: t.taskId,
          status: "fail",
          details: "Task verification data missing from report."
        }));
        return {
          verdict: verdictUpper,
          tasksVerified,
          details: typeof partial["details"] === "string" ? partial["details"] : "Details not provided in expected format.",
          recommendation: typeof partial["recommendation"] === "string" ? partial["recommendation"] : "Review the detailed findings.",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    }
  }
  const verdict = extractVerdict(text);
  if (verdict !== null) {
    return parseTextBased(text, tasksToVerify);
  }
  return createFailReport(
    `Reviewer output could not be parsed into a structured report. Raw output:
${text.slice(0, 2e3)}`,
    tasksToVerify
  );
}
function salvageTaskVerifications(rawTasks, tasksToVerify) {
  const parsed = /* @__PURE__ */ new Map();
  for (const raw of rawTasks) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw;
    const taskId = typeof entry["taskId"] === "string" ? entry["taskId"] : void 0;
    if (taskId === void 0) continue;
    const rawStatus = typeof entry["status"] === "string" ? entry["status"].toLowerCase() : "fail";
    const status = rawStatus === "pass" || rawStatus === "fail" || rawStatus === "blocked" ? rawStatus : "fail";
    parsed.set(taskId, {
      taskId,
      status,
      details: typeof entry["details"] === "string" ? entry["details"] : "No details provided."
    });
  }
  return tasksToVerify.map(
    (t) => parsed.get(t.taskId) ?? {
      taskId: t.taskId,
      status: "fail",
      details: "Task not found in reviewer response."
    }
  );
}
async function runLoomex(config) {
  try {
    const tools = filterReadOnlyTools(config.tools);
    const systemPrompt = buildLoomexPrompt({
      nodeTitle: config.nodeTitle,
      nodeInstructions: config.nodeInstructions,
      tasksToVerify: config.tasksToVerify,
      specContext: config.specContext,
      sharedMemory: config.sharedMemoryContent
    });
    await logEvent2(config, "reviewer_started", {
      nodeTitle: config.nodeTitle,
      tasksToVerify: config.tasksToVerify.map((t) => t.taskId)
    });
    let loopResult;
    try {
      loopResult = await runAgentLoop({
        systemPrompt,
        tools,
        provider: config.provider,
        model: config.model,
        maxTokens: config.config.maxTokens,
        timeout: config.config.agentTimeout,
        tokenLimit: config.config.agentTokenLimit,
        agentId: config.agentId,
        nodeId: config.nodeId,
        workspacePath: config.workspacePath,
        writeScope: []
        // Loomex has no write scope
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await logEvent2(config, "reviewer_verdict", {
        verdict: "FAIL",
        error: errorMessage
      });
      const report2 = createFailReport(
        `Agent loop threw unexpectedly: ${errorMessage}`,
        config.tasksToVerify
      );
      return {
        report: report2,
        tokenUsage: { input: 0, output: 0 },
        error: errorMessage
      };
    }
    config.costTracker.recordCall(
      config.model,
      loopResult.tokenUsage.input,
      loopResult.tokenUsage.output,
      config.agentId,
      config.nodeId
    );
    const report = parseReviewReport(loopResult.output, config.tasksToVerify);
    await logEvent2(config, "reviewer_verdict", {
      verdict: report.verdict,
      tasksVerified: report.tasksVerified.length,
      loopStatus: loopResult.status
    });
    const result = {
      report,
      tokenUsage: loopResult.tokenUsage
    };
    if (loopResult.status !== "completed") {
      result.error = loopResult.error ?? `Agent loop ended with status: ${loopResult.status}`;
    }
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const report = createFailReport(
      `Loomex failed unexpectedly: ${errorMessage}`,
      config.tasksToVerify
    );
    return {
      report,
      tokenUsage: { input: 0, output: 0 },
      error: errorMessage
    };
  }
}

// src/agents/loomi.ts
import picomatch from "picomatch";
import { z as z5 } from "zod";
var WorkerPlanSchema = z5.object({
  id: z5.string(),
  taskDescription: z5.string(),
  writeScope: z5.array(z5.string()).min(1)
});
var TeamPlanSchema = z5.object({
  reasoning: z5.string(),
  workers: z5.array(WorkerPlanSchema).min(1)
});
var CompletionTracker = class {
  reports = /* @__PURE__ */ new Map();
  /**
   * Record a completion report from a worker agent.
   *
   * @param agentId - ID of the agent reporting completion.
   * @param _nodeId - Node ID (unused, present for interface compliance).
   * @param report - Structured completion payload.
   * @returns Resolves when the report has been stored.
   */
  reportComplete(agentId, _nodeId, report) {
    this.reports.set(agentId, report);
    return Promise.resolve();
  }
  /**
   * Get the completion report for a specific agent.
   *
   * @param agentId - Agent identifier to look up.
   * @returns The completion report, or undefined if the agent has not reported.
   */
  getReport(agentId) {
    return this.reports.get(agentId);
  }
  /**
   * Clear all tracked reports between retry cycles.
   */
  clear() {
    this.reports.clear();
  }
};
function buildPlanningSystemPrompt(maxWorkers) {
  const maxWorkerLine = maxWorkers !== null ? `You MUST NOT plan more than ${String(maxWorkers)} worker(s).` : "There is no limit on the number of workers.";
  return [
    "You are Loomi, the Orchestrator agent in the Loomflo AI agent framework.",
    "Your task is to analyze node instructions and plan a team of Worker agents (Loomas).",
    "",
    "Rules:",
    "- Each worker must have a clear, specific task description.",
    "- Each worker must have an exclusive file write scope defined as glob patterns.",
    "- File write scopes MUST NOT overlap between workers \u2014 no two workers may write to the same file.",
    '- Use descriptive worker IDs prefixed with "looma-" (e.g., "looma-auth-1", "looma-api-routes-1").',
    `- ${maxWorkerLine}`,
    "- If the work is small enough for one worker, plan one worker. Do not split unnecessarily.",
    "",
    "Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):",
    "{",
    '  "reasoning": "Brief explanation of why you are dividing the work this way",',
    '  "workers": [',
    "    {",
    '      "id": "looma-descriptive-name-1",',
    '      "taskDescription": "Detailed description of what this worker should accomplish",',
    '      "writeScope": ["glob/pattern/**/*.ts"]',
    "    }",
    "  ]",
    "}"
  ].join("\n");
}
function buildPlanningUserMessage(nodeTitle, instructions, specContext, sharedMemoryContent) {
  const parts = [
    `## Node: ${nodeTitle}`,
    "",
    "## Instructions",
    instructions
  ];
  if (specContext !== void 0 && specContext.length > 0) {
    parts.push("", "## Spec Context", specContext);
  }
  if (sharedMemoryContent !== void 0 && sharedMemoryContent.length > 0) {
    parts.push("", "## Shared Memory", sharedMemoryContent);
  }
  return parts.join("\n");
}
function buildRetryPlanningSystemPrompt() {
  return [
    "You are Loomi, the Orchestrator agent. Some of your workers failed their tasks.",
    "Generate adapted task descriptions that incorporate the reviewer feedback.",
    "",
    "Rules:",
    "- Only generate plans for the failed workers listed below.",
    "- Keep the same worker IDs and file write scopes \u2014 only adapt the task descriptions.",
    "- Address the specific issues raised in the review feedback.",
    "- Be more specific and explicit about what the worker should do differently.",
    "",
    "Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):",
    "{",
    '  "reasoning": "What changes you are making to address the feedback",',
    '  "workers": [',
    "    {",
    '      "id": "existing-worker-id",',
    '      "taskDescription": "Adapted task description addressing the feedback",',
    '      "writeScope": ["same/scope/as/before/**"]',
    "    }",
    "  ]",
    "}"
  ].join("\n");
}
function buildRetryUserMessage(failedPlans, reviewFeedback, originalInstructions) {
  const planDescriptions = failedPlans.map((p) => `- ${p.id}: ${p.taskDescription} (scope: ${p.writeScope.join(", ")})`).join("\n");
  return [
    "## Failed Workers",
    planDescriptions,
    "",
    "## Review Feedback",
    reviewFeedback,
    "",
    "## Original Node Instructions",
    originalInstructions
  ].join("\n");
}
function extractJson5(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== void 0) {
    return JSON.parse(fenceMatch[1].trim());
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
  throw new Error("Failed to extract JSON from LLM response");
}
function validateFileScopes(workers) {
  const overlaps = [];
  for (let i = 0; i < workers.length; i++) {
    const a = workers[i];
    for (let j = i + 1; j < workers.length; j++) {
      const b = workers[j];
      const matcherA = picomatch(a.writeScope);
      const matcherB = picomatch(b.writeScope);
      const testPaths = generateTestPaths([...a.writeScope, ...b.writeScope]);
      for (const testPath of testPaths) {
        if (matcherA(testPath) && matcherB(testPath)) {
          overlaps.push(
            `Workers "${a.id}" and "${b.id}" both match "${testPath}"`
          );
          break;
        }
      }
    }
  }
  return { valid: overlaps.length === 0, overlaps };
}
function generateTestPaths(patterns) {
  const paths = /* @__PURE__ */ new Set();
  for (const pattern of patterns) {
    let path = pattern.replace(/\*\*/g, "a/b");
    path = path.replace(/\*/g, "test.file");
    path = path.replace(/\{([^}]+)\}/g, (_match, group) => {
      const first = group.split(",")[0];
      return first ?? "x";
    });
    path = path.replace(/\?/g, "x");
    paths.add(path);
  }
  return Array.from(paths);
}
function buildTeamContext(currentId, allPlans) {
  const others = allPlans.filter((p) => p.id !== currentId);
  if (others.length === 0) {
    return "You are the only worker in this node.";
  }
  const lines = others.map(
    (p) => `- ${p.id}: ${p.taskDescription} (writes to: ${p.writeScope.join(", ")})`
  );
  return ["Your teammates in this node:", ...lines].join("\n");
}
function createWorkerAgentInfo(plan, model) {
  return {
    id: plan.id,
    role: "looma",
    model,
    status: "created",
    writeScope: [...plan.writeScope],
    taskDescription: plan.taskDescription,
    tokenUsage: { input: 0, output: 0 },
    cost: 0
  };
}
function buildWorkerTools(baseTools, messageBus, completionTracker) {
  const dynamicNames = /* @__PURE__ */ new Set(["send_message", "report_complete"]);
  const filtered = baseTools.filter((t) => !dynamicNames.has(t.name));
  return [
    ...filtered,
    createSendMessageTool(messageBus),
    createReportCompleteTool(completionTracker)
  ];
}
async function logEvent3(config, loomiAgentId, type, details) {
  const event = createEvent({
    type,
    workflowId: config.eventLog.workflowId,
    nodeId: config.nodeId,
    agentId: loomiAgentId,
    details
  });
  await appendEvent(config.workspacePath, event);
}
async function writeProgress(config, agentId, content) {
  await config.sharedMemory.write("PROGRESS.md", content, agentId);
}
async function planTeam(config) {
  const maxWorkers = config.config.maxLoomasPerLoomi;
  const systemPrompt = buildPlanningSystemPrompt(maxWorkers);
  const userMessage = buildPlanningUserMessage(
    config.nodeTitle,
    config.instructions,
    config.specContext,
    config.sharedMemoryContent
  );
  const response = await config.provider.complete({
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
    model: config.model
  });
  const loomiAgentId = `loomi-${config.nodeId}`;
  config.costTracker.recordCall(
    config.model,
    response.usage.inputTokens,
    response.usage.outputTokens,
    loomiAgentId,
    config.nodeId
  );
  const textBlocks = response.content.filter(
    (block) => block.type === "text"
  );
  const responseText = textBlocks.map((b) => b.text).join("\n");
  if (responseText.length === 0) {
    throw new Error("LLM returned empty response for team planning");
  }
  const json = extractJson5(responseText);
  const plan = TeamPlanSchema.parse(json);
  if (maxWorkers !== null && plan.workers.length > maxWorkers) {
    plan.workers = plan.workers.slice(0, maxWorkers);
  }
  const seenIds = /* @__PURE__ */ new Set();
  for (const worker of plan.workers) {
    if (seenIds.has(worker.id)) {
      worker.id = `${worker.id}-${String(seenIds.size + 1)}`;
    }
    seenIds.add(worker.id);
  }
  return plan;
}
async function adaptPlansForRetry(config, failedPlans, reviewFeedback) {
  const systemPrompt = buildRetryPlanningSystemPrompt();
  const userMessage = buildRetryUserMessage(
    failedPlans,
    reviewFeedback,
    config.instructions
  );
  const response = await config.provider.complete({
    messages: [{ role: "user", content: userMessage }],
    system: systemPrompt,
    model: config.model
  });
  const loomiAgentId = `loomi-${config.nodeId}`;
  config.costTracker.recordCall(
    config.model,
    response.usage.inputTokens,
    response.usage.outputTokens,
    loomiAgentId,
    config.nodeId
  );
  const textBlocks = response.content.filter(
    (block) => block.type === "text"
  );
  const responseText = textBlocks.map((b) => b.text).join("\n");
  if (responseText.length === 0) {
    throw new Error("LLM returned empty response for retry planning");
  }
  const json = extractJson5(responseText);
  const adaptedPlan = TeamPlanSchema.parse(json);
  return failedPlans.map((original) => {
    const adapted = adaptedPlan.workers.find((w) => w.id === original.id);
    return {
      id: original.id,
      taskDescription: adapted?.taskDescription ?? original.taskDescription,
      writeScope: original.writeScope
    };
  });
}
async function spawnWorker(config, plan, allPlans, tools, retryContext) {
  const teamContext = buildTeamContext(plan.id, allPlans);
  const workerModel = config.config.models.looma;
  const systemPrompt = buildLoomaPrompt({
    taskDescription: plan.taskDescription,
    fileScope: plan.writeScope,
    nodeInstructions: config.instructions,
    teamContext,
    specContext: config.specContext,
    sharedMemory: config.sharedMemoryContent,
    retryContext
  });
  return runAgentLoop({
    systemPrompt,
    tools,
    provider: config.provider,
    model: workerModel,
    timeout: config.config.agentTimeout,
    tokenLimit: config.config.agentTokenLimit,
    agentId: plan.id,
    nodeId: config.nodeId,
    workspacePath: config.workspacePath,
    writeScope: plan.writeScope
  });
}
function classifyWorkerResults(plans, results, tracker) {
  const completedIds = [];
  const failedIds = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const result = results[i];
    const report = tracker.getReport(plan.id);
    if (result.status !== "completed") {
      failedIds.push(plan.id);
    } else if (report !== void 0 && report.status !== "success") {
      failedIds.push(plan.id);
    } else {
      completedIds.push(plan.id);
    }
  }
  return { completedIds, failedIds };
}
async function handleEscalation(config, loomiAgentId, reason, details, completedAgents, failedAgents, retryCount) {
  await logEvent3(config, loomiAgentId, "escalation_triggered", {
    reason,
    details
  });
  await config.escalationHandler.escalate({
    reason,
    nodeId: config.nodeId,
    agentId: loomiAgentId,
    suggestedAction: "modify_node",
    details
  });
  await writeProgress(
    config,
    loomiAgentId,
    `## Escalated to Architect
Reason: ${reason}
`
  );
  return {
    status: "escalated",
    completedAgents,
    failedAgents,
    retryCount
  };
}
function applyPerTaskRetryLimits(workers, taskRetryTracker, maxRetriesPerTask, permanentlyFailed) {
  const failedSet = new Set(permanentlyFailed);
  const retryable = workers.filter((p) => !failedSet.has(p.id));
  for (const plan of retryable) {
    const current = taskRetryTracker.get(plan.id) ?? 0;
    taskRetryTracker.set(plan.id, current + 1);
  }
  const eligible = retryable.filter(
    (p) => (taskRetryTracker.get(p.id) ?? 0) <= maxRetriesPerTask
  );
  const exhausted = retryable.filter(
    (p) => (taskRetryTracker.get(p.id) ?? 0) > maxRetriesPerTask
  );
  return { eligible, exhausted };
}
async function runLoomi(config) {
  const loomiAgentId = `loomi-${config.nodeId}`;
  const completionTracker = new CompletionTracker();
  const maxRetries = config.config.maxRetriesPerNode;
  let retryCount = 0;
  const allCompletedAgents = [];
  const taskRetryTracker = /* @__PURE__ */ new Map();
  const maxRetriesPerTask = config.config.maxRetriesPerTask;
  const permanentlyFailedAgents = [];
  await logEvent3(config, loomiAgentId, "node_started", {
    nodeTitle: config.nodeTitle
  });
  await writeProgress(
    config,
    loomiAgentId,
    `## Node "${config.nodeTitle}" \u2014 Orchestration Started
Planning team...
`
  );
  let teamPlan;
  try {
    teamPlan = await planTeam(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEvent3(config, loomiAgentId, "node_failed", {
      error: `Planning failed: ${message}`
    });
    await writeProgress(config, loomiAgentId, `## Planning Failed
${message}
`);
    return { status: "failed", completedAgents: [], failedAgents: [], retryCount: 0 };
  }
  await writeProgress(
    config,
    loomiAgentId,
    `## Team Planned
${teamPlan.reasoning}
Workers: ${String(teamPlan.workers.length)}
` + teamPlan.workers.map((p) => `- ${p.id}: ${p.taskDescription}`).join("\n") + "\n"
  );
  const scopeValidation = validateFileScopes(teamPlan.workers);
  if (!scopeValidation.valid) {
    await writeProgress(
      config,
      loomiAgentId,
      `## File Scope Overlap Detected \u2014 Replanning
${scopeValidation.overlaps.join("\n")}
`
    );
    try {
      const retryPlan = await planTeam(config);
      const revalidation = validateFileScopes(retryPlan.workers);
      if (!revalidation.valid) {
        await logEvent3(config, loomiAgentId, "node_failed", {
          error: "File scope overlap persists after replanning",
          overlaps: revalidation.overlaps
        });
        return { status: "failed", completedAgents: [], failedAgents: [], retryCount: 0 };
      }
      teamPlan = retryPlan;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logEvent3(config, loomiAgentId, "node_failed", {
        error: `Replanning failed: ${message}`
      });
      return { status: "failed", completedAgents: [], failedAgents: [], retryCount: 0 };
    }
  }
  let activePlans = [...teamPlan.workers];
  const workerTools = buildWorkerTools(config.workerTools, config.messageBus, completionTracker);
  config.messageBus.registerAgent(loomiAgentId, config.nodeId);
  try {
    while (retryCount <= maxRetries) {
      completionTracker.clear();
      for (const plan of activePlans) {
        config.messageBus.registerAgent(plan.id, config.nodeId);
      }
      for (const plan of activePlans) {
        await logEvent3(config, loomiAgentId, "agent_created", {
          agentId: plan.id,
          role: "looma",
          taskDescription: plan.taskDescription,
          writeScope: plan.writeScope,
          retry: retryCount > 0
        });
      }
      const retryContext = retryCount > 0 ? `This is retry attempt ${String(retryCount)}. Address the issues from the previous attempt.` : void 0;
      const retryDetails = retryCount > 0 ? "\n" + activePlans.map((p) => `  - ${p.id} (task retry ${String(taskRetryTracker.get(p.id) ?? 0)}/${String(maxRetriesPerTask)})`).join("\n") + "\n" : "";
      await writeProgress(
        config,
        loomiAgentId,
        retryCount > 0 ? `## Retry ${String(retryCount)} \u2014 Relaunching ${String(activePlans.length)} worker(s)${retryDetails}
` : `## Spawning ${String(activePlans.length)} worker(s)
`
      );
      const workerResults = await Promise.all(
        activePlans.map(
          (plan) => spawnWorker(config, plan, teamPlan.workers, workerTools, retryContext)
        )
      );
      for (let i = 0; i < activePlans.length; i++) {
        const plan = activePlans[i];
        const result = workerResults[i];
        config.costTracker.recordCall(
          config.config.models.looma,
          result.tokenUsage.input,
          result.tokenUsage.output,
          plan.id,
          config.nodeId
        );
        const agentEventType = result.status === "completed" ? "agent_completed" : "agent_failed";
        await logEvent3(config, loomiAgentId, agentEventType, {
          agentId: plan.id,
          loopStatus: result.status,
          ...result.error !== void 0 && { error: result.error }
        });
      }
      for (const plan of activePlans) {
        config.messageBus.unregisterAgent(plan.id, config.nodeId);
      }
      const { completedIds, failedIds } = classifyWorkerResults(
        activePlans,
        workerResults,
        completionTracker
      );
      allCompletedAgents.push(...completedIds);
      await writeProgress(
        config,
        loomiAgentId,
        `## Workers Finished
Completed: ${completedIds.join(", ") || "none"}
Failed: ${failedIds.join(", ") || "none"}
`
      );
      if (failedIds.length === 0) {
        if (config.reviewCallback !== void 0) {
          await logEvent3(config, loomiAgentId, "reviewer_started", {});
          const reviewReport = await config.reviewCallback();
          if (reviewReport === null || reviewReport.verdict === "PASS") {
            if (reviewReport !== null) {
              await logEvent3(config, loomiAgentId, "reviewer_verdict", { verdict: "PASS" });
            }
            await logEvent3(config, loomiAgentId, "node_completed", { retryCount });
            await writeProgress(config, loomiAgentId, `## Node Completed Successfully
`);
            return {
              status: "completed",
              completedAgents: allCompletedAgents,
              failedAgents: [],
              retryCount
            };
          }
          await logEvent3(config, loomiAgentId, "reviewer_verdict", {
            verdict: reviewReport.verdict
          });
          if (reviewReport.verdict === "BLOCKED") {
            return await handleEscalation(
              config,
              loomiAgentId,
              `Node "${config.nodeTitle}" is BLOCKED: ${reviewReport.details}`,
              reviewReport.recommendation,
              allCompletedAgents,
              [],
              retryCount
            );
          }
          if (retryCount >= maxRetries) {
            return await handleEscalation(
              config,
              loomiAgentId,
              `Node "${config.nodeTitle}" exhausted ${String(maxRetries)} retries: ${reviewReport.details}`,
              `${reviewReport.recommendation}${permanentlyFailedAgents.length > 0 ? `
Permanently failed workers (per-task limit): ${permanentlyFailedAgents.join(", ")}` : ""}`,
              allCompletedAgents,
              permanentlyFailedAgents,
              retryCount
            );
          }
          const failedTaskIds = reviewReport.tasksVerified.filter((t) => t.status !== "pass").map((t) => t.taskId);
          const failedWorkerPlans2 = teamPlan.workers.filter(
            (p) => failedTaskIds.includes(p.id) || failedTaskIds.length === 0
          );
          const candidatePlans = failedWorkerPlans2.length > 0 ? failedWorkerPlans2 : [...teamPlan.workers];
          const { eligible: reviewEligible, exhausted: reviewExhausted } = applyPerTaskRetryLimits(candidatePlans, taskRetryTracker, maxRetriesPerTask, permanentlyFailedAgents);
          if (reviewExhausted.length > 0) {
            permanentlyFailedAgents.push(...reviewExhausted.map((p) => p.id));
            await writeProgress(
              config,
              loomiAgentId,
              `## Per-task retry limit reached
Permanently failed: ${reviewExhausted.map((p) => p.id).join(", ")}
`
            );
          }
          if (reviewEligible.length === 0) {
            return await handleEscalation(
              config,
              loomiAgentId,
              `Node "${config.nodeTitle}" \u2014 all failed workers exhausted per-task retry limit (${String(maxRetriesPerTask)})`,
              `Permanently failed workers: ${permanentlyFailedAgents.join(", ")}`,
              allCompletedAgents,
              permanentlyFailedAgents,
              retryCount
            );
          }
          activePlans = reviewEligible;
          await logEvent3(config, loomiAgentId, "retry_triggered", {
            retryCount: retryCount + 1,
            failedWorkers: activePlans.map((p) => p.id),
            taskRetryCounts: Object.fromEntries(taskRetryTracker),
            permanentlyFailed: permanentlyFailedAgents
          });
          const feedback = `${reviewReport.details}

Recommendation: ${reviewReport.recommendation}`;
          try {
            activePlans = await adaptPlansForRetry(config, activePlans, feedback);
          } catch {
            await writeProgress(
              config,
              loomiAgentId,
              `## Prompt adaptation failed, retrying with original plans
`
            );
          }
          retryCount++;
          continue;
        }
        await logEvent3(config, loomiAgentId, "node_completed", { retryCount });
        await writeProgress(config, loomiAgentId, `## Node Completed Successfully
`);
        return {
          status: "completed",
          completedAgents: allCompletedAgents,
          failedAgents: [],
          retryCount
        };
      }
      if (retryCount >= maxRetries) {
        const allFailed = [.../* @__PURE__ */ new Set([...failedIds, ...permanentlyFailedAgents])];
        return await handleEscalation(
          config,
          loomiAgentId,
          `Node "${config.nodeTitle}" has ${String(failedIds.length)} failed worker(s) after ${String(maxRetries)} retries`,
          `Failed workers: ${failedIds.join(", ")}${permanentlyFailedAgents.length > 0 ? `
Permanently failed (per-task limit): ${permanentlyFailedAgents.join(", ")}` : ""}`,
          allCompletedAgents,
          allFailed,
          retryCount
        );
      }
      const failedWorkerPlans = teamPlan.workers.filter((p) => failedIds.includes(p.id));
      const { eligible: workerEligible, exhausted: workerExhausted } = applyPerTaskRetryLimits(failedWorkerPlans, taskRetryTracker, maxRetriesPerTask, permanentlyFailedAgents);
      if (workerExhausted.length > 0) {
        permanentlyFailedAgents.push(...workerExhausted.map((p) => p.id));
        await writeProgress(
          config,
          loomiAgentId,
          `## Per-task retry limit reached
Permanently failed: ${workerExhausted.map((p) => p.id).join(", ")}
`
        );
      }
      if (workerEligible.length === 0) {
        return await handleEscalation(
          config,
          loomiAgentId,
          `Node "${config.nodeTitle}" \u2014 all failed workers exhausted per-task retry limit (${String(maxRetriesPerTask)})`,
          `Permanently failed workers: ${permanentlyFailedAgents.join(", ")}`,
          allCompletedAgents,
          permanentlyFailedAgents,
          retryCount
        );
      }
      activePlans = workerEligible;
      await logEvent3(config, loomiAgentId, "retry_triggered", {
        retryCount: retryCount + 1,
        failedWorkers: activePlans.map((p) => p.id),
        taskRetryCounts: Object.fromEntries(taskRetryTracker),
        permanentlyFailed: permanentlyFailedAgents
      });
      retryCount++;
    }
  } finally {
    config.messageBus.unregisterAgent(loomiAgentId, config.nodeId);
  }
  return {
    status: "failed",
    completedAgents: allCompletedAgents,
    failedAgents: permanentlyFailedAgents,
    retryCount
  };
}

// src/agents/message-bus.ts
import { randomUUID as randomUUID2 } from "crypto";
var MessageBus = class {
  /**
   * Per-node, per-agent incoming message queues.
   *
   * Structure: `Map<nodeId, Map<agentId, Message[]>>`
   */
  queues = /* @__PURE__ */ new Map();
  /** Append-only log of every message sent through the bus. */
  log = [];
  // ==========================================================================
  // Registration
  // ==========================================================================
  /**
   * Register an agent to receive messages within a node.
   *
   * Creates an empty incoming queue for the agent. If the agent is already
   * registered to the same node, this is a no-op.
   *
   * @param agentId - Unique agent identifier.
   * @param nodeId - Node the agent belongs to.
   */
  registerAgent(agentId, nodeId) {
    let nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) {
      nodeQueues = /* @__PURE__ */ new Map();
      this.queues.set(nodeId, nodeQueues);
    }
    if (!nodeQueues.has(agentId)) {
      nodeQueues.set(agentId, []);
    }
  }
  /**
   * Unregister an agent from a node, removing its message queue.
   *
   * Any undelivered messages in the queue are discarded. If the node has no
   * remaining agents, the node entry is cleaned up.
   *
   * @param agentId - Unique agent identifier.
   * @param nodeId - Node the agent belongs to.
   */
  unregisterAgent(agentId, nodeId) {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) return;
    nodeQueues.delete(agentId);
    if (nodeQueues.size === 0) {
      this.queues.delete(nodeId);
    }
  }
  // ==========================================================================
  // Messaging
  // ==========================================================================
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
  send(from, to, nodeId, content) {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) {
      return Promise.reject(new Error(
        `Cannot send message: no agents registered for node "${nodeId}"`
      ));
    }
    if (!nodeQueues.has(from)) {
      return Promise.reject(new Error(
        `Cannot send message: sender "${from}" is not registered to node "${nodeId}"`
      ));
    }
    const recipientQueue = nodeQueues.get(to);
    if (!recipientQueue) {
      return Promise.reject(new Error(
        `Cannot send message: recipient "${to}" is not registered to node "${nodeId}"`
      ));
    }
    const message = {
      id: randomUUID2(),
      from,
      to,
      nodeId,
      content,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.log.push(message);
    recipientQueue.push(message);
    return Promise.resolve();
  }
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
  broadcast(from, nodeId, content) {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) {
      return Promise.reject(new Error(
        `Cannot broadcast: no agents registered for node "${nodeId}"`
      ));
    }
    if (!nodeQueues.has(from)) {
      return Promise.reject(new Error(
        `Cannot broadcast: sender "${from}" is not registered to node "${nodeId}"`
      ));
    }
    for (const [agentId, queue] of nodeQueues) {
      if (agentId === from) continue;
      const message = {
        id: randomUUID2(),
        from,
        to: agentId,
        nodeId,
        content,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.log.push(message);
      queue.push(message);
    }
    return Promise.resolve();
  }
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
  collect(agentId, nodeId) {
    const nodeQueues = this.queues.get(nodeId);
    if (!nodeQueues) return [];
    const queue = nodeQueues.get(agentId);
    if (!queue) return [];
    const messages = [...queue];
    queue.length = 0;
    return messages;
  }
  // ==========================================================================
  // Inspection
  // ==========================================================================
  /**
   * Get the message log for inspection or dashboard display.
   *
   * When `nodeId` is provided, returns only messages for that node.
   * Otherwise returns all logged messages across all nodes.
   *
   * @param nodeId - Optional node ID to filter by.
   * @returns Read-only array of logged messages.
   */
  getMessageLog(nodeId) {
    if (nodeId === void 0) {
      return this.log;
    }
    return this.log.filter((m) => m.nodeId === nodeId);
  }
};

// src/tools/file-read.ts
import { readFile, realpath } from "fs/promises";
import { resolve, normalize } from "path";
import { z as z6 } from "zod";
var ReadFileInputSchema = z6.object({
  /** File path relative to the workspace root. */
  path: z6.string().describe("File path relative to the workspace root")
});
var readFileTool = {
  name: "read_file",
  description: "Read the contents of a file from the workspace. Provide a path relative to the workspace root. Returns the file content as a string, or an error message if the file cannot be read.",
  inputSchema: ReadFileInputSchema,
  async execute(input, context) {
    try {
      const { path: filePath } = ReadFileInputSchema.parse(input);
      const workspaceRoot = normalize(resolve(context.workspacePath));
      const resolved = normalize(resolve(workspaceRoot, filePath));
      if (!resolved.startsWith(workspaceRoot + "/") && resolved !== workspaceRoot) {
        return `Error: path "${filePath}" resolves outside the workspace`;
      }
      let real;
      try {
        real = await realpath(resolved);
      } catch {
        return `Error: file not found \u2014 ${filePath}`;
      }
      const realWorkspace = await realpath(workspaceRoot);
      if (!real.startsWith(realWorkspace + "/") && real !== realWorkspace) {
        return `Error: path "${filePath}" resolves outside the workspace via symlink`;
      }
      const content = await readFile(real, "utf-8");
      return content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/file-write.ts
import { mkdir as mkdir2, realpath as realpath2, writeFile as writeFile2 } from "fs/promises";
import { dirname, normalize as normalize2, resolve as resolve2 } from "path";
import picomatch2 from "picomatch";
import { z as z7 } from "zod";
var WriteFileInputSchema = z7.object({
  /** File path relative to the workspace root. */
  path: z7.string().describe("File path relative to the workspace root"),
  /** Content to write to the file. */
  content: z7.string().describe("Content to write to the file")
});
var writeFileTool = {
  name: "write_file",
  description: "Create or overwrite a file within the workspace. Provide a path relative to the workspace root and the content to write. The path must fall within the agent's assigned write scope. Returns a success message with bytes written, or an error message on failure.",
  inputSchema: WriteFileInputSchema,
  async execute(input, context) {
    try {
      const { path: filePath, content } = WriteFileInputSchema.parse(input);
      const workspaceRoot = normalize2(resolve2(context.workspacePath));
      const resolved = normalize2(resolve2(workspaceRoot, filePath));
      if (!resolved.startsWith(workspaceRoot + "/") && resolved !== workspaceRoot) {
        return `Error: path "${filePath}" resolves outside the workspace`;
      }
      const parentDir = dirname(resolved);
      let realParent;
      try {
        realParent = await realpath2(parentDir);
      } catch {
        realParent = parentDir;
      }
      const realWorkspace = await realpath2(workspaceRoot);
      if (!realParent.startsWith(realWorkspace + "/") && realParent !== realWorkspace) {
        return `Error: path "${filePath}" resolves outside the workspace via symlink`;
      }
      const relativePath = resolved.slice(workspaceRoot.length + 1);
      const isAllowed = picomatch2(context.writeScope);
      if (!isAllowed(relativePath)) {
        return "Error: Write denied \u2014 path outside your assigned scope";
      }
      await mkdir2(parentDir, { recursive: true });
      const bytes = Buffer.byteLength(content, "utf-8");
      await writeFile2(resolved, content, "utf-8");
      return `Successfully wrote ${String(bytes)} bytes to ${filePath}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/file-edit.ts
import { readFile as readFile2, realpath as realpath3, writeFile as writeFile3 } from "fs/promises";
import { normalize as normalize3, resolve as resolve3 } from "path";
import picomatch3 from "picomatch";
import { z as z8 } from "zod";
var EditFileInputSchema = z8.object({
  /** File path relative to the workspace root. */
  path: z8.string().describe("File path relative to the workspace root"),
  /** The exact text to find in the file. */
  oldText: z8.string().describe("The exact text to find in the file"),
  /** The replacement text. */
  newText: z8.string().describe("The replacement text")
});
var editFileTool = {
  name: "edit_file",
  description: "Edit a file by replacing a string occurrence within the workspace. Provide a path relative to the workspace root, the exact text to find (oldText), and the replacement text (newText). Only the first occurrence is replaced. The path must fall within the agent's assigned write scope. Returns a success message, or an error message on failure.",
  inputSchema: EditFileInputSchema,
  async execute(input, context) {
    try {
      const { path: filePath, oldText, newText } = EditFileInputSchema.parse(input);
      const workspaceRoot = normalize3(resolve3(context.workspacePath));
      const resolved = normalize3(resolve3(workspaceRoot, filePath));
      if (!resolved.startsWith(workspaceRoot + "/") && resolved !== workspaceRoot) {
        return `Error: path "${filePath}" resolves outside the workspace`;
      }
      let real;
      try {
        real = await realpath3(resolved);
      } catch {
        return `Error: file not found \u2014 ${filePath}`;
      }
      const realWorkspace = await realpath3(workspaceRoot);
      if (!real.startsWith(realWorkspace + "/") && real !== realWorkspace) {
        return `Error: path "${filePath}" resolves outside the workspace via symlink`;
      }
      const relativePath = resolved.slice(workspaceRoot.length + 1);
      const isAllowed = picomatch3(context.writeScope);
      if (!isAllowed(relativePath)) {
        return "Error: Write denied \u2014 path outside your assigned scope";
      }
      const content = await readFile2(real, "utf-8");
      const firstIndex = content.indexOf(oldText);
      if (firstIndex === -1) {
        return "Error: oldText not found in file";
      }
      let occurrences = 0;
      let searchFrom = 0;
      for (; ; ) {
        const idx = content.indexOf(oldText, searchFrom);
        if (idx === -1) break;
        occurrences++;
        searchFrom = idx + oldText.length;
      }
      const modified = content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);
      await writeFile3(real, modified, "utf-8");
      if (occurrences > 1) {
        return `Successfully edited ${filePath} (replaced first of ${String(occurrences)} occurrences)`;
      }
      return `Successfully edited ${filePath}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/file-search.ts
import { readFile as readFile3, readdir, realpath as realpath4 } from "fs/promises";
import { join as join2, normalize as normalize4, relative, resolve as resolve4 } from "path";
import picomatch4 from "picomatch";
import { z as z9 } from "zod";
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist"]);
var BINARY_CHECK_BYTES = 8192;
var SearchFilesInputSchema = z9.object({
  /** Regex pattern to search for in file contents. */
  pattern: z9.string().describe("Regex pattern to search for in file contents"),
  /** Glob pattern to filter which files to search. Defaults to all files. */
  glob: z9.string().optional().describe("Glob pattern to filter which files to search (default: **/*)"),
  /** Maximum number of matches to return. Defaults to 50. */
  maxResults: z9.number().int().positive().optional().describe("Maximum number of matching lines to return (default: 50)")
});
function compileRegex(pattern) {
  try {
    return new RegExp(pattern, "g");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: invalid regex pattern \u2014 ${message}`;
  }
}
function isBinary(buffer) {
  const length = Math.min(buffer.length, BINARY_CHECK_BYTES);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}
async function walkDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const nested = await walkDirectory(join2(dir, entry.name));
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(join2(dir, entry.name));
    }
  }
  return files;
}
var searchFilesTool = {
  name: "search_files",
  description: 'Search file contents within the workspace using a regex pattern. Optionally filter files with a glob pattern. Returns matching lines in "file:lineNumber:content" format, or an error message on failure.',
  inputSchema: SearchFilesInputSchema,
  async execute(input, context) {
    try {
      const {
        pattern,
        glob: globPattern = "**/*",
        maxResults = 50
      } = SearchFilesInputSchema.parse(input);
      const regex = compileRegex(pattern);
      if (typeof regex === "string") {
        return regex;
      }
      const workspaceRoot = normalize4(resolve4(context.workspacePath));
      const realWorkspace = await realpath4(workspaceRoot);
      const isGlobMatch = picomatch4(globPattern);
      const allFiles = await walkDirectory(realWorkspace);
      const results = [];
      for (const absolutePath of allFiles) {
        if (results.length >= maxResults) {
          break;
        }
        const rel = relative(realWorkspace, absolutePath);
        if (!isGlobMatch(rel)) {
          continue;
        }
        const realFile = await realpath4(absolutePath);
        if (!realFile.startsWith(realWorkspace + "/") && realFile !== realWorkspace) {
          continue;
        }
        let buffer;
        try {
          buffer = await readFile3(realFile);
        } catch {
          continue;
        }
        if (isBinary(buffer)) {
          continue;
        }
        const content = buffer.toString("utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          const currentLine = lines[i] ?? "";
          if (regex.test(currentLine)) {
            results.push(`${rel}:${String(i + 1)}:${currentLine}`);
            if (results.length >= maxResults) {
              break;
            }
          }
        }
      }
      if (results.length === 0) {
        return "No matches found";
      }
      return results.join("\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/file-list.ts
import { readdir as readdir2, realpath as realpath5 } from "fs/promises";
import { join as join3, normalize as normalize5, relative as relative2, resolve as resolve5 } from "path";
import picomatch5 from "picomatch";
import { z as z10 } from "zod";
var SKIP_DIRS2 = /* @__PURE__ */ new Set(["node_modules", ".git", "dist"]);
var ListFilesInputSchema = z10.object({
  /** Glob pattern to filter which files to list. Defaults to all files. */
  glob: z10.string().optional().describe("Glob pattern to filter which files to list (default: **/*)"),
  /** Maximum number of file paths to return. Defaults to 200. */
  maxResults: z10.number().int().positive().optional().describe("Maximum number of file paths to return (default: 200)")
});
async function walkDirectory2(dir) {
  const entries = await readdir2(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS2.has(entry.name)) {
        continue;
      }
      const nested = await walkDirectory2(join3(dir, entry.name));
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(join3(dir, entry.name));
    }
  }
  return files;
}
var listFilesTool = {
  name: "list_files",
  description: "List files in the workspace matching a glob pattern. Returns relative file paths, one per line. Skips node_modules, .git, and dist directories.",
  inputSchema: ListFilesInputSchema,
  async execute(input, context) {
    try {
      const { glob: globPattern = "**/*", maxResults = 200 } = ListFilesInputSchema.parse(input);
      const workspaceRoot = normalize5(resolve5(context.workspacePath));
      const realWorkspace = await realpath5(workspaceRoot);
      const isGlobMatch = picomatch5(globPattern);
      const allFiles = await walkDirectory2(realWorkspace);
      const matched = [];
      let totalMatches = 0;
      for (const absolutePath of allFiles) {
        const rel = relative2(realWorkspace, absolutePath);
        if (!isGlobMatch(rel)) {
          continue;
        }
        const realFile = await realpath5(absolutePath);
        if (!realFile.startsWith(realWorkspace + "/") && realFile !== realWorkspace) {
          continue;
        }
        totalMatches++;
        if (matched.length < maxResults) {
          matched.push(rel);
        }
      }
      if (totalMatches === 0) {
        return "No files found matching the pattern";
      }
      let result = matched.join("\n");
      if (totalMatches > maxResults) {
        result += `

(Showing ${String(maxResults)} of ${String(totalMatches)} matching files)`;
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/shell-exec.ts
import { exec } from "child_process";
import { realpath as realpath6 } from "fs/promises";
import { normalize as normalize6, resolve as resolve6 } from "path";
import { z as z11 } from "zod";
var DEFAULT_TIMEOUT_MS = 3e4;
var MAX_BUFFER_BYTES = 1024 * 1024;
var ShellExecInputSchema = z11.object({
  /** Shell command to execute within the workspace. */
  command: z11.string().describe("Shell command to execute within the workspace"),
  /** Max execution time in milliseconds (default 30000). */
  timeout: z11.number().int().positive().optional().describe("Max execution time in milliseconds (default 30000)")
});
var DANGEROUS_PATTERNS = [
  [/\.\.[\\/]/, "path traversal (../)"],
  [/\/etc(\/|$)/, "access to /etc"],
  [/\/root(\/|$)/, "access to /root"],
  [/\/proc(\/|$)/, "access to /proc"],
  [/\/sys(\/|$)/, "access to /sys"],
  [/\/dev(\/|$)/, "access to /dev"],
  [/\/var(\/|$)/, "access to /var"],
  [/\/tmp(\/|$)/, "access to /tmp"],
  [/~\//, "home directory expansion (~/)"],
  [/\bcd\s+\//, "directory escape (cd /)"]
];
function detectDangerousPattern(command) {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return null;
}
var shellExecTool = {
  name: "exec_command",
  description: "Execute a shell command within the workspace directory. The command is sandboxed to the project workspace \u2014 path traversal and access to system directories are rejected. Returns the combined stdout and stderr output, or an error message on failure.",
  inputSchema: ShellExecInputSchema,
  async execute(input, context) {
    try {
      const { command, timeout } = ShellExecInputSchema.parse(input);
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;
      if (command.trim().length === 0) {
        return "Error: command must not be empty";
      }
      const danger = detectDangerousPattern(command);
      if (danger !== null) {
        return `Error: command rejected \u2014 ${danger}`;
      }
      const workspaceRoot = normalize6(resolve6(context.workspacePath));
      let realWorkspace;
      try {
        realWorkspace = await realpath6(workspaceRoot);
      } catch {
        return `Error: workspace path does not exist \u2014 ${context.workspacePath}`;
      }
      if (!realWorkspace.startsWith(workspaceRoot) && realWorkspace !== workspaceRoot) {
        return "Error: workspace path resolves outside expected location via symlink";
      }
      return await new Promise((resolvePromise) => {
        exec(
          command,
          {
            cwd: realWorkspace,
            timeout: timeoutMs,
            maxBuffer: MAX_BUFFER_BYTES,
            env: { ...process.env, HOME: realWorkspace }
          },
          (error, stdout, stderr) => {
            const output = combineOutput(stdout, stderr);
            if (error !== null) {
              if (error.killed) {
                resolvePromise(
                  `Error: command timed out after ${String(timeoutMs)}ms` + (output.length > 0 ? `
${output}` : "")
                );
                return;
              }
              resolvePromise(
                `Error: command exited with code ${String(error.code ?? 1)}` + (output.length > 0 ? `
${output}` : "")
              );
              return;
            }
            resolvePromise(output.length > 0 ? output : "(no output)");
          }
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};
function combineOutput(stdout, stderr) {
  const parts = [];
  const out = stdout.trim();
  const err = stderr.trim();
  if (out.length > 0) parts.push(out);
  if (err.length > 0) parts.push(err);
  return parts.join("\n");
}

// src/tools/memory-read.ts
import { readFile as readFile4 } from "fs/promises";
import { join as join4 } from "path";
import { z as z12 } from "zod";
var SHARED_MEMORY_DIR = ".loomflo/shared-memory";
var ReadMemoryInputSchema = z12.object({
  /** Name of the shared memory file to read (e.g. "DECISIONS.md"). */
  name: z12.string().describe('Name of the shared memory file (e.g. "DECISIONS.md")')
});
var memoryReadTool = {
  name: "read_memory",
  description: 'Read a shared memory file from the workspace. Provide the file name (e.g. "DECISIONS.md", "PROGRESS.md"). Returns the file content as a string, or an error message if the file cannot be read.',
  inputSchema: ReadMemoryInputSchema,
  async execute(input, context) {
    try {
      const { name } = ReadMemoryInputSchema.parse(input);
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        return `Error: invalid memory file name "${name}" \u2014 must not contain path separators or ".."`;
      }
      const filePath = join4(context.workspacePath, SHARED_MEMORY_DIR, name);
      let content;
      try {
        content = await readFile4(filePath, "utf-8");
      } catch {
        return `Error: shared memory file not found \u2014 ${name}`;
      }
      return content;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/memory-write.ts
import { appendFile, mkdir as mkdir3 } from "fs/promises";
import { join as join5 } from "path";
import { z as z13 } from "zod";
var SHARED_MEMORY_DIR2 = ".loomflo/shared-memory";
var WriteMemoryInputSchema = z13.object({
  /** Name of the shared memory file to write to (e.g. "DECISIONS.md"). */
  name: z13.string().describe('Name of the shared memory file (e.g. "DECISIONS.md")'),
  /** Text content to append to the memory file. */
  content: z13.string().describe("Text content to append to the shared memory file")
});
function buildEntryHeader(agentId) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  return `
---
_[${timestamp}] written by ${agentId}_

`;
}
var memoryWriteTool = {
  name: "write_memory",
  description: 'Append content to a shared memory file in the workspace. Provide the file name (e.g. "DECISIONS.md", "PROGRESS.md") and the text content to append. The content is appended with a timestamp and agent ID header for traceability. Returns a success confirmation or an error message.',
  inputSchema: WriteMemoryInputSchema,
  async execute(input, context) {
    try {
      const { name, content } = WriteMemoryInputSchema.parse(input);
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        return `Error: invalid memory file name "${name}" \u2014 must not contain path separators or ".."`;
      }
      const dirPath = join5(context.workspacePath, SHARED_MEMORY_DIR2);
      const filePath = join5(dirPath, name);
      try {
        await mkdir3(dirPath, { recursive: true });
      } catch {
        return `Error: failed to create shared memory directory at ${dirPath}`;
      }
      const entry = buildEntryHeader(context.agentId) + content + "\n";
      try {
        await appendFile(filePath, entry, "utf-8");
      } catch {
        return `Error: failed to write to shared memory file \u2014 ${name}`;
      }
      return `Successfully appended to ${name}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  }
};

// src/tools/escalate.ts
import { z as z14 } from "zod";
var EscalateInputSchema = z14.object({
  /** Reason why the escalation is needed. */
  reason: z14.string().describe("Why the escalation is needed"),
  /** Optional suggestion for how Loom might resolve the issue. */
  suggestedAction: z14.enum(["add_node", "modify_node", "remove_node", "skip_node"]).optional().describe(
    'Optional suggestion for how the architect should handle it: "add_node", "modify_node", "remove_node", or "skip_node"'
  ),
  /** Additional context about the failure. */
  details: z14.string().optional().describe("Additional context about the failure or blockage")
});
function createEscalateTool(handler) {
  return {
    name: "escalate",
    description: "Request graph modifications from the architect (Loom) when a node is BLOCKED or has exhausted all retries. Provide a reason explaining why escalation is needed, an optional suggested action, and optional details about the failure. This tool should be called when the orchestrator cannot resolve the issue on its own.",
    inputSchema: EscalateInputSchema,
    async execute(input, context) {
      try {
        const parsed = EscalateInputSchema.parse(input);
        const request = {
          reason: parsed.reason,
          nodeId: context.nodeId,
          agentId: context.agentId,
          suggestedAction: parsed.suggestedAction,
          details: parsed.details
        };
        try {
          await handler.escalate(request);
        } catch {
          return `Error: failed to escalate for node "${context.nodeId}" \u2014 the handler rejected the escalation request`;
        }
        return `Escalation submitted \u2014 agent: ${context.agentId}, node: ${context.nodeId}, reason: ${parsed.reason}` + (parsed.suggestedAction ? `, suggested: ${parsed.suggestedAction}` : "");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    }
  };
}

// src/costs/rate-limiter.ts
var RateLimiter = class {
  maxTokens;
  refillRatePerMs;
  buckets = /* @__PURE__ */ new Map();
  /**
   * Creates a new RateLimiter instance.
   *
   * @param maxCallsPerMinute - Maximum LLM API calls allowed per minute per agent.
   *   Defaults to 60 (matching config.apiRateLimit default).
   */
  constructor(maxCallsPerMinute = 60) {
    this.maxTokens = maxCallsPerMinute;
    this.refillRatePerMs = maxCallsPerMinute / 6e4;
  }
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
  acquireOrReject(agentId) {
    const now = Date.now();
    let bucket = this.buckets.get(agentId);
    if (bucket === void 0) {
      bucket = { tokens: this.maxTokens, lastRefillTime: now };
      this.buckets.set(agentId, bucket);
    }
    const elapsed = now - bucket.lastRefillTime;
    if (elapsed > 0) {
      const refill = elapsed * this.refillRatePerMs;
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refill);
      bucket.lastRefillTime = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit / this.refillRatePerMs);
    return { allowed: false, retryAfterMs };
  }
  /**
   * Clears rate limit state for a specific agent.
   *
   * Should be called when an agent's lifecycle ends to free resources.
   *
   * @param agentId - Unique identifier of the agent to clear.
   */
  reset(agentId) {
    this.buckets.delete(agentId);
  }
  /**
   * Clears rate limit state for all agents.
   *
   * Should be called when a workflow completes or is reset.
   */
  resetAll() {
    this.buckets.clear();
  }
};

// src/memory/shared-memory.ts
import { appendFile as appendFile2, mkdir as mkdir4, readFile as readFile5, readdir as readdir3, stat, writeFile as writeFile4 } from "fs/promises";
import { join as join6 } from "path";
import { Mutex } from "async-mutex";
var SHARED_MEMORY_DIR3 = ".loomflo/shared-memory";
var ENTRY_HEADER_REGEX = /_\[(.+?)\] written by (.+?)_/g;
var STANDARD_MEMORY_FILES = [
  "DECISIONS.md",
  "ERRORS.md",
  "PROGRESS.md",
  "PREFERENCES.md",
  "ISSUES.md",
  "INSIGHTS.md",
  "ARCHITECTURE_CHANGES.md"
];
function validateFileName(name) {
  if (!name.endsWith(".md")) {
    throw new Error(`Invalid memory file name "${name}" \u2014 must end in .md`);
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid memory file name "${name}" \u2014 must not contain path separators`);
  }
  if (name.includes("..")) {
    throw new Error(`Invalid memory file name "${name}" \u2014 must not contain ".." segments`);
  }
}
var SharedMemoryManager = class {
  memoryDir;
  mutexes = /* @__PURE__ */ new Map();
  /**
   * Creates a new SharedMemoryManager instance.
   *
   * @param workspacePath - Absolute path to the project workspace root.
   */
  constructor(workspacePath) {
    this.memoryDir = join6(workspacePath, SHARED_MEMORY_DIR3);
  }
  /**
   * Initializes the shared memory directory and standard files.
   *
   * Creates the `.loomflo/shared-memory/` directory if it does not exist,
   * then creates each standard file with a title header if it is missing.
   * This operation is idempotent — existing files are not overwritten.
   */
  async initialize() {
    await mkdir4(this.memoryDir, { recursive: true });
    for (const fileName of STANDARD_MEMORY_FILES) {
      const filePath = join6(this.memoryDir, fileName);
      try {
        await stat(filePath);
      } catch {
        const title = fileName.replace(".md", "");
        await writeFile4(filePath, `# ${title}

`, "utf-8");
      }
    }
  }
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
  async read(name) {
    validateFileName(name);
    const filePath = join6(this.memoryDir, name);
    let content;
    let fileStat;
    try {
      [content, fileStat] = await Promise.all([
        readFile5(filePath, "utf-8"),
        stat(filePath)
      ]);
    } catch {
      throw new Error(`Shared memory file not found: ${name}`);
    }
    const { lastModifiedBy, lastModifiedAt } = this.parseLastEntry(content, fileStat.mtime);
    return {
      name,
      path: filePath,
      content,
      lastModifiedBy,
      lastModifiedAt
    };
  }
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
  async write(name, content, agentId) {
    validateFileName(name);
    const filePath = join6(this.memoryDir, name);
    const mutex = this.getMutex(name);
    await mutex.runExclusive(async () => {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      const entry = `
---
_[${timestamp}] written by ${agentId}_

${content}
`;
      await appendFile2(filePath, entry, "utf-8");
    });
  }
  /**
   * Lists all shared memory files with their content and metadata.
   *
   * Reads every `.md` file in the shared memory directory and returns
   * an array of {@link SharedMemoryFile} objects. Files that cannot be
   * read are silently skipped.
   *
   * @returns Array of all shared memory files with content and metadata.
   */
  async list() {
    let entries;
    try {
      entries = await readdir3(this.memoryDir);
    } catch {
      return [];
    }
    const mdFiles = entries.filter((e) => e.endsWith(".md"));
    const results = [];
    for (const fileName of mdFiles) {
      try {
        results.push(await this.read(fileName));
      } catch {
      }
    }
    return results;
  }
  /**
   * Returns the names of the 7 standard shared memory files.
   *
   * @returns Array of standard file names.
   */
  getStandardFiles() {
    return [...STANDARD_MEMORY_FILES];
  }
  // ==========================================================================
  // Private Helpers
  // ==========================================================================
  /**
   * Returns the mutex for a given file, creating one if it does not exist.
   */
  getMutex(name) {
    let mutex = this.mutexes.get(name);
    if (mutex === void 0) {
      mutex = new Mutex();
      this.mutexes.set(name, mutex);
    }
    return mutex;
  }
  /**
   * Parses file content for the last entry header to extract metadata.
   *
   * Falls back to file system mtime and "system" agent if no entry
   * headers are found (freshly initialized file).
   */
  parseLastEntry(content, mtime) {
    const matches = [...content.matchAll(ENTRY_HEADER_REGEX)];
    const lastMatch = matches.at(-1);
    if (lastMatch !== void 0) {
      return {
        lastModifiedAt: lastMatch[1] ?? mtime.toISOString(),
        lastModifiedBy: lastMatch[2] ?? "system"
      };
    }
    return {
      lastModifiedBy: "system",
      lastModifiedAt: mtime.toISOString()
    };
  }
};

// src/workflow/file-ownership.ts
import { randomUUID as randomUUID3 } from "crypto";
import picomatch6 from "picomatch";
function isLockProtocolMessage(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed["protocol"] === "file_lock";
  } catch {
    return false;
  }
}
function parseLockProtocolMessage(content) {
  try {
    const parsed = JSON.parse(content);
    if (parsed["protocol"] !== "file_lock") return null;
    const action = parsed["action"];
    if (action !== "lock_request" && action !== "lock_grant" && action !== "lock_denied" && action !== "lock_release") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function createLockRequest(targetPattern, reason) {
  const msg = {
    protocol: "file_lock",
    action: "lock_request",
    targetPattern,
    reason
  };
  return JSON.stringify(msg);
}
function createLockGrant(lock) {
  const msg = {
    protocol: "file_lock",
    action: "lock_grant",
    lockId: lock.id,
    patterns: [...lock.patterns],
    expiresAt: lock.expiresAt
  };
  return JSON.stringify(msg);
}
function createLockDenied(targetPattern, reason) {
  const msg = {
    protocol: "file_lock",
    action: "lock_denied",
    targetPattern,
    reason
  };
  return JSON.stringify(msg);
}
function createLockRelease(lockId) {
  const msg = {
    protocol: "file_lock",
    action: "lock_release",
    lockId
  };
  return JSON.stringify(msg);
}
var DEFAULT_LOCK_DURATION_MS = 5 * 60 * 1e3;
var FileOwnershipManager = class _FileOwnershipManager {
  /** Permanent scope assignments: agent ID → mutable glob pattern array. */
  scopes;
  /** Active temporary locks keyed by lock ID. */
  locks;
  /**
   * Creates a FileOwnershipManager with initial permanent scope assignments.
   *
   * @param scopes - Initial scope map (agent ID → glob patterns). Defaults to empty.
   */
  constructor(scopes = {}) {
    this.scopes = new Map(
      Object.entries(scopes).map(([k, v]) => [k, [...v]])
    );
    this.locks = /* @__PURE__ */ new Map();
  }
  // ==========================================================================
  // Scope Management
  // ==========================================================================
  /**
   * Assigns permanent write scope patterns to an agent.
   *
   * Replaces any existing scope for the agent. Call {@link validateNoOverlap}
   * after modifying scopes to verify the non-overlap invariant.
   *
   * @param agentId - Agent to assign the scope to.
   * @param patterns - Glob patterns defining the agent's write scope.
   */
  setScope(agentId, patterns) {
    this.scopes.set(agentId, [...patterns]);
  }
  /**
   * Returns the permanent write scope patterns for an agent.
   *
   * @param agentId - Agent whose scope to retrieve.
   * @returns Read-only array of glob patterns (empty if no scope assigned).
   */
  getScope(agentId) {
    return this.scopes.get(agentId) ?? [];
  }
  /**
   * Removes the permanent write scope for an agent.
   *
   * Does not affect any active temporary locks held by the agent.
   *
   * @param agentId - Agent whose scope to remove.
   */
  removeScope(agentId) {
    this.scopes.delete(agentId);
  }
  /**
   * Returns all permanent scope assignments as a plain record.
   *
   * @returns A defensive copy of all scope assignments.
   */
  getAllScopes() {
    const result = {};
    for (const [k, v] of this.scopes) {
      result[k] = [...v];
    }
    return result;
  }
  // ==========================================================================
  // Non-Overlap Validation
  // ==========================================================================
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
  validateNoOverlap() {
    const overlaps = [];
    const entries = Array.from(this.scopes.entries());
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const entryA = entries[i];
        const entryB = entries[j];
        if (!entryA || !entryB) continue;
        const [idA, patternsA] = entryA;
        const [idB, patternsB] = entryB;
        if (patternsA.length === 0 || patternsB.length === 0) continue;
        const matcherA = picomatch6(patternsA);
        const matcherB = picomatch6(patternsB);
        const testPaths = generateTestPaths2([...patternsA, ...patternsB]);
        for (const testPath of testPaths) {
          if (matcherA(testPath) && matcherB(testPath)) {
            overlaps.push(
              `Agents "${idA}" and "${idB}" both match "${testPath}"`
            );
            break;
          }
        }
      }
    }
    return { valid: overlaps.length === 0, overlaps };
  }
  // ==========================================================================
  // Temporary Locks
  // ==========================================================================
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
  grantTemporaryLock(agentId, patterns, durationMs = DEFAULT_LOCK_DURATION_MS, grantedBy) {
    const now = /* @__PURE__ */ new Date();
    const lock = {
      id: randomUUID3(),
      agentId,
      patterns: [...patterns],
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMs).toISOString(),
      grantedBy
    };
    this.locks.set(lock.id, lock);
    return lock;
  }
  /**
   * Explicitly releases a temporary lock before its expiry.
   *
   * @param lockId - ID of the lock to release.
   * @returns `true` if the lock existed and was removed, `false` otherwise.
   */
  releaseTemporaryLock(lockId) {
    return this.locks.delete(lockId);
  }
  /**
   * Returns all active (non-expired) temporary locks, optionally filtered
   * by agent ID.
   *
   * @param agentId - If provided, only return locks for this agent.
   * @returns Read-only array of active temporary locks.
   */
  getActiveLocks(agentId) {
    const now = Date.now();
    const active = [];
    for (const lock of this.locks.values()) {
      if (new Date(lock.expiresAt).getTime() > now) {
        if (agentId === void 0 || lock.agentId === agentId) {
          active.push(lock);
        }
      }
    }
    return active;
  }
  /**
   * Removes all expired temporary locks from the internal store.
   *
   * @returns The number of locks pruned.
   */
  pruneExpiredLocks() {
    const now = Date.now();
    let count = 0;
    for (const [id, lock] of this.locks) {
      if (new Date(lock.expiresAt).getTime() <= now) {
        this.locks.delete(id);
        count++;
      }
    }
    return count;
  }
  // ==========================================================================
  // Combined Write Permission Check
  // ==========================================================================
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
  isWriteAllowed(agentId, filePath) {
    const scope = this.scopes.get(agentId);
    if (scope && scope.length > 0 && picomatch6.isMatch(filePath, scope)) {
      return true;
    }
    const now = Date.now();
    for (const lock of this.locks.values()) {
      if (lock.agentId === agentId && new Date(lock.expiresAt).getTime() > now && picomatch6.isMatch(filePath, [...lock.patterns])) {
        return true;
      }
    }
    return false;
  }
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
  getEffectiveScope(agentId) {
    const patterns = [];
    const scope = this.scopes.get(agentId);
    if (scope) {
      patterns.push(...scope);
    }
    const now = Date.now();
    for (const lock of this.locks.values()) {
      if (lock.agentId === agentId && new Date(lock.expiresAt).getTime() > now) {
        patterns.push(...lock.patterns);
      }
    }
    return patterns;
  }
  // ==========================================================================
  // Serialization
  // ==========================================================================
  /**
   * Serializes the ownership state to a plain object for persistence.
   *
   * Includes all temporary locks (even expired ones) so the caller can
   * decide whether to prune before persisting.
   *
   * @returns A defensive copy of the ownership state.
   */
  toJSON() {
    return {
      scopes: this.getAllScopes(),
      temporaryLocks: Array.from(this.locks.values()).map((l) => ({
        ...l,
        patterns: [...l.patterns]
      }))
    };
  }
  /**
   * Restores a FileOwnershipManager from a persisted state snapshot.
   *
   * @param state - The serialized state to restore from.
   * @returns A new FileOwnershipManager with the restored state.
   */
  static fromJSON(state) {
    const manager = new _FileOwnershipManager(state.scopes);
    for (const lock of state.temporaryLocks) {
      manager.locks.set(lock.id, {
        ...lock,
        patterns: [...lock.patterns]
      });
    }
    return manager;
  }
};
function generateTestPaths2(patterns) {
  const paths = /* @__PURE__ */ new Set();
  for (const pattern of patterns) {
    let path = pattern.replace(/\*\*/g, "a/b");
    path = path.replace(/\*/g, "test.file");
    path = path.replace(/\{([^}]+)\}/g, (_match, group) => {
      const first = group.split(",")[0];
      return first ?? "x";
    });
    path = path.replace(/\?/g, "x");
    paths.add(path);
  }
  return Array.from(paths);
}

// src/workflow/graph.ts
var WorkflowGraph = class _WorkflowGraph {
  nodes;
  edgeList;
  /**
   * Creates a new WorkflowGraph instance.
   *
   * @param nodes - Initial nodes as a Map or plain record, or omit for an empty graph.
   * @param edges - Initial directed edges, or omit for an empty edge list.
   */
  constructor(nodes, edges) {
    if (nodes instanceof Map) {
      this.nodes = new Map(nodes);
    } else if (nodes) {
      this.nodes = new Map(Object.entries(nodes));
    } else {
      this.nodes = /* @__PURE__ */ new Map();
    }
    this.edgeList = edges ? [...edges] : [];
  }
  /**
   * Returns the number of nodes in the graph.
   *
   * @returns Node count.
   */
  get size() {
    return this.nodes.size;
  }
  /**
   * Adds a node to the graph.
   *
   * @param node - The node to add.
   * @throws Error if a node with the same ID already exists.
   */
  addNode(node) {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists`);
    }
    this.nodes.set(node.id, node);
  }
  /**
   * Removes a node and all edges connected to it.
   *
   * @param nodeId - ID of the node to remove.
   * @throws Error if the node does not exist.
   */
  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node "${nodeId}" not found`);
    }
    this.nodes.delete(nodeId);
    for (let i = this.edgeList.length - 1; i >= 0; i--) {
      const edge = this.edgeList[i];
      if (edge && (edge.from === nodeId || edge.to === nodeId)) {
        this.edgeList.splice(i, 1);
      }
    }
  }
  /**
   * Retrieves a node by ID.
   *
   * @param nodeId - ID of the node to retrieve.
   * @returns The node, or undefined if not found.
   */
  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }
  /**
   * Updates a node's properties by merging partial updates.
   *
   * The node ID cannot be changed via this method.
   *
   * @param nodeId - ID of the node to update.
   * @param updates - Partial node properties to merge.
   * @throws Error if the node does not exist.
   */
  updateNode(nodeId, updates) {
    const existing = this.nodes.get(nodeId);
    if (!existing) {
      throw new Error(`Node "${nodeId}" not found`);
    }
    this.nodes.set(nodeId, { ...existing, ...updates, id: nodeId });
  }
  /**
   * Adds a directed edge between two existing nodes.
   *
   * Rejects self-loops, duplicate edges, references to missing nodes,
   * and edges that would create a cycle.
   *
   * @param edge - The directed edge to add.
   * @throws Error if the edge is invalid or would create a cycle.
   */
  addEdge(edge) {
    if (!this.nodes.has(edge.from)) {
      throw new Error(`Source node "${edge.from}" not found`);
    }
    if (!this.nodes.has(edge.to)) {
      throw new Error(`Target node "${edge.to}" not found`);
    }
    if (edge.from === edge.to) {
      throw new Error(
        `Self-loop detected: "${edge.from}" cannot connect to itself`
      );
    }
    const duplicate = this.edgeList.some(
      (e) => e.from === edge.from && e.to === edge.to
    );
    if (duplicate) {
      throw new Error(`Edge "${edge.from}" \u2192 "${edge.to}" already exists`);
    }
    this.edgeList.push(edge);
    if (this.detectCycles()) {
      this.edgeList.pop();
      throw new Error(
        `Adding edge "${edge.from}" \u2192 "${edge.to}" would create a cycle`
      );
    }
  }
  /**
   * Removes a directed edge.
   *
   * @param from - Source node ID.
   * @param to - Target node ID.
   * @throws Error if the edge does not exist.
   */
  removeEdge(from, to) {
    const index = this.edgeList.findIndex(
      (e) => e.from === from && e.to === to
    );
    if (index === -1) {
      throw new Error(`Edge "${from}" \u2192 "${to}" not found`);
    }
    this.edgeList.splice(index, 1);
  }
  /**
   * Returns a copy of all directed edges.
   *
   * @returns Array of edges.
   */
  getEdges() {
    return [...this.edgeList];
  }
  /**
   * Returns the IDs of all successor nodes (outgoing edges).
   *
   * @param nodeId - ID of the node to query.
   * @returns Array of successor node IDs.
   */
  getSuccessors(nodeId) {
    return this.edgeList.filter((e) => e.from === nodeId).map((e) => e.to);
  }
  /**
   * Returns the IDs of all predecessor nodes (incoming edges).
   *
   * @param nodeId - ID of the node to query.
   * @returns Array of predecessor node IDs.
   */
  getPredecessors(nodeId) {
    return this.edgeList.filter((e) => e.to === nodeId).map((e) => e.from);
  }
  /**
   * Detects whether the graph contains any cycles using DFS coloring.
   *
   * Uses a three-color algorithm: white (unvisited), gray (in current
   * DFS stack), black (fully processed). A back-edge to a gray node
   * indicates a cycle.
   *
   * @returns `true` if the graph contains at least one cycle, `false` otherwise.
   */
  detectCycles() {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = /* @__PURE__ */ new Map();
    for (const id of this.nodes.keys()) {
      color.set(id, WHITE);
    }
    const dfs = (nodeId) => {
      color.set(nodeId, GRAY);
      for (const successor of this.getSuccessors(nodeId)) {
        const c = color.get(successor);
        if (c === GRAY) return true;
        if (c === WHITE && dfs(successor)) return true;
      }
      color.set(nodeId, BLACK);
      return false;
    };
    for (const id of this.nodes.keys()) {
      if (color.get(id) === WHITE && dfs(id)) {
        return true;
      }
    }
    return false;
  }
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
  validateDAG() {
    const errors = [];
    if (this.nodes.size === 0) {
      return { valid: true, errors: [] };
    }
    if (this.detectCycles()) {
      errors.push("Graph contains one or more cycles");
    }
    const sourceNodes = [];
    for (const nodeId of this.nodes.keys()) {
      const predecessors = this.getPredecessors(nodeId);
      const successors = this.getSuccessors(nodeId);
      if (predecessors.length === 0 && successors.length === 0 && this.nodes.size > 1) {
        errors.push(
          `Node "${nodeId}" is an orphan (no incoming or outgoing edges)`
        );
      }
      if (predecessors.length === 0) {
        sourceNodes.push(nodeId);
      }
    }
    if (sourceNodes.length > 1) {
      errors.push(
        `Multiple source nodes found: ${sourceNodes.join(", ")}. Only one entry point is allowed`
      );
    }
    return { valid: errors.length === 0, errors };
  }
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
  detectTopology() {
    let hasDivergent = false;
    let hasConvergent = false;
    for (const nodeId of this.nodes.keys()) {
      if (this.getSuccessors(nodeId).length > 1) {
        hasDivergent = true;
      }
      if (this.getPredecessors(nodeId).length > 1) {
        hasConvergent = true;
      }
      if (hasDivergent && hasConvergent) {
        return "mixed";
      }
    }
    if (hasDivergent) return "tree";
    if (hasConvergent) return "convergent";
    return "linear";
  }
  /**
   * Returns a topological sort of node IDs using Kahn's algorithm.
   *
   * The returned order guarantees that for every edge (u → v), u appears
   * before v. Throws if the graph contains a cycle.
   *
   * @returns Array of node IDs in execution order.
   * @throws Error if the graph contains a cycle.
   */
  getExecutionOrder() {
    const inDegree = /* @__PURE__ */ new Map();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }
    for (const edge of this.edgeList) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
    const queue = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }
    const order = [];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (nodeId === void 0) break;
      order.push(nodeId);
      for (const successor of this.getSuccessors(nodeId)) {
        const newDegree = (inDegree.get(successor) ?? 1) - 1;
        inDegree.set(successor, newDegree);
        if (newDegree === 0) {
          queue.push(successor);
        }
      }
    }
    if (order.length !== this.nodes.size) {
      throw new Error(
        "Cannot determine execution order: graph contains a cycle"
      );
    }
    return order;
  }
  /**
   * Serializes the graph to the {@link Graph} schema format.
   *
   * Topology is re-detected from the current structure.
   *
   * @returns A plain object matching the GraphSchema.
   */
  toJSON() {
    return {
      nodes: Object.fromEntries(this.nodes),
      edges: [...this.edgeList],
      topology: this.detectTopology()
    };
  }
  /**
   * Deserializes a {@link Graph} schema object into a WorkflowGraph instance.
   *
   * @param data - A plain object matching the GraphSchema.
   * @returns A new WorkflowGraph instance.
   */
  static fromJSON(data) {
    return new _WorkflowGraph(data.nodes, data.edges);
  }
};

// src/workflow/node.ts
import picomatch7 from "picomatch";
var TRANSITIONS = {
  pending: ["waiting"],
  waiting: ["running"],
  running: ["review", "done", "failed", "blocked"],
  review: ["done", "running", "blocked", "failed"],
  done: [],
  failed: [],
  blocked: []
};
var WorkflowNode = class _WorkflowNode {
  data;
  /**
   * Creates a WorkflowNode from existing node data.
   *
   * @param data - A plain {@link Node} object to wrap.
   */
  constructor(data) {
    this.data = { ...data, agents: [...data.agents] };
  }
  /** The node's unique identifier. */
  get id() {
    return this.data.id;
  }
  /** The node's human-readable title. */
  get title() {
    return this.data.title;
  }
  /** The current lifecycle status. */
  get status() {
    return this.data.status;
  }
  /** The number of retry cycles attempted so far. */
  get retryCount() {
    return this.data.retryCount;
  }
  /** The maximum allowed retry cycles. */
  get maxRetries() {
    return this.data.maxRetries;
  }
  /** The current review report, or null. */
  get reviewReport() {
    return this.data.reviewReport;
  }
  /** The agents assigned to this node. */
  get agents() {
    return this.data.agents;
  }
  /** The file ownership map (agent ID to glob patterns). */
  get fileOwnership() {
    return this.data.fileOwnership;
  }
  /**
   * Checks whether a transition to the given status is valid.
   *
   * @param to - The target status to check.
   * @returns `true` if the transition is allowed, `false` otherwise.
   */
  canTransition(to) {
    return TRANSITIONS[this.data.status].includes(to);
  }
  /**
   * Returns all valid next states from the current status.
   *
   * @returns Array of valid target statuses.
   */
  getValidTransitions() {
    return [...TRANSITIONS[this.data.status]];
  }
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
  transition(to) {
    if (!this.canTransition(to)) {
      throw new Error(
        `Invalid transition: "${this.data.status}" \u2192 "${to}". Valid transitions: ${TRANSITIONS[this.data.status].join(", ") || "none"}`
      );
    }
    this.data.status = to;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (to === "running" && this.data.startedAt === null) {
      this.data.startedAt = now;
    }
    if (to === "done" || to === "failed" || to === "blocked") {
      this.data.completedAt = now;
    }
  }
  /**
   * Increments the retry count by one.
   *
   * @throws Error if retryCount would exceed maxRetries.
   */
  incrementRetry() {
    if (this.data.retryCount >= this.data.maxRetries) {
      throw new Error(
        `Cannot increment retry: count (${String(this.data.retryCount)}) already at or above max (${String(this.data.maxRetries)})`
      );
    }
    this.data.retryCount += 1;
  }
  /**
   * Sets the review report for this node.
   *
   * @param report - The structured review report from Loomex.
   */
  setReviewReport(report) {
    this.data.reviewReport = report;
  }
  /**
   * Updates an existing agent's properties by merging partial updates.
   *
   * The agent ID cannot be changed via this method.
   *
   * @param agentId - ID of the agent to update.
   * @param updates - Partial agent properties to merge.
   * @throws Error if the agent is not found.
   */
  updateAgent(agentId, updates) {
    const index = this.data.agents.findIndex((a) => a.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found in node "${this.data.id}"`);
    }
    const existing = this.data.agents[index];
    if (!existing) {
      throw new Error(`Agent "${agentId}" not found in node "${this.data.id}"`);
    }
    this.data.agents[index] = { ...existing, ...updates, id: agentId };
  }
  /**
   * Adds an agent to this node.
   *
   * @param agent - The agent metadata to add.
   * @throws Error if an agent with the same ID already exists.
   */
  addAgent(agent) {
    if (this.data.agents.some((a) => a.id === agent.id)) {
      throw new Error(
        `Agent "${agent.id}" already exists in node "${this.data.id}"`
      );
    }
    this.data.agents.push(agent);
  }
  /**
   * Removes an agent from this node.
   *
   * Also removes any file ownership entries for the agent.
   *
   * @param agentId - ID of the agent to remove.
   * @throws Error if the agent is not found.
   */
  removeAgent(agentId) {
    const index = this.data.agents.findIndex((a) => a.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found in node "${this.data.id}"`);
    }
    this.data.agents.splice(index, 1);
    delete this.data.fileOwnership[agentId];
  }
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
  validateWriteScope(agentId, filePath) {
    const patterns = this.data.fileOwnership[agentId];
    if (!patterns || patterns.length === 0) {
      return false;
    }
    return picomatch7.isMatch(filePath, patterns);
  }
  /**
   * Assigns file ownership glob patterns to an agent.
   *
   * @param agentId - The agent to assign ownership to.
   * @param patterns - Glob patterns defining the agent's write scope.
   * @throws Error if the agent is not assigned to this node.
   */
  setFileOwnership(agentId, patterns) {
    if (!this.data.agents.some((a) => a.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found in node "${this.data.id}"`);
    }
    this.data.fileOwnership[agentId] = [...patterns];
  }
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
  validateNoOverlap() {
    const overlaps = [];
    const agentIds = Object.keys(this.data.fileOwnership);
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const idA = agentIds[i];
        const idB = agentIds[j];
        if (!idA || !idB) continue;
        const patternsA = this.data.fileOwnership[idA];
        const patternsB = this.data.fileOwnership[idB];
        if (!patternsA || !patternsB) continue;
        const matcherA = picomatch7(patternsA);
        const matcherB = picomatch7(patternsB);
        const testPaths = generateTestPaths2([...patternsA, ...patternsB]);
        for (const testPath of testPaths) {
          if (matcherA(testPath) && matcherB(testPath)) {
            overlaps.push(
              `Agents "${idA}" and "${idB}" both match "${testPath}"`
            );
            break;
          }
        }
      }
    }
    return { valid: overlaps.length === 0, overlaps };
  }
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
  createFileOwnershipManager() {
    return new FileOwnershipManager(this.data.fileOwnership);
  }
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
  applyFileOwnershipState(manager) {
    this.data.fileOwnership = manager.getAllScopes();
  }
  /**
   * Serializes the node to a plain {@link Node} object.
   *
   * @returns A copy of the underlying node data.
   */
  toJSON() {
    return {
      ...this.data,
      agents: this.data.agents.map((a) => ({ ...a })),
      fileOwnership: Object.fromEntries(
        Object.entries(this.data.fileOwnership).map(([k, v]) => [k, [...v]])
      )
    };
  }
  /**
   * Factory method to create a new WorkflowNode with sensible defaults.
   *
   * @param id - Unique node identifier.
   * @param title - Human-readable name for the node.
   * @param instructions - Markdown instructions for this node.
   * @param options - Optional overrides for delay, maxRetries, and agents.
   * @returns A new WorkflowNode in `pending` status.
   */
  static create(id, title, instructions, options) {
    return new _WorkflowNode({
      id,
      title,
      status: "pending",
      instructions,
      delay: options?.delay ?? "0",
      resumeAt: null,
      agents: options?.agents ?? [],
      fileOwnership: options?.fileOwnership ?? {},
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 3,
      reviewReport: null,
      cost: 0,
      startedAt: null,
      completedAt: null
    });
  }
};

// src/workflow/scheduler.ts
var DELAY_PATTERN = /^(\d+)([smhd])?$/;
var UNIT_MS = {
  s: 1e3,
  m: 6e4,
  h: 36e5,
  d: 864e5
};
function parseDelay(delay) {
  if (delay === void 0 || delay === "" || delay === "0") {
    return 0;
  }
  const match = DELAY_PATTERN.exec(delay);
  if (!match) {
    throw new Error(
      `Invalid delay format: "${delay}". Expected "0", "", or a number followed by s/m/h/d (e.g., "30s", "5m", "1h", "1d").`
    );
  }
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier = UNIT_MS[unit];
  if (multiplier === void 0) {
    throw new Error(`Unknown delay unit: "${unit}".`);
  }
  if (value === 0) {
    return 0;
  }
  return value * multiplier;
}
var Scheduler = class {
  entries = /* @__PURE__ */ new Map();
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
  scheduleNode(nodeId, delay, callback) {
    if (this.entries.has(nodeId)) {
      throw new Error(`Node "${nodeId}" is already scheduled.`);
    }
    const ms = parseDelay(delay);
    if (ms === 0) {
      callback();
      return;
    }
    const resumeAt = new Date(Date.now() + ms).toISOString();
    const timer = setTimeout(() => {
      this.entries.delete(nodeId);
      callback();
    }, ms);
    this.entries.set(nodeId, { timer, resumeAt, callback });
  }
  /**
   * Cancels a pending timer for a node.
   *
   * @param nodeId - Unique identifier of the node to cancel.
   * @throws Error if the node is not currently scheduled.
   */
  cancelNode(nodeId) {
    const entry = this.entries.get(nodeId);
    if (!entry) {
      throw new Error(`Node "${nodeId}" is not scheduled.`);
    }
    clearTimeout(entry.timer);
    this.entries.delete(nodeId);
  }
  /**
   * Returns the ISO 8601 resumeAt timestamp for a scheduled node.
   *
   * @param nodeId - Unique identifier of the node.
   * @returns The ISO 8601 timestamp when the delay expires, or `null` if not scheduled.
   */
  getResumeAt(nodeId) {
    return this.entries.get(nodeId)?.resumeAt ?? null;
  }
  /**
   * Returns the remaining time in milliseconds for a scheduled node.
   *
   * @param nodeId - Unique identifier of the node.
   * @returns Remaining milliseconds until the delay expires, or `0` if not scheduled or past due.
   */
  getRemainingMs(nodeId) {
    const entry = this.entries.get(nodeId);
    if (!entry) {
      return 0;
    }
    const remaining = new Date(entry.resumeAt).getTime() - Date.now();
    return Math.max(0, remaining);
  }
  /**
   * Checks whether a node has a pending timer.
   *
   * @param nodeId - Unique identifier of the node.
   * @returns `true` if the node is currently scheduled, `false` otherwise.
   */
  isScheduled(nodeId) {
    return this.entries.has(nodeId);
  }
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
  rescheduleFromPersistence(nodeId, resumeAt, callback) {
    if (this.entries.has(nodeId)) {
      throw new Error(`Node "${nodeId}" is already scheduled.`);
    }
    const remaining = new Date(resumeAt).getTime() - Date.now();
    if (remaining <= 0) {
      callback();
      return;
    }
    const timer = setTimeout(() => {
      this.entries.delete(nodeId);
      callback();
    }, remaining);
    this.entries.set(nodeId, { timer, resumeAt, callback });
  }
  /**
   * Cancels all pending timers. Used during shutdown.
   */
  cancelAll() {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
  /**
   * Returns the number of currently pending timers.
   *
   * @returns Count of scheduled nodes.
   */
  getScheduledCount() {
    return this.entries.size;
  }
};

// src/workflow/workflow.ts
import { randomUUID as randomUUID4 } from "crypto";
var TRANSITIONS2 = {
  init: ["spec"],
  spec: ["building"],
  building: ["running"],
  running: ["paused", "done", "failed"],
  paused: ["running"],
  done: [],
  failed: []
};
var TRANSITION_EVENTS = {
  running: "workflow_started",
  paused: "workflow_paused",
  done: "workflow_completed"
};
var WorkflowManager = class _WorkflowManager {
  data;
  graph;
  nodeInstances;
  /**
   * Creates a WorkflowManager from existing workflow data.
   *
   * Reconstructs the {@link WorkflowGraph} and all {@link WorkflowNode}
   * instances from the serialized workflow state.
   *
   * @param data - A validated {@link Workflow} object.
   */
  constructor(data) {
    this.data = { ...data };
    this.graph = WorkflowGraph.fromJSON(data.graph);
    this.nodeInstances = /* @__PURE__ */ new Map();
    for (const node of Object.values(data.graph.nodes)) {
      this.nodeInstances.set(node.id, new WorkflowNode(node));
    }
  }
  /** The workflow's unique identifier. */
  get id() {
    return this.data.id;
  }
  /** The current workflow lifecycle status. */
  get status() {
    return this.data.status;
  }
  /** The original project description. */
  get description() {
    return this.data.description;
  }
  /** The absolute path to the project workspace. */
  get projectPath() {
    return this.data.projectPath;
  }
  /** The accumulated total cost in USD. */
  get totalCost() {
    return this.data.totalCost;
  }
  /** The workflow configuration. */
  get config() {
    return this.data.config;
  }
  /** ISO 8601 timestamp when the workflow was created. */
  get createdAt() {
    return this.data.createdAt;
  }
  /** ISO 8601 timestamp of the last state change. */
  get updatedAt() {
    return this.data.updatedAt;
  }
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
  static async create(description, projectPath, config) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const emptyGraph = { nodes: {}, edges: [], topology: "linear" };
    const workflow = {
      id: randomUUID4(),
      status: "init",
      description,
      projectPath,
      graph: emptyGraph,
      config,
      createdAt: now,
      updatedAt: now,
      totalCost: 0
    };
    const manager = new _WorkflowManager(workflow);
    await saveWorkflowState(projectPath, manager.toJSON());
    const event = createEvent({
      type: "workflow_created",
      workflowId: workflow.id,
      details: { description, projectPath }
    });
    await appendEvent(projectPath, event);
    return manager;
  }
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
  static async resume(projectPath) {
    const state = await loadWorkflowState(projectPath);
    if (!state) {
      return null;
    }
    if (state.status !== "running" && state.status !== "paused") {
      throw new Error(
        `Cannot resume workflow in "${state.status}" status. Only "running" or "paused" workflows can be resumed.`
      );
    }
    const completedNodeIds = [];
    const resetNodeIds = [];
    const rescheduledNodeIds = [];
    let resumedFrom = null;
    for (const node of Object.values(state.graph.nodes)) {
      if (node.status === "done") {
        completedNodeIds.push(node.id);
      } else if (node.status === "running" || node.status === "review") {
        if (resumedFrom === null) {
          resumedFrom = node.id;
        }
        resetNodeIds.push(node.id);
        node.status = "pending";
        node.agents = [];
        node.retryCount = 0;
        node.reviewReport = null;
        node.cost = 0;
        node.startedAt = null;
        node.completedAt = null;
        node.resumeAt = null;
      } else if (node.status === "waiting") {
        if (node.resumeAt !== null) {
          rescheduledNodeIds.push(node.id);
        } else {
          resetNodeIds.push(node.id);
          node.status = "pending";
        }
      }
    }
    if (state.status === "paused") {
      state.status = "running";
    }
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const manager = new _WorkflowManager(state);
    await saveWorkflowState(projectPath, manager.toJSON());
    const event = createEvent({
      type: "workflow_resumed",
      workflowId: state.id,
      details: { resumedFrom, completedNodeIds, resetNodeIds, rescheduledNodeIds }
    });
    await appendEvent(projectPath, event);
    return {
      manager,
      info: { resumedFrom, completedNodeIds, resetNodeIds, rescheduledNodeIds }
    };
  }
  /**
   * Checks whether a transition to the given status is valid.
   *
   * @param to - The target workflow status to check.
   * @returns `true` if the transition is allowed, `false` otherwise.
   */
  canTransition(to) {
    return TRANSITIONS2[this.data.status].includes(to);
  }
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
  async transition(to) {
    if (!this.canTransition(to)) {
      throw new Error(
        `Invalid workflow transition: "${this.data.status}" \u2192 "${to}". Valid transitions: ${TRANSITIONS2[this.data.status].join(", ") || "none"}`
      );
    }
    const from = this.data.status;
    this.data.status = to;
    this.data.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveWorkflowState(this.data.projectPath, this.toJSON());
    const eventType = this.resolveEventType(from, to);
    if (eventType) {
      const event = createEvent({
        type: eventType,
        workflowId: this.data.id,
        details: { from, to }
      });
      await appendEvent(this.data.projectPath, event);
    }
  }
  /**
   * Pauses a running workflow.
   *
   * Transitions the workflow status from `running` to `paused`,
   * persists the new state, and logs a `workflow_paused` event.
   *
   * @throws Error if the workflow is not in `running` status.
   */
  async pause() {
    await this.transition("paused");
  }
  /**
   * Returns the {@link WorkflowGraph} instance for this workflow.
   *
   * @returns The workflow's directed acyclic graph.
   */
  getGraph() {
    return this.graph;
  }
  /**
   * Retrieves a {@link WorkflowNode} by ID.
   *
   * @param nodeId - The unique node identifier.
   * @returns The WorkflowNode instance, or undefined if not found.
   */
  getNode(nodeId) {
    return this.nodeInstances.get(nodeId);
  }
  /**
   * Returns all {@link WorkflowNode} instances in the workflow.
   *
   * @returns Array of all WorkflowNode instances.
   */
  getAllNodes() {
    return [...this.nodeInstances.values()];
  }
  /**
   * Adds a cost amount to the workflow's accumulated total cost.
   *
   * @param amount - The cost in USD to add (must be non-negative).
   * @throws Error if the amount is negative.
   */
  updateTotalCost(amount) {
    if (amount < 0) {
      throw new Error(`Cost amount must be non-negative, got ${String(amount)}`);
    }
    this.data.totalCost += amount;
  }
  /**
   * Synchronizes the internal graph and node instances from updated node data.
   *
   * Call this after modifying nodes or the graph to ensure the serialized
   * workflow state reflects the current in-memory state.
   */
  syncGraph() {
    const graphJSON = this.graph.toJSON();
    const syncedNodes = {};
    for (const [id, nodeInstance] of this.nodeInstances) {
      syncedNodes[id] = nodeInstance.toJSON();
    }
    this.data.graph = { ...graphJSON, nodes: syncedNodes };
  }
  /**
   * Serializes the workflow to a plain {@link Workflow} object for persistence.
   *
   * Synchronizes the graph and node data before serializing.
   *
   * @returns A plain object matching the WorkflowSchema.
   */
  toJSON() {
    this.syncGraph();
    return { ...this.data };
  }
  /**
   * Deserializes a {@link Workflow} object into a WorkflowManager instance.
   *
   * @param data - A validated Workflow object (e.g., from loadWorkflowState).
   * @returns A new WorkflowManager instance.
   */
  static fromJSON(data) {
    return new _WorkflowManager(data);
  }
  /**
   * Persists the current workflow state to disk.
   *
   * @param projectPath - Absolute path to the project root.
   */
  async persist(projectPath) {
    await saveWorkflowState(projectPath, this.toJSON());
  }
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
  resolveEventType(from, to) {
    if (from === "paused" && to === "running") {
      return "workflow_resumed";
    }
    return TRANSITION_EVENTS[to];
  }
};

// src/workflow/execution-engine.ts
var WorkflowExecutionEngine = class {
  manager;
  executor;
  costTracker;
  scheduler;
  graph;
  /** Node IDs currently being executed (in-flight promises). */
  activeNodes = /* @__PURE__ */ new Map();
  /** Tracks which nodes have been activated to prevent double-activation. */
  activatedNodes = /* @__PURE__ */ new Set();
  /** IDs of nodes that completed with `done`. */
  completedNodes = [];
  /** IDs of nodes that ended with `failed` or `blocked`. */
  failedNodes = [];
  /** Flag set by {@link stop} to halt the engine gracefully. */
  stopped = false;
  /** Resolver for the main execution loop's wait-for-completion promise. */
  wakeUp = null;
  /**
   * Creates a new WorkflowExecutionEngine.
   *
   * @param config - Engine configuration with manager, executor, and cost tracker.
   */
  constructor(config) {
    this.manager = config.manager;
    this.executor = config.executor;
    this.costTracker = config.costTracker;
    this.scheduler = config.scheduler ?? new Scheduler();
    this.graph = this.manager.getGraph();
  }
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
  async run() {
    if (this.manager.status !== "running") {
      throw new Error(
        `Cannot start execution: workflow is in "${this.manager.status}" state, expected "running"`
      );
    }
    await this.logWorkflowEvent("workflow_started", {});
    this.activateReadyNodes();
    while (!this.isTerminal()) {
      if (this.stopped) {
        return this.buildPausedResult("Engine stopped by external signal");
      }
      if (this.costTracker.isBudgetExceeded()) {
        return this.buildPausedResult("Budget limit reached");
      }
      if (this.activeNodes.size === 0 && !this.hasActivatableNodes()) {
        return this.buildFailedResult("Deadlock detected: no active or activatable nodes remain");
      }
      await this.waitForAnyCompletion();
    }
    return this.buildTerminalResult();
  }
  /**
   * Signals the engine to stop gracefully after in-flight nodes complete.
   *
   * The engine will not activate new nodes and will return a `paused` result
   * from the current {@link run} invocation.
   */
  stop() {
    this.stopped = true;
    this.scheduler.cancelAll();
    if (this.wakeUp) {
      this.wakeUp();
    }
  }
  /**
   * Returns the current count of in-flight node executions.
   *
   * @returns Number of nodes currently being executed.
   */
  getActiveNodeCount() {
    return this.activeNodes.size;
  }
  /**
   * Returns the IDs of nodes that have completed successfully so far.
   *
   * @returns Array of completed node IDs.
   */
  getCompletedNodes() {
    return [...this.completedNodes];
  }
  /**
   * Returns the IDs of nodes that have failed or are blocked.
   *
   * @returns Array of failed/blocked node IDs.
   */
  getFailedNodes() {
    return [...this.failedNodes];
  }
  // ==========================================================================
  // Node Activation
  // ==========================================================================
  /**
   * Scans all pending nodes and activates those whose predecessors are all done.
   *
   * For each ready node, transitions it to `waiting` and schedules it via the
   * {@link Scheduler}. When the delay expires (or immediately if delay is "0"),
   * the node transitions to `running` and execution begins.
   */
  activateReadyNodes() {
    if (this.stopped) return;
    const readyNodeIds = this.findReadyNodes();
    for (const nodeId of readyNodeIds) {
      if (this.activatedNodes.has(nodeId)) continue;
      this.activatedNodes.add(nodeId);
      this.activateNode(nodeId);
    }
  }
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
  findReadyNodes() {
    const ready = [];
    for (const node of this.manager.getAllNodes()) {
      if (node.status !== "pending") continue;
      if (this.activatedNodes.has(node.id)) continue;
      const predecessors = this.graph.getPredecessors(node.id);
      const allDone = predecessors.every((predId) => {
        const pred = this.manager.getNode(predId);
        return pred !== void 0 && pred.status === "done";
      });
      if (allDone) {
        ready.push(node.id);
      }
    }
    return ready;
  }
  /**
   * Checks whether any pending node could still be activated.
   *
   * A node is activatable if it is `pending` and none of its predecessors
   * are in a terminal failure state (`failed` or `blocked`). This is used
   * for deadlock detection.
   *
   * @returns `true` if at least one node can still potentially be activated.
   */
  hasActivatableNodes() {
    for (const node of this.manager.getAllNodes()) {
      if (node.status !== "pending") continue;
      if (this.activatedNodes.has(node.id)) continue;
      const predecessors = this.graph.getPredecessors(node.id);
      const blocked = predecessors.some((predId) => {
        const pred = this.manager.getNode(predId);
        return pred !== void 0 && (pred.status === "failed" || pred.status === "blocked");
      });
      if (!blocked) {
        return true;
      }
    }
    return false;
  }
  /**
   * Activates a single node: transitions to `waiting`, schedules via the
   * {@link Scheduler}, and starts execution when the delay expires.
   *
   * @param nodeId - ID of the node to activate.
   */
  activateNode(nodeId) {
    const node = this.manager.getNode(nodeId);
    if (!node) return;
    node.transition("waiting");
    const delay = this.graph.getNode(nodeId)?.delay ?? "0";
    this.scheduler.scheduleNode(nodeId, delay, () => {
      this.startNodeExecution(nodeId);
    });
  }
  // ==========================================================================
  // Node Execution
  // ==========================================================================
  /**
   * Transitions a node to `running` and begins execution via the injected executor.
   *
   * The execution promise is stored in {@link activeNodes} so the engine can
   * await completion. When execution finishes, the node's terminal state is
   * applied and the engine checks for newly activatable nodes.
   *
   * @param nodeId - ID of the node to execute.
   */
  startNodeExecution(nodeId) {
    const node = this.manager.getNode(nodeId);
    if (!node) return;
    node.transition("running");
    const promise = this.executeNode(nodeId, node);
    this.activeNodes.set(nodeId, promise);
  }
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
  async executeNode(nodeId, node) {
    await this.logNodeEvent(nodeId, "node_started", { title: node.title });
    let result;
    try {
      result = await this.executor(node, this.manager);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { status: "failed", cost: 0, error: message };
    }
    await this.applyNodeResult(nodeId, node, result);
    this.activeNodes.delete(nodeId);
    if (!this.stopped && !this.costTracker.isBudgetExceeded()) {
      this.activateReadyNodes();
    }
    this.signalWakeUp();
    return result;
  }
  /**
   * Applies the execution result to a node: transitions state, updates costs,
   * persists, and logs the appropriate event.
   *
   * @param nodeId - ID of the node.
   * @param node - The WorkflowNode instance.
   * @param result - The execution result to apply.
   */
  async applyNodeResult(nodeId, node, result) {
    const targetStatus = result.status;
    if (node.canTransition(targetStatus)) {
      node.transition(targetStatus);
    }
    if (result.cost > 0) {
      this.manager.updateTotalCost(result.cost);
    }
    if (result.status === "done") {
      this.completedNodes.push(nodeId);
      await this.logNodeEvent(nodeId, "node_completed", {
        cost: result.cost
      });
    } else {
      this.failedNodes.push(nodeId);
      const eventType = result.status === "blocked" ? "node_blocked" : "node_failed";
      await this.logNodeEvent(nodeId, eventType, {
        error: result.error ?? "Unknown error",
        cost: result.cost
      });
    }
    await this.persistState();
  }
  // ==========================================================================
  // Completion Detection
  // ==========================================================================
  /**
   * Waits until at least one active node completes.
   *
   * Returns immediately if no nodes are active (the main loop will re-evaluate
   * the terminal condition). Uses a manual promise so that {@link stop} can
   * unblock the wait.
   */
  async waitForAnyCompletion() {
    if (this.activeNodes.size === 0) return;
    const racePromise = new Promise((resolve7) => {
      this.wakeUp = resolve7;
    });
    const activePromises = [...this.activeNodes.values()].map(
      (p) => p.then(() => void 0)
    );
    await Promise.race([racePromise, ...activePromises]);
    this.wakeUp = null;
  }
  /**
   * Checks whether the workflow has reached a terminal state.
   *
   * Terminal means every node is in a terminal status (`done`, `failed`, or `blocked`)
   * and no nodes are currently executing or scheduled.
   *
   * @returns `true` if no further progress is possible.
   */
  isTerminal() {
    if (this.activeNodes.size > 0) return false;
    for (const node of this.manager.getAllNodes()) {
      const status = node.status;
      if (status !== "done" && status !== "failed" && status !== "blocked") {
        if (this.activatedNodes.has(node.id)) {
          return false;
        }
        const predecessors = this.graph.getPredecessors(node.id);
        const hasFailedPredecessor = predecessors.some((predId) => {
          const pred = this.manager.getNode(predId);
          return pred !== void 0 && (pred.status === "failed" || pred.status === "blocked");
        });
        if (!hasFailedPredecessor) {
          return false;
        }
      }
    }
    return true;
  }
  // ==========================================================================
  // Result Building
  // ==========================================================================
  /**
   * Marks pending nodes downstream of failed nodes as blocked, then builds
   * the terminal workflow result.
   *
   * If all nodes are `done`, the workflow transitions to `done`.
   * Otherwise, it transitions to `failed`.
   *
   * @returns The final execution result.
   */
  async buildTerminalResult() {
    await this.markUnreachableNodesBlocked();
    const allDone = this.manager.getAllNodes().every((n) => n.status === "done");
    if (allDone) {
      await this.manager.transition("done");
      return {
        status: "done",
        completedNodes: [...this.completedNodes],
        failedNodes: [...this.failedNodes],
        totalCost: this.costTracker.getTotalCost()
      };
    }
    await this.manager.transition("failed");
    return {
      status: "failed",
      completedNodes: [...this.completedNodes],
      failedNodes: [...this.failedNodes],
      totalCost: this.costTracker.getTotalCost(),
      haltReason: "One or more nodes failed or are blocked"
    };
  }
  /**
   * Builds a paused result and transitions the workflow to `paused`.
   *
   * Waits for all in-flight nodes to finish before returning.
   *
   * @param reason - Human-readable reason for the pause.
   * @returns The paused execution result.
   */
  async buildPausedResult(reason) {
    await this.drainActiveNodes();
    await this.manager.transition("paused");
    return {
      status: "paused",
      completedNodes: [...this.completedNodes],
      failedNodes: [...this.failedNodes],
      totalCost: this.costTracker.getTotalCost(),
      haltReason: reason
    };
  }
  /**
   * Builds a failed result and transitions the workflow to `failed`.
   *
   * @param reason - Human-readable reason for the failure.
   * @returns The failed execution result.
   */
  async buildFailedResult(reason) {
    await this.drainActiveNodes();
    await this.manager.transition("failed");
    return {
      status: "failed",
      completedNodes: [...this.completedNodes],
      failedNodes: [...this.failedNodes],
      totalCost: this.costTracker.getTotalCost(),
      haltReason: reason
    };
  }
  /**
   * Transitions all pending nodes downstream of failed/blocked nodes to `blocked`.
   *
   * Prevents the engine from waiting on nodes that can never be activated.
   */
  async markUnreachableNodesBlocked() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.manager.getAllNodes()) {
        if (node.status !== "pending") continue;
        const predecessors = this.graph.getPredecessors(node.id);
        const hasFailedPredecessor = predecessors.some((predId) => {
          const pred = this.manager.getNode(predId);
          return pred !== void 0 && (pred.status === "failed" || pred.status === "blocked");
        });
        if (hasFailedPredecessor) {
          node.transition("waiting");
          node.transition("running");
          node.transition("blocked");
          this.failedNodes.push(node.id);
          await this.logNodeEvent(node.id, "node_blocked", {
            error: "Predecessor node failed or is blocked"
          });
          changed = true;
        }
      }
    }
    await this.persistState();
  }
  // ==========================================================================
  // Helpers
  // ==========================================================================
  /**
   * Waits for all currently active node executions to finish.
   *
   * Uses {@link Promise.allSettled} to ensure all in-flight work completes
   * even if some nodes throw.
   */
  async drainActiveNodes() {
    if (this.activeNodes.size === 0) return;
    await Promise.allSettled([...this.activeNodes.values()]);
  }
  /**
   * Wakes up the main execution loop if it is waiting.
   */
  signalWakeUp() {
    if (this.wakeUp) {
      this.wakeUp();
    }
  }
  /**
   * Persists the current workflow state to disk.
   */
  async persistState() {
    await saveWorkflowState(this.manager.projectPath, this.manager.toJSON());
  }
  /**
   * Logs a workflow-level event.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload.
   */
  async logWorkflowEvent(type, details) {
    const event = createEvent({
      type,
      workflowId: this.manager.id,
      details
    });
    await appendEvent(this.manager.projectPath, event);
  }
  /**
   * Logs a node-level event.
   *
   * @param nodeId - ID of the node the event relates to.
   * @param type - Event type identifier.
   * @param details - Event-specific payload.
   */
  async logNodeEvent(nodeId, type, details) {
    const event = createEvent({
      type,
      workflowId: this.manager.id,
      nodeId,
      details
    });
    await appendEvent(this.manager.projectPath, event);
  }
};

// src/api/server.ts
import { existsSync } from "fs";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";

// src/api/routes/health.ts
var VERSION = "0.1.0";
function healthRoutes(options) {
  const { getUptime, getWorkflow } = options;
  const plugin = (fastify) => {
    fastify.get("/health", () => {
      return {
        status: "ok",
        uptime: getUptime(),
        version: VERSION,
        workflow: getWorkflow()
      };
    });
    return Promise.resolve();
  };
  return plugin;
}

// src/api/routes/memory.ts
function memoryRoutes(options) {
  const { getSharedMemory } = options;
  const plugin = (fastify) => {
    fastify.get("/memory", async (_request, reply) => {
      const sharedMemory = getSharedMemory();
      if (sharedMemory === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      const memoryFiles = await sharedMemory.list();
      const files = memoryFiles.map((file) => ({
        name: file.name,
        lastModifiedBy: file.lastModifiedBy,
        lastModifiedAt: file.lastModifiedAt
      }));
      await reply.code(200).send({ files });
    });
    fastify.get(
      "/memory/:name",
      async (request, reply) => {
        const sharedMemory = getSharedMemory();
        if (sharedMemory === null) {
          await reply.code(404).send({ error: "No active workflow" });
          return;
        }
        const { name } = request.params;
        if (!isValidMemoryFileName(name)) {
          await reply.code(400).send({ error: "Invalid memory file name" });
          return;
        }
        try {
          const file = await sharedMemory.read(name);
          await reply.type("text/markdown").code(200).send(file.content);
        } catch {
          await reply.code(404).send({ error: "Memory file not found" });
        }
      }
    );
    return Promise.resolve();
  };
  return plugin;
}
function isValidMemoryFileName(name) {
  if (name.length === 0) {
    return false;
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return false;
  }
  return true;
}

// src/api/routes/events.ts
import { z as z15 } from "zod";
var EventsQuerySchema = z15.object({
  type: EventTypeSchema.optional(),
  nodeId: z15.string().min(1).optional(),
  limit: z15.coerce.number().int().min(1).optional().default(50),
  offset: z15.coerce.number().int().min(0).optional().default(0)
});
function eventsRoutes(options) {
  const { getProjectPath } = options;
  const plugin = (fastify) => {
    fastify.get("/events", async (request, reply) => {
      const parseResult = EventsQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid query parameters",
          details: parseResult.error.issues
        });
        return;
      }
      const { type, nodeId, limit, offset } = parseResult.data;
      const filters = {};
      if (type !== void 0) {
        filters.type = type;
      }
      if (nodeId !== void 0) {
        filters.nodeId = nodeId;
      }
      const projectPath = getProjectPath();
      const allMatching = await queryEvents(projectPath, filters);
      const total = allMatching.length;
      const paginated = allMatching.slice(offset, offset + limit);
      const response = { events: paginated, total };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };
  return plugin;
}

// src/api/routes/nodes.ts
import { z as z16 } from "zod";
var NodeParamsSchema = z16.object({
  id: z16.string().min(1)
});
function toNodeSummary(node) {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    cost: node.cost,
    agentCount: node.agents.length,
    retryCount: node.retryCount,
    startedAt: node.startedAt,
    completedAt: node.completedAt
  };
}
function toNodeDetail(node) {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    instructions: node.instructions,
    delay: node.delay,
    resumeAt: node.resumeAt,
    agents: node.agents,
    fileOwnership: node.fileOwnership,
    retryCount: node.retryCount,
    maxRetries: node.maxRetries,
    reviewReport: node.reviewReport,
    cost: node.cost,
    startedAt: node.startedAt,
    completedAt: node.completedAt
  };
}
function nodesRoutes(options) {
  const { getWorkflow } = options;
  const plugin = (fastify) => {
    fastify.get("/nodes", async (_request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      const summaries = Object.values(workflow.graph.nodes).map(toNodeSummary);
      await reply.code(200).send(summaries);
    });
    fastify.get("/nodes/:id", async (request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      const parseResult = NodeParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid node ID",
          details: parseResult.error.issues
        });
        return;
      }
      const node = workflow.graph.nodes[parseResult.data.id];
      if (node === void 0) {
        await reply.code(404).send({ error: "Node not found" });
        return;
      }
      await reply.code(200).send(toNodeDetail(node));
    });
    fastify.get("/nodes/:id/review", async (request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      const parseResult = NodeParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid node ID",
          details: parseResult.error.issues
        });
        return;
      }
      const node = workflow.graph.nodes[parseResult.data.id];
      if (node === void 0) {
        await reply.code(404).send({ error: "Node not found" });
        return;
      }
      if (node.reviewReport === null) {
        await reply.code(404).send({ error: "No review report for this node" });
        return;
      }
      await reply.code(200).send(node.reviewReport);
    });
    return Promise.resolve();
  };
  return plugin;
}

// src/api/routes/workflow.ts
import { randomUUID as randomUUID5 } from "crypto";
import { z as z17 } from "zod";
var InitRequestSchema = z17.object({
  description: z17.string().min(1),
  projectPath: z17.string().min(1),
  config: PartialConfigSchema.optional()
});
function workflowRoutes(options) {
  const { getWorkflow, setWorkflow } = options;
  const plugin = (fastify) => {
    fastify.get("/workflow", async (_request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      await reply.code(200).send({
        id: workflow.id,
        status: workflow.status,
        description: workflow.description,
        projectPath: workflow.projectPath,
        totalCost: workflow.totalCost,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        graph: workflow.graph
      });
    });
    fastify.post("/workflow/init", async (request, reply) => {
      const parseResult = InitRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid request body",
          details: parseResult.error.issues
        });
        return;
      }
      const body = parseResult.data;
      if (getWorkflow() !== null) {
        await reply.code(409).send({ error: "A workflow is already active" });
        return;
      }
      let mergedConfig;
      try {
        mergedConfig = await loadConfig({
          projectPath: body.projectPath,
          overrides: body.config
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await reply.code(400).send({ error: `Invalid configuration: ${message}` });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const id = randomUUID5();
      const workflow = {
        id,
        status: "spec",
        description: body.description,
        projectPath: body.projectPath,
        graph: { nodes: {}, edges: [], topology: "linear" },
        config: mergedConfig,
        createdAt: now,
        updatedAt: now,
        totalCost: 0
      };
      setWorkflow(workflow);
      void runSpecGenerationBackground(workflow, options);
      await reply.code(201).send({
        id: workflow.id,
        status: workflow.status,
        description: workflow.description
      });
    });
    fastify.post("/workflow/start", async (_request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      if (workflow.status !== "building") {
        await reply.code(400).send({ error: "Workflow not in building state" });
        return;
      }
      const updated = {
        ...workflow,
        status: "running",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      setWorkflow(updated);
      await saveWorkflowState(updated.projectPath, updated);
      await reply.code(200).send({ status: "running" });
    });
    fastify.post("/workflow/pause", async (_request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      if (workflow.status !== "running") {
        await reply.code(400).send({
          error: `Cannot pause workflow in "${workflow.status}" state. Only running workflows can be paused.`
        });
        return;
      }
      const updated = {
        ...workflow,
        status: "paused",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      setWorkflow(updated);
      await saveWorkflowState(updated.projectPath, updated);
      await reply.code(200).send({ status: "paused" });
    });
    fastify.post("/workflow/resume", async (_request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No workflow to resume" });
        return;
      }
      if (workflow.status !== "paused" && workflow.status !== "running") {
        await reply.code(400).send({
          error: `Cannot resume workflow in "${workflow.status}" state. Only paused or running workflows can be resumed.`
        });
        return;
      }
      try {
        const result = await WorkflowManager.resume(workflow.projectPath);
        if (result === null) {
          await reply.code(404).send({ error: "No persisted workflow state found" });
          return;
        }
        const resumedWorkflow = result.manager.toJSON();
        setWorkflow(resumedWorkflow);
        await reply.code(200).send({
          status: resumedWorkflow.status,
          resumeInfo: result.info
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await reply.code(400).send({ error: `Resume failed: ${message}` });
      }
    });
    return Promise.resolve();
  };
  return plugin;
}
async function runSpecGenerationBackground(workflow, options) {
  const { setWorkflow, getProvider, getSharedMemory, getCostTracker } = options;
  const loom = new LoomAgent({
    provider: getProvider(),
    projectPath: workflow.projectPath,
    eventLog: { workflowId: workflow.id },
    sharedMemory: getSharedMemory(),
    costTracker: getCostTracker()
  });
  try {
    const result = await loom.runSpecGeneration(workflow.description);
    const updated = {
      ...workflow,
      status: "building",
      graph: result.graph,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    setWorkflow(updated);
    await saveWorkflowState(updated.projectPath, updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workflow] Spec generation failed for ${workflow.id}: ${message}`);
    const updated = {
      ...workflow,
      status: "failed",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    setWorkflow(updated);
    await saveWorkflowState(updated.projectPath, updated);
  }
}

// src/api/routes/chat.ts
import { z as z18 } from "zod";
var ChatMessageSchema = z18.object({
  message: z18.string().min(1)
});
function chatRoutes(options) {
  const { handleChat, getChatHistory, addToHistory } = options;
  const plugin = (fastify) => {
    fastify.post("/chat", async (request, reply) => {
      const parseResult = ChatMessageSchema.safeParse(request.body);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid request body",
          details: parseResult.error.issues
        });
        return;
      }
      const { message } = parseResult.data;
      addToHistory({
        role: "user",
        content: message,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const result = await handleChat(message);
      addToHistory({
        role: "assistant",
        content: result.response,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const action = result.modification !== null && result.modification.action !== "no_action" ? {
        type: "graph_modified",
        details: result.modification
      } : null;
      const response = {
        response: result.response,
        action,
        category: result.category
      };
      await reply.code(200).send(response);
    });
    fastify.get("/chat/history", async (_request, reply) => {
      const response = { messages: getChatHistory() };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };
  return plugin;
}

// src/api/routes/config.ts
function configRoutes(options) {
  const { getConfig, updateConfig } = options;
  const plugin = (fastify) => {
    fastify.get("/config", async (_request, reply) => {
      const response = { config: getConfig() };
      await reply.code(200).send(response);
    });
    fastify.put("/config", async (request, reply) => {
      const parseResult = ConfigSchema.partial().safeParse(request.body);
      if (!parseResult.success) {
        await reply.code(400).send({
          error: "Invalid config",
          details: parseResult.error.issues
        });
        return;
      }
      const updated = updateConfig(parseResult.data);
      const response = { config: updated };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };
  return plugin;
}

// src/api/routes/costs.ts
function costsRoutes(options) {
  const { getCostSummary, getWorkflow, getLoomCost } = options;
  const plugin = (fastify) => {
    fastify.get("/costs", async (_request, reply) => {
      const workflow = getWorkflow();
      if (workflow === null) {
        await reply.code(404).send({ error: "No active workflow" });
        return;
      }
      const summary = getCostSummary();
      const nodes = Object.values(workflow.graph.nodes).map(
        (node) => ({
          id: node.id,
          title: node.title,
          cost: summary.perNode[node.id] ?? 0,
          retries: node.retryCount
        })
      );
      const response = {
        total: summary.totalCost,
        budgetLimit: summary.budgetLimit,
        budgetRemaining: summary.budgetRemaining,
        nodes,
        loomCost: getLoomCost()
      };
      await reply.code(200).send(response);
    });
    return Promise.resolve();
  };
  return plugin;
}

// src/api/server.ts
var VERSION2 = "0.1.0";
var WS_CLOSE_UNAUTHORIZED = 4001;
var WS_OPEN = 1;
var BEARER_PREFIX = "Bearer ";
var API_ROUTE_PREFIXES = [
  "/workflow",
  "/nodes",
  "/memory",
  "/events",
  "/specs",
  "/chat",
  "/config",
  "/costs"
];
async function createServer(options) {
  const { token, dashboardPath } = options;
  const server = Fastify({ logger: false });
  const dashboardRoot = dashboardPath && existsSync(dashboardPath) ? dashboardPath : null;
  await server.register(fastifyWebsocket);
  await server.register(fastifyCors, { origin: true });
  if (dashboardRoot) {
    await server.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: "/"
    });
  }
  server.addHook(
    "onRequest",
    async (request, reply) => {
      if (request.method === "GET" && request.url === "/health") {
        return;
      }
      if (request.url === "/ws" || request.url.startsWith("/ws?")) {
        return;
      }
      if (dashboardRoot && request.method === "GET") {
        const isApiRoute = API_ROUTE_PREFIXES.some(
          (p) => request.url === p || request.url.startsWith(p + "/") || request.url.startsWith(p + "?")
        );
        if (!isApiRoute) return;
      }
      const header = request.headers.authorization;
      if (!header || !header.startsWith(BEARER_PREFIX)) {
        await reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      if (header.slice(BEARER_PREFIX.length) !== token) {
        await reply.code(401).send({ error: "Unauthorized" });
        return;
      }
    }
  );
  server.setErrorHandler(
    async (error, _request, reply) => {
      const statusCode = error.statusCode ?? 500;
      await reply.code(statusCode).send({ error: error.message });
    }
  );
  await server.register(
    healthRoutes(
      options.health ?? {
        getUptime: () => Math.floor(process.uptime()),
        getWorkflow: () => null
      }
    )
  );
  if (options.workflow) {
    await server.register(workflowRoutes(options.workflow));
  }
  if (options.nodes) {
    await server.register(nodesRoutes(options.nodes));
  }
  if (options.memory) {
    await server.register(memoryRoutes(options.memory));
  }
  if (options.events) {
    await server.register(eventsRoutes(options.events));
  }
  if (options.chat) {
    await server.register(chatRoutes(options.chat));
  }
  if (options.config) {
    await server.register(configRoutes(options.config));
  }
  if (options.costs) {
    await server.register(costsRoutes(options.costs));
  }
  const clients = /* @__PURE__ */ new Set();
  server.get(
    "/ws",
    { websocket: true },
    (socket, _request) => {
      const url = new URL(
        _request.url,
        `http://${_request.headers.host ?? "localhost"}`
      );
      const queryToken = url.searchParams.get("token");
      if (queryToken !== token) {
        socket.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
        return;
      }
      clients.add(socket);
      socket.send(JSON.stringify({ type: "connected", version: VERSION2 }));
      socket.on("close", () => {
        clients.delete(socket);
      });
    }
  );
  server.setNotFoundHandler(
    async (request, reply) => {
      if (dashboardRoot && request.method === "GET" && request.headers.accept?.includes("text/html")) {
        reply.sendFile("index.html");
        return;
      }
      await reply.code(404).send({ error: "Not found" });
    }
  );
  const broadcast = (event) => {
    const data = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === WS_OPEN) {
        client.send(data);
      }
    }
  };
  return { server, broadcast };
}

// src/api/auth.ts
var BEARER_PREFIX2 = "Bearer ";
function createAuthMiddleware(token) {
  return async function authMiddleware(request, reply) {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX2)) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const provided = header.slice(BEARER_PREFIX2.length);
    if (provided !== token) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
  };
}

// src/api/websocket.ts
var WebSocketBroadcaster = class {
  /** The underlying broadcast function from the server. */
  broadcast;
  /**
   * Create a new WebSocketBroadcaster.
   *
   * @param broadcast - The broadcast function returned by {@link createServer}.
   */
  constructor(broadcast) {
    this.broadcast = broadcast;
  }
  /** Send a typed event through the raw broadcast function. */
  emit(event) {
    this.broadcast(event);
  }
  /**
   * Broadcast a node status change to all connected clients.
   *
   * @param nodeId - ID of the node whose status changed.
   * @param status - The new node status.
   * @param details - Optional additional context about the change.
   */
  emitNodeStatus(nodeId, status, details) {
    const event = {
      type: "node_status",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId,
      status,
      ...details !== void 0 && { details }
    };
    this.emit(event);
  }
  /**
   * Broadcast an agent status change to all connected clients.
   *
   * @param nodeId - ID of the node the agent belongs to.
   * @param agentId - ID of the agent whose status changed.
   * @param status - The new agent status.
   * @param details - Optional additional context about the change.
   */
  emitAgentStatus(nodeId, agentId, status, details) {
    const event = {
      type: "agent_status",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId,
      agentId,
      status,
      ...details !== void 0 && { details }
    };
    this.emit(event);
  }
  /**
   * Broadcast an agent message to all connected clients.
   *
   * @param nodeId - ID of the node where the message was sent.
   * @param agentId - ID of the agent that sent or received the message.
   * @param message - The message content.
   */
  emitAgentMessage(nodeId, agentId, message) {
    const event = {
      type: "agent_message",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId,
      agentId,
      message
    };
    this.emit(event);
  }
  /**
   * Broadcast a Loomex review verdict to all connected clients.
   *
   * @param nodeId - ID of the node that was reviewed.
   * @param verdict - The overall review verdict (PASS, FAIL, or BLOCKED).
   * @param report - The full structured review report.
   */
  emitReviewVerdict(nodeId, verdict, report) {
    const event = {
      type: "review_verdict",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId,
      verdict,
      report
    };
    this.emit(event);
  }
  /**
   * Broadcast a graph modification to all connected clients.
   *
   * @param action - The kind of modification (node_added, node_removed, etc.).
   * @param nodeId - ID of the affected node, if applicable.
   * @param details - Optional additional context about the modification.
   */
  emitGraphModified(action, nodeId, details) {
    const event = {
      type: "graph_modified",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      action,
      ...nodeId !== void 0 && { nodeId },
      ...details !== void 0 && { details }
    };
    this.emit(event);
  }
  /**
   * Broadcast a cost update after an LLM call to all connected clients.
   *
   * @param nodeId - ID of the node where the LLM call occurred.
   * @param callCost - Cost of the individual LLM call in USD.
   * @param nodeCost - Total accumulated cost for this node in USD.
   * @param totalCost - Total accumulated cost across the workflow in USD.
   * @param budgetRemaining - Remaining budget in USD, or undefined if no limit.
   */
  emitCostUpdate(nodeId, callCost, nodeCost, totalCost, budgetRemaining) {
    const event = {
      type: "cost_update",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      nodeId,
      callCost,
      nodeCost,
      totalCost,
      ...budgetRemaining !== void 0 && { budgetRemaining }
    };
    this.emit(event);
  }
  /**
   * Broadcast a Loom chat response to all connected clients.
   *
   * @param response - The text response from Loom.
   * @param category - The classified category (question, instruction, or graph_change).
   * @param action - Graph modification action if the message triggered one, or null.
   */
  emitChatResponse(response, category, action) {
    const event = {
      type: "chat_response",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      response,
      category,
      action
    };
    this.emit(event);
  }
  /**
   * Broadcast that a spec artifact has been generated during Phase 1.
   *
   * @param name - File name of the generated artifact (e.g. "spec.md").
   * @param path - Relative path to the artifact (e.g. ".loomflo/specs/spec.md").
   */
  emitSpecArtifactReady(name, path) {
    const event = {
      type: "spec_artifact_ready",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      name,
      path
    };
    this.emit(event);
  }
  /**
   * Broadcast that a shared memory file has been updated.
   *
   * @param file - Name of the memory file that was updated.
   * @param summary - Description of what was updated.
   * @param agentId - ID of the agent that triggered the update, if applicable.
   */
  emitMemoryUpdated(file, summary, agentId) {
    const event = {
      type: "memory_updated",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      file,
      summary,
      ...agentId !== void 0 && { agentId }
    };
    this.emit(event);
  }
};
export {
  AgentInfoSchema,
  AgentRoleSchema,
  AgentStatusSchema,
  AnthropicProvider,
  CompletionParamsSchema,
  ConfigManager,
  ConfigSchema,
  ContentBlockSchema,
  CostTracker,
  DEFAULT_CONFIG,
  DEFAULT_COST_ESTIMATION_CONFIG,
  DEFAULT_PRICING,
  Daemon,
  EdgeSchema,
  EscalationManager,
  EventSchema,
  EventTypeSchema,
  FileOwnershipManager,
  GraphSchema,
  GraphValidationError,
  LLMMessageRoleSchema,
  LLMMessageSchema,
  LLMResponseSchema,
  LOOMCRAFT_PROMPT,
  LOOMKIT_PROMPT,
  LOOMPATH_PROMPT,
  LOOMPRINT_PROMPT,
  LOOMSCAN_PROMPT,
  LOOMSCOPE_PROMPT,
  LevelSchema,
  LoomAgent,
  MessageBus,
  MessageSchema,
  ModelsConfigSchema,
  NodeSchema,
  NodeStatusSchema,
  OllamaProvider,
  OpenAIProvider,
  PartialConfigSchema,
  ProviderConfigSchema,
  RateLimiter,
  RetryStrategySchema,
  ReviewReportSchema,
  SPEC_PROMPTS,
  STANDARD_MEMORY_FILES,
  Scheduler,
  SharedMemoryFileSchema,
  SharedMemoryManager,
  SpecEngine,
  SpecPipelineError,
  TaskVerificationSchema,
  TokenUsageSchema,
  ToolDefinitionSchema,
  TopologyTypeSchema,
  WebSocketBroadcaster,
  WorkflowExecutionEngine,
  WorkflowGraph,
  WorkflowManager,
  WorkflowNode,
  WorkflowSchema,
  WorkflowStatusSchema,
  appendEvent,
  buildLoomPrompt,
  buildLoomaPrompt,
  buildLoomexPrompt,
  buildLoomiPrompt,
  createAuthMiddleware,
  createEscalateTool,
  createEvent,
  createLockDenied,
  createLockGrant,
  createLockRelease,
  createLockRequest,
  createReportCompleteTool,
  createSendMessageTool,
  createServer,
  createWorkerAgentInfo,
  deepMerge,
  editFileTool,
  estimateNodeCost,
  flushPendingWrites,
  generateTestPaths2 as generateTestPaths,
  isLockProtocolMessage,
  listFilesTool,
  loadConfig,
  loadConfigFile,
  loadDaemonInfo,
  loadWorkflowState,
  memoryReadTool,
  memoryWriteTool,
  parseDelay,
  parseLockProtocolMessage,
  parseReviewReport,
  queryEvents,
  readFileTool,
  repairState,
  resolveConfig,
  runAgentLoop,
  runLooma,
  runLoomex,
  runLoomi,
  saveWorkflowState,
  saveWorkflowStateImmediate,
  searchFilesTool,
  shellExecTool,
  toToolDefinition,
  validateAndOptimizeGraph,
  validateDag,
  validateGraphIntegrity,
  verifyStateConsistency,
  writeFileTool,
  zodToJsonSchema
};
