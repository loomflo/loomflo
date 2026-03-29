/**
 * Workflow state machine managing the full lifecycle of a Loomflo workflow.
 *
 * Wraps the {@link Workflow} data type with validated state transitions,
 * persistence after every change, event logging, and access to the
 * underlying {@link WorkflowGraph} and {@link WorkflowNode} instances.
 */

import { randomUUID } from 'node:crypto';
import type { Config, EventType, Graph, Node, Workflow, WorkflowStatus } from '../types.js';
import { loadWorkflowState, saveWorkflowState } from '../persistence/state.js';
import { appendEvent, createEvent } from '../persistence/events.js';
import { WorkflowGraph } from './graph.js';
import { WorkflowNode } from './node.js';

/**
 * Valid state transitions for the workflow lifecycle.
 *
 * Each key is a current state, and its value is the set of states
 * it may transition to.
 */
const TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  init: ['spec'],
  spec: ['building'],
  building: ['running'],
  running: ['paused', 'done', 'failed'],
  paused: ['running'],
  done: [],
  failed: [],
} as const;

/**
 * Maps workflow state transitions to the event type that should be logged.
 *
 * Keyed by target state. Only states that emit workflow-level events are included.
 */
const TRANSITION_EVENTS: Readonly<Partial<Record<WorkflowStatus, EventType>>> = {
  running: 'workflow_started',
  paused: 'workflow_paused',
  done: 'workflow_completed',
} as const;

/**
 * Information about a resumed workflow, describing which nodes
 * were completed, reset, or rescheduled during the resume process.
 */
export interface ResumeInfo {
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
export class WorkflowManager {
  private data: Workflow;
  private graph: WorkflowGraph;
  private nodeInstances: Map<string, WorkflowNode>;

  /**
   * Creates a WorkflowManager from existing workflow data.
   *
   * Reconstructs the {@link WorkflowGraph} and all {@link WorkflowNode}
   * instances from the serialized workflow state.
   *
   * @param data - A validated {@link Workflow} object.
   */
  constructor(data: Workflow) {
    this.data = { ...data };
    this.graph = WorkflowGraph.fromJSON(data.graph);
    this.nodeInstances = new Map();
    for (const node of Object.values(data.graph.nodes)) {
      this.nodeInstances.set(node.id, new WorkflowNode(node));
    }
  }

  /** The workflow's unique identifier. */
  get id(): string {
    return this.data.id;
  }

  /** The current workflow lifecycle status. */
  get status(): WorkflowStatus {
    return this.data.status;
  }

  /** The original project description. */
  get description(): string {
    return this.data.description;
  }

  /** The absolute path to the project workspace. */
  get projectPath(): string {
    return this.data.projectPath;
  }

  /** The accumulated total cost in USD. */
  get totalCost(): number {
    return this.data.totalCost;
  }

  /** The workflow configuration. */
  get config(): Readonly<Config> {
    return this.data.config;
  }

  /** ISO 8601 timestamp when the workflow was created. */
  get createdAt(): string {
    return this.data.createdAt;
  }

