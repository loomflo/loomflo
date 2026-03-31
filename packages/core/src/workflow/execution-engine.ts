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

import type { CostTracker } from "../costs/tracker.js";
import { appendEvent, createEvent } from "../persistence/events.js";
import { saveWorkflowState } from "../persistence/state.js";
import type { NodeStatus } from "../types.js";
import type { WorkflowGraph } from "./graph.js";
import type { WorkflowNode } from "./node.js";
import { Scheduler } from "./scheduler.js";
import type { WorkflowManager } from "./workflow.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Outcome of executing a single workflow node.
 *
 * Maps to the terminal states a node can reach after execution.
 */
export type NodeExecutionStatus = "done" | "failed" | "blocked";

/**
 * Result returned by a {@link NodeExecutor} after a node finishes execution.
 *
 * @param status - Terminal status the node reached.
 * @param cost - Cost in USD incurred during execution.
 * @param error - Human-readable error message when status is `failed` or `blocked`.
 */
export interface NodeExecutionResult {
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
export type NodeExecutor = (
  node: WorkflowNode,
  manager: WorkflowManager,
) => Promise<NodeExecutionResult>;

/**
 * Configuration for creating a {@link WorkflowExecutionEngine}.
 *
 * @param manager - The WorkflowManager holding workflow state.
 * @param executor - Function to execute individual nodes.
 * @param costTracker - Cost tracker for budget enforcement.
 * @param scheduler - Optional pre-configured Scheduler (one is created if omitted).
 */
export interface ExecutionEngineConfig {
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
export interface ExecutionResult {
  /** The workflow's terminal status after execution. */
  status: "done" | "failed" | "paused";
  /** IDs of nodes that completed successfully. */
  completedNodes: string[];
  /** IDs of nodes that ended in `failed` or `blocked`. */
  failedNodes: string[];
  /** Total cost in USD incurred during this execution run. */
  totalCost: number;
  /** Human-readable reason when the workflow did not reach `done`. */
  haltReason?: string;
}

// ============================================================================
// Engine
// ============================================================================

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
export class WorkflowExecutionEngine {
  private readonly manager: WorkflowManager;
  private readonly executor: NodeExecutor;
  private readonly costTracker: CostTracker;
  private readonly scheduler: Scheduler;
  private readonly graph: WorkflowGraph;

  /** Node IDs currently being executed (in-flight promises). */
  private readonly activeNodes: Map<string, Promise<NodeExecutionResult>> = new Map();
  /** Tracks which nodes have been activated to prevent double-activation. */
  private readonly activatedNodes: Set<string> = new Set();
  /** IDs of nodes that completed with `done`. */
  private readonly completedNodes: string[] = [];
  /** IDs of nodes that ended with `failed` or `blocked`. */
  private readonly failedNodes: string[] = [];

  /** Flag set by {@link stop} to halt the engine gracefully. */
  private stopped = false;
  /** Resolver for the main execution loop's wait-for-completion promise. */
  private wakeUp: (() => void) | null = null;

