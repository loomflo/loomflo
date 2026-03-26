/**
 * Loom (Architect) agent — the top-level agent in the Loomflo hierarchy.
 *
 * There is exactly one Loom per project. It persists for the entire workflow
 * lifetime and is responsible for:
 * - Driving the SpecEngine pipeline (Phase 1: spec generation)
 * - Managing the transition from Phase 1 to Phase 2 (execution)
 * - Writing all artifacts to `.loomflo/specs/`
 * - Logging events to the EventLog
 * - Tracking costs via CostTracker
 *
 * This module implements ONLY the spec-generation mode. Execution mode
 * (monitoring, escalation handling, chat) will be added in T075.
 */

import type { CostTracker } from '../costs/tracker.js';
import type { SharedMemoryManager } from '../memory/shared-memory.js';
import { createEvent, appendEvent } from '../persistence/events.js';
import type { LLMProvider } from '../providers/base.js';
import type {
  SpecPipelineResult,
  SpecStepEvent,
  ClarificationCallback,
} from '../spec/spec-engine.js';
import { SpecEngine } from '../spec/spec-engine.js';

// ============================================================================
// Constants
// ============================================================================

/** Default LLM model for the Loom agent per constitution (claude-opus-4-6). */
const DEFAULT_LOOM_MODEL = 'claude-opus-4-6';

/** Agent ID used for event logging and shared memory attribution. */
const LOOM_AGENT_ID = 'loom';

// ============================================================================
// LoomAgentStatus
// ============================================================================

/**
 * Lifecycle status of the Loom agent.
 *
 * - `created`: Agent instantiated but no work started.
 * - `running_spec`: Spec-generation pipeline is executing.
 * - `running_execution`: Execution mode is active (T075).
 * - `idle`: Work completed or awaiting further instructions.
 */
export type LoomAgentStatus = 'created' | 'running_spec' | 'running_execution' | 'idle';

// ============================================================================
// LoomConfig
// ============================================================================

/**
 * Configuration for creating a Loom agent instance.
 *
 * @param provider - LLM provider for making completion calls.
 * @param model - Model identifier (defaults to claude-opus-4-6).
 * @param projectPath - Absolute path to the project workspace.
 * @param eventLog - Event log for persisting workflow events.
 * @param sharedMemory - Shared memory manager for cross-agent state.
 * @param costTracker - Cost tracker for LLM usage accounting.
 * @param maxTokensPerCall - Maximum tokens per LLM call (optional).
 * @param clarificationCallback - Callback for handling ambiguity questions (optional).
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
}

// ============================================================================
// LoomAgent
// ============================================================================

/**
 * The Loom (Architect) agent — top-level agent, one per project.
 *
 * In spec-generation mode, Loom drives the {@link SpecEngine} pipeline,
 * logs events, tracks costs, and writes progress updates to shared memory.
 *
 * The agent does NOT use the base agent loop for spec generation — it
 * drives the SpecEngine directly. The base agent loop will be used in
 * execution mode (T075) for responding to escalations and chat.
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
 * const result = await loom.runSpecGeneration('Build a REST API with auth');
 * ```
 */
export class LoomAgent {
  private readonly config: LoomConfig;
  private readonly model: string;
  private status: LoomAgentStatus = 'created';

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
    this.status = 'running_spec';

    await this.logEvent('spec_phase_started', {
      phase: 'pipeline',
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
    });

    const onProgress = (event: SpecStepEvent): void => {
      this.handleSpecProgress(event);
    };

    try {
      const result = await engine.runPipeline(description, onProgress);

      await this.logEvent('spec_phase_completed', {
        phase: 'pipeline',
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

      this.status = 'idle';
      return result;
    } catch (error: unknown) {
      this.status = 'idle';

      const message = error instanceof Error ? error.message : String(error);
      await this.logEvent('spec_phase_completed', {
        phase: 'pipeline',
        error: message,
      });

      await this.writeProgress(
        `## Spec Generation Failed\nError: ${message}\n`,
      );

      throw error;
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

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

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
      case 'spec_step_started':
        void this.logEvent('spec_phase_started', {
          phase: event.stepName,
          stepIndex: event.stepIndex,
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} — started\n`,
        );
        break;

      case 'spec_step_completed':
        void this.logEvent('spec_phase_completed', {
          phase: event.stepName,
          stepIndex: event.stepIndex,
          artifactPath: event.artifactPath,
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} — completed\n`,
        );
        break;

      case 'spec_step_error':
        void this.logEvent('spec_phase_completed', {
          phase: event.stepName,
          stepIndex: event.stepIndex,
          error: event.error.message,
        });
        void this.writeProgress(
          `### Step ${String(event.stepIndex)}: ${event.stepName} — failed: ${event.error.message}\n`,
        );
        break;

      case 'clarification_requested':
        void this.writeProgress(
          `### Clarification requested in ${event.stepName} (${String(event.questions.length)} questions)\n`,
        );
        break;

      case 'clarification_answered':
        void this.writeProgress(
          `### Clarification answered in ${event.stepName}\n`,
        );
        break;

      case 'spec_pipeline_completed':
        // Handled in runSpecGeneration after the pipeline returns
        break;
    }
  }

  /**
   * Log an event to the project's events.jsonl file.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload data.
   */
  private async logEvent(
    type: 'spec_phase_started' | 'spec_phase_completed',
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
   * Write a progress update to the PROGRESS.md shared memory file.
   *
   * @param content - Markdown content to append.
   */
  private async writeProgress(content: string): Promise<void> {
    await this.config.sharedMemory.write('PROGRESS.md', content, LOOM_AGENT_ID);
  }
}