  /** ISO 8601 timestamp of the last state change. */
  get updatedAt(): string {
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
  static async create(
    description: string,
    projectPath: string,
    config: Config,
  ): Promise<WorkflowManager> {
    const now = new Date().toISOString();
    const emptyGraph: Graph = { nodes: {}, edges: [], topology: 'linear' };

    const workflow: Workflow = {
      id: randomUUID(),
      status: 'init',
      description,
      projectPath,
      graph: emptyGraph,
      config,
      createdAt: now,
      updatedAt: now,
      totalCost: 0,
    };

    const manager = new WorkflowManager(workflow);

    await saveWorkflowState(projectPath, manager.toJSON());

    const event = createEvent({
      type: 'workflow_created',
      workflowId: workflow.id,
      details: { description, projectPath },
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
  static async resume(
    projectPath: string,
  ): Promise<{ manager: WorkflowManager; info: ResumeInfo } | null> {
    const state = await loadWorkflowState(projectPath);
    if (!state) {
      return null;
    }

    if (state.status !== 'running' && state.status !== 'paused') {
      throw new Error(
        `Cannot resume workflow in "${state.status}" status. ` +
          'Only "running" or "paused" workflows can be resumed.',
      );
    }

    const completedNodeIds: string[] = [];
    const resetNodeIds: string[] = [];
    const rescheduledNodeIds: string[] = [];
    let resumedFrom: string | null = null;

    for (const node of Object.values(state.graph.nodes)) {
      if (node.status === 'done') {
        completedNodeIds.push(node.id);
      } else if (node.status === 'running' || node.status === 'review') {
        if (resumedFrom === null) {
          resumedFrom = node.id;
        }
        resetNodeIds.push(node.id);
        node.status = 'pending';
        node.agents = [];
        node.retryCount = 0;
        node.reviewReport = null;
        node.cost = 0;
        node.startedAt = null;
        node.completedAt = null;
        node.resumeAt = null;
      } else if (node.status === 'waiting') {
        if (node.resumeAt !== null) {
          rescheduledNodeIds.push(node.id);
        } else {
          // Waiting node with no resumeAt is inconsistent — reset to pending
          // so the engine re-evaluates it on the next scheduling pass.
          resetNodeIds.push(node.id);
          node.status = 'pending';
        }
      }
    }

    if (state.status === 'paused') {
      state.status = 'running';
    }
    state.updatedAt = new Date().toISOString();

    const manager = new WorkflowManager(state);
    await saveWorkflowState(projectPath, manager.toJSON());

    const event = createEvent({
      type: 'workflow_resumed',
      workflowId: state.id,
      details: { resumedFrom, completedNodeIds, resetNodeIds, rescheduledNodeIds },
    });
    await appendEvent(projectPath, event);

    return {
      manager,
      info: { resumedFrom, completedNodeIds, resetNodeIds, rescheduledNodeIds },
    };
  }

  /**
   * Checks whether a transition to the given status is valid.
   *
   * @param to - The target workflow status to check.
   * @returns `true` if the transition is allowed, `false` otherwise.
   */
  canTransition(to: WorkflowStatus): boolean {
    return TRANSITIONS[this.data.status].includes(to);
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
  async transition(to: WorkflowStatus): Promise<void> {
    if (!this.canTransition(to)) {
      throw new Error(
        `Invalid workflow transition: "${this.data.status}" → "${to}". ` +
          `Valid transitions: ${TRANSITIONS[this.data.status].join(', ') || 'none'}`,
      );
    }

    const from = this.data.status;
    this.data.status = to;
    this.data.updatedAt = new Date().toISOString();

    await saveWorkflowState(this.data.projectPath, this.toJSON());

    const eventType = this.resolveEventType(from, to);
    if (eventType) {
      const event = createEvent({
        type: eventType,
        workflowId: this.data.id,
        details: { from, to },
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
  async pause(): Promise<void> {
    await this.transition('paused');
  }

  /**
   * Returns the {@link WorkflowGraph} instance for this workflow.
   *
   * @returns The workflow's directed acyclic graph.
   */
  getGraph(): WorkflowGraph {
    return this.graph;
  }

  /**
   * Retrieves a {@link WorkflowNode} by ID.
   *
   * @param nodeId - The unique node identifier.
   * @returns The WorkflowNode instance, or undefined if not found.
   */
  getNode(nodeId: string): WorkflowNode | undefined {
    return this.nodeInstances.get(nodeId);
  }

  /**
   * Returns all {@link WorkflowNode} instances in the workflow.
   *
   * @returns Array of all WorkflowNode instances.
   */
  getAllNodes(): WorkflowNode[] {
    return [...this.nodeInstances.values()];
  }

  /**
   * Adds a cost amount to the workflow's accumulated total cost.
   *
   * @param amount - The cost in USD to add (must be non-negative).
   * @throws Error if the amount is negative.
   */
  updateTotalCost(amount: number): void {
    if (amount < 0) {
      throw new Error(`Cost amount must be non-negative, got ${amount}`);
    }
    this.data.totalCost += amount;
  }

  /**
   * Synchronizes the internal graph and node instances from updated node data.
   *
   * Call this after modifying nodes or the graph to ensure the serialized
   * workflow state reflects the current in-memory state.
   */
  syncGraph(): void {
    const graphJSON = this.graph.toJSON();
    const syncedNodes: Record<string, Node> = {};
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
  toJSON(): Workflow {
    this.syncGraph();
    return { ...this.data };
  }

  /**
   * Deserializes a {@link Workflow} object into a WorkflowManager instance.
   *
   * @param data - A validated Workflow object (e.g., from loadWorkflowState).
   * @returns A new WorkflowManager instance.
   */
  static fromJSON(data: Workflow): WorkflowManager {
    return new WorkflowManager(data);
  }

  /**
   * Persists the current workflow state to disk.
   *
   * @param projectPath - Absolute path to the project root.
   */
  async persist(projectPath: string): Promise<void> {
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
  private resolveEventType(from: WorkflowStatus, to: WorkflowStatus): EventType | undefined {
    if (from === 'paused' && to === 'running') {
      return 'workflow_resumed';
    }
    return TRANSITION_EVENTS[to];
  }
}
