import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SpecEngine,
  validateDag,
  validateGraphIntegrity,
  validateAndOptimizeGraph,
  estimateNodeCost,
  GraphValidationError,
  SpecPipelineError,
  DEFAULT_COST_ESTIMATION_CONFIG,
} from "../../src/spec/spec-engine.js";
import type {
  SpecEngineConfig,
  ClarificationCallback,
  ClarificationQuestion,
  SpecStepEvent,
  SpecStepCallback,
} from "../../src/spec/spec-engine.js";
import type { LLMProvider, CompletionParams } from "../../src/providers/base.js";
import type { LLMResponse, Graph, Node, Edge } from "../../src/types.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal LLMResponse with text content. */
function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: "text", text }],
    model: "mock-model",
    usage: { input: 100, output: 50 },
    stopReason: "end_turn",
  };
}

/**
 * Build a mock LLM provider that returns predetermined responses.
 *
 * The responses array is consumed in order: the first call gets
 * responses[0], the second gets responses[1], etc.
 */
function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    complete: vi.fn(async (_params: CompletionParams): Promise<LLMResponse> => {
      if (callIndex >= responses.length) {
        throw new Error(`Mock provider ran out of responses (call ${String(callIndex)})`);
      }
      const response = responses[callIndex]!;
      callIndex++;
      return response;
    }),
  };
}

/** A valid graph JSON that the mock LLM returns for the graph-building step. */
const VALID_GRAPH_JSON = JSON.stringify({
  nodes: [
    {
      id: "node-1",
      title: "Setup",
      instructions: "1. Create project\n2. Init repo",
      dependencies: [],
    },
    {
      id: "node-2",
      title: "Feature A",
      instructions: "1. Implement feature A\n2. Add tests\n3. Update docs",
      dependencies: ["node-1"],
    },
    {
      id: "node-3",
      title: "Feature B",
      instructions: "1. Implement feature B",
      dependencies: ["node-1"],
    },
  ],
});

