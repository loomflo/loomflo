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

import type { CostTracker } from "../costs/tracker.js";
import type { SharedMemoryManager } from "../memory/shared-memory.js";
import { createEvent, appendEvent } from "../persistence/events.js";
import type { LLMProvider } from "../providers/base.js";
import type {
  SpecPipelineResult,
  SpecStepEvent,
  ClarificationCallback,
} from "../spec/spec-engine.js";
import { SpecEngine } from "../spec/spec-engine.js";
import type { EscalationRequest } from "../tools/escalate.js";
import type { GraphModification, GraphModifierLike } from "./escalation.js";
import type { EventType } from "../types.js";

// ============================================================================
// Constants
// ============================================================================

/** Default LLM model for the Loom agent per constitution (claude-opus-4-6). */
const DEFAULT_LOOM_MODEL = "claude-opus-4-6";

/** Agent ID used for event logging and shared memory attribution. */
const LOOM_AGENT_ID = "loom";

/** Shared memory files monitored for critical issues. */
const MONITORED_MEMORY_FILES = ["ERRORS.md", "ISSUES.md", "PROGRESS.md"];

/** Maximum tokens for the lightweight classification LLM call. */
const CLASSIFICATION_MAX_TOKENS = 150;

/** Shared memory files read for project context in question handling. */
const CONTEXT_MEMORY_FILES = ["DECISIONS.md", "PROGRESS.md", "ARCHITECTURE_CHANGES.md"];

// ============================================================================
// LoomAgentStatus
// ============================================================================

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
export type LoomAgentStatus =
  | "created"
  | "running_spec"
  | "running_execution"
  | "handling_escalation"
  | "handling_chat"
  | "idle";

// ============================================================================
// LoomConfig
// ============================================================================

/**
 * Configuration for creating a Loom agent instance.
 */
export interface LoomConfig {
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
  /** Default delay between node activations. Passed to SpecEngine. */
  defaultDelay?: string;
}

// ============================================================================
// EscalationResult
// ============================================================================

/**
 * Result of handling an escalation request.
 */
export interface EscalationResult {
  /** Whether the escalation was handled successfully. */
  success: boolean;
  /** The decided graph modification, or null if handling failed. */
  modification: GraphModification | null;
  /** Error message if handling failed. */
  error?: string;
}

// ============================================================================
// Chat Message Classification
// ============================================================================

/**
 * Category of a user chat message for routing.
 *
 * - `question`: Asking about the project, its state, or architecture.
 * - `instruction`: Giving a directive to be relayed to orchestrators.
 * - `graph_change`: Requesting structural changes to the workflow graph.
 */
export type ChatMessageCategory = "question" | "instruction" | "graph_change";

/**
 * Result of classifying a user chat message.
 */
export interface ChatClassification {
  /** The determined category of the message. */
  category: ChatMessageCategory;
  /** Confidence score from the LLM (0.0 to 1.0). */
  confidence: number;
  /** Brief reasoning for the classification. */
  reasoning: string;
}

// ============================================================================
// ChatResult
// ============================================================================

/**
 * Result of handling a user chat message.
 */
export interface ChatResult {
  /** The response text from Loom. */
  response: string;
  /** Category the message was classified as. */
  category: ChatMessageCategory;
  /** Graph modification if the user requested one, or null. */
  modification: GraphModification | null;
  /** Error message if chat handling failed. */
  error?: string;
}

// ============================================================================
// MonitoringResult
// ============================================================================

/**
 * Result of shared memory monitoring.
 */
export interface MonitoringResult {
  /** Whether critical issues were detected. */
  issuesDetected: boolean;
  /** Proactive graph modification if intervention is needed, or null. */
  modification: GraphModification | null;
  /** Summary of findings. */
  summary: string;
}

// ============================================================================
// Escalation Prompt Helpers
// ============================================================================

/**
 * Build the system prompt for escalation handling.
 *
 * @returns System prompt for the architect to decide on graph modifications.
 */
function buildEscalationHandlingPrompt(): string {
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
    "Include only the fields relevant to your chosen action.",
  ].join("\n");
}

