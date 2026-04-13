import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Event, EventType, NodeStatus, Workflow } from "../types.js";
import { WorkflowSchema } from "../types.js";
import { queryEvents } from "./events.js";

/** Directory name for Loomflo project-level state. */
const LOOMFLO_DIR = ".loomflo";

/** Workflow state filename. */
const WORKFLOW_FILE = "workflow.json";

/** Debounce delay in milliseconds. */
const DEBOUNCE_MS = 300;

/** Tracks a pending debounced write for a given project path. */
interface PendingWrite {
  /** The timer handle for the debounced write. */
  timer: ReturnType<typeof setTimeout>;
  /** The workflow data to be written. */
  workflow: Workflow;
  /** Resolvers for all promises waiting on this write. */
  resolvers: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
}

/** Map of project paths to their pending debounced writes. */
const pendingWrites = new Map<string, PendingWrite>();

/**
 * Get the path to the workflow.json file for a project.
 *
 * @param projectPath - Absolute path to the project root.
 * @returns The absolute path to the workflow.json file.
 */
function getWorkflowPath(projectPath: string): string {
  return join(projectPath, LOOMFLO_DIR, WORKFLOW_FILE);
}

/**
 * Write a workflow to disk atomically by writing to a temp file first,
 * then renaming it to the target path. Creates the parent directory if needed.
 *
 * @param filePath - Absolute path to the target workflow.json file.
 * @param workflow - The workflow state to persist.
 */