/** Helper to create a simple Graph for validation tests. */
function createGraph(
  nodes: Record<string, Partial<Node>>,
  edges: Edge[],
  topology: string = "linear",
): Graph {
  const fullNodes: Record<string, Node> = {};
  for (const [id, partial] of Object.entries(nodes)) {
    fullNodes[id] = {
      id,
      title: partial.title ?? id,
      status: partial.status ?? "pending",
      instructions: partial.instructions ?? "",
      delay: partial.delay ?? "0",
      resumeAt: partial.resumeAt ?? null,
      agents: partial.agents ?? [],
      fileOwnership: partial.fileOwnership ?? {},
      retryCount: partial.retryCount ?? 0,
      maxRetries: partial.maxRetries ?? 3,
      reviewReport: partial.reviewReport ?? null,
      cost: partial.cost ?? 0,
      startedAt: partial.startedAt ?? null,
      completedAt: partial.completedAt ?? null,
    };
  }
  return { nodes: fullNodes, edges, topology: topology as Graph["topology"] };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("SpecEngine", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = join(
      tmpdir(),
      `loomflo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(projectPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Graph Validation (pure functions)
  // --------------------------------------------------------------------------

  describe("validateDag", () => {
    it("should accept a valid DAG", () => {
      const nodes: Record<string, Node> = {
        a: createGraph({ a: {} }, []).nodes["a"]!,
        b: createGraph({ b: {} }, []).nodes["b"]!,
        c: createGraph({ c: {} }, []).nodes["c"]!,
      };
      const edges: Edge[] = [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ];

      expect(() => validateDag(nodes, edges)).not.toThrow();
    });

    it("should reject a graph with a cycle", () => {
      const nodes: Record<string, Node> = {
        a: createGraph({ a: {} }, []).nodes["a"]!,
        b: createGraph({ b: {} }, []).nodes["b"]!,
        c: createGraph({ c: {} }, []).nodes["c"]!,
      };
      const edges: Edge[] = [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ];

      expect(() => validateDag(nodes, edges)).toThrow(GraphValidationError);
      try {
        validateDag(nodes, edges);
      } catch (e) {
        expect((e as GraphValidationError).code).toBe("cycle_detected");
      }
    });

    it("should accept a single-node graph", () => {
      const nodes: Record<string, Node> = {
        a: createGraph({ a: {} }, []).nodes["a"]!,
      };

      expect(() => validateDag(nodes, [])).not.toThrow();
    });
  });

  describe("validateGraphIntegrity", () => {
    it("should accept a valid graph", () => {
      const graph = createGraph({ a: {}, b: {}, c: {} }, [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ]);

      expect(() => validateGraphIntegrity(graph)).not.toThrow();
    });

    it("should reject an empty graph", () => {
      const graph = createGraph({}, []);

      expect(() => validateGraphIntegrity(graph)).toThrow(GraphValidationError);
      try {
        validateGraphIntegrity(graph);
      } catch (e) {
        expect((e as GraphValidationError).code).toBe("empty_graph");
      }
    });

    it("should reject invalid edge references", () => {
      const graph = createGraph({ a: {} }, [{ from: "a", to: "nonexistent" }]);

      expect(() => validateGraphIntegrity(graph)).toThrow(GraphValidationError);
      try {
        validateGraphIntegrity(graph);
      } catch (e) {
        expect((e as GraphValidationError).code).toBe("invalid_edge_reference");
      }
    });

    it("should reject a graph where all nodes have incoming edges (no root)", () => {
      const graph = createGraph({ a: {}, b: {} }, [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ]);

      /* Both nodes have incoming edges — no root node exists. */
      expect(() => validateGraphIntegrity(graph)).toThrow(GraphValidationError);
      try {
        validateGraphIntegrity(graph);
      } catch (e) {
        expect((e as GraphValidationError).code).toBe("no_root_node");
      }
    });

    it("should reject orphan nodes in a multi-node graph", () => {
      const graph = createGraph({ a: {}, b: {}, orphan: {} }, [{ from: "a", to: "b" }]);

      expect(() => validateGraphIntegrity(graph)).toThrow(GraphValidationError);
      try {
        validateGraphIntegrity(graph);
      } catch (e) {
        expect((e as GraphValidationError).code).toBe("orphan_nodes");
      }
    });

    it("should accept a single-node graph (no edges needed)", () => {
      const graph = createGraph({ solo: {} }, []);

      expect(() => validateGraphIntegrity(graph)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Cost Estimation
  // --------------------------------------------------------------------------

  describe("estimateNodeCost", () => {
    it("should estimate cost based on numbered list items", () => {
      const node = createGraph(
        { a: { instructions: "1. First task\n2. Second task\n3. Third task" } },
        [],
      ).nodes["a"]!;

      const cost = estimateNodeCost(node, DEFAULT_COST_ESTIMATION_CONFIG);
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe("number");
    });

    it("should estimate cost based on bullet items", () => {
      const node = createGraph({ a: { instructions: "- Task one\n- Task two" } }, []).nodes["a"]!;

      const cost = estimateNodeCost(node, DEFAULT_COST_ESTIMATION_CONFIG);
      expect(cost).toBeGreaterThan(0);
    });

    it("should fall back to 1 task for plain text", () => {
      const node = createGraph({ a: { instructions: "Do something simple" } }, []).nodes["a"]!;

      const cost = estimateNodeCost(node, DEFAULT_COST_ESTIMATION_CONFIG);
      expect(cost).toBeGreaterThan(0);
    });

    it("should scale cost with number of tasks", () => {
      const node1 = createGraph({ a: { instructions: "1. One" } }, []).nodes["a"]!;
      const node3 = createGraph({ a: { instructions: "1. One\n2. Two\n3. Three" } }, []).nodes[
        "a"
      ]!;

      const cost1 = estimateNodeCost(node1, DEFAULT_COST_ESTIMATION_CONFIG);
      const cost3 = estimateNodeCost(node3, DEFAULT_COST_ESTIMATION_CONFIG);
      expect(cost3).toBeGreaterThan(cost1);
    });
  });

  // --------------------------------------------------------------------------
  // validateAndOptimizeGraph
  // --------------------------------------------------------------------------

  describe("validateAndOptimizeGraph", () => {
    it("should detect linear topology", () => {
      const graph = createGraph(
        { a: { instructions: "1. Setup" }, b: { instructions: "1. Build" } },
        [{ from: "a", to: "b" }],
      );

      const result = validateAndOptimizeGraph(graph);
      expect(result.graph.topology).toBe("linear");
      expect(result.estimatedTotalCost).toBeGreaterThan(0);
    });

    it("should detect divergent topology", () => {
      const graph = createGraph(
        {
          a: { instructions: "1. Root" },
          b: { instructions: "1. Branch 1" },
          c: { instructions: "1. Branch 2" },
        },
        [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      );

      const result = validateAndOptimizeGraph(graph);
      expect(result.graph.topology).toBe("divergent");
    });

    it("should detect convergent topology", () => {
      const graph = createGraph(
        {
          a: { instructions: "1. Source 1" },
          b: { instructions: "1. Source 2" },
          c: { instructions: "1. Target" },
        },
        [
          { from: "a", to: "c" },
          { from: "b", to: "c" },
        ],
      );

      const result = validateAndOptimizeGraph(graph);
      expect(result.graph.topology).toBe("convergent");
    });

    it("should detect mixed topology", () => {
      const graph = createGraph(
        {
          a: { instructions: "1. Root" },
          b: { instructions: "1. Branch 1" },
          c: { instructions: "1. Branch 2" },
          d: { instructions: "1. Merge" },
        },
        [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "d" },
          { from: "c", to: "d" },
        ],
      );

      const result = validateAndOptimizeGraph(graph);
      expect(result.graph.topology).toBe("mixed");
    });

    it("should populate cost on each node", () => {
      const graph = createGraph(
        {
          a: { instructions: "1. Setup\n2. Config" },
          b: { instructions: "1. Build" },
        },
        [{ from: "a", to: "b" }],
      );

      const result = validateAndOptimizeGraph(graph);
      expect(result.graph.nodes["a"]!.cost).toBeGreaterThan(0);
      expect(result.graph.nodes["b"]!.cost).toBeGreaterThan(0);
    });

    it("should throw on invalid graph", () => {
      const graph = createGraph({}, []);
      expect(() => validateAndOptimizeGraph(graph)).toThrow(GraphValidationError);
    });
  });

  // --------------------------------------------------------------------------
  // Full Pipeline (with mock LLM)
  // --------------------------------------------------------------------------

  describe("runPipeline", () => {
    it("should produce 5 artifacts and a valid graph", async () => {
      /* The pipeline makes 6 LLM calls:
       *   0: constitution
       *   1: spec
       *   2: plan
       *   3: tasks
       *   4: analysis
       *   5: graph (returns JSON)
       */
      const provider = mockProvider([
        textResponse("# Constitution\nStrict quality rules."),
        textResponse("# Spec\nUser stories here."),
        textResponse("# Plan\nTechnical plan here."),
        textResponse("# Tasks\n- [ ] T001 Setup\n- [ ] T002 Feature A"),
        textResponse("# Analysis\nAll looks good."),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      const config: SpecEngineConfig = {
        provider,
        model: "mock-model",
        projectPath,
      };

      const engine = new SpecEngine(config);
      const result = await engine.runPipeline("Build a todo app");

      /* Should have 5 file artifacts (constitution, spec, plan, tasks, analysis) */
      expect(result.artifacts).toHaveLength(5);

      const names = result.artifacts.map((a) => a.name);
      expect(names).toContain("constitution.md");
      expect(names).toContain("spec.md");
      expect(names).toContain("plan.md");
      expect(names).toContain("tasks.md");
      expect(names).toContain("analysis-report.md");

      /* Graph should be valid */
      expect(Object.keys(result.graph.nodes)).toHaveLength(3);
      expect(result.graph.edges.length).toBeGreaterThan(0);
      expect(result.graph.topology).toBe("divergent");
    });

    it("should write artifacts to disk", async () => {
      const provider = mockProvider([
        textResponse("# Constitution\nContent."),
        textResponse("# Spec\nContent."),
        textResponse("# Plan\nContent."),
        textResponse("# Tasks\nContent."),
        textResponse("# Analysis\nContent."),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      await engine.runPipeline("Test project");

      const specsDir = join(projectPath, ".loomflo", "specs");

      const constitutionContent = await readFile(join(specsDir, "constitution.md"), "utf-8");
      expect(constitutionContent).toBe("# Constitution\nContent.");

      const specContent = await readFile(join(specsDir, "spec.md"), "utf-8");
      expect(specContent).toBe("# Spec\nContent.");
    });

    it("should emit progress events for each step", async () => {
      const provider = mockProvider([
        textResponse("Constitution"),
        textResponse("Spec"),
        textResponse("Plan"),
        textResponse("Tasks"),
        textResponse("Analysis"),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      const events: SpecStepEvent[] = [];
      const onProgress: SpecStepCallback = (event) => events.push(event);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      await engine.runPipeline("Test project", onProgress);

      /* Should have started events for all 6 steps */
      const startEvents = events.filter((e) => e.type === "spec_step_started");
      expect(startEvents).toHaveLength(6);

      /* Should have completed events for all 6 steps */
      const completedEvents = events.filter((e) => e.type === "spec_step_completed");
      expect(completedEvents).toHaveLength(6);

      /* Should have a pipeline_completed event */
      const pipelineComplete = events.filter((e) => e.type === "spec_pipeline_completed");
      expect(pipelineComplete).toHaveLength(1);
    });

    it("should call the LLM provider 6 times", async () => {
      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      await engine.runPipeline("Test");

      expect(provider.complete).toHaveBeenCalledTimes(6);
    });

    it("should throw SpecPipelineError when LLM fails", async () => {
      const provider: LLMProvider = {
        name: "failing-mock",
        complete: vi.fn(async (): Promise<LLMResponse> => {
          throw new Error("API rate limit exceeded");
        }),
      };

      const engine = new SpecEngine({ provider, model: "mock", projectPath });

      await expect(engine.runPipeline("Test")).rejects.toThrow(SpecPipelineError);
    });

    it("should throw SpecPipelineError with step info when a specific step fails", async () => {
      /* First 3 calls succeed, 4th (tasks) fails */
      let callCount = 0;
      const provider: LLMProvider = {
        name: "partial-mock",
        complete: vi.fn(async (): Promise<LLMResponse> => {
          callCount++;
          if (callCount === 4) {
            throw new Error("Tasks generation failed");
          }
          return textResponse(`Step ${String(callCount)} content`);
        }),
      };

      const engine = new SpecEngine({ provider, model: "mock", projectPath });

      try {
        await engine.runPipeline("Test");
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SpecPipelineError);
        const pipelineError = e as SpecPipelineError;
        expect(pipelineError.stepName).toBe("tasks");
        expect(pipelineError.stepIndex).toBe(3);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Clarification Handling
  // --------------------------------------------------------------------------

  describe("clarification handling", () => {
    it("should invoke clarification callback when markers are detected", async () => {
      const clarificationCallback: ClarificationCallback = vi.fn(
        async (_questions: ClarificationQuestion[]): Promise<string[]> => {
          return ["Use PostgreSQL", "Yes, include JWT"];
        },
      );

      /* First call returns constitution with clarification markers.
       * Second call (re-run after answers) returns clean constitution.
       * Then the remaining 5 steps succeed normally. */
      const provider = mockProvider([
        textResponse(
          "# Constitution\n\n[CLARIFICATION_NEEDED]\n" +
            "Q1: Which database should be used?\nContext: Multiple options available.\n" +
            "Q2: Should auth include JWT?\nContext: Affects security setup.\n" +
            "[/CLARIFICATION_NEEDED]\n\nFallback constitution content.",
        ),
        textResponse("# Constitution (refined)\nWith PostgreSQL and JWT."),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      const engine = new SpecEngine({
        provider,
        model: "mock",
        projectPath,
        clarificationCallback,
      });

      const result = await engine.runPipeline("Build an API");

      expect(clarificationCallback).toHaveBeenCalledTimes(1);
      expect(clarificationCallback).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ question: "Which database should be used?" }),
          expect.objectContaining({ question: "Should auth include JWT?" }),
        ]),
      );

      expect(result.artifacts).toHaveLength(5);
    });

    it("should strip markers and use LLM defaults when no callback is configured", async () => {
      const provider = mockProvider([
        textResponse(
          "Before markers.\n[CLARIFICATION_NEEDED]\nQ1: Some question?\nContext: Ctx.\n[/CLARIFICATION_NEEDED]\nAfter markers.",
        ),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      /* No clarificationCallback — should strip markers and continue */
      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      const result = await engine.runPipeline("Build something");

      /* 5 artifacts, 6 LLM calls (no re-run since no callback) */
      expect(result.artifacts).toHaveLength(5);
      expect(provider.complete).toHaveBeenCalledTimes(6);
    });

    it("should strip markers when callback throws", async () => {
      const clarificationCallback: ClarificationCallback = vi.fn(async (): Promise<string[]> => {
        throw new Error("User disconnected");
      });

      const provider = mockProvider([
        textResponse(
          "# Constitution\n[CLARIFICATION_NEEDED]\nQ1: Which DB?\nContext: Important.\n[/CLARIFICATION_NEEDED]\nFallback.",
        ),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse("```json\n" + VALID_GRAPH_JSON + "\n```"),
      ]);

      const engine = new SpecEngine({
        provider,
        model: "mock",
        projectPath,
        clarificationCallback,
      });

      /* Should not throw — falls back to stripped output */
      const result = await engine.runPipeline("Build an API");
      expect(result.artifacts).toHaveLength(5);
      /* No re-run since callback failed: 6 calls total */
      expect(provider.complete).toHaveBeenCalledTimes(6);
    });
  });

  // --------------------------------------------------------------------------
  // Graph building from LLM output
  // --------------------------------------------------------------------------

  describe("graph building", () => {
    it("should build a valid graph from LLM JSON output", async () => {
      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      const result = await engine.runPipeline("Test");

      expect(result.graph.nodes["node-1"]).toBeDefined();
      expect(result.graph.nodes["node-2"]).toBeDefined();
      expect(result.graph.nodes["node-3"]).toBeDefined();

      /* Edges: node-1 -> node-2, node-1 -> node-3 */
      expect(result.graph.edges).toEqual(
        expect.arrayContaining([
          { from: "node-1", to: "node-2" },
          { from: "node-1", to: "node-3" },
        ]),
      );
    });

    it("should detect correct topology from LLM graph output", async () => {
      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      const result = await engine.runPipeline("Test");

      /* node-1 fans out to node-2 and node-3 → divergent */
      expect(result.graph.topology).toBe("divergent");
    });

    it("should reject LLM output with duplicate node IDs", async () => {
      const duplicateGraph = JSON.stringify({
        nodes: [
          { id: "node-1", title: "A", instructions: "Do A", dependencies: [] },
          { id: "node-1", title: "B", instructions: "Do B", dependencies: [] },
        ],
      });

      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse(duplicateGraph),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      await expect(engine.runPipeline("Test")).rejects.toThrow(SpecPipelineError);
    });

    it("should reject LLM output with invalid dependency references", async () => {
      const badRefGraph = JSON.stringify({
        nodes: [{ id: "node-1", title: "A", instructions: "Do A", dependencies: ["nonexistent"] }],
      });

      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse(badRefGraph),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      await expect(engine.runPipeline("Test")).rejects.toThrow(SpecPipelineError);
    });

    it("should reject LLM output with cyclic dependencies", async () => {
      const cyclicGraph = JSON.stringify({
        nodes: [
          { id: "a", title: "A", instructions: "Do A", dependencies: ["c"] },
          { id: "b", title: "B", instructions: "Do B", dependencies: ["a"] },
          { id: "c", title: "C", instructions: "Do C", dependencies: ["b"] },
        ],
      });

      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse(cyclicGraph),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      await expect(engine.runPipeline("Test")).rejects.toThrow(SpecPipelineError);
    });

    it("should handle JSON wrapped in markdown code blocks", async () => {
      const provider = mockProvider([
        textResponse("C"),
        textResponse("S"),
        textResponse("P"),
        textResponse("T"),
        textResponse("A"),
        textResponse("Here is the graph:\n\n```json\n" + VALID_GRAPH_JSON + "\n```\n\nDone."),
      ]);

      const engine = new SpecEngine({ provider, model: "mock", projectPath });
      const result = await engine.runPipeline("Test");

      expect(Object.keys(result.graph.nodes)).toHaveLength(3);
    });
  });
});
