import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Workflow, WorkflowSchema } from '../types.js';

/** Directory name for Loomflo project-level state. */
const LOOMFLO_DIR = '.loomflo';

/** Workflow state filename. */
const WORKFLOW_FILE = 'workflow.json';

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
  await writeFile(tmpPath, content, 'utf-8');
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
    content = await readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'ENOENT') {
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
    throw new Error(
      `Invalid workflow state in ${filePath}: ${result.error.message}`,
    );
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