async function atomicWrite(filePath: string, workflow: Workflow): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  const content = JSON.stringify(workflow, null, 2);
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

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
export async function loadWorkflowState(projectPath: string): Promise<Workflow | null> {
  const filePath = getWorkflowPath(projectPath);

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") {
      return null;
    }
    throw new Error(
      `Failed to read workflow state at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in workflow state at ${filePath}`);
  }

  const result = WorkflowSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid workflow state in ${filePath}: ${result.error.message}`);
  }

  return result.data;
}

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
export async function saveWorkflowState(projectPath: string, workflow: Workflow): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const existing = pendingWrites.get(projectPath);

    if (existing) {
      clearTimeout(existing.timer);
      existing.workflow = workflow;
      existing.resolvers.push({ resolve, reject });
      existing.timer = setTimeout(() => void executePendingWrite(projectPath), DEBOUNCE_MS);
    } else {
      const pending: PendingWrite = {
        timer: setTimeout(() => void executePendingWrite(projectPath), DEBOUNCE_MS),
        workflow,
        resolvers: [{ resolve, reject }],
      };
      pendingWrites.set(projectPath, pending);
    }
  });
}

/**
 * Execute a pending debounced write for the given project path.
 *
 * @param projectPath - Absolute path to the project root.
 */
async function executePendingWrite(projectPath: string): Promise<void> {
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
  } catch (error: unknown) {
    for (const { reject } of resolvers) {
      reject(error);
    }
  }
}

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
export async function saveWorkflowStateImmediate(
  projectPath: string,
  workflow: Workflow,
): Promise<void> {
  const existing = pendingWrites.get(projectPath);
  if (existing) {
    clearTimeout(existing.timer);
    pendingWrites.delete(projectPath);
    // Resolve pending promises after write succeeds
    try {
      await atomicWrite(getWorkflowPath(projectPath), workflow);
      for (const { resolve } of existing.resolvers) {
        resolve();
      }
    } catch (error: unknown) {
      for (const { reject } of existing.resolvers) {
        reject(error);
      }
      throw error;
    }
    return;
  }

  await atomicWrite(getWorkflowPath(projectPath), workflow);
}

/**
 * Flush all pending debounced writes across all project paths.
 *
 * Waits for every pending write to complete. Useful for graceful shutdown
 * to ensure no state is lost.
 *
 * @returns A promise that resolves when all pending writes are flushed.
 */
export async function flushPendingWrites(): Promise<void> {
  const projectPaths = [...pendingWrites.keys()];
  const writePromises: Promise<void>[] = [];

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

// ============================================================================
// State Verification
// ============================================================================

/**
 * Maps terminal event types to the expected node status.
 * Only events that represent a final state transition for a node are included.
 */
const EVENT_TO_NODE_STATUS: ReadonlyMap<EventType, NodeStatus> = new Map<EventType, NodeStatus>([
  ["node_started", "running"],
  ["node_completed", "done"],
  ["node_failed", "failed"],
  ["node_blocked", "blocked"],
]);

/** Node-level event types used for cross-checking node status. */
const NODE_EVENT_TYPES: EventType[] = [
  "node_started",
  "node_completed",
  "node_failed",
  "node_blocked",
];

/**
 * Result of verifying consistency between workflow.json and events.jsonl.
 *
 * @property valid - Whether the workflow state is fully consistent with the event log.
 * @property issues - Human-readable descriptions of each detected inconsistency.
 * @property recoverable - Whether all detected issues can be auto-fixed by {@link repairState}.
 */
export interface VerificationResult {
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
export async function verifyStateConsistency(projectPath: string): Promise<VerificationResult> {
  const issues: string[] = [];
  let recoverable = true;

  // Load workflow state — corruption surfaces as thrown errors.
  let workflow: Workflow | null;
  try {
    workflow = await loadWorkflowState(projectPath);
  } catch (error: unknown) {
    return {
      valid: false,
      issues: [
        `Workflow state corrupted: ${error instanceof Error ? error.message : String(error)}`,
      ],
      recoverable: false,
    };
  }

  // Load all events for cross-checking.
  const events = await queryEvents(projectPath);

  // Check: workflow.json missing.
  if (workflow === null) {
    const hasEvents = events.length > 0;
    if (hasEvents) {
      issues.push("workflow.json is missing but events.jsonl contains events");
      recoverable = false;
    }
    return { valid: !hasEvents, issues, recoverable };
  }

  // Check: events.jsonl exists and references this workflow.
  const workflowEvents = events.filter((e) => e.workflowId === workflow.id);
  if (events.length > 0 && workflowEvents.length === 0) {
    issues.push(`events.jsonl contains events but none reference workflow ${workflow.id}`);
    // Not auto-fixable — event log may belong to a different workflow.
    recoverable = false;
  }

  // Build a map of the last node-level event per node.
  const lastEventByNode = buildLastEventByNode(workflowEvents);

  // Cross-check each node's status against its latest event.
  for (const [nodeId, node] of Object.entries(workflow.graph.nodes)) {
    const lastEvent = lastEventByNode.get(nodeId);

    if (lastEvent === undefined) {
      // Node has no events — only valid for nodes in initial states.
      if (node.status !== "pending" && node.status !== "waiting") {
        issues.push(
          `Node "${nodeId}" has status "${node.status}" but no events were logged for it`,
        );
      }
      continue;
    }

    const expectedStatus = EVENT_TO_NODE_STATUS.get(lastEvent.type);
    if (expectedStatus !== undefined && node.status !== expectedStatus) {
      issues.push(
        `Node "${nodeId}" has status "${node.status}" but last event is "${lastEvent.type}" (expected "${expectedStatus}")`,
      );
    }

    // Check: node is 'done' but missing a node_completed event.
    if (node.status === "done") {
      const hasCompletionEvent = workflowEvents.some(
        (e) => e.nodeId === nodeId && e.type === "node_completed",
      );
      if (!hasCompletionEvent) {
        issues.push(`Node "${nodeId}" is marked as done but has no node_completed event`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    recoverable: recoverable && issues.length > 0,
  };
}

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
export async function repairState(projectPath: string): Promise<VerificationResult> {
  const verification = await verifyStateConsistency(projectPath);

  if (verification.valid) {
    return verification;
  }

  if (!verification.recoverable) {
    return verification;
  }

  // Re-load to get a mutable copy.
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
    if (lastEvent === undefined) {
      continue;
    }

    const expectedStatus = EVENT_TO_NODE_STATUS.get(lastEvent.type);
    if (expectedStatus !== undefined && node.status !== expectedStatus) {
      node.status = expectedStatus;
      repaired = true;
    }
  }

  if (repaired) {
    workflow.updatedAt = new Date().toISOString();
    await saveWorkflowStateImmediate(projectPath, workflow);
  }

  // Re-verify after repair to confirm resolution.
  return verifyStateConsistency(projectPath);
}

/**
 * Build a map from node ID to the last node-level event for that node.
 *
 * @param events - Events filtered to a single workflow, in log order.
 * @returns Map from node ID to the latest node-level event.
 */
function buildLastEventByNode(events: Event[]): Map<string, Event> {
  const nodeEventTypes: Set<EventType> = new Set(NODE_EVENT_TYPES);
  const lastEventByNode = new Map<string, Event>();

  for (const event of events) {
    if (event.nodeId !== null && nodeEventTypes.has(event.type)) {
      lastEventByNode.set(event.nodeId, event);
    }
  }

  return lastEventByNode;
}
