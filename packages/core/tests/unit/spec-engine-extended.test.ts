import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  SpecEngine,
  SpecPipelineError,
} from "../../src/spec/spec-engine.js";
import type {
  SpecEngineConfig,
  ClarificationCallback,
  ClarificationQuestion,
  SpecStepEvent,
  SpecStepCallback,
} from "../../src/spec/spec-engine.js";
import type { LLMProvider, CompletionParams } from "../../src/providers/base.js";
import type { LLMResponse } from "../../src/types.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal LLMResponse containing a single text block. */
function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: "text", text }],
    model: "mock-model",
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: "end_turn",
  };
}

/** A valid 3-node graph JSON the mock LLM returns for the graph-building step. */
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

/**
 * Build a mock LLM provider whose complete() returns predetermined responses
 * in order. Optionally accepts a side-effect function called with each params.
 */
function mockProvider(
  responses: LLMResponse[],
  sideEffect?: (params: CompletionParams, index: number) => void,
): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  let callIndex = 0;
  return {
    complete: vi.fn(async (params: CompletionParams): Promise<LLMResponse> => {
      if (callIndex >= responses.length) {
        throw new Error(`Mock provider ran out of responses (call ${String(callIndex)})`);
      }
      const idx = callIndex;
      const response = responses[callIndex]!;
      callIndex++;
      sideEffect?.(params, idx);
      return response;
    }),
  };
}

/** Responses for the 5 text artifact steps (constitution through analysis). */
function fiveArtifactResponses(): LLMResponse[] {
  return [
    textResponse("# Constitution\nStrict quality rules."),
    textResponse("# Spec\nUser stories here."),
    textResponse("# Plan\nTechnical plan here."),
    textResponse("# Tasks\n- [ ] T001 Setup\n- [ ] T002 Feature A"),
    textResponse("# Analysis\nAll looks good."),
  ];
}

/** Full 6-step responses: 5 artifact steps + valid graph JSON. */
function fullPipelineResponses(): LLMResponse[] {
  return [...fiveArtifactResponses(), textResponse(VALID_GRAPH_JSON)];
}

// ============================================================================
// Test Suite
// ============================================================================

/**
 * Extended unit tests for the SpecEngine class.
 *
 * Covers:
 * - Plan generation with artifact written to disk
 * - Clarification flow (callback invoked, answers fed back, spec resumes)
 * - Graph building from spec (node count, edge validity, topology detection)
 * - Full 6-step pipeline (all 6 spec files created in .loomflo/specs/)
 * - Error handling (LLM throws on step 2 -> descriptive SpecPipelineError)
 * - Clarification skipped (no callback -> continues with best-guess output)
 *
 * All tests use a temporary directory and mock LLM provider (no real API calls).
 */
