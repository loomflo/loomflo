import { Command } from 'commander';

import { type ApiResponse, DaemonClient, readDaemonConfig } from '../client.js';

// ============================================================================
// Types
// ============================================================================

/** Shape of a graph node within the workflow response. */
interface GraphNode {
  id: string;
  title: string;
  type: string;
}

/** Shape of a graph edge within the workflow response. */
interface GraphEdge {
  source: string;
  target: string;
}

/** Shape of the GET /workflow success response. */
interface WorkflowResponse {
  id: string;
  status: string;
  description: string;
  projectPath: string;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    topology: string;
  };
}

/** Shape of a single node entry in the costs response. */
interface CostNode {
  id: string;
  title: string;
  cost: number;
  retries: number;
}

/** Shape of the GET /costs success response. */
interface CostsResponse {
  total: number;
  budgetLimit: number | null;
  budgetRemaining: number | null;
  nodes: CostNode[];
  loomCost: number;
}

/** Shape of a single node entry in the nodes response. */
interface NodeEntry {
  id: string;
  title: string;
  status: string;
  agentCount: number;
  cost: number;
  retryCount: number;
}

/** Shape of an API error response. */
interface ErrorResponse {
  error: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format a numeric cost as a dollar string with 2 decimal places.
 *
 * @param value - The numeric cost value.
 * @returns A formatted string like "$1.23".
 */
function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

// ============================================================================
// Command Factory
// ============================================================================

/**
 * Create the `status` command for the loomflo CLI.
 *
 * Usage: `loomflo status`
 *
 * Connects to the running daemon and fetches the current workflow state,
 * per-node cost breakdown, and node statuses. Displays a structured summary
 * including active nodes, a cost table, and budget information.
 *
 * @returns A configured commander Command instance.
 */
export function createStatusCommand(): Command {
  const cmd = new Command('status')
    .description('Show workflow status and costs')
    .action(async (): Promise<void> => {
      /* ------------------------------------------------------------------ */
      /* Connect to daemon                                                  */
      /* ------------------------------------------------------------------ */

      let config;
      try {
        config = await readDaemonConfig();
      } catch {
        console.error('Daemon is not running. Start with: loomflo start');
        process.exit(1);
      }

      const client = new DaemonClient(config.port, config.token);

      /* ------------------------------------------------------------------ */
      /* Fetch workflow, costs, and nodes in parallel                        */
      /* ------------------------------------------------------------------ */

      const [workflowResult, costsResult, nodesResult] = await Promise.allSettled([
        client.get<WorkflowResponse | ErrorResponse>('/workflow'),
        client.get<CostsResponse | ErrorResponse>('/costs'),
        client.get<NodeEntry[] | ErrorResponse>('/nodes'),
      ]);

      /* ------------------------------------------------------------------ */
      /* Handle no workflow (404)                                            */
      /* ------------------------------------------------------------------ */

      if (workflowResult.status === 'rejected') {
        console.error('Failed to connect to daemon.');
        process.exit(1);
      }

      const workflowRes = workflowResult.value as ApiResponse<WorkflowResponse | ErrorResponse>;

      if (!workflowRes.ok) {
        if (workflowRes.status === 404) {
          console.log('No active workflow. Start one with: loomflo start');
          return;
        }
        const errorData = workflowRes.data as ErrorResponse;
        console.error(`Failed to fetch workflow: ${errorData.error}`);
        process.exit(1);
      }

      const workflow = workflowRes.data as WorkflowResponse;

      /* ------------------------------------------------------------------ */
      /* Workflow summary                                                    */
      /* ------------------------------------------------------------------ */

      console.log('Workflow');
      console.log(`  ID:          ${workflow.id}`);
      console.log(`  Status:      ${workflow.status}`);
      console.log(`  Description: ${workflow.description}`);
      console.log('');

      /* ------------------------------------------------------------------ */
      /* Active nodes                                                        */
      /* ------------------------------------------------------------------ */

      let nodes: NodeEntry[] = [];
      if (nodesResult.status === 'fulfilled') {
        const nodesRes = nodesResult.value as ApiResponse<NodeEntry[] | ErrorResponse>;
        if (nodesRes.ok) {
          nodes = nodesRes.data as NodeEntry[];
        }
      }

      const activeNodes = nodes.filter(
        (n) => n.status === 'running' || n.status === 'review',
      );

      if (activeNodes.length > 0) {
        console.log('Active Nodes');
        for (const node of activeNodes) {
          console.log(`  - ${node.title} [${node.status}] (${String(node.agentCount)} agents)`);
        }
        console.log('');
      }

      /* ------------------------------------------------------------------ */
      /* Per-node cost table                                                 */
      /* ------------------------------------------------------------------ */

      if (nodes.length > 0) {
        console.log('Node Costs');

        const titleWidth = Math.max(
          'Node'.length,
          ...nodes.map((n) => n.title.length),
        );
        const statusWidth = Math.max(
          'Status'.length,
          ...nodes.map((n) => n.status.length),
        );

        const header =
          '  ' +
          'Node'.padEnd(titleWidth) +
          '  ' +
          'Status'.padEnd(statusWidth) +
          '  ' +
          'Cost'.padStart(10) +
          '  ' +
          'Retries';
        const separator = '  ' + '-'.repeat(header.length - 2);

        console.log(header);
        console.log(separator);

        for (const node of nodes) {
          const line =
            '  ' +
            node.title.padEnd(titleWidth) +
            '  ' +
            node.status.padEnd(statusWidth) +
            '  ' +
            formatCost(node.cost).padStart(10) +
            '  ' +
            String(node.retryCount);
          console.log(line);
        }
        console.log('');
      }

      /* ------------------------------------------------------------------ */
      /* Cost summary                                                        */
      /* ------------------------------------------------------------------ */

      if (costsResult.status === 'fulfilled') {
        const costsRes = costsResult.value as ApiResponse<CostsResponse | ErrorResponse>;
        if (costsRes.ok) {
          const costs = costsRes.data as CostsResponse;

          console.log('Cost Summary');
          console.log(`  Total Cost:       ${formatCost(costs.total)}`);
          console.log(`  Budget Limit:     ${costs.budgetLimit !== null ? formatCost(costs.budgetLimit) : 'None'}`);
          console.log(`  Budget Remaining: ${costs.budgetRemaining !== null ? formatCost(costs.budgetRemaining) : 'N/A'}`);
          console.log(`  Loom Overhead:    ${formatCost(costs.loomCost)}`);
        }
      }
    });

  return cmd;
}
