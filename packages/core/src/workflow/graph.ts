/**
 * Directed acyclic graph (DAG) implementation for workflow execution topology.
 *
 * Provides node/edge management, cycle detection, DAG validation,
 * topology classification, and topological sort for execution ordering.
 */

import type { Edge, Graph, Node, TopologyType } from "../types.js";

/** Result of DAG validation containing validity status and any errors found. */
export interface ValidationResult {
  /** Whether the graph is a valid DAG. */
  valid: boolean;
  /** List of validation errors, empty when valid. */
  errors: string[];
}

/**
 * A mutable directed acyclic graph that wraps the {@link Graph} schema data.
 *
 * Nodes are stored in a Map keyed by ID for O(1) lookup. Edges are stored
 * as an array of directed pairs. All mutating operations enforce DAG
 * invariants (no cycles, no self-loops, no duplicates).
 */
export class WorkflowGraph {
  private readonly nodes: Map<string, Node>;
  private readonly edgeList: Edge[];

  /**
   * Creates a new WorkflowGraph instance.
   *
   * @param nodes - Initial nodes as a Map or plain record, or omit for an empty graph.
   * @param edges - Initial directed edges, or omit for an empty edge list.
   */
  constructor(nodes?: Map<string, Node> | Record<string, Node>, edges?: Edge[]) {
    if (nodes instanceof Map) {
      this.nodes = new Map(nodes);
    } else if (nodes) {
      this.nodes = new Map(Object.entries(nodes));
    } else {
      this.nodes = new Map();
    }
    this.edgeList = edges ? [...edges] : [];
  }

  /**
   * Returns the number of nodes in the graph.
   *
   * @returns Node count.
   */
  get size(): number {
    return this.nodes.size;
  }