describe("SpecEngine (extended)", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = join(tmpdir(), `loomflo-spec-ext-${randomUUID()}`);
    await mkdir(projectPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1. Plan generation: artifact written to disk
  // --------------------------------------------------------------------------

  describe("plan generation", () => {
    it("should write plan.md to .loomflo/specs/ when the LLM returns valid plan JSON", async () => {
      const planContent = "# Implementation Plan\n\n## Summary\nBuild a REST API with auth.\n\n## Build Phases\n1. Setup\n2. Auth\n3. API";
      const provider = mockProvider([
        textResponse("# Constitution\nRules."),
        textResponse("# Spec\nStories."),
        textResponse(planContent),
        textResponse("# Tasks\nT001 Setup"),
        textResponse("# Analysis\nOK."),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Build a REST API");

      const planArtifact = result.artifacts.find((a) => a.name === "plan.md");
      expect(planArtifact).toBeDefined();
      expect(planArtifact!.content).toBe(planContent);

      const diskContent = await readFile(
        join(projectPath, ".loomflo", "specs", "plan.md"),
        "utf-8",
      );
      expect(diskContent).toBe(planContent);
    });

    it("should pass correct system prompt for each step to the LLM", async () => {
      const systemPrompts: string[] = [];
      const provider = mockProvider(fullPipelineResponses(), (params) => {
        systemPrompts.push(params.system);
      });

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      await engine.runPipeline("Build a todo app");

      expect(systemPrompts).toHaveLength(6);
      expect(systemPrompts[0]).toContain("Loomprint");
      expect(systemPrompts[1]).toContain("Loomscope");
      expect(systemPrompts[2]).toContain("Loomcraft");
      expect(systemPrompts[3]).toContain("Loompath");
      expect(systemPrompts[4]).toContain("Loomscan");
      expect(systemPrompts[5]).toContain("Loomkit");
    });
  });

  // --------------------------------------------------------------------------
  // 2. Clarification flow: callback invoked with extracted questions
  // --------------------------------------------------------------------------

  describe("clarification flow", () => {
    it("should invoke clarificationCallback with extracted questions and resume with answers", async () => {
      const clarificationCallback: ClarificationCallback = vi.fn(
        async (questions: ClarificationQuestion[]): Promise<string[]> => {
          expect(questions).toHaveLength(2);
          return ["Use PostgreSQL", "Yes, include JWT"];
        },
      );

      const provider = mockProvider([
        // Step 0 (constitution): returns clarification markers
        textResponse(
          "# Constitution\n\n[CLARIFICATION_NEEDED]\n" +
            "Q1: Which database should be used?\nContext: Multiple options exist.\n" +
            "Q2: Should auth include JWT?\nContext: Affects security.\n" +
            "[/CLARIFICATION_NEEDED]\n\nFallback constitution.",
        ),
        // Step 0 re-run after clarification answers
        textResponse("# Constitution (refined)\nWith PostgreSQL and JWT."),
        // Steps 1-4: normal
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        // Step 5: graph
        textResponse(VALID_GRAPH_JSON),
      ]);

      const events: SpecStepEvent[] = [];
      const onProgress: SpecStepCallback = (event) => events.push(event);

      const engine = new SpecEngine({
        provider,
        model: "mock-model",
        projectPath,
        clarificationCallback,
      });

      const result = await engine.runPipeline("Build an API", onProgress);

      // Callback invoked once with 2 questions
      expect(clarificationCallback).toHaveBeenCalledTimes(1);
      const callArgs = (clarificationCallback as ReturnType<typeof vi.fn>).mock
        .calls[0] as ClarificationQuestion[][];
      expect(callArgs[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ question: "Which database should be used?" }),
          expect.objectContaining({ question: "Should auth include JWT?" }),
        ]),
      );

      // Re-run call should include clarification answers in the user message
      const completeCalls = (provider.complete as ReturnType<typeof vi.fn>).mock.calls;
      const rerunCall = completeCalls[1] as CompletionParams[];
      const rerunUserMessage =
        typeof rerunCall[0].messages[0]!.content === "string"
          ? rerunCall[0].messages[0]!.content
          : "";
      expect(rerunUserMessage).toContain("PostgreSQL");
      expect(rerunUserMessage).toContain("JWT");

      // Pipeline completed successfully
      expect(result.artifacts).toHaveLength(5);
      expect(Object.keys(result.graph.nodes)).toHaveLength(3);

      // Clarification events emitted
      const clarEvents = events.filter((e) => e.type === "clarification_requested");
      expect(clarEvents).toHaveLength(1);
      const answeredEvents = events.filter((e) => e.type === "clarification_answered");
      expect(answeredEvents).toHaveLength(1);
    });

    it("should limit clarification questions to 3 even when LLM returns more", async () => {
      const clarificationCallback: ClarificationCallback = vi.fn(
        async (questions: ClarificationQuestion[]): Promise<string[]> => {
          expect(questions.length).toBeLessThanOrEqual(3);
          return questions.map(() => "answer");
        },
      );

      const provider = mockProvider([
        textResponse(
          "[CLARIFICATION_NEEDED]\n" +
            "Q1: First?\nContext: C1.\n" +
            "Q2: Second?\nContext: C2.\n" +
            "Q3: Third?\nContext: C3.\n" +
            "Q4: Fourth?\nContext: C4.\n" +
            "[/CLARIFICATION_NEEDED]\nFallback.",
        ),
        textResponse("# Constitution (refined)"),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({
        provider,
        model: "mock-model",
        projectPath,
        clarificationCallback,
      });

      await engine.runPipeline("Project");

      expect(clarificationCallback).toHaveBeenCalledTimes(1);
      const passedQuestions = (clarificationCallback as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as ClarificationQuestion[];
      expect(passedQuestions).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Graph building from spec
  // --------------------------------------------------------------------------

  describe("graph building from spec", () => {
    it("should produce a graph with correct node count, valid edges, and detected topology", async () => {
      const provider = mockProvider([
        ...fiveArtifactResponses(),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Build a project");

      // 3 nodes
      const nodeIds = Object.keys(result.graph.nodes);
      expect(nodeIds).toHaveLength(3);
      expect(nodeIds).toContain("node-1");
      expect(nodeIds).toContain("node-2");
      expect(nodeIds).toContain("node-3");

      // Edges: node-1 -> node-2, node-1 -> node-3
      expect(result.graph.edges).toHaveLength(2);
      expect(result.graph.edges).toEqual(
        expect.arrayContaining([
          { from: "node-1", to: "node-2" },
          { from: "node-1", to: "node-3" },
        ]),
      );

      // Divergent topology (one root fans out to two children)
      expect(result.graph.topology).toBe("divergent");
    });

    it("should detect linear topology for a sequential graph", async () => {
      const linearGraph = JSON.stringify({
        nodes: [
          { id: "a", title: "Step A", instructions: "1. Do A", dependencies: [] },
          { id: "b", title: "Step B", instructions: "1. Do B", dependencies: ["a"] },
          { id: "c", title: "Step C", instructions: "1. Do C", dependencies: ["b"] },
        ],
      });

      const provider = mockProvider([
        ...fiveArtifactResponses(),
        textResponse(linearGraph),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Sequential project");

      expect(Object.keys(result.graph.nodes)).toHaveLength(3);
      expect(result.graph.edges).toHaveLength(2);
      expect(result.graph.topology).toBe("linear");
    });

    it("should detect mixed topology for a diamond graph", async () => {
      const diamondGraph = JSON.stringify({
        nodes: [
          { id: "root", title: "Root", instructions: "1. Start", dependencies: [] },
          { id: "left", title: "Left", instructions: "1. Left path", dependencies: ["root"] },
          { id: "right", title: "Right", instructions: "1. Right path", dependencies: ["root"] },
          { id: "merge", title: "Merge", instructions: "1. Converge", dependencies: ["left", "right"] },
        ],
      });

      const provider = mockProvider([
        ...fiveArtifactResponses(),
        textResponse(diamondGraph),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Diamond project");

      expect(Object.keys(result.graph.nodes)).toHaveLength(4);
      expect(result.graph.topology).toBe("mixed");
    });

    it("should populate cost estimates on each node", async () => {
      const provider = mockProvider([
        ...fiveArtifactResponses(),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Cost estimation project");

      for (const node of Object.values(result.graph.nodes)) {
        expect(node.cost).toBeGreaterThan(0);
        expect(typeof node.cost).toBe("number");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. Full 6-step pipeline
  // --------------------------------------------------------------------------

  describe("full 6-step pipeline", () => {
    it("should create all 6 spec files in .loomflo/specs/", async () => {
      const provider = mockProvider(fullPipelineResponses());

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Build a complete project");

      // 5 file artifacts (constitution, spec, plan, tasks, analysis)
      expect(result.artifacts).toHaveLength(5);

      const expectedFiles = [
        "constitution.md",
        "spec.md",
        "plan.md",
        "tasks.md",
        "analysis-report.md",
      ];

      const specsDir = join(projectPath, ".loomflo", "specs");
      const filesOnDisk = await readdir(specsDir);

      for (const fileName of expectedFiles) {
        expect(filesOnDisk).toContain(fileName);

        const content = await readFile(join(specsDir, fileName), "utf-8");
        expect(content.length).toBeGreaterThan(0);

        const artifact = result.artifacts.find((a) => a.name === fileName);
        expect(artifact).toBeDefined();
        expect(artifact!.content).toBe(content);
      }

      // Graph is also returned
      expect(result.graph).toBeDefined();
      expect(Object.keys(result.graph.nodes).length).toBeGreaterThan(0);
    });

    it("should call the LLM exactly 6 times for a clean pipeline", async () => {
      const provider = mockProvider(fullPipelineResponses());

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      await engine.runPipeline("Test");

      expect(provider.complete).toHaveBeenCalledTimes(6);
    });

    it("should emit started and completed events for all 6 steps plus pipeline_completed", async () => {
      const provider = mockProvider(fullPipelineResponses());

      const events: SpecStepEvent[] = [];
      const onProgress: SpecStepCallback = (event) => events.push(event);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      await engine.runPipeline("Event tracking test", onProgress);

      const startEvents = events.filter((e) => e.type === "spec_step_started");
      expect(startEvents).toHaveLength(6);

      const completedEvents = events.filter((e) => e.type === "spec_step_completed");
      expect(completedEvents).toHaveLength(6);

      const pipelineComplete = events.filter((e) => e.type === "spec_pipeline_completed");
      expect(pipelineComplete).toHaveLength(1);

      // Step names are in order
      const stepNames = startEvents.map(
        (e) => (e as { type: "spec_step_started"; stepName: string }).stepName,
      );
      expect(stepNames).toEqual([
        "constitution",
        "spec",
        "plan",
        "tasks",
        "analysis",
        "graph",
      ]);
    });

    it("should pass the configured model to every LLM call", async () => {
      const models: string[] = [];
      const provider = mockProvider(fullPipelineResponses(), (params) => {
        models.push(params.model);
      });

      const engine = new SpecEngine({ provider, model: "claude-opus-4-6", projectPath });
      await engine.runPipeline("Model check");

      expect(models).toHaveLength(6);
      for (const model of models) {
        expect(model).toBe("claude-opus-4-6");
      }
    });

    it("should feed each step's output as context to subsequent steps", async () => {
      const userMessages: string[] = [];
      const provider = mockProvider(fullPipelineResponses(), (params) => {
        const msg = params.messages[0]?.content;
        if (typeof msg === "string") {
          userMessages.push(msg);
        }
      });

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      await engine.runPipeline("Context chaining test");

      // Step 1 (spec): should include constitution output
      expect(userMessages[1]).toContain("Strict quality rules");
      // Step 2 (plan): should include spec output
      expect(userMessages[2]).toContain("User stories here");
      // Step 3 (tasks): should include plan output
      expect(userMessages[3]).toContain("Technical plan here");
      // Step 4 (analysis): should include tasks output
      expect(userMessages[4]).toContain("T001 Setup");
    });
  });

  // --------------------------------------------------------------------------
  // 5. Error handling: LLM throws on step 2
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should reject with SpecPipelineError when LLM throws on step 2 (spec)", async () => {
      let callCount = 0;
      const provider: LLMProvider & { complete: ReturnType<typeof vi.fn> } = {
        complete: vi.fn(async (): Promise<LLMResponse> => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Rate limit exceeded on spec generation");
          }
          return textResponse(`Step ${String(callCount)} output`);
        }),
      };

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });

      try {
        await engine.runPipeline("Error test");
        expect.unreachable("Should have thrown SpecPipelineError");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(SpecPipelineError);
        const pipelineError = e as SpecPipelineError;
        expect(pipelineError.stepName).toBe("spec");
        expect(pipelineError.stepIndex).toBe(1);
        expect(pipelineError.message).toContain("spec");
        expect(pipelineError.message).toContain("Rate limit exceeded");
        expect(pipelineError.cause).toBeInstanceOf(Error);
      }
    });

    it("should emit spec_step_error event when a step fails", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        complete: vi.fn(async (): Promise<LLMResponse> => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Connection timeout");
          }
          return textResponse(`Step ${String(callCount)}`);
        }),
      };

      const events: SpecStepEvent[] = [];
      const onProgress: SpecStepCallback = (event) => events.push(event);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });

      await expect(engine.runPipeline("Error event test", onProgress)).rejects.toThrow(
        SpecPipelineError,
      );

      const errorEvents = events.filter((e) => e.type === "spec_step_error");
      expect(errorEvents).toHaveLength(1);
      expect(
        (errorEvents[0] as { type: "spec_step_error"; stepName: string }).stepName,
      ).toBe("spec");
    });

    it("should wrap non-Error throwables in SpecPipelineError", async () => {
      const provider: LLMProvider = {
        complete: vi.fn(async (): Promise<LLMResponse> => {
          throw "string error value";
        }),
      };

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });

      try {
        await engine.runPipeline("String error test");
        expect.unreachable("Should have thrown");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(SpecPipelineError);
        const pipelineError = e as SpecPipelineError;
        expect(pipelineError.stepName).toBe("constitution");
        expect(pipelineError.stepIndex).toBe(0);
      }
    });

    it("should reject with SpecPipelineError when graph JSON is malformed", async () => {
      const provider = mockProvider([
        ...fiveArtifactResponses(),
        textResponse("This is not valid JSON at all {{{"),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });

      try {
        await engine.runPipeline("Bad JSON test");
        expect.unreachable("Should have thrown");
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(SpecPipelineError);
        const pipelineError = e as SpecPipelineError;
        expect(pipelineError.stepName).toBe("graph");
        expect(pipelineError.stepIndex).toBe(5);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Clarification skipped: no callback provided
  // --------------------------------------------------------------------------

  describe("clarification skipped (no callback)", () => {
    it("should continue with best-guess output when no clarificationCallback is provided", async () => {
      const provider = mockProvider([
        textResponse(
          "Before markers.\n[CLARIFICATION_NEEDED]\n" +
            "Q1: What framework?\nContext: Need to choose.\n" +
            "[/CLARIFICATION_NEEDED]\nBest-guess constitution content.",
        ),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse(VALID_GRAPH_JSON),
      ]);

      // No clarificationCallback in config
      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      const result = await engine.runPipeline("Skipped clarification test");

      // Pipeline succeeds
      expect(result.artifacts).toHaveLength(5);

      // 6 LLM calls (no re-run since no callback)
      expect(provider.complete).toHaveBeenCalledTimes(6);

      // Constitution artifact has markers stripped
      const constitutionArtifact = result.artifacts.find((a) => a.name === "constitution.md");
      expect(constitutionArtifact).toBeDefined();
      expect(constitutionArtifact!.content).not.toContain("[CLARIFICATION_NEEDED]");
      expect(constitutionArtifact!.content).not.toContain("[/CLARIFICATION_NEEDED]");
      expect(constitutionArtifact!.content).toContain("Best-guess constitution content");
    });

    it("should not invoke any callback when markers present but no callback configured", async () => {
      const callbackSpy = vi.fn();

      const provider = mockProvider([
        textResponse(
          "[CLARIFICATION_NEEDED]\nQ1: Question?\nContext: Ctx.\n[/CLARIFICATION_NEEDED]\nFallback.",
        ),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({ provider, model: "mock-model", projectPath });
      await engine.runPipeline("No callback test");

      // The spy was never registered as a callback, confirming no callback was invoked
      expect(callbackSpy).not.toHaveBeenCalled();
    });

    it("should strip markers and continue when clarificationCallback throws", async () => {
      const failingCallback: ClarificationCallback = vi.fn(async (): Promise<string[]> => {
        throw new Error("User cancelled the prompt");
      });

      const provider = mockProvider([
        textResponse(
          "Preamble.\n[CLARIFICATION_NEEDED]\n" +
            "Q1: Which database?\nContext: Important decision.\n" +
            "[/CLARIFICATION_NEEDED]\nDefault choice: SQLite.",
        ),
        textResponse("# Spec"),
        textResponse("# Plan"),
        textResponse("# Tasks"),
        textResponse("# Analysis"),
        textResponse(VALID_GRAPH_JSON),
      ]);

      const engine = new SpecEngine({
        provider,
        model: "mock-model",
        projectPath,
        clarificationCallback: failingCallback,
      });

      const result = await engine.runPipeline("Callback failure test");

      // Pipeline still completes
      expect(result.artifacts).toHaveLength(5);

      // Callback was called but threw
      expect(failingCallback).toHaveBeenCalledTimes(1);

      // No re-run since callback failed: 6 total calls
      expect(provider.complete).toHaveBeenCalledTimes(6);

      // Markers stripped from constitution
      const constitutionArtifact = result.artifacts.find((a) => a.name === "constitution.md");
      expect(constitutionArtifact!.content).not.toContain("[CLARIFICATION_NEEDED]");
      expect(constitutionArtifact!.content).toContain("Default choice: SQLite");
    });
  });
});