  /**
   * Creates a new WorkflowExecutionEngine.
   *
   * @param config - Engine configuration with manager, executor, and cost tracker.
   */
  constructor(config: ExecutionEngineConfig) {
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
  async run(): Promise<ExecutionResult> {
    if (this.manager.status !== "running") {
      throw new Error(
        `Cannot start execution: workflow is in "${this.manager.status}" state, expected "running"`,
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
  stop(): void {
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
  getActiveNodeCount(): number {
    return this.activeNodes.size;
  }

  /**
   * Returns the IDs of nodes that have completed successfully so far.
   *
   * @returns Array of completed node IDs.
   */
  getCompletedNodes(): string[] {
    return [...this.completedNodes];
  }

  /**
   * Returns the IDs of nodes that have failed or are blocked.
   *
   * @returns Array of failed/blocked node IDs.
   */
  getFailedNodes(): string[] {
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
  private activateReadyNodes(): void {
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
  private findReadyNodes(): string[] {
    const ready: string[] = [];

    for (const node of this.manager.getAllNodes()) {
      if (node.status !== "pending") continue;
      if (this.activatedNodes.has(node.id)) continue;

      const predecessors = this.graph.getPredecessors(node.id);
      const allDone = predecessors.every((predId) => {
        const pred = this.manager.getNode(predId);
        return pred !== undefined && pred.status === "done";
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
  private hasActivatableNodes(): boolean {
    for (const node of this.manager.getAllNodes()) {
      if (node.status !== "pending") continue;
      if (this.activatedNodes.has(node.id)) continue;

      const predecessors = this.graph.getPredecessors(node.id);
      const blocked = predecessors.some((predId) => {
        const pred = this.manager.getNode(predId);
        return pred !== undefined && (pred.status === "failed" || pred.status === "blocked");
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
  private activateNode(nodeId: string): void {
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
  private startNodeExecution(nodeId: string): void {
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
  private async executeNode(nodeId: string, node: WorkflowNode): Promise<NodeExecutionResult> {
    await this.logNodeEvent(nodeId, "node_started", { title: node.title });

    let result: NodeExecutionResult;
    try {
      result = await this.executor(node, this.manager);
    } catch (error: unknown) {
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
  private async applyNodeResult(
    nodeId: string,
    node: WorkflowNode,
    result: NodeExecutionResult,
  ): Promise<void> {
    const targetStatus: NodeStatus = result.status;

    if (node.canTransition(targetStatus)) {
      node.transition(targetStatus);
    }

    if (result.cost > 0) {
      this.manager.updateTotalCost(result.cost);
    }

    if (result.status === "done") {
      this.completedNodes.push(nodeId);
      await this.logNodeEvent(nodeId, "node_completed", {
        cost: result.cost,
      });
    } else {
      this.failedNodes.push(nodeId);
      const eventType = result.status === "blocked" ? "node_blocked" : "node_failed";
      await this.logNodeEvent(nodeId, eventType, {
        error: result.error ?? "Unknown error",
        cost: result.cost,
      });
      // Eagerly propagate blocked status to downstream pending nodes so that
      // isTerminal() can correctly detect the terminal state without waiting
      // for all chains to be explicitly checked. Without this, a chain like
      // A → B → C where A returns "blocked" leaves C with a pending predecessor
      // (B) that has no direct failed ancestor — causing an infinite loop.
      await this.markUnreachableNodesBlocked();
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
  private async waitForAnyCompletion(): Promise<void> {
    if (this.activeNodes.size === 0) return;

    // Guard against a race condition where signalWakeUp() fires before
    // the wakeUp resolver is assigned. The Promise constructor runs
    // synchronously, so wakeUp is set before any async continuation can call it.
    const racePromise = new Promise<void>((resolve) => {
      this.wakeUp = resolve;
    });

    const activePromises = [...this.activeNodes.values()].map((p) => p.then((): void => undefined));

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
  private isTerminal(): boolean {
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
          return pred !== undefined && (pred.status === "failed" || pred.status === "blocked");
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
  private async buildTerminalResult(): Promise<ExecutionResult> {
    await this.markUnreachableNodesBlocked();

    const allDone = this.manager.getAllNodes().every((n) => n.status === "done");

    if (allDone) {
      await this.manager.transition("done");
      return {
        status: "done",
        completedNodes: [...this.completedNodes],
        failedNodes: [...this.failedNodes],
        totalCost: this.costTracker.getTotalCost(),
      };
    }

    await this.manager.transition("failed");
    return {
      status: "failed",
      completedNodes: [...this.completedNodes],
      failedNodes: [...this.failedNodes],
      totalCost: this.costTracker.getTotalCost(),
      haltReason: "One or more nodes failed or are blocked",
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
  private async buildPausedResult(reason: string): Promise<ExecutionResult> {
    await this.drainActiveNodes();
    await this.manager.transition("paused");

    return {
      status: "paused",
      completedNodes: [...this.completedNodes],
      failedNodes: [...this.failedNodes],
      totalCost: this.costTracker.getTotalCost(),
      haltReason: reason,
    };
  }

  /**
   * Builds a failed result and transitions the workflow to `failed`.
   *
   * @param reason - Human-readable reason for the failure.
   * @returns The failed execution result.
   */
  private async buildFailedResult(reason: string): Promise<ExecutionResult> {
    await this.drainActiveNodes();
    await this.manager.transition("failed");

    return {
      status: "failed",
      completedNodes: [...this.completedNodes],
      failedNodes: [...this.failedNodes],
      totalCost: this.costTracker.getTotalCost(),
      haltReason: reason,
    };
  }

  /**
   * Transitions all pending nodes downstream of failed/blocked nodes to `blocked`.
   *
   * Prevents the engine from waiting on nodes that can never be activated.
   */
  private async markUnreachableNodesBlocked(): Promise<void> {
    let changed = true;

    while (changed) {
      changed = false;

      for (const node of this.manager.getAllNodes()) {
        if (node.status !== "pending") continue;

        const predecessors = this.graph.getPredecessors(node.id);
        const hasFailedPredecessor = predecessors.some((predId) => {
          const pred = this.manager.getNode(predId);
          return pred !== undefined && (pred.status === "failed" || pred.status === "blocked");
        });

        if (hasFailedPredecessor) {
          node.transition("waiting");
          node.transition("running");
          node.transition("blocked");
          this.failedNodes.push(node.id);
          await this.logNodeEvent(node.id, "node_blocked", {
            error: "Predecessor node failed or is blocked",
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
  private async drainActiveNodes(): Promise<void> {
    if (this.activeNodes.size === 0) return;
    await Promise.allSettled([...this.activeNodes.values()]);
  }

  /**
   * Wakes up the main execution loop if it is waiting.
   */
  private signalWakeUp(): void {
    if (this.wakeUp) {
      this.wakeUp();
    }
  }

  /**
   * Persists the current workflow state to disk.
   */
  private async persistState(): Promise<void> {
    await saveWorkflowState(this.manager.projectPath, this.manager.toJSON());
  }

  /**
   * Logs a workflow-level event.
   *
   * @param type - Event type identifier.
   * @param details - Event-specific payload.
   */
  private async logWorkflowEvent(
    type: "workflow_started" | "workflow_completed" | "workflow_paused",
    details: Record<string, unknown>,
  ): Promise<void> {
    const event = createEvent({
      type,
      workflowId: this.manager.id,
      details,
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
  private async logNodeEvent(
    nodeId: string,
    type: "node_started" | "node_completed" | "node_failed" | "node_blocked",
    details: Record<string, unknown>,
  ): Promise<void> {
    const event = createEvent({
      type,
      workflowId: this.manager.id,
      nodeId,
      details,
    });
    await appendEvent(this.manager.projectPath, event);
  }
}