  /**
   * Adds a node to the graph.
   *
   * @param node - The node to add.
   * @throws Error if a node with the same ID already exists.
   */
  addNode(node: Node): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node "${node.id}" already exists`);
    }
    this.nodes.set(node.id, node);
  }

  /**
   * Removes a node and all edges connected to it.
   *
   * @param nodeId - ID of the node to remove.
   * @throws Error if the node does not exist.
   */
  removeNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node "${nodeId}" not found`);
    }
    this.nodes.delete(nodeId);
    for (let i = this.edgeList.length - 1; i >= 0; i--) {
      const edge = this.edgeList[i];
      if (edge && (edge.from === nodeId || edge.to === nodeId)) {
        this.edgeList.splice(i, 1);
      }
    }
  }

  /**
   * Retrieves a node by ID.
   *
   * @param nodeId - ID of the node to retrieve.
   * @returns The node, or undefined if not found.
   */
  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Updates a node's properties by merging partial updates.
   *
   * The node ID cannot be changed via this method.
   *
   * @param nodeId - ID of the node to update.
   * @param updates - Partial node properties to merge.
   * @throws Error if the node does not exist.
   */
  updateNode(nodeId: string, updates: Partial<Node>): void {
    const existing = this.nodes.get(nodeId);
    if (!existing) {
      throw new Error(`Node "${nodeId}" not found`);
    }
    this.nodes.set(nodeId, { ...existing, ...updates, id: nodeId });
  }

  /**
   * Adds a directed edge between two existing nodes.
   *
   * Rejects self-loops, duplicate edges, references to missing nodes,
   * and edges that would create a cycle.
   *
   * @param edge - The directed edge to add.
   * @throws Error if the edge is invalid or would create a cycle.
   */
  addEdge(edge: Edge): void {
    if (!this.nodes.has(edge.from)) {
      throw new Error(`Source node "${edge.from}" not found`);
    }
    if (!this.nodes.has(edge.to)) {
      throw new Error(`Target node "${edge.to}" not found`);
    }
    if (edge.from === edge.to) {
      throw new Error(`Self-loop detected: "${edge.from}" cannot connect to itself`);
    }
    const duplicate = this.edgeList.some((e) => e.from === edge.from && e.to === edge.to);
    if (duplicate) {
      throw new Error(`Edge "${edge.from}" → "${edge.to}" already exists`);
    }
    this.edgeList.push(edge);
    if (this.detectCycles()) {
      this.edgeList.pop();
      throw new Error(`Adding edge "${edge.from}" → "${edge.to}" would create a cycle`);
    }
  }

  /**
   * Removes a directed edge.
   *
   * @param from - Source node ID.
   * @param to - Target node ID.
   * @throws Error if the edge does not exist.
   */
  removeEdge(from: string, to: string): void {
    const index = this.edgeList.findIndex((e) => e.from === from && e.to === to);
    if (index === -1) {
      throw new Error(`Edge "${from}" → "${to}" not found`);
    }
    this.edgeList.splice(index, 1);
  }

  /**
   * Returns a copy of all directed edges.
   *
   * @returns Array of edges.
   */
  getEdges(): Edge[] {
    return [...this.edgeList];
  }

  /**
   * Returns the IDs of all successor nodes (outgoing edges).
   *
   * @param nodeId - ID of the node to query.
   * @returns Array of successor node IDs.
   */
  getSuccessors(nodeId: string): string[] {
    return this.edgeList.filter((e) => e.from === nodeId).map((e) => e.to);
  }

  /**
   * Returns the IDs of all predecessor nodes (incoming edges).
   *
   * @param nodeId - ID of the node to query.
   * @returns Array of predecessor node IDs.
   */
  getPredecessors(nodeId: string): string[] {
    return this.edgeList.filter((e) => e.to === nodeId).map((e) => e.from);
  }

  /**
   * Detects whether the graph contains any cycles using DFS coloring.
   *
   * Uses a three-color algorithm: white (unvisited), gray (in current
   * DFS stack), black (fully processed). A back-edge to a gray node
   * indicates a cycle.
   *
   * @returns `true` if the graph contains at least one cycle, `false` otherwise.
   */
  detectCycles(): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      color.set(id, WHITE);
    }

    const dfs = (nodeId: string): boolean => {
      color.set(nodeId, GRAY);
      for (const successor of this.getSuccessors(nodeId)) {
        const c = color.get(successor);
        if (c === GRAY) return true;
        if (c === WHITE && dfs(successor)) return true;
      }
      color.set(nodeId, BLACK);
      return false;
    };

    for (const id of this.nodes.keys()) {
      if (color.get(id) === WHITE && dfs(id)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validates that the graph is a well-formed DAG.
   *
   * Checks:
   * 1. No cycles exist.
   * 2. At most one source node (no incoming edges) — the entry point.
   * 3. No orphan nodes (nodes with no edges at all in a multi-node graph).
   *
   * @returns Validation result with any errors found.
   */
  validateDAG(): ValidationResult {
    const errors: string[] = [];

    if (this.nodes.size === 0) {
      return { valid: true, errors: [] };
    }

    if (this.detectCycles()) {
      errors.push("Graph contains one or more cycles");
    }

    const sourceNodes: string[] = [];

    for (const nodeId of this.nodes.keys()) {
      const predecessors = this.getPredecessors(nodeId);
      const successors = this.getSuccessors(nodeId);

      if (predecessors.length === 0 && successors.length === 0 && this.nodes.size > 1) {
        errors.push(`Node "${nodeId}" is an orphan (no incoming or outgoing edges)`);
      }

      if (predecessors.length === 0) {
        sourceNodes.push(nodeId);
      }
    }

    if (sourceNodes.length > 1) {
      errors.push(
        `Multiple source nodes found: ${sourceNodes.join(", ")}. Only one entry point is allowed`,
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Classifies the graph topology based on node connectivity patterns.
   *
   * - `linear`: every node has at most 1 successor and 1 predecessor.
   * - `convergent`: at least one node has multiple predecessors, none have multiple successors.
   * - `tree`: at least one node has multiple successors, none have multiple predecessors.
   * - `mixed`: nodes with multiple successors and nodes with multiple predecessors both exist.
   *
   * @returns The detected topology type.
   */
  detectTopology(): TopologyType {
    let hasDivergent = false;
    let hasConvergent = false;

    for (const nodeId of this.nodes.keys()) {
      if (this.getSuccessors(nodeId).length > 1) {
        hasDivergent = true;
      }
      if (this.getPredecessors(nodeId).length > 1) {
        hasConvergent = true;
      }
      if (hasDivergent && hasConvergent) {
        return "mixed";
      }
    }

    if (hasDivergent) return "tree";
    if (hasConvergent) return "convergent";
    return "linear";
  }

  /**
   * Returns a topological sort of node IDs using Kahn's algorithm.
   *
   * The returned order guarantees that for every edge (u → v), u appears
   * before v. Throws if the graph contains a cycle.
   *
   * @returns Array of node IDs in execution order.
   * @throws Error if the graph contains a cycle.
   */
  getExecutionOrder(): string[] {
    const inDegree = new Map<string, number>();
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0);
    }
    for (const edge of this.edgeList) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (nodeId === undefined) break;
      order.push(nodeId);
      for (const successor of this.getSuccessors(nodeId)) {
        const newDegree = (inDegree.get(successor) ?? 1) - 1;
        inDegree.set(successor, newDegree);
        if (newDegree === 0) {
          queue.push(successor);
        }
      }
    }

    if (order.length !== this.nodes.size) {
      throw new Error("Cannot determine execution order: graph contains a cycle");
    }

    return order;
  }

  /**
   * Serializes the graph to the {@link Graph} schema format.
   *
   * Topology is re-detected from the current structure.
   *
   * @returns A plain object matching the GraphSchema.
   */
  toJSON(): Graph {
    return {
      nodes: Object.fromEntries(this.nodes),
      edges: [...this.edgeList],
      topology: this.detectTopology(),
    };
  }

  /**
   * Deserializes a {@link Graph} schema object into a WorkflowGraph instance.
   *
   * @param data - A plain object matching the GraphSchema.
   * @returns A new WorkflowGraph instance.
   */
  static fromJSON(data: Graph): WorkflowGraph {
    return new WorkflowGraph(data.nodes, data.edges);
  }
}