/**
 * Build the system prompt for shared memory monitoring.
 *
 * @returns System prompt for proactive monitoring.
 */
function buildMonitoringPrompt(): string {
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
    '{"issuesDetected": false, "summary": "Brief summary of current state"}',
  ].join("\n");
}

/**
 * Build the system prompt for message classification.
 *
 * @returns System prompt for the lightweight classification call.
 */
function buildClassificationPrompt(): string {
  return [
    "Classify the following user message into exactly one category:",
    "- question: Asking about the project, its state, architecture, or progress.",
    '- instruction: Giving a directive or preference (e.g., "use bcrypt", "prefer PostgreSQL").',
    '- graph_change: Requesting structural workflow changes (e.g., "add a node", "remove the docs step").',
    "",
    "Respond with ONLY a JSON object:",
    '{"category": "question|instruction|graph_change", "confidence": 0.0-1.0, "reasoning": "brief explanation"}',
  ].join("\n");
}

/**
 * Build the system prompt for question handling.
 *
 * @returns System prompt for answering developer questions.
 */
function buildQuestionHandlingPrompt(): string {
  return [
    "You are Loom, the Architect agent in the Loomflo framework.",
    "A developer is asking you a question about their project.",
    "",
    "Answer using the project context provided (shared memory, graph state, specifications).",
    "Be informative, specific, and concise.",
    "Reference concrete details from the context when available.",
  ].join("\n");
}

/**
 * Build the system prompt for instruction handling.
 *
 * @returns System prompt for processing developer directives.
 */
function buildInstructionHandlingPrompt(): string {
  return [
    "You are Loom, the Architect agent in the Loomflo framework.",
    "A developer has given you an instruction or directive about their project.",
    "",
    "Your job is to:",
    "1. Acknowledge the instruction clearly.",
    "2. Explain how it will be applied (which nodes or agents it affects).",
    "3. Confirm that the instruction has been recorded in project decisions.",
    "",
    "Be concise and action-oriented.",
  ].join("\n");
}

/**
 * Build the system prompt for graph change handling.
 *
 * @returns System prompt for processing structural graph modifications.
 */
function buildGraphChangeHandlingPrompt(): string {
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
    "Include only the fields relevant to the action.",
  ].join("\n");
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract a JSON object from text that may contain markdown fences.
 *
 * @param text - Raw text from the LLM response.
 * @returns Parsed JSON value, or null if extraction fails.
 */
function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Fall through
  }

  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // Fall through
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Parse a graph modification from a JSON object.
 *
 * @param json - Parsed JSON object from LLM response.
 * @param fallbackNodeId - Node ID to use if not specified in the response.
 * @returns Parsed graph modification.
 */
