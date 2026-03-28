/**
 * Node lifecycle state machine for workflow execution.
 *
 * Wraps the {@link Node} data type with transition validation,
 * agent management, file ownership enforcement, and serialization.
 */

import picomatch from 'picomatch';
import type { AgentInfo, Node, NodeStatus, ReviewReport } from '../types.js';
import { FileOwnershipManager, generateTestPaths } from './file-ownership.js';

/**
 * Valid state transitions for the node lifecycle.
 *
 * Each key is a current state, and its value is the set of states
 * it may transition to.
 */
const TRANSITIONS: Readonly<Record<NodeStatus, readonly NodeStatus[]>> = {
  pending: ['waiting'],
  waiting: ['running'],
  running: ['review', 'done', 'failed', 'blocked'],
  review: ['done', 'running', 'blocked', 'failed'],
  done: [],
  failed: [],
  blocked: [],
} as const;

/**
 * A mutable wrapper around the {@link Node} data type that enforces
 * lifecycle state machine rules, manages agents, and validates
 * file ownership scopes.
 */
export class WorkflowNode {
  private data: Node;

  /**
   * Creates a WorkflowNode from existing node data.
   *
   * @param data - A plain {@link Node} object to wrap.
   */
  constructor(data: Node) {
    this.data = { ...data, agents: [...data.agents] };
  }

  /** The node's unique identifier. */
  get id(): string {
    return this.data.id;
  }

  /** The node's human-readable title. */
  get title(): string {
    return this.data.title;
  }

  /** The current lifecycle status. */
  get status(): NodeStatus {
    return this.data.status;
  }

  /** The number of retry cycles attempted so far. */
  get retryCount(): number {
    return this.data.retryCount;
  }

  /** The maximum allowed retry cycles. */
  get maxRetries(): number {
    return this.data.maxRetries;
  }

  /** The current review report, or null. */
  get reviewReport(): ReviewReport | null {
    return this.data.reviewReport;
  }

  /** The agents assigned to this node. */
  get agents(): readonly AgentInfo[] {
    return this.data.agents;
  }

  /** The file ownership map (agent ID to glob patterns). */
  get fileOwnership(): Readonly<Record<string, string[]>> {
    return this.data.fileOwnership;
  }

  /**
   * Checks whether a transition to the given status is valid.
   *
   * @param to - The target status to check.
   * @returns `true` if the transition is allowed, `false` otherwise.
   */
  canTransition(to: NodeStatus): boolean {
    return TRANSITIONS[this.data.status].includes(to);
  }

  /**
   * Returns all valid next states from the current status.
   *
   * @returns Array of valid target statuses.
   */
  getValidTransitions(): NodeStatus[] {
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
  transition(to: NodeStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(
        `Invalid transition: "${this.data.status}" → "${to}". ` +
          `Valid transitions: ${TRANSITIONS[this.data.status].join(', ') || 'none'}`,
      );
    }

    this.data.status = to;

    const now = new Date().toISOString();

    if (to === 'running' && this.data.startedAt === null) {
      this.data.startedAt = now;
    }

    if (to === 'done' || to === 'failed' || to === 'blocked') {
      this.data.completedAt = now;
    }
  }

  /**
   * Increments the retry count by one.
   *
   * @throws Error if retryCount would exceed maxRetries.
   */
  incrementRetry(): void {
    if (this.data.retryCount >= this.data.maxRetries) {
      throw new Error(
        `Cannot increment retry: count (${this.data.retryCount}) ` +
          `already at or above max (${this.data.maxRetries})`,
      );
    }
    this.data.retryCount += 1;
  }

  /**
   * Sets the review report for this node.
   *
   * @param report - The structured review report from Loomex.
   */
  setReviewReport(report: ReviewReport): void {
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
  updateAgent(agentId: string, updates: Partial<AgentInfo>): void {
    const index = this.data.agents.findIndex((a) => a.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found in node "${this.data.id}"`);
    }
    const existing = this.data.agents[index]!;
    this.data.agents[index] = { ...existing, ...updates, id: agentId };
  }

  /**
   * Adds an agent to this node.
   *
   * @param agent - The agent metadata to add.
   * @throws Error if an agent with the same ID already exists.
   */
  addAgent(agent: AgentInfo): void {
    if (this.data.agents.some((a) => a.id === agent.id)) {
      throw new Error(
        `Agent "${agent.id}" already exists in node "${this.data.id}"`,
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
  removeAgent(agentId: string): void {
    const index = this.data.agents.findIndex((a) => a.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found in node "${this.data.id}"`);
    }
    this.data.agents.splice(index, 1);
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
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
  validateWriteScope(agentId: string, filePath: string): boolean {
    const patterns = this.data.fileOwnership[agentId];
    if (!patterns || patterns.length === 0) {
      return false;
    }
    return picomatch.isMatch(filePath, patterns);
  }

  /**
   * Assigns file ownership glob patterns to an agent.
   *
   * @param agentId - The agent to assign ownership to.
   * @param patterns - Glob patterns defining the agent's write scope.
   * @throws Error if the agent is not assigned to this node.
   */
  setFileOwnership(agentId: string, patterns: string[]): void {
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
  validateNoOverlap(): { valid: boolean; overlaps: string[] } {
    const overlaps: string[] = [];
    const agentIds = Object.keys(this.data.fileOwnership);

    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const idA = agentIds[i]!;
        const idB = agentIds[j]!;
        const patternsA = this.data.fileOwnership[idA]!;
        const patternsB = this.data.fileOwnership[idB]!;

        const matcherA = picomatch(patternsA);
        const matcherB = picomatch(patternsB);

        // Generate test paths from both agents' patterns
        const testPaths = generateTestPaths([...patternsA, ...patternsB]);

        for (const testPath of testPaths) {
          if (matcherA(testPath) && matcherB(testPath)) {
            overlaps.push(
              `Agents "${idA}" and "${idB}" both match "${testPath}"`,
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
  createFileOwnershipManager(): FileOwnershipManager {
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
  applyFileOwnershipState(manager: FileOwnershipManager): void {
    this.data.fileOwnership = manager.getAllScopes();
  }

  /**
   * Serializes the node to a plain {@link Node} object.
   *
   * @returns A copy of the underlying node data.
   */
  toJSON(): Node {
    return {
      ...this.data,
      agents: this.data.agents.map((a) => ({ ...a })),
      fileOwnership: Object.fromEntries(
        Object.entries(this.data.fileOwnership).map(([k, v]) => [k, [...v]]),
      ),
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
  static create(
    id: string,
    title: string,
    instructions: string,
    options?: {
      delay?: string;
      maxRetries?: number;
      agents?: AgentInfo[];
      fileOwnership?: Record<string, string[]>;
    },
  ): WorkflowNode {
    return new WorkflowNode({
      id,
      title,
      status: 'pending',
      instructions,
      delay: options?.delay ?? '0',
      resumeAt: null,
      agents: options?.agents ?? [],
      fileOwnership: options?.fileOwnership ?? {},
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 3,
      reviewReport: null,
      cost: 0,
      startedAt: null,
      completedAt: null,
    });
  }
}

