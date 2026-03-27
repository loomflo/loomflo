/**
 * Escalation manager — concrete implementation of {@link EscalationHandlerLike}.
 *
 * Connects Loomi (Orchestrator) escalations to Loom (Architect) by:
 * 1. Receiving escalation requests from Loomi via the {@link EscalationHandlerLike} interface
 * 2. Making an LLM call to analyze the escalation and decide on a graph modification
 * 3. Applying the modification via a {@link GraphModifierLike} callback
 * 4. Logging the change to shared memory (ARCHITECTURE_CHANGES.md) and events.jsonl
 */

import type { CostTracker } from '../costs/tracker.js';
import type { SharedMemoryManager } from '../memory/shared-memory.js';
import { createEvent, appendEvent } from '../persistence/events.js';
import type { LLMProvider } from '../providers/base.js';
import type { EscalationHandlerLike, EscalationRequest } from '../tools/escalate.js';
import type { EventType } from '../types.js';

// ============================================================================
// GraphModification
// ============================================================================

/**
 * Describes a modification to the workflow graph decided by the Architect.
 */
export interface GraphModification {
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

// ============================================================================
// GraphModifierLike
// ============================================================================

/**
 * Minimal interface for applying graph modifications.
 *
 * The concrete implementation lives in the workflow engine. This interface
 * decouples the escalation manager from the graph implementation.
 */
export interface GraphModifierLike {
  /**
   * Apply a graph modification.
   *
   * @param modification - The modification to apply.
   * @returns Resolves when the modification has been applied and persisted.
   */
  applyModification(modification: GraphModification): Promise<void>;
}

// ============================================================================
// EscalationManagerConfig
// ============================================================================

/**
 * Configuration for the {@link EscalationManager}.
 */
export interface EscalationManagerConfig {
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
  eventLog: { workflowId: string };
  /** Callback for applying graph modifications. */
  graphModifier: GraphModifierLike;
}

// ============================================================================
// Constants
// ============================================================================

/** Agent ID used for escalation event logging. */
const ESCALATION_AGENT_ID = 'loom-escalation';

// ============================================================================
// Prompts
// ============================================================================

/**
 * Build the system prompt for the escalation decision LLM call.
 *
 * @returns System prompt instructing the LLM to decide on a graph modification.
 */
function buildEscalationSystemPrompt(): string {
  return [
    'You are Loom, the Architect agent in the Loomflo framework.',
    'An Orchestrator (Loomi) has submitted an escalation to you. A node in the workflow has failed or is blocked.',
    '',
    'Your task is to decide how to modify the workflow graph to work around the issue.',
    'The workflow must NEVER deadlock — you must always choose an action that allows forward progress.',
    '',
    'Available actions:',
    '- add_node: Insert a new node to handle the work differently. Specify title, instructions, and where to insert.',
    '- modify_node: Change the instructions of the failed node so a retry has a better chance. Specify the nodeId and new instructions.',
    '- remove_node: Remove the failed node if its work is not critical. Specify the nodeId.',
    '- skip_node: Mark the node as done (skipped) and move on. Use when the node\'s work can be deferred or is optional. Specify the nodeId.',
    '- no_action: No graph change needed — the issue will resolve on its own or is informational only.',
    '',
    'Respond with ONLY a JSON object in this exact format (no markdown, no explanation outside the JSON):',
    '{',
    '  "action": "add_node|modify_node|remove_node|skip_node|no_action",',
    '  "nodeId": "target-node-id (for modify/remove/skip, omit for add/no_action)",',
    '  "newNode": {',
    '    "title": "Node Title (for add_node only)",',
    '    "instructions": "Markdown instructions (for add_node only)",',
    '    "insertAfter": "node-id (optional)",',
    '    "insertBefore": "node-id (optional)"',
    '  },',
    '  "modifiedInstructions": "New instructions (for modify_node only)",',
    '  "reason": "Brief explanation of why you chose this action"',
    '}',
  ].join('\n');
}

/**
 * Build the user message for the escalation decision LLM call.
 *
 * @param request - The escalation request from Loomi.
 * @returns Formatted user message with escalation context.
 */
function buildEscalationUserMessage(request: EscalationRequest): string {
  const parts = [
    '## Escalation Report',
    '',
    `**Node:** ${request.nodeId}`,
    `**Agent:** ${request.agentId}`,
    `**Reason:** ${request.reason}`,
  ];

  if (request.suggestedAction !== undefined) {
    parts.push(`**Suggested Action:** ${request.suggestedAction}`);
  }

  if (request.details !== undefined && request.details.length > 0) {
    parts.push('', '**Details:**', request.details);
  }

  return parts.join('\n');
}

// ============================================================================
// JSON Extraction
// ============================================================================

/**
 * Extract a JSON object from an LLM response that may contain markdown fences.
 *
 * @param text - Raw text from the LLM response.
 * @returns Parsed JSON value.
 * @throws Error if no valid JSON can be extracted.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through
  }

  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch?.[1] !== undefined) {
    return JSON.parse(fenceMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error('Failed to extract JSON from LLM response');
}

/**
 * Parse the LLM response into a {@link GraphModification}.
 *
 * Falls back to a skip_node action if parsing fails, to ensure forward progress.
 *
 * @param text - Raw LLM response text.
 * @param nodeId - The escalated node ID (used for fallback).
 * @returns Parsed or fallback graph modification.
 */
function parseModification(text: string, nodeId: string): GraphModification {
  try {
    const json = extractJson(text) as Record<string, unknown>;
    const action = json['action'] as GraphModification['action'] | undefined;
    const validActions = new Set(['add_node', 'modify_node', 'remove_node', 'skip_node', 'no_action']);

    if (action === undefined || !validActions.has(action)) {
      return {
        action: 'skip_node',
        nodeId,
        reason: `LLM returned invalid action "${String(action)}" — defaulting to skip_node for forward progress`,
      };
    }

    const modification: GraphModification = {
      action,
      reason: typeof json['reason'] === 'string' ? json['reason'] : 'No reason provided',
    };

    if (typeof json['nodeId'] === 'string') {
      modification.nodeId = json['nodeId'];
    }

    if (action === 'add_node' && typeof json['newNode'] === 'object' && json['newNode'] !== null) {
      const newNode = json['newNode'] as Record<string, unknown>;
      modification.newNode = {
        title: typeof newNode['title'] === 'string' ? newNode['title'] : 'Recovery Node',
        instructions: typeof newNode['instructions'] === 'string' ? newNode['instructions'] : '',
      };
      if (typeof newNode['insertAfter'] === 'string') {
        modification.newNode.insertAfter = newNode['insertAfter'];
      }
      if (typeof newNode['insertBefore'] === 'string') {
        modification.newNode.insertBefore = newNode['insertBefore'];
      }
    }

    if (action === 'modify_node' && typeof json['modifiedInstructions'] === 'string') {
      modification.modifiedInstructions = json['modifiedInstructions'];
    }

    return modification;
  } catch {
    return {
      action: 'skip_node',
      nodeId,
      reason: 'Failed to parse LLM escalation response — defaulting to skip_node for forward progress',
    };
  }
}

// ============================================================================
// EscalationManager
// ============================================================================

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
export class EscalationManager implements EscalationHandlerLike {
  private readonly config: EscalationManagerConfig;

