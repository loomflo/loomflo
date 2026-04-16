/**
 * ASCII tree renderer for workflow DAGs.
 *
 * Renders a project's workflow graph as a Unicode box-drawing tree.
 * In branching DAGs, nodes with multiple parents appear under each
 * parent to faithfully represent the DAG structure.
 *
 * @module
 */

import { theme } from "../theme/index.js";

// ============================================================================
// Types
// ============================================================================

/** A single node in the workflow graph. */
export interface Node {
  id: string;
  title: string;
  status: string;
}

/** The full workflow graph shape returned by the daemon API. */
export interface Graph {
  nodes: Record<string, Node>;
  edges: Array<{ from: string; to: string }>;
  topology: string[];
}

// ============================================================================
// Tree-drawing constants
// ============================================================================

const BRANCH = "\u251C\u2500\u2500 "; // ├──
const LAST = "\u2514\u2500\u2500 ";   // └──
const PIPE = "\u2502   ";             // │
const SPACE = "    ";                 //

// ============================================================================
// Helpers
// ============================================================================

/**
 * Pick a theme tone based on the node's status string.
 *
 * - completed / done  -> accent
 * - failed            -> err
 * - running           -> muted
 * - anything else     -> dim
 */
function toneForStatus(status: string): "accent" | "err" | "muted" | "dim" {
  switch (status) {
    case "completed":
    case "done":
      return "accent";
    case "failed":
      return "err";
    case "running":
      return "muted";
    default:
      return "dim";
  }
}

/**
 * Format a single node line with coloured id, title, and status.
 */
function formatNode(node: Node): string {
  const tone = toneForStatus(node.status);
  return `${theme.dim(node.id)}  ${theme[tone](node.title)}  ${theme.dim(`[${node.status}]`)}`;
}

// ============================================================================
// Renderer
// ============================================================================

/**
 * Render a workflow graph as an ASCII tree string.
 *
 * @param projectName - The project name displayed as the heading.
 * @param graph - The workflow graph (nodes, edges, topology).
 * @returns A multi-line string with Unicode box-drawing characters and ANSI colours.
 */
export function renderTree(projectName: string, graph: Graph): string {
  // Build children map: parent -> ordered list of child ids
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    let list = children.get(edge.from);
    if (!list) {
      list = [];
      children.set(edge.from, list);
    }
    list.push(edge.to);
  }

  // Determine incoming-edge set to find root nodes
  const hasIncoming = new Set<string>();
  for (const edge of graph.edges) {
    hasIncoming.add(edge.to);
  }

  // Root nodes: topology order, no incoming edges
  const roots = graph.topology.filter((id) => !hasIncoming.has(id));

  const lines: string[] = [];

  // Heading
  lines.push(theme.heading(projectName));

  /**
   * Recursively walk the tree and append formatted lines.
   *
   * @param nodeId - Current node to render.
   * @param prefix - The prefix for this node's line (connector chars).
   * @param childPrefix - The prefix for this node's children (continuation chars).
   */
  function walk(nodeId: string, prefix: string, childPrefix: string): void {
    const node = graph.nodes[nodeId];
    if (!node) return;

    lines.push(`${prefix}${formatNode(node)}`);

    const kids = children.get(nodeId) ?? [];
    for (let i = 0; i < kids.length; i++) {
      const childId = kids[i];
      if (childId === undefined) continue;
      const isLast = i === kids.length - 1;
      const connector = isLast ? LAST : BRANCH;
      const continuation = isLast ? SPACE : PIPE;
      walk(childId, childPrefix + connector, childPrefix + continuation);
    }
  }

  // Render each root (no prefix for root nodes)
  for (const rootId of roots) {
    walk(rootId, "", "");
  }

  return lines.join("\n");
}