function parseGraphModification(
  json: Record<string, unknown>,
  fallbackNodeId: string,
): GraphModification {
  const action = json["action"] as GraphModification["action"] | undefined;
  const validActions = new Set([
    "add_node",
    "modify_node",
    "remove_node",
    "skip_node",
    "no_action",
  ]);

  const modification: GraphModification = {
    action: action !== undefined && validActions.has(action) ? action : "skip_node",
    reason: typeof json["reason"] === "string" ? json["reason"] : "No reason provided",
  };

  if (typeof json["nodeId"] === "string") {
    modification.nodeId = json["nodeId"];
  } else if (modification.action !== "add_node" && modification.action !== "no_action") {
    modification.nodeId = fallbackNodeId;
  }

  if (
    modification.action === "add_node" &&
    typeof json["newNode"] === "object" &&
    json["newNode"] !== null
  ) {
    const newNode = json["newNode"] as Record<string, unknown>;
    modification.newNode = {
      title: typeof newNode["title"] === "string" ? newNode["title"] : "Recovery Node",
      instructions: typeof newNode["instructions"] === "string" ? newNode["instructions"] : "",
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

// ============================================================================
// LoomAgent
// ============================================================================

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
export class LoomAgent {
  private readonly config: LoomConfig;
  private readonly model: string;
  private status: LoomAgentStatus = "created";

  /**
   * Creates a new Loom agent instance.
   *
   * @param config - Loom agent configuration.
   */
  constructor(config: LoomConfig) {
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
  async runSpecGeneration(description: string): Promise<SpecPipelineResult> {
    this.status = "running_spec";

    await this.logEvent("spec_phase_started", {
      phase: "pipeline",
      description: description.slice(0, 200),
    });

    await this.writeProgress(
      `## Spec Generation Started\nGenerating specification for project.\nPhase: pipeline\n`,
    );

    const engine = new SpecEngine({
      provider: this.config.provider,
      model: this.model,
      projectPath: this.config.projectPath,
      maxTokens: this.config.maxTokensPerCall,
      clarificationCallback: this.config.clarificationCallback,
      defaultDelay: this.config.defaultDelay,
    });

    const onProgress = (event: SpecStepEvent): void => {
      this.handleSpecProgress(event);
    };

    try {
      const result = await engine.runPipeline(description, onProgress);

      await this.logEvent("spec_phase_completed", {
        phase: "pipeline",
        artifactCount: result.artifacts.length,
        nodeCount: Object.keys(result.graph.nodes).length,
        topology: result.graph.topology,
      });

      const nodeCount = Object.keys(result.graph.nodes).length;
      const edgeCount = result.graph.edges.length;
      await this.writeProgress(
        `## Spec Generation Completed\n` +
          `Artifacts: ${String(result.artifacts.length)}\n` +
          `Graph: ${String(nodeCount)} nodes, ${String(edgeCount)} edges (${result.graph.topology})\n`,
      );

      this.status = "idle";
      return result;
    } catch (error: unknown) {
      this.status = "idle";

      const message = error instanceof Error ? error.message : String(error);
      await this.logEvent("spec_phase_completed", {
        phase: "pipeline",
        error: message,
      });

      await this.writeProgress(`## Spec Generation Failed\nError: ${message}\n`);

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
  async handleEscalation(request: EscalationRequest): Promise<EscalationResult> {
    this.status = "handling_escalation";

    try {
      await this.logEventGeneric("escalation_triggered", {
        nodeId: request.nodeId,
        agentId: request.agentId,
        reason: request.reason,
        suggestedAction: request.suggestedAction ?? null,
      });

      // Build escalation context
      const userMessage = [
        "## Escalation Report",
        `**Node:** ${request.nodeId}`,
        `**Agent:** ${request.agentId}`,
        `**Reason:** ${request.reason}`,
        request.suggestedAction !== undefined ? `**Suggested:** ${request.suggestedAction}` : "",
        request.details !== undefined ? `\n**Details:**\n${request.details}` : "",
        this.config.graphSummary !== undefined
          ? `\n## Current Graph\n${this.config.graphSummary}`
          : "",
      ]
        .filter((l) => l.length > 0)
        .join("\n");

      // LLM call to decide
      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: userMessage }],
        system: buildEscalationHandlingPrompt(),
        model: this.model,
      });

      this.config.costTracker.recordCall(
        this.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        LOOM_AGENT_ID,
        request.nodeId,
      );

      const textBlocks = response.content.filter(
        (block): block is { type: "text"; text: string } => block.type === "text",
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");

      const json = extractJson(responseText);
      const modification =
        json !== null
          ? parseGraphModification(json, request.nodeId)
          : {
              action: "skip_node" as const,
              nodeId: request.nodeId,
              reason: "Failed to parse architect response — skipping node for forward progress",
            };

      // Apply modification if graphModifier is available
      if (this.config.graphModifier !== undefined && modification.action !== "no_action") {
        try {
          await this.config.graphModifier.applyModification(modification);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.writeProgress(`## Escalation — Graph modification failed\n${msg}\n`);
        }
      }

      // Log the graph modification
      await this.logEventGeneric("graph_modified", {
        action: modification.action,
        nodeId: modification.nodeId ?? request.nodeId,
        reason: modification.reason,
      });

      // Write to ARCHITECTURE_CHANGES.md
      const changeEntry = [
        `## Escalation Resolution: ${modification.action}`,
        `**Node:** ${modification.nodeId ?? request.nodeId}`,
        `**Reason:** ${modification.reason}`,
        `**Original Issue:** ${request.reason}`,
        `**Timestamp:** ${new Date().toISOString()}`,
        "",
      ].join("\n");

      await this.writeMemory("ARCHITECTURE_CHANGES.md", changeEntry);

      this.status = "idle";
      return { success: true, modification };
    } catch (err: unknown) {
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
  async monitorSharedMemory(): Promise<MonitoringResult> {
    try {
      // Read monitored files
      const memoryContents: string[] = [];
      for (const fileName of MONITORED_MEMORY_FILES) {
        try {
          const file = await this.config.sharedMemory.read(fileName);
          if (file.content.length > 0) {
            memoryContents.push(`## ${fileName}\n${file.content}`);
          }
        } catch {
          // File may not exist yet — skip
        }
      }

      if (memoryContents.length === 0) {
        return {
          issuesDetected: false,
          modification: null,
          summary: "No shared memory content to monitor",
        };
      }

      const userMessage = memoryContents.join("\n\n");

      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: userMessage }],
        system: buildMonitoringPrompt(),
        model: this.model,
      });

      this.config.costTracker.recordCall(
        this.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        LOOM_AGENT_ID,
        null as unknown as string,
      );

      const textBlocks = response.content.filter(
        (block): block is { type: "text"; text: string } => block.type === "text",
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");

      const json = extractJson(responseText);
      if (json === null) {
        return {
          issuesDetected: false,
          modification: null,
          summary: "Could not parse monitoring response",
        };
      }

      const issuesDetected = json["issuesDetected"] === true;
      const summary = typeof json["summary"] === "string" ? json["summary"] : "No summary";

      if (!issuesDetected) {
        return { issuesDetected: false, modification: null, summary };
      }

      const modification = parseGraphModification(json, "");

      // Apply modification if possible
      if (this.config.graphModifier !== undefined && modification.action !== "no_action") {
        try {
          await this.config.graphModifier.applyModification(modification);
          await this.logEventGeneric("graph_modified", {
            action: modification.action,
            nodeId: modification.nodeId ?? "proactive",
            reason: modification.reason,
            source: "monitoring",
          });
        } catch {
          // Non-critical
        }
      }

      return { issuesDetected: true, modification, summary };
    } catch (err: unknown) {
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
  async handleChat(message: string, chatHistory?: string): Promise<ChatResult> {
    this.status = "handling_chat";

    try {
      const classification = await this.classifyMessage(message);

      let result: ChatResult;
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
        content: result.response.slice(0, 500),
      });

      this.status = "idle";
      return result;
    } catch (err: unknown) {
      this.status = "idle";
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        response: `I encountered an error processing your message: ${errorMsg}`,
        category: "question",
        modification: null,
        error: errorMsg,
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
  async classifyMessage(message: string): Promise<ChatClassification> {
    try {
      const response = await this.config.provider.complete({
        messages: [{ role: "user", content: message }],
        system: buildClassificationPrompt(),
        model: this.model,
        maxTokens: CLASSIFICATION_MAX_TOKENS,
      });

      this.config.costTracker.recordCall(
        this.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        LOOM_AGENT_ID,
        null as unknown as string,
      );

      const textBlocks = response.content.filter(
        (block): block is { type: "text"; text: string } => block.type === "text",
      );
      const responseText = textBlocks.map((b) => b.text).join("\n");

      const json = extractJson(responseText);
      if (json !== null) {
        const category = json["category"] as string;
        const validCategories = new Set<string>(["question", "instruction", "graph_change"]);
        if (validCategories.has(category)) {
          return {
            category: category as ChatMessageCategory,
            confidence: typeof json["confidence"] === "number" ? json["confidence"] : 0.5,
            reasoning: typeof json["reasoning"] === "string" ? json["reasoning"] : "",
          };
        }
      }

      return {
        category: "question",
        confidence: 0,
        reasoning: "Classification parsing failed — defaulting to question",
      };
    } catch {
      return {
        category: "question",
        confidence: 0,
        reasoning: "Classification call failed — defaulting to question",
      };
    }
  }

  /**
   * Returns the current lifecycle status of the Loom agent.
   *
   * @returns The agent's current status.
   */
  getStatus(): LoomAgentStatus {
    return this.status;
  }

  /**
   * Update the graph summary used for context in escalation and chat handling.
   *
   * @param summary - New graph summary string.
   */
  updateGraphSummary(summary: string): void {
    (this.config as { graphSummary?: string }).graphSummary = summary;
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
  private async handleQuestion(message: string, chatHistory?: string): Promise<ChatResult> {
    const contextParts = [message];
    if (chatHistory !== undefined && chatHistory.length > 0) {
      contextParts.unshift(`## Previous Chat\n${chatHistory}\n\n## New Message`);
    }
    if (this.config.graphSummary !== undefined) {
      contextParts.push(`\n\n## Current Workflow Graph\n${this.config.graphSummary}`);
    }

    const memoryContext = await this.readSharedMemoryContext();
    if (memoryContext.length > 0) {
      contextParts.push(`\n\n## Project Context (Shared Memory)\n${memoryContext}`);
    }

    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: contextParts.join("\n") }],
      system: buildQuestionHandlingPrompt(),
      model: this.model,
    });

    this.config.costTracker.recordCall(
      this.model,
      response.usage.inputTokens,
      response.usage.outputTokens,
      LOOM_AGENT_ID,
      null as unknown as string,
    );

    const textBlocks = response.content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );

    return {
      response: textBlocks
        .map((b) => b.text)
        .join("\n")
        .trim(),
      category: "question",
      modification: null,
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
  private async handleInstruction(message: string, chatHistory?: string): Promise<ChatResult> {
    const contextParts = [message];
    if (chatHistory !== undefined && chatHistory.length > 0) {
      contextParts.unshift(`## Previous Chat\n${chatHistory}\n\n## New Message`);
    }
    if (this.config.graphSummary !== undefined) {
      contextParts.push(`\n\n## Current Workflow Graph\n${this.config.graphSummary}`);
    }

    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: contextParts.join("\n") }],
      system: buildInstructionHandlingPrompt(),
      model: this.model,
    });

    this.config.costTracker.recordCall(
      this.model,
      response.usage.inputTokens,
      response.usage.outputTokens,
      LOOM_AGENT_ID,
      null as unknown as string,
    );

    const textBlocks = response.content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );
    const responseText = textBlocks
      .map((b) => b.text)
      .join("\n")
      .trim();

    const decisionEntry = [
      `## Developer Instruction`,
      `**Instruction:** ${message}`,
      `**Timestamp:** ${new Date().toISOString()}`,
      "",
    ].join("\n");

    await this.writeMemory("DECISIONS.md", decisionEntry);

    return {
      response: responseText,
      category: "instruction",
      modification: null,
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
  private async handleGraphChange(message: string, chatHistory?: string): Promise<ChatResult> {
    const contextParts = [message];
    if (chatHistory !== undefined && chatHistory.length > 0) {
      contextParts.unshift(`## Previous Chat\n${chatHistory}\n\n## New Message`);
    }
    if (this.config.graphSummary !== undefined) {
      contextParts.push(`\n\n## Current Workflow Graph\n${this.config.graphSummary}`);
    }

    const response = await this.config.provider.complete({
      messages: [{ role: "user", content: contextParts.join("\n") }],
      system: buildGraphChangeHandlingPrompt(),
      model: this.model,
    });

    this.config.costTracker.recordCall(
      this.model,
      response.usage.inputTokens,
      response.usage.outputTokens,
      LOOM_AGENT_ID,
      null as unknown as string,
    );

    const textBlocks = response.content.filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    );
    const responseText = textBlocks.map((b) => b.text).join("\n");

    let modification: GraphModification | null = null;
    const graphChangeMatch = /```json\s*\n?\s*\{[\s\S]*?"graphChange"[\s\S]*?\}\s*\n?\s*```/i.exec(
      responseText,
    );
    if (graphChangeMatch !== null) {
      const changeJson = extractJson(graphChangeMatch[0]);
      if (
        changeJson !== null &&
        typeof changeJson["graphChange"] === "object" &&
        changeJson["graphChange"] !== null
      ) {
        modification = parseGraphModification(
          changeJson["graphChange"] as Record<string, unknown>,
          "",
        );

        if (this.config.graphModifier !== undefined && modification.action !== "no_action") {
          try {
            await this.config.graphModifier.applyModification(modification);
            await this.logEventGeneric("graph_modified", {
              action: modification.action,
              nodeId: modification.nodeId ?? "chat-requested",
              reason: modification.reason,
              source: "chat",
            });
          } catch {
            // Non-critical — graph modification failure doesn't block response
          }
        }
      }
    }

    const cleanResponse = responseText.replace(/```json[\s\S]*?```/g, "").trim();

    return {
      response: cleanResponse,
      category: "graph_change",
      modification,
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
  private async readSharedMemoryContext(): Promise<string> {
    const parts: string[] = [];
    for (const fileName of CONTEXT_MEMORY_FILES) {
      try {
        const file = await this.config.sharedMemory.read(fileName);
        if (file.content.length > 0) {
          parts.push(`### ${fileName}\n${file.content}`);
        }
      } catch {
        // File may not exist yet — skip
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
  private handleSpecProgress(event: SpecStepEvent): void {
    switch (event.type) {
      case "spec_step_started":
        void this.logEvent("spec_phase_started", {
          phase: event.stepName,
          stepIndex: event.stepIndex,
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} — started\n`,
        );
        break;

      case "spec_step_completed":
        void this.logEvent("spec_phase_completed", {
          phase: event.stepName,
          stepIndex: event.stepIndex,
          artifactPath: event.artifactPath,
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} — completed\n`,
        );
        break;

      case "spec_step_error":
        void this.logEvent("spec_phase_completed", {
          phase: event.stepName,
          stepIndex: event.stepIndex,
          error: event.error.message,
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} — failed: ${event.error.message}\n`,
        );
        break;

      case "clarification_requested":
        void this.writeProgress(
          `### Clarification requested in ${event.stepName} (${String(event.questions.length)} questions)\n`,
        );
        break;

      case "clarification_answered":
        void this.writeProgress(`### Clarification answered in ${event.stepName}\n`);
        break;

      case "spec_pipeline_completed":
        // Handled in runSpecGeneration after the pipeline returns
        break;
    }
  }

  /**
   * Log a spec-phase event to the project's events.jsonl file.
   *
   * @param type - Event type identifier (spec_phase_started or spec_phase_completed).
   * @param details - Event-specific payload data.
   */
  private async logEvent(
    type: "spec_phase_started" | "spec_phase_completed",
    details: Record<string, unknown>,
  ): Promise<void> {
    const event = createEvent({
      type,
      workflowId: this.config.eventLog.workflowId,
      agentId: LOOM_AGENT_ID,
      details,
    });

    await appendEvent(this.config.projectPath, event);
  }

  /**
   * Log a generic event to the project's events.jsonl file.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload data.
   */
  private async logEventGeneric(type: EventType, details: Record<string, unknown>): Promise<void> {
    try {
      const event = createEvent({
        type,
        workflowId: this.config.eventLog.workflowId,
        agentId: LOOM_AGENT_ID,
        details,
      });
      await appendEvent(this.config.projectPath, event);
    } catch {
      // Event logging failure is non-critical
    }
  }

  /**
   * Write a progress update to the PROGRESS.md shared memory file.
   *
   * Errors are silently swallowed — progress writes are best-effort
   * and must not disrupt spec generation on cleanup/race conditions.
   *
   * @param content - Markdown content to append.
   */
  private async writeProgress(content: string): Promise<void> {
    try {
      await this.config.sharedMemory.write("PROGRESS.md", content, LOOM_AGENT_ID);
    } catch {
      // Non-critical — progress writes are fire-and-forget
    }
  }

  /**
   * Write content to a named shared memory file.
   *
   * @param fileName - Shared memory file name.
   * @param content - Markdown content to append.
   */
  private async writeMemory(fileName: string, content: string): Promise<void> {
    try {
      await this.config.sharedMemory.write(fileName, content, LOOM_AGENT_ID);
    } catch {
      // Non-critical
    }
  }
}