  /**
   * Create an EscalationManager instance.
   *
   * @param config - Manager configuration with provider, graph modifier, and logging.
   */
  constructor(config: EscalationManagerConfig) {
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
  async escalate(request: EscalationRequest): Promise<void> {
    // Log the escalation event
    await this.logEvent('escalation_triggered', {
      nodeId: request.nodeId,
      agentId: request.agentId,
      reason: request.reason,
      suggestedAction: request.suggestedAction ?? null,
      details: request.details ?? null,
    });

    // Make LLM call to decide on modification
    let modification: GraphModification;
    try {
      const systemPrompt = buildEscalationSystemPrompt();
      const userMessage = buildEscalationUserMessage(request);

      const response = await this.config.provider.complete({
        messages: [{ role: 'user', content: userMessage }],
        system: systemPrompt,
        model: this.config.model,
      });

      // Record cost
      this.config.costTracker.recordCall(
        this.config.model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        ESCALATION_AGENT_ID,
        request.nodeId,
      );

      // Extract text response
      const textBlocks = response.content.filter(
        (block): block is { type: 'text'; text: string } => block.type === 'text',
      );
      const responseText = textBlocks.map((b) => b.text).join('\n');

      modification = parseModification(responseText, request.nodeId);
    } catch {
      // LLM call failed — fall back to skip_node
      modification = {
        action: 'skip_node',
        nodeId: request.nodeId,
        reason: 'Escalation LLM call failed — defaulting to skip_node for forward progress',
      };
    }

    // Apply the modification (skip for no_action)
    if (modification.action === 'no_action') {
      // Log but don't modify the graph
      await this.logEvent('graph_modified', {
        action: 'no_action',
        nodeId: modification.nodeId ?? request.nodeId,
        reason: modification.reason,
      });
    }

    try {
      if (modification.action !== 'no_action') {
        await this.config.graphModifier.applyModification(modification);
      }
    } catch {
      // Graph modification failed — log but don't re-throw
      await this.logEvent('graph_modified', {
        action: modification.action,
        nodeId: modification.nodeId ?? request.nodeId,
        reason: modification.reason,
        error: 'Graph modification application failed',
      });
      return;
    }

    // Log the graph modification event
    await this.logEvent('graph_modified', {
      action: modification.action,
      nodeId: modification.nodeId ?? request.nodeId,
      reason: modification.reason,
      ...(modification.newNode !== undefined && { newNodeTitle: modification.newNode.title }),
    });

    // Write to ARCHITECTURE_CHANGES.md
    const changeParts = [
      `## Escalation: ${modification.action}`,
      `**Node:** ${modification.nodeId ?? request.nodeId}`,
      `**Reason:** ${modification.reason}`,
      `**Escalated by:** ${request.agentId}`,
      `**Original escalation:** ${request.reason}`,
    ];

    if (modification.newNode !== undefined) {
      changeParts.push(`**New Node Title:** ${modification.newNode.title}`);
      changeParts.push(`**New Node Instructions:** ${modification.newNode.instructions}`);
      if (modification.newNode.insertAfter !== undefined) {
        changeParts.push(`**Insert after:** ${modification.newNode.insertAfter}`);
      }
      if (modification.newNode.insertBefore !== undefined) {
        changeParts.push(`**Insert before:** ${modification.newNode.insertBefore}`);
      }
    }

    if (modification.modifiedInstructions !== undefined) {
      changeParts.push(`**Modified Instructions:** ${modification.modifiedInstructions}`);
    }

    changeParts.push(`**Timestamp:** ${new Date().toISOString()}`, '');

    const changeEntry = changeParts.join('\n');

    try {
      await this.config.sharedMemory.write(
        'ARCHITECTURE_CHANGES.md',
        changeEntry,
        ESCALATION_AGENT_ID,
      );
    } catch {
      // Shared memory write failed — non-critical, continue
    }
  }

  /**
   * Log an event to the project's events.jsonl file.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload data.
   */
  private async logEvent(
    type: EventType,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      const event = createEvent({
        type,
        workflowId: this.config.eventLog.workflowId,
        agentId: ESCALATION_AGENT_ID,
        details,
      });
      await appendEvent(this.config.workspacePath, event);
    } catch {
      // Event logging failed — non-critical
    }
  }
}
