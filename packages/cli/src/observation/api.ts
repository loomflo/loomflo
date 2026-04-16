/**
 * Cross-project API helpers for the observation layer.
 *
 * Provides a thin `httpGet` wrapper around `fetch` that targets the local
 * daemon, and a `fetchProjectsRuntime` aggregator that combines the project
 * list with per-project workflow status into a single table-friendly shape.
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/** Minimal daemon connection info — compatible with both DaemonConfig and DaemonInfo. */
export interface DaemonEndpoint {
  port: number;
  token: string;
}

/** Summary row returned by {@link fetchProjectsRuntime}. */
export interface ProjectRuntimeRow {
  id: string;
  name: string;
  projectPath: string;
  status: string;
  currentNodeId: string | null;
  nodeCount: number;
  cost: number;
  uptimeSec: number;
}

// ============================================================================
// Internal response shapes (what the daemon returns)
// ============================================================================

interface ProjectListItem {
  id: string;
  name: string;
  projectPath: string;
}

interface WorkflowResponse {
  status: string;
  graph: { topology: string[] };
  currentNodeId?: string | null;
  totalCost: number;
  startedAt: string | null;
}

// ============================================================================
// httpGet
// ============================================================================

/**
 * Thin GET helper targeting the local daemon.
 *
 * Adds `Authorization: Bearer <token>` automatically and returns parsed JSON.
 *
 * @typeParam T - Expected shape of the JSON response body.
 * @param path - URL path (e.g. `/projects`).
 * @param daemon - Daemon connection info (port + token).
 * @returns Parsed JSON response.
 * @throws {Error} If the response is not ok (status outside 200-299).
 */
export async function httpGet<T = unknown>(path: string, daemon: DaemonEndpoint): Promise<T> {
  const url = `http://127.0.0.1:${String(daemon.port)}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${daemon.token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`GET ${path} failed: HTTP ${String(res.status)} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ============================================================================
// fetchProjectsRuntime
// ============================================================================

/**
 * Fetch the combined project list + per-project workflow status.
 *
 * 1. Calls `GET /projects` to obtain all registered projects.
 * 2. Calls `GET /projects/:id/workflow` in parallel for each project.
 * 3. Aggregates into a flat {@link ProjectRuntimeRow} array.
 *
 * If an individual workflow request fails, the row is still included with
 * `status: "unknown"` and zeroed-out fields.
 *
 * @param daemon - Daemon connection info.
 * @returns Array of project runtime rows.
 */
export async function fetchProjectsRuntime(daemon: DaemonEndpoint): Promise<ProjectRuntimeRow[]> {
  const projects = await httpGet<ProjectListItem[]>("/projects", daemon);

  if (projects.length === 0) return [];

  const settled = await Promise.allSettled(
    projects.map((p) => httpGet<WorkflowResponse>(`/projects/${p.id}/workflow`, daemon)),
  );

  return projects.map((project, idx) => {
    const result = settled[idx] as PromiseSettledResult<WorkflowResponse>;
    if (result.status === "fulfilled") {
      const wf = result.value;
      const uptimeSec =
        wf.startedAt != null ? Math.max(0, (Date.now() - new Date(wf.startedAt).getTime()) / 1000) : 0;
      return {
        id: project.id,
        name: project.name,
        projectPath: project.projectPath,
        status: wf.status,
        currentNodeId: wf.currentNodeId ?? null,
        nodeCount: wf.graph.topology.length,
        cost: wf.totalCost,
        uptimeSec,
      };
    }
    // Workflow fetch failed — return a degraded row
    return {
      id: project.id,
      name: project.name,
      projectPath: project.projectPath,
      status: "unknown",
      currentNodeId: null,
      nodeCount: 0,
      cost: 0,
      uptimeSec: 0,
    };
  });
}
