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
   * Tracks ancestors on the current path to detect and break cycles.
   *
   * @param nodeId - Current node to render.
   * @param prefix - The prefix for this node's line (connector chars).
   * @param childPrefix - The prefix for this node's children (continuation chars).
   * @param ancestors - Set of node IDs on the current walk path (cycle guard).
   */
  function walk(nodeId: string, prefix: string, childPrefix: string, ancestors: Set<string>): void {
    const node = graph.nodes[nodeId];
    if (!node) return;

    // Cycle guard: if this node is already an ancestor on the current path, stop.
    if (ancestors.has(nodeId)) {
      lines.push(`${prefix}${theme.warn(`[cycle: ${nodeId}]`)}`);
      return;
    }

    lines.push(`${prefix}${formatNode(node)}`);

    const kids = children.get(nodeId) ?? [];
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(nodeId);
    for (let i = 0; i < kids.length; i++) {
      const childId = kids[i];
      if (childId === undefined) continue;
      const isLast = i === kids.length - 1;
      const connector = isLast ? LAST : BRANCH;
      const continuation = isLast ? SPACE : PIPE;
      walk(childId, childPrefix + connector, childPrefix + continuation, nextAncestors);
    }
  }

  // Render each root (no prefix for root nodes)
  for (const rootId of roots) {
    walk(rootId, "", "", new Set());
  }

  return lines.join("\n");
}
