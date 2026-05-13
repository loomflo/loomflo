import { describe, it, expect } from "vitest";
import { WorkflowGraph } from "../../src/workflow/graph.js";
import type { Edge, Node } from "../../src/types.js";

// ===========================================================================
// Helpers
// ===========================================================================

/** Creates a minimal valid Node with sensible defaults, overridable via `overrides`. */
function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "node-1",
    title: "Test Node",
    status: "pending",
    instructions: "Do something",
    delay: "0",
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 3,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null,
    providerRetryState: null,
    ...overrides,
  };
}

/** Creates an Edge from `from` to `to`. */
function makeEdge(from: string, to: string): Edge {
  return { from, to };
}

/** Creates a linear chain of nodes: A → B → C → ... and returns a populated WorkflowGraph. */
function makeLinearGraph(ids: string[]): WorkflowGraph {
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  for (const id of ids) {
    nodes.set(id, makeNode({ id, title: id }));
  }
  for (let i = 0; i < ids.length - 1; i++) {
    edges.push(makeEdge(ids[i]!, ids[i + 1]!));
  }
  return new WorkflowGraph(nodes, edges);
}

// ===========================================================================
// WorkflowGraph
// ===========================================================================

describe("WorkflowGraph", () => {
  // =========================================================================
  // Constructor & size
  // =========================================================================

  describe("constructor", () => {
    it("creates an empty graph when called with no arguments", () => {
      const g = new WorkflowGraph();
      expect(g.size).toBe(0);
      expect(g.getEdges()).toEqual([]);
    });

    it("accepts a Map of nodes", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      const g = new WorkflowGraph(nodes);
      expect(g.size).toBe(2);
      expect(g.getNode("a")).toBeDefined();
      expect(g.getNode("b")).toBeDefined();
    });

    it("accepts a Record of nodes", () => {
      const nodes: Record<string, Node> = {
        a: makeNode({ id: "a" }),
        b: makeNode({ id: "b" }),
      };
      const g = new WorkflowGraph(nodes);
      expect(g.size).toBe(2);
    });

    it("accepts initial edges", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      const g = new WorkflowGraph(nodes, [makeEdge("a", "b")]);
      expect(g.getEdges()).toHaveLength(1);
    });

    it("does not share the provided Map — mutations to the original do not affect the graph", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      const g = new WorkflowGraph(nodes);
      nodes.set("b", makeNode({ id: "b" }));
      expect(g.size).toBe(1);
    });

    it("does not share the provided edges array", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      const edges = [makeEdge("a", "b")];
      const g = new WorkflowGraph(nodes, edges);
      edges.push(makeEdge("b", "a"));
      expect(g.getEdges()).toHaveLength(1);
    });
  });

  describe("size", () => {
    it("returns 0 for an empty graph", () => {
      expect(new WorkflowGraph().size).toBe(0);
    });

    it("reflects nodes added after construction", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(g.size).toBe(1);
      g.addNode(makeNode({ id: "b" }));
      expect(g.size).toBe(2);
    });
  });

  // =========================================================================
  // addNode
  // =========================================================================

  describe("addNode", () => {
    it("adds a node to the graph", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(g.getNode("a")).toBeDefined();
      expect(g.size).toBe(1);
    });

    it("throws on duplicate node ID", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(() => g.addNode(makeNode({ id: "a" }))).toThrow('Node "a" already exists');
    });
  });

  // =========================================================================
  // removeNode
  // =========================================================================

  describe("removeNode", () => {
    it("removes an existing node", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.removeNode("a");
      expect(g.size).toBe(0);
      expect(g.getNode("a")).toBeUndefined();
    });

    it("removes all edges connected to the removed node", () => {
      const g = makeLinearGraph(["a", "b", "c"]);
      g.removeNode("b");
      expect(g.getEdges()).toHaveLength(0);
    });

    it("removes only edges involving the removed node, keeping others intact", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      g.removeNode("b");
      const edges = g.getEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual({ from: "a", to: "c" });
    });

    it("throws when removing a non-existent node", () => {
      const g = new WorkflowGraph();
      expect(() => g.removeNode("missing")).toThrow('Node "missing" not found');
    });
  });

  // =========================================================================
  // getNode
  // =========================================================================

  describe("getNode", () => {
    it("returns the node when it exists", () => {
      const g = new WorkflowGraph();
      const node = makeNode({ id: "x", title: "Find Me" });
      g.addNode(node);
      expect(g.getNode("x")).toEqual(node);
    });

    it("returns undefined for a missing node", () => {
      const g = new WorkflowGraph();
      expect(g.getNode("nope")).toBeUndefined();
    });
  });

  // =========================================================================
  // updateNode
  // =========================================================================

  describe("updateNode", () => {
    it("merges partial updates into the existing node", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a", title: "Old", status: "pending" }));
      g.updateNode("a", { title: "New", status: "running" });
      const updated = g.getNode("a")!;
      expect(updated.title).toBe("New");
      expect(updated.status).toBe("running");
      expect(updated.instructions).toBe("Do something");
    });

    it("preserves the node ID even if updates try to change it", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.updateNode("a", { id: "different" } as Partial<Node>);
      expect(g.getNode("a")).toBeDefined();
      expect(g.getNode("a")!.id).toBe("a");
      expect(g.getNode("different")).toBeUndefined();
    });

    it("throws when updating a non-existent node", () => {
      const g = new WorkflowGraph();
      expect(() => g.updateNode("missing", { title: "x" })).toThrow('Node "missing" not found');
    });
  });

  // =========================================================================
  // addEdge
  // =========================================================================

  describe("addEdge", () => {
    it("adds a valid edge", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addEdge(makeEdge("a", "b"));
      expect(g.getEdges()).toHaveLength(1);
      expect(g.getEdges()[0]).toEqual({ from: "a", to: "b" });
    });

    it("rejects self-loops", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(() => g.addEdge(makeEdge("a", "a"))).toThrow(
        'Self-loop detected: "a" cannot connect to itself',
      );
    });

    it("rejects duplicate edges", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addEdge(makeEdge("a", "b"));
      expect(() => g.addEdge(makeEdge("a", "b"))).toThrow('Edge "a" → "b" already exists');
    });

    it("rejects edges from a missing source node", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "b" }));
      expect(() => g.addEdge(makeEdge("missing", "b"))).toThrow('Source node "missing" not found');
    });

    it("rejects edges to a missing target node", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(() => g.addEdge(makeEdge("a", "missing"))).toThrow('Target node "missing" not found');
    });

    it("rejects edges that would create a cycle", () => {
      const g = makeLinearGraph(["a", "b", "c"]);
      expect(() => g.addEdge(makeEdge("c", "a"))).toThrow(
        'Adding edge "c" → "a" would create a cycle',
      );
    });

    it("does not persist the edge when cycle rejection occurs", () => {
      const g = makeLinearGraph(["a", "b", "c"]);
      try {
        g.addEdge(makeEdge("c", "a"));
      } catch {
        // expected
      }
      expect(g.getEdges()).toHaveLength(2);
      expect(g.detectCycles()).toBe(false);
    });

    it("allows parallel edges between different node pairs", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      expect(g.getEdges()).toHaveLength(2);
    });
  });

  // =========================================================================
  // removeEdge
  // =========================================================================

  describe("removeEdge", () => {
    it("removes an existing edge", () => {
      const g = makeLinearGraph(["a", "b"]);
      g.removeEdge("a", "b");
      expect(g.getEdges()).toHaveLength(0);
    });

    it("throws when removing a non-existent edge", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      expect(() => g.removeEdge("a", "b")).toThrow('Edge "a" → "b" not found');
    });
  });

  // =========================================================================
  // getEdges
  // =========================================================================

  describe("getEdges", () => {
    it("returns a copy — mutations do not affect the graph", () => {
      const g = makeLinearGraph(["a", "b"]);
      const edges = g.getEdges();
      edges.push(makeEdge("b", "a"));
      expect(g.getEdges()).toHaveLength(1);
    });
  });

  // =========================================================================
  // getSuccessors / getPredecessors
  // =========================================================================

  describe("getSuccessors", () => {
    it("returns successor node IDs", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      expect(g.getSuccessors("a")).toEqual(["b", "c"]);
    });

    it("returns an empty array for a leaf node", () => {
      const g = makeLinearGraph(["a", "b"]);
      expect(g.getSuccessors("b")).toEqual([]);
    });
  });

  describe("getPredecessors", () => {
    it("returns predecessor node IDs", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "c"));
      expect(g.getPredecessors("c")).toEqual(["a", "b"]);
    });

    it("returns an empty array for a source node", () => {
      const g = makeLinearGraph(["a", "b"]);
      expect(g.getPredecessors("a")).toEqual([]);
    });
  });

  // =========================================================================
  // detectCycles
  // =========================================================================

  describe("detectCycles", () => {
    it("returns false for an empty graph", () => {
      const g = new WorkflowGraph();
      expect(g.detectCycles()).toBe(false);
    });

    it("returns false for a single node with no edges", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(g.detectCycles()).toBe(false);
    });

    it("returns false for a valid linear DAG", () => {
      const g = makeLinearGraph(["a", "b", "c", "d"]);
      expect(g.detectCycles()).toBe(false);
    });

    it("returns false for a valid divergent DAG", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      expect(g.detectCycles()).toBe(false);
    });

    it("detects a cycle injected via constructor bypass", () => {
      // Construct with edges that form a cycle (bypassing addEdge checks)
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      nodes.set("c", makeNode({ id: "c" }));
      const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("c", "a")];
      const g = new WorkflowGraph(nodes, edges);
      expect(g.detectCycles()).toBe(true);
    });

    it("detects a two-node cycle", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      const edges = [makeEdge("a", "b"), makeEdge("b", "a")];
      const g = new WorkflowGraph(nodes, edges);
      expect(g.detectCycles()).toBe(true);
    });

    it("returns false for a complex acyclic diamond graph", () => {
      // a → b, a → c, b → d, c → d
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addNode(makeNode({ id: "d" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "d"));
      g.addEdge(makeEdge("c", "d"));
      expect(g.detectCycles()).toBe(false);
    });
  });

  // =========================================================================
  // validateDAG
  // =========================================================================

  describe("validateDAG", () => {
    it("returns valid for an empty graph", () => {
      const g = new WorkflowGraph();
      const result = g.validateDAG();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("returns valid for a single-node graph (no edges required)", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      const result = g.validateDAG();
      expect(result.valid).toBe(true);
    });

    it("returns valid for a well-formed linear DAG", () => {
      const g = makeLinearGraph(["a", "b", "c"]);
      const result = g.validateDAG();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("returns valid for a tree DAG (single source)", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "root" }));
      g.addNode(makeNode({ id: "left" }));
      g.addNode(makeNode({ id: "right" }));
      g.addEdge(makeEdge("root", "left"));
      g.addEdge(makeEdge("root", "right"));
      const result = g.validateDAG();
      expect(result.valid).toBe(true);
    });

    it("detects orphan nodes in a multi-node graph", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "orphan" }));
      g.addEdge(makeEdge("a", "b"));
      const result = g.validateDAG();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("orphan"))).toBe(true);
    });

    it("detects multiple source nodes", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "c"));
      const result = g.validateDAG();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Multiple source nodes"))).toBe(true);
    });

    it("detects cycles (constructed via bypass)", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      const edges = [makeEdge("a", "b"), makeEdge("b", "a")];
      const g = new WorkflowGraph(nodes, edges);
      const result = g.validateDAG();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("cycles"))).toBe(true);
    });

    it("reports multiple errors at once", () => {
      // Three disconnected nodes: orphan errors + multiple sources
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      const result = g.validateDAG();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // detectTopology
  // =========================================================================

  describe("detectTopology", () => {
    it("detects linear topology", () => {
      const g = makeLinearGraph(["a", "b", "c"]);
      expect(g.detectTopology()).toBe("linear");
    });

    it("detects linear for single node", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      expect(g.detectTopology()).toBe("linear");
    });

    it("detects linear for empty graph", () => {
      const g = new WorkflowGraph();
      expect(g.detectTopology()).toBe("linear");
    });

    it("detects tree/divergent topology (one node with multiple successors)", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      expect(g.detectTopology()).toBe("tree");
    });

    it("detects convergent topology (one node with multiple predecessors)", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "c"));
      expect(g.detectTopology()).toBe("convergent");
    });

    it("detects mixed topology (divergent + convergent)", () => {
      // a → b, a → c, b → d, c → d  (diamond: a diverges, d converges)
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addNode(makeNode({ id: "d" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "d"));
      g.addEdge(makeEdge("c", "d"));
      expect(g.detectTopology()).toBe("mixed");
    });
  });

  // =========================================================================
  // getExecutionOrder
  // =========================================================================

  describe("getExecutionOrder", () => {
    it("returns correct order for a linear graph", () => {
      const g = makeLinearGraph(["a", "b", "c"]);
      expect(g.getExecutionOrder()).toEqual(["a", "b", "c"]);
    });

    it("returns a single-element array for a one-node graph", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "solo" }));
      expect(g.getExecutionOrder()).toEqual(["solo"]);
    });

    it("returns an empty array for an empty graph", () => {
      const g = new WorkflowGraph();
      expect(g.getExecutionOrder()).toEqual([]);
    });

    it("respects dependency order in a divergent graph", () => {
      // a → b, a → c
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      const order = g.getExecutionOrder();
      expect(order[0]).toBe("a");
      expect(order).toHaveLength(3);
      expect(order).toContain("b");
      expect(order).toContain("c");
    });

    it("respects dependency order in a convergent graph", () => {
      // a → c, b → c
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "c"));
      const order = g.getExecutionOrder();
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    });

    it("respects dependency order in a diamond graph", () => {
      // a → b, a → c, b → d, c → d
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addNode(makeNode({ id: "d" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "d"));
      g.addEdge(makeEdge("c", "d"));
      const order = g.getExecutionOrder();
      expect(order[0]).toBe("a");
      expect(order[order.length - 1]).toBe("d");
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
      expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
    });

    it("throws when the graph contains a cycle", () => {
      const nodes = new Map<string, Node>();
      nodes.set("a", makeNode({ id: "a" }));
      nodes.set("b", makeNode({ id: "b" }));
      const edges = [makeEdge("a", "b"), makeEdge("b", "a")];
      const g = new WorkflowGraph(nodes, edges);
      expect(() => g.getExecutionOrder()).toThrow(
        "Cannot determine execution order: graph contains a cycle",
      );
    });
  });

  // =========================================================================
  // toJSON / fromJSON roundtrip
  // =========================================================================

  describe("toJSON", () => {
    it("serializes an empty graph", () => {
      const g = new WorkflowGraph();
      const json = g.toJSON();
      expect(json.nodes).toEqual({});
      expect(json.edges).toEqual([]);
      expect(json.topology).toBe("linear");
    });

    it("serializes nodes as a record keyed by ID", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addEdge(makeEdge("a", "b"));
      const json = g.toJSON();
      expect(Object.keys(json.nodes)).toEqual(["a", "b"]);
      expect(json.edges).toEqual([{ from: "a", to: "b" }]);
    });

    it("re-detects topology on serialization", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      expect(g.toJSON().topology).toBe("tree");
    });
  });

  describe("fromJSON", () => {
    it("deserializes a Graph object into a WorkflowGraph", () => {
      const original = makeLinearGraph(["a", "b", "c"]);
      const json = original.toJSON();
      const restored = WorkflowGraph.fromJSON(json);
      expect(restored.size).toBe(3);
      expect(restored.getNode("a")).toBeDefined();
      expect(restored.getEdges()).toHaveLength(2);
    });

    it("roundtrip preserves all node data", () => {
      const g = new WorkflowGraph();
      const node = makeNode({ id: "x", title: "Special", status: "running", cost: 1.5 });
      g.addNode(node);
      const restored = WorkflowGraph.fromJSON(g.toJSON());
      const restoredNode = restored.getNode("x")!;
      expect(restoredNode.title).toBe("Special");
      expect(restoredNode.status).toBe("running");
      expect(restoredNode.cost).toBe(1.5);
    });

    it("roundtrip preserves edges", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      const restored = WorkflowGraph.fromJSON(g.toJSON());
      expect(restored.getEdges()).toEqual(g.getEdges());
    });

    it("roundtrip preserves topology detection", () => {
      const g = new WorkflowGraph();
      g.addNode(makeNode({ id: "a" }));
      g.addNode(makeNode({ id: "b" }));
      g.addNode(makeNode({ id: "c" }));
      g.addNode(makeNode({ id: "d" }));
      g.addEdge(makeEdge("a", "b"));
      g.addEdge(makeEdge("a", "c"));
      g.addEdge(makeEdge("b", "d"));
      g.addEdge(makeEdge("c", "d"));
      const restored = WorkflowGraph.fromJSON(g.toJSON());
      expect(restored.detectTopology()).toBe("mixed");
    });
  });
});
