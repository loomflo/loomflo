import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ModelPricing } from '../costs/tracker.js';
import { DEFAULT_PRICING } from '../costs/tracker.js';
import type { LLMProvider } from '../providers/base.js';
import type { Graph, LLMResponse, Node, Edge, TopologyType } from '../types.js';
import type { WebSocketBroadcaster } from '../api/websocket.js';
import { SPEC_PROMPTS } from './prompts.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the spec generation engine.
 *
 * @param provider - LLM provider for making completion calls.
 * @param model - Model identifier to use for all spec generation calls.
 * @param projectPath - Absolute path to the project workspace.
 * @param maxTokens - Maximum tokens per LLM completion call.
 */
export interface SpecEngineConfig {
  /** LLM provider for making completion calls. */
  provider: LLMProvider;
  /** Model identifier to use for all spec generation calls. */
  model: string;
  /** Absolute path to the project workspace. */
  projectPath: string;
  /** Maximum tokens per LLM completion call. */
  maxTokens?: number;
  /**
   * Optional callback for handling clarification questions.
   *
   * When the LLM detects ambiguity in the project description, it includes
   * `[CLARIFICATION_NEEDED]` markers in its output. If this callback is set,
   * the engine extracts the questions (max 3), invokes the callback, and
   * re-runs the step with the user's answers. If not set, the engine uses
   * the LLM's best-guess defaults.
   */
  clarificationCallback?: ClarificationCallback;
  /**
   * Optional WebSocket broadcaster for emitting real-time events during
   * spec generation (graph_modified, spec_artifact_ready).
   */
  broadcaster?: WebSocketBroadcaster;
}

/**
 * A clarification question extracted from LLM output ambiguity markers.
 *
 * @param question - The clarification question text.
 * @param context - Additional context explaining why this question matters.
 */
export interface ClarificationQuestion {
  /** The clarification question text. */
  question: string;
  /** Additional context explaining why this question matters. */
  context: string;
}

/**
 * Callback invoked when the spec engine detects ambiguity and needs user input.
 *
 * Receives an array of questions (max 3) and must return an array of answers
 * in the same order. The callback is responsible for presenting the questions
 * to the user and collecting responses.
 *
 * @param questions - Array of clarification questions (max 3).
 * @returns Promise resolving to an array of answer strings in corresponding order.
 */
export type ClarificationCallback = (
  questions: ClarificationQuestion[],
) => Promise<string[]>;

/**
 * A single spec artifact produced by the pipeline.
 *
 * @param name - Artifact file name (e.g., "constitution.md").
 * @param path - Absolute path where the artifact was written.
 * @param content - Full content of the artifact.
 */
export interface SpecArtifact {
  /** Artifact file name (e.g., "constitution.md"). */
  name: string;
  /** Absolute path where the artifact was written. */
  path: string;
  /** Full content of the artifact. */
  content: string;
}

/**
 * Result of a completed spec generation pipeline.
 *
 * @param artifacts - All spec artifacts produced by the pipeline.
 * @param graph - The execution graph built from the task list.
 */
export interface SpecPipelineResult {
  /** All spec artifacts produced by the pipeline. */
  artifacts: SpecArtifact[];
  /** The execution graph built from the task list. */
  graph: Graph;
}

/** Events emitted during spec pipeline execution for progress tracking. */
export type SpecStepEvent =
  | { type: 'spec_step_started'; stepName: string; stepIndex: number }
  | { type: 'spec_step_completed'; stepName: string; stepIndex: number; artifactPath: string }
  | { type: 'spec_step_error'; stepName: string; stepIndex: number; error: Error }
  | { type: 'spec_pipeline_completed'; artifacts: SpecArtifact[]; graph: Graph }
  | { type: 'clarification_requested'; questions: ClarificationQuestion[]; stepName: string }
  | { type: 'clarification_answered'; answers: string[]; stepName: string };

/** Callback for receiving spec pipeline progress events. */
export type SpecStepCallback = (event: SpecStepEvent) => void;

// ============================================================================
// SpecPipelineError
// ============================================================================

/**
 * Error thrown when a spec pipeline step fails.
 *
 * Contains the step name and index for diagnostics. The original error
 * is preserved as the `cause` property.
 */
export class SpecPipelineError extends Error {
  /** Name of the pipeline step that failed. */
  public readonly stepName: string;
  /** Zero-based index of the pipeline step that failed. */
  public readonly stepIndex: number;

  /**
   * @param stepName - Name of the failed pipeline step.
   * @param stepIndex - Zero-based index of the failed step.
   * @param cause - The underlying error that caused the failure.
   */
  constructor(stepName: string, stepIndex: number, cause: Error) {
    super(
      `Spec pipeline failed at step ${String(stepIndex)} (${stepName}): ${cause.message}`,
      { cause },
    );
    this.name = 'SpecPipelineError';
    this.stepName = stepName;
    this.stepIndex = stepIndex;
  }
}


// ============================================================================
// GraphValidationError
// ============================================================================

/**
 * Validation error codes for graph integrity checks.
 *
 * - `cycle_detected`: The graph contains a cycle (not a valid DAG).
 * - `duplicate_node_id`: Two or more nodes share the same ID.
 * - `invalid_edge_reference`: An edge references a non-existent node.
 * - `no_root_node`: No node exists without incoming edges.
 * - `orphan_nodes`: One or more nodes have no edges at all in a multi-node graph.
 * - `empty_graph`: The graph contains zero nodes.
 */
export type GraphValidationCode =
  | 'cycle_detected'
  | 'duplicate_node_id'
  | 'invalid_edge_reference'
  | 'no_root_node'
  | 'orphan_nodes'
  | 'empty_graph';

/**
 * Error thrown when graph validation fails.
 *
 * Contains a machine-readable {@link code} identifying the failure type
 * and an optional list of {@link involvedNodes} for targeted debugging.
 */
export class GraphValidationError extends Error {
  /** Machine-readable validation failure code. */
  public readonly code: GraphValidationCode;
  /** Node IDs involved in the validation failure, if applicable. */
  public readonly involvedNodes: string[];

  /**
   * @param code - Machine-readable validation failure code.
   * @param message - Human-readable description of the failure.
   * @param involvedNodes - Node IDs involved in the failure.
   */
  constructor(code: GraphValidationCode, message: string, involvedNodes: string[] = []) {
    super(message);
    this.name = 'GraphValidationError';
    this.code = code;
    this.involvedNodes = involvedNodes;
  }
}

// ============================================================================
// Cost Estimation Types
// ============================================================================

/**
 * Configuration for graph node cost estimation.
 *
 * Controls how many tokens are estimated per task and what pricing
 * to apply. Uses {@link ModelPricing} from `costs/tracker` for consistency.
 * These are rough estimates for user guidance, not exact billing.
 *
 * @param estimatedInputTokensPerTask - Estimated input tokens consumed per task.
 * @param estimatedOutputTokensPerTask - Estimated output tokens produced per task.
 * @param modelPricing - Per-model pricing table (model ID → pricing).
 * @param model - Model ID to look up in the pricing table.
 */
export interface CostEstimationConfig {
  /** Estimated input tokens consumed per task (default: 4000). */
  estimatedInputTokensPerTask: number;
  /** Estimated output tokens produced per task (default: 2000). */
  estimatedOutputTokensPerTask: number;
  /** Per-model pricing table keyed by model identifier (reuses costs/tracker ModelPricing). */
  modelPricing: Record<string, ModelPricing>;
  /** Model identifier to use for cost lookup. */
  model: string;
}

/** Default cost estimation config using Anthropic Claude pricing via the shared pricing table. */
export const DEFAULT_COST_ESTIMATION_CONFIG: CostEstimationConfig = {
  estimatedInputTokensPerTask: 4000,
  estimatedOutputTokensPerTask: 2000,
  modelPricing: DEFAULT_PRICING,
  model: 'claude-sonnet-4-6',
};

/**
 * Result of graph validation and cost estimation.
 *
 * @param graph - The validated graph with updated topology and per-node costs.
 * @param estimatedTotalCost - Sum of all node cost estimates in USD.
 */
export interface ValidatedGraph {
  /** The validated graph with per-node cost estimates and verified topology. */
  graph: Graph;
  /** Estimated total cost in USD across all nodes. */
  estimatedTotalCost: number;
}

// ============================================================================
// Internal Types
// ============================================================================

/** Shape of a single node definition in the LLM's graph JSON output. */
interface GraphNodeDefinition {
  id: string;
  title: string;
  instructions: string;
  dependencies: string[];
}

/** Shape of the LLM's graph JSON output. */
interface GraphDefinition {
  nodes: GraphNodeDefinition[];
}

// ============================================================================
// Clarification Constants
// ============================================================================

/** Opening marker the LLM uses to signal ambiguity in its output. */
const CLARIFICATION_MARKER_START = '[CLARIFICATION_NEEDED]';

/** Closing marker the LLM uses to end the ambiguity block. */
const CLARIFICATION_MARKER_END = '[/CLARIFICATION_NEEDED]';

/** Maximum number of clarification questions per step (FR-007). */
const MAX_CLARIFICATION_QUESTIONS = 3;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract all text content from an LLM response.
 *
 * Concatenates all text-type content blocks from the response,
 * ignoring tool_use and tool_result blocks.
 *
 * @param response - The LLM response to extract text from.
 * @returns The concatenated text content.
 * @throws If the response contains no text content.
 */
function extractResponseText(response: LLMResponse): string {
  const parts: string[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }

  const text = parts.join('\n');
  if (text.length === 0) {
    throw new Error('LLM response contained no text content');
  }

  return text;
}

/**
 * Extract and parse a JSON object from text that may contain markdown or prose.
 *
 * Tries in order:
 * 1. JSON inside a markdown code block (```json ... ```)
 * 2. First JSON object or array found in the text
 * 3. The entire text as raw JSON
 *
 * @param text - Text potentially containing JSON.
 * @returns The parsed JSON value.
 * @throws If no valid JSON can be found or parsed.
 */
function extractJson(text: string): unknown {
  // Try markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch?.[1] != null) {
    return JSON.parse(codeBlockMatch[1]) as unknown;
  }

  // Try to find a JSON object in the text
  const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch?.[0] != null) {
    return JSON.parse(jsonObjectMatch[0]) as unknown;
  }

  // Last resort: try parsing the entire text
  return JSON.parse(text) as unknown;
}

/**
 * Validate that a parsed value conforms to the expected GraphDefinition shape.
 *
 * @param value - The parsed JSON value to validate.
 * @returns The validated GraphDefinition.
 * @throws If the value does not match the expected structure.
 */
function validateGraphDefinition(value: unknown): GraphDefinition {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Graph definition must be an object');
  }

  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj['nodes'])) {
    throw new Error('Graph definition must have a "nodes" array');
  }

  for (const node of obj['nodes'] as unknown[]) {
    if (typeof node !== 'object' || node === null) {
      throw new Error('Each graph node must be an object');
    }

    const n = node as Record<string, unknown>;
    if (typeof n['id'] !== 'string' || n['id'].length === 0) {
      throw new Error('Each graph node must have a non-empty string "id"');
    }
    if (typeof n['title'] !== 'string' || n['title'].length === 0) {
      throw new Error(`Graph node "${n['id']}" must have a non-empty string "title"`);
    }
    if (typeof n['instructions'] !== 'string') {
      throw new Error(`Graph node "${n['id']}" must have a string "instructions"`);
    }
    if (!Array.isArray(n['dependencies'])) {
      throw new Error(`Graph node "${n['id']}" must have a "dependencies" array`);
    }
    for (const dep of n['dependencies'] as unknown[]) {
      if (typeof dep !== 'string') {
        throw new Error(`Graph node "${n['id']}" dependencies must be strings`);
      }
    }
  }

  return value as GraphDefinition;
}

/**
 * Detect the topology classification of a directed graph.
 *
 * Classifications:
 * - linear: no node has more than one incoming or outgoing edge
 * - divergent: exactly one node fans out (out-degree > 1), no convergence
 * - tree: multiple nodes fan out, no convergence
 * - convergent: at least one node fans in (in-degree > 1), no divergence
 * - mixed: both divergence and convergence present
 *
 * @param nodeIds - Set of all node IDs in the graph.
 * @param edges - All directed edges in the graph.
 * @returns The detected topology type.
 */
function detectTopology(nodeIds: string[], edges: Edge[]): TopologyType {
  if (edges.length === 0) {
    return 'linear';
  }

  const outDegree = new Map<string, number>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    outDegree.set(id, 0);
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  let divergentCount = 0;
  let convergentCount = 0;

  for (const count of outDegree.values()) {
    if (count > 1) divergentCount++;
  }
  for (const count of inDegree.values()) {
    if (count > 1) convergentCount++;
  }

  if (divergentCount === 0 && convergentCount === 0) return 'linear';
  if (divergentCount > 0 && convergentCount === 0) {
    return divergentCount === 1 ? 'divergent' : 'tree';
  }
  if (divergentCount === 0 && convergentCount > 0) return 'convergent';
  return 'mixed';
}

/**
 * Count the approximate number of discrete tasks in a node's instructions.
 *
 * Uses heuristics: numbered list items, bullet points, or markdown headings.
 * Falls back to 1 if no list structure is detected.
 *
 * @param instructions - Markdown instructions for a graph node.
 * @returns Estimated number of tasks (minimum 1).
 */
function countTasksInInstructions(instructions: string): number {
  const numberedItems = instructions.match(/^\s*\d+\.\s/gm);
  if (numberedItems != null && numberedItems.length > 0) {
    return numberedItems.length;
  }

  const bulletItems = instructions.match(/^\s*[-*]\s/gm);
  if (bulletItems != null && bulletItems.length > 0) {
    return bulletItems.length;
  }

  const headings = instructions.match(/^#+\s/gm);
  if (headings != null && headings.length > 0) {
    return headings.length;
  }

  return 1;
}

// ============================================================================
// Graph Validation & Cost Estimation (Public API)
// ============================================================================

/**
 * Validate that a graph is a directed acyclic graph (DAG) using Kahn's algorithm.
 *
 * Performs a topological sort by iteratively removing nodes with zero in-degree.
 * If all nodes are removed, the graph is a valid DAG. If nodes remain, a cycle
 * exists among the remaining nodes.
 *
 * @param nodes - Map of node IDs to Node objects.
 * @param edges - All directed edges in the graph.
 * @throws {GraphValidationError} With code `cycle_detected` if a cycle exists.
 */
export function validateDag(nodes: Record<string, Node>, edges: Edge[]): void {
  const nodeIds = Object.keys(nodes);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  let visited = 0;
  let current = queue.shift();
  while (current != null) {
    visited++;

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
    current = queue.shift();
  }

  if (visited !== nodeIds.length) {
    const cycleNodes = [...inDegree.entries()]
      .filter(([, degree]) => degree > 0)
      .map(([id]) => id);
    throw new GraphValidationError(
      'cycle_detected',
      `Graph contains a cycle involving nodes: ${cycleNodes.join(', ')}`,
      cycleNodes,
    );
  }
}

/**
 * Validate the structural integrity of a graph.
 *
 * Checks:
 * 1. The graph has at least one node.
 * 2. All node IDs in the nodes map are unique (guaranteed by Record keys).
 * 3. All edge references point to existing nodes.
 * 4. At least one root node exists (no incoming edges).
 * 5. In multi-node graphs, no node is completely disconnected (orphan).
 *
 * @param graph - The graph to validate.
 * @throws {GraphValidationError} With a descriptive code if any check fails.
 */
export function validateGraphIntegrity(graph: Graph): void {
  const nodeIds = new Set(Object.keys(graph.nodes));

  if (nodeIds.size === 0) {
    throw new GraphValidationError(
      'empty_graph',
      'Graph must contain at least one node',
    );
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new GraphValidationError(
        'invalid_edge_reference',
        `Edge references non-existent source node "${edge.from}"`,
        [edge.from],
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new GraphValidationError(
        'invalid_edge_reference',
        `Edge references non-existent target node "${edge.to}"`,
        [edge.to],
      );
    }
  }

  const nodesWithIncoming = new Set(graph.edges.map((e) => e.to));
  const rootNodes = [...nodeIds].filter((id) => !nodesWithIncoming.has(id));
  if (rootNodes.length === 0) {
    throw new GraphValidationError(
      'no_root_node',
      'Graph must have at least one root node (no incoming edges)',
    );
  }

  if (nodeIds.size > 1) {
    const nodesWithOutgoing = new Set(graph.edges.map((e) => e.from));
    const connectedNodes = new Set([...nodesWithIncoming, ...nodesWithOutgoing]);
    const orphanNodes = [...nodeIds].filter((id) => !connectedNodes.has(id));
    if (orphanNodes.length > 0) {
      throw new GraphValidationError(
        'orphan_nodes',
        `Graph contains orphan nodes with no edges: ${orphanNodes.join(', ')}`,
        orphanNodes,
      );
    }
  }
}

/**
 * Estimate the cost of executing a single graph node.
 *
 * Counts the approximate number of tasks in the node's instructions,
 * multiplies by the configured token estimates, and applies model pricing.
 * This is a rough estimate for user guidance, not an exact billing prediction.
 *
 * If the configured model is not found in the pricing table, falls back
 * to Sonnet-tier pricing ($3/$15 per million tokens).
 *
 * @param node - The graph node to estimate cost for.
 * @param config - Cost estimation configuration with token estimates and pricing.
 * @returns Estimated cost in USD.
 */
export function estimateNodeCost(node: Node, config: CostEstimationConfig): number {
  const taskCount = countTasksInInstructions(node.instructions);

  const totalInputTokens = taskCount * config.estimatedInputTokensPerTask;
  const totalOutputTokens = taskCount * config.estimatedOutputTokensPerTask;

  const pricing = config.modelPricing[config.model] ?? {
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  };

  return (
    (totalInputTokens * pricing.inputPricePerMToken) / 1_000_000 +
    (totalOutputTokens * pricing.outputPricePerMToken) / 1_000_000
  );
}

/**
 * Validate a graph and annotate it with topology detection and cost estimates.
 *
 * Runs all validation checks in order:
 * 1. Structural integrity (non-empty, valid references, roots, no orphans)
 * 2. DAG validation (no cycles via Kahn's algorithm)
 * 3. Topology re-detection
 * 4. Per-node cost estimation
 *
 * If any validation step fails, a {@link GraphValidationError} is thrown
 * before subsequent steps run. On success, returns the graph with updated
 * topology, per-node cost fields, and an aggregate cost total.
 *
 * @param graph - The graph to validate and annotate.
 * @param costConfig - Cost estimation configuration (defaults to Anthropic Claude pricing).
 * @returns The validated graph and estimated total cost.
 * @throws {GraphValidationError} If the graph fails any validation check.
 */
export function validateAndOptimizeGraph(
  graph: Graph,
  costConfig: CostEstimationConfig = DEFAULT_COST_ESTIMATION_CONFIG,
): ValidatedGraph {
  validateGraphIntegrity(graph);
  validateDag(graph.nodes, graph.edges);

  const topology = detectTopology(Object.keys(graph.nodes), graph.edges);

  let estimatedTotalCost = 0;
  for (const node of Object.values(graph.nodes)) {
    node.cost = estimateNodeCost(node, costConfig);
    estimatedTotalCost += node.cost;
  }

  return {
    graph: { ...graph, topology },
    estimatedTotalCost,
  };
}

/**
 * Create a Node object with default field values from a graph node definition.
 *
 * @param def - The graph node definition from the LLM output.
 * @returns A fully populated Node object in 'pending' status.
 */
function createNodeFromDefinition(def: GraphNodeDefinition): Node {
  return {
    id: def.id,
    title: def.title,
    status: 'pending',
    instructions: def.instructions,
    delay: '0',
    resumeAt: null,
    agents: [],
    fileOwnership: {},
    retryCount: 0,
    maxRetries: 3,
    reviewReport: null,
    cost: 0,
    startedAt: null,
    completedAt: null,
  };
}

// ============================================================================
// SpecEngine
// ============================================================================

/**
 * Engine that runs the 6-step spec generation pipeline.
 *
 * The pipeline takes a natural language project description and produces
 * a complete specification suite (constitution, spec, plan, tasks, analysis)
 * plus an execution workflow graph. Each step calls the LLM with the previous
 * step's output as context, building up the specification incrementally.
 *
 * All artifacts are written to `.loomflo/specs/` in the project directory.
 * Progress is reported via an optional callback.
 *
 * @example
 * ```typescript
 * const engine = new SpecEngine({
 *   provider: anthropicProvider,
 *   model: 'claude-opus-4-6',
 *   projectPath: '/path/to/project',
 * });
 *
 * const result = await engine.runPipeline(
 *   'Build a REST API with auth',
 *   (event) => console.log(event.type, event.stepName),
 * );
 * ```
 */
export class SpecEngine {
  private readonly config: SpecEngineConfig;
  private readonly specsDir: string;
  private readonly broadcaster: WebSocketBroadcaster | undefined;

  /**
   * Create a new SpecEngine instance.
   *
   * @param config - Engine configuration including provider, model, and project path.
   */
  constructor(config: SpecEngineConfig) {
    this.config = config;
    this.specsDir = join(config.projectPath, '.loomflo', 'specs');
    this.broadcaster = config.broadcaster;
  }

  /**
   * Run the full 6-step spec generation pipeline.
   *
   * Steps executed sequentially:
   * 1. Generate constitution.md — foundational quality principles
   * 2. Generate spec.md — functional specification
   * 3. Generate plan.md — technical implementation plan
   * 4. Generate tasks.md — ordered task breakdown
   * 5. Generate analysis-report.md — coherence analysis
   * 6. Build workflow graph — from tasks and plan
   *
   * Each artifact is written to `.loomflo/specs/` on disk. If any step fails,
   * the pipeline aborts and a {@link SpecPipelineError} is thrown.
   *
   * @param description - Natural language project description.
   * @param onProgress - Optional callback for receiving progress events.
   * @returns The pipeline result with all artifacts and the built graph.
   * @throws {SpecPipelineError} If any pipeline step fails.
   */
  async runPipeline(
    description: string,
    onProgress?: SpecStepCallback,
  ): Promise<SpecPipelineResult> {
    await mkdir(this.specsDir, { recursive: true });

    const artifacts: SpecArtifact[] = [];

    // Step 0: Generate constitution (with clarification support)
    const constitution = await this.executeStep(
      0, 'constitution',
      async () => {
        const output = await this.generateConstitution(description);
        return this.handleClarification(
          'constitution', description, output,
          (augmented) => this.generateConstitution(augmented),
          onProgress,
        );
      },
      onProgress,
    );
    const constitutionArtifact = await this.writeArtifact('constitution.md', constitution);
    artifacts.push(constitutionArtifact);
    this.broadcaster?.emitSpecArtifactReady('constitution.md', '.loomflo/specs/constitution.md');
    this.notifyStepCompleted(0, 'constitution', constitutionArtifact.path, onProgress);

    // Step 1: Generate spec (with clarification support)
    const spec = await this.executeStep(
      1, 'spec',
      async () => {
        const output = await this.generateSpec(description, constitution);
        return this.handleClarification(
          'spec', description, output,
          (augmented) => this.generateSpec(augmented, constitution),
          onProgress,
        );
      },
      onProgress,
    );
    const specArtifact = await this.writeArtifact('spec.md', spec);
    artifacts.push(specArtifact);
    this.broadcaster?.emitSpecArtifactReady('spec.md', '.loomflo/specs/spec.md');
    this.notifyStepCompleted(1, 'spec', specArtifact.path, onProgress);

    // Step 2: Generate plan
    const plan = await this.executeStep(
      2, 'plan',
      () => this.generatePlan(description, constitution, spec),
      onProgress,
    );
    const planArtifact = await this.writeArtifact('plan.md', plan);
    artifacts.push(planArtifact);
    this.broadcaster?.emitSpecArtifactReady('plan.md', '.loomflo/specs/plan.md');
    this.notifyStepCompleted(2, 'plan', planArtifact.path, onProgress);

    // Step 3: Generate tasks
    const tasks = await this.executeStep(
      3, 'tasks',
      () => this.generateTasks(description, constitution, spec, plan),
      onProgress,
    );
    const tasksArtifact = await this.writeArtifact('tasks.md', tasks);
    artifacts.push(tasksArtifact);
    this.broadcaster?.emitSpecArtifactReady('tasks.md', '.loomflo/specs/tasks.md');
    this.notifyStepCompleted(3, 'tasks', tasksArtifact.path, onProgress);

    // Step 4: Generate analysis
    const analysis = await this.executeStep(
      4, 'analysis',
      () => this.generateAnalysis(constitution, spec, plan, tasks),
      onProgress,
    );
    const analysisArtifact = await this.writeArtifact('analysis-report.md', analysis);
    artifacts.push(analysisArtifact);
    this.broadcaster?.emitSpecArtifactReady('analysis-report.md', '.loomflo/specs/analysis-report.md');
    this.notifyStepCompleted(4, 'analysis', analysisArtifact.path, onProgress);

    // Step 5: Build graph
    const graph = await this.executeStep(
      5, 'graph',
      () => this.buildGraph(tasks, plan),
      onProgress,
    );
    this.notifyStepCompleted(5, 'graph', this.specsDir, onProgress);

    // Pipeline complete
    onProgress?.({
      type: 'spec_pipeline_completed',
      artifacts,
      graph,
    });

    return { artifacts, graph };
  }

  /**
   * Execute a single pipeline step with error handling and progress notification.
   *
   * Emits a `spec_step_started` event before execution and a `spec_step_error`
   * event on failure. Wraps errors in {@link SpecPipelineError}.
   *
   * @param stepIndex - Zero-based index of the step.
   * @param stepName - Human-readable name of the step.
   * @param fn - Async function that performs the step's work.
   * @param onProgress - Optional progress callback.
   * @returns The result of the step function.
   * @throws {SpecPipelineError} If the step function throws.
   */
  private async executeStep<T>(
    stepIndex: number,
    stepName: string,
    fn: () => Promise<T>,
    onProgress?: SpecStepCallback,
  ): Promise<T> {
    onProgress?.({ type: 'spec_step_started', stepName, stepIndex });

    try {
      return await fn();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      onProgress?.({ type: 'spec_step_error', stepName, stepIndex, error });
      throw new SpecPipelineError(stepName, stepIndex, error);
    }
  }

  /**
   * Notify progress callback of a completed step.
   *
   * @param stepIndex - Zero-based index of the completed step.
   * @param stepName - Name of the completed step.
   * @param artifactPath - Path to the artifact produced by the step.
   * @param onProgress - Optional progress callback.
   */
  private notifyStepCompleted(
    stepIndex: number,
    stepName: string,
    artifactPath: string,
    onProgress?: SpecStepCallback,
  ): void {
    onProgress?.({
      type: 'spec_step_completed',
      stepName,
      stepIndex,
      artifactPath,
    });
  }

  /**
   * Call the LLM provider with a system prompt and user message.
   *
   * Sends a single-turn completion request and extracts the text response.
   *
   * @param systemPrompt - System prompt providing instructions to the LLM.
   * @param userMessage - User message containing the project context.
   * @returns The text content of the LLM response.
   * @throws If the LLM call fails or returns no text content.
   */
  private async callLLM(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.config.provider.complete({
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      model: this.config.model,
      maxTokens: this.config.maxTokens,
    });

    return extractResponseText(response);
  }

  /**
   * Write a spec artifact to the `.loomflo/specs/` directory.
   *
   * @param name - File name for the artifact (e.g., "constitution.md").
   * @param content - Full content to write.
   * @returns The artifact metadata including the resolved file path.
   */
  private async writeArtifact(name: string, content: string): Promise<SpecArtifact> {
    const artifactPath = join(this.specsDir, name);
    await writeFile(artifactPath, content, 'utf-8');
    return { name, path: artifactPath, content };
  }

  /**
   * Detect `[CLARIFICATION_NEEDED]` markers in LLM output and extract questions.
   *
   * Parses the block between `[CLARIFICATION_NEEDED]` and `[/CLARIFICATION_NEEDED]`
   * for numbered questions (Q1:, Q2:, etc.) with optional `Context:` lines.
   *
   * Expected marker format:
   * ```
   * [CLARIFICATION_NEEDED]
   * Q1: Question text here?
   * Context: Why this matters.
   * Q2: Another question?
   * Context: Additional context.
   * [/CLARIFICATION_NEEDED]
   * ```
   *
   * @param text - The raw LLM output text to scan.
   * @returns Array of extracted clarification questions, empty if no markers found.
   */
  private detectAmbiguityMarkers(text: string): ClarificationQuestion[] {
    const startIdx = text.indexOf(CLARIFICATION_MARKER_START);
    const endIdx = text.indexOf(CLARIFICATION_MARKER_END);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      return [];
    }

    const block = text
      .substring(startIdx + CLARIFICATION_MARKER_START.length, endIdx)
      .trim();

    if (block.length === 0) {
      return [];
    }

    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const questions: ClarificationQuestion[] = [];
    let currentQuestion: string | null = null;
    let currentContext = '';

    for (const line of lines) {
      const qMatch = /^Q\d+:\s*(.+)$/.exec(line);
      const cMatch = /^Context:\s*(.+)$/.exec(line);

      if (qMatch?.[1] != null) {
        // Flush the previous question before starting a new one
        if (currentQuestion !== null) {
          questions.push({ question: currentQuestion, context: currentContext });
        }
        currentQuestion = qMatch[1];
        currentContext = '';
      } else if (cMatch?.[1] != null) {
        currentContext = cMatch[1];
      }
    }

    // Flush the last question
    if (currentQuestion !== null) {
      questions.push({ question: currentQuestion, context: currentContext });
    }

    return questions;
  }

  /**
   * Remove the `[CLARIFICATION_NEEDED]...[/CLARIFICATION_NEEDED]` block from text.
   *
   * Returns the remaining text (the LLM's best-guess output) with the marker
   * block stripped out and surrounding whitespace normalized.
   *
   * @param text - The raw LLM output containing clarification markers.
   * @returns The text with the clarification block removed.
   */
  private stripClarificationMarkers(text: string): string {
    const startIdx = text.indexOf(CLARIFICATION_MARKER_START);
    const endIdx = text.indexOf(CLARIFICATION_MARKER_END);

    if (startIdx === -1 || endIdx === -1) {
      return text;
    }

    const before = text.substring(0, startIdx);
    const after = text.substring(endIdx + CLARIFICATION_MARKER_END.length);
    return (before + after).trim();
  }

  /**
   * Handle clarification for a pipeline step's LLM output.
   *
   * Detects ambiguity markers in the output and, if found:
   * - With a callback: asks the user (max 3 questions), augments the description
   *   with answers, and re-runs the step exactly once.
   * - Without a callback: logs a warning and returns the output with markers stripped.
   * - On callback failure: logs a warning and returns the output with markers stripped.
   *
   * If no markers are found, returns the output unchanged.
   *
   * Only one clarification round occurs per step — the re-run output is returned
   * as-is regardless of whether it contains markers.
   *
   * @param stepName - Name of the current pipeline step (for logging and events).
   * @param description - The original project description.
   * @param llmOutput - The raw LLM output that may contain clarification markers.
   * @param rerunFn - Function to re-run the step with an augmented description.
   * @param onProgress - Optional progress callback for emitting clarification events.
   * @returns The final step output (either original, stripped, or re-run result).
   */
  private async handleClarification(
    stepName: string,
    description: string,
    llmOutput: string,
    rerunFn: (augmentedDescription: string) => Promise<string>,
    onProgress?: SpecStepCallback,
  ): Promise<string> {
    const questions = this.detectAmbiguityMarkers(llmOutput);

    if (questions.length === 0) {
      return llmOutput;
    }

    const limitedQuestions = questions.slice(0, MAX_CLARIFICATION_QUESTIONS);

    if (this.config.clarificationCallback == null) {
      // No callback configured — use LLM's best guesses
      console.warn(
        `[SpecEngine] Clarification needed in "${stepName}" step but no callback configured. Using LLM defaults.`,
      );
      return this.stripClarificationMarkers(llmOutput);
    }

    // Emit clarification_requested event
    onProgress?.({
      type: 'clarification_requested',
      questions: limitedQuestions,
      stepName,
    });

    let answers: string[];
    try {
      answers = await this.config.clarificationCallback(limitedQuestions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[SpecEngine] Clarification callback failed in "${stepName}" step: ${message}. Using LLM defaults.`,
      );
      return this.stripClarificationMarkers(llmOutput);
    }

    // Emit clarification_answered event
    onProgress?.({
      type: 'clarification_answered',
      answers,
      stepName,
    });

    // Build augmented description with Q&A pairs
    const clarificationLines = limitedQuestions
      .map((q, i) => `Q: ${q.question}\nA: ${answers[i] ?? 'No answer provided'}`)
      .join('\n\n');

    const augmentedDescription = [
      description,
      '',
      '## Clarifications',
      clarificationLines,
    ].join('\n');

    // Re-run the step once with the augmented description
    return rerunFn(augmentedDescription);
  }

  /**
   * Step 1: Generate a project constitution document.
   *
   * Produces non-negotiable quality principles, delivery standards,
   * technology constraints, and governance rules for the target project.
   *
   * @param description - Natural language project description.
   * @returns The generated constitution content as Markdown.
   */
  private async generateConstitution(description: string): Promise<string> {
    return this.callLLM(
      SPEC_PROMPTS.constitution,
      `Generate a constitution for the following project:\n\n${description}`,
    );
  }

  /**
   * Step 2: Generate a functional specification.
   *
   * Produces user stories, features, functional requirements, constraints,
   * assumptions, and out-of-scope items. Focuses on WHAT, not HOW.
   *
   * @param description - Natural language project description.
   * @param constitution - Previously generated constitution content.
   * @returns The generated specification content as Markdown.
   */
  private async generateSpec(description: string, constitution: string): Promise<string> {
    const userMessage = [
      'Generate a functional specification for the following project.',
      '',
      '## Project Description',
      description,
      '',
      '## Constitution',
      constitution,
    ].join('\n');

    return this.callLLM(SPEC_PROMPTS.spec, userMessage);
  }

  /**
   * Step 3: Generate a technical implementation plan.
   *
   * Produces stack decisions, project structure, data model, architecture
   * decisions, build phases, and key implementation decisions.
   *
   * @param description - Natural language project description.
   * @param constitution - Previously generated constitution content.
   * @param spec - Previously generated specification content.
   * @returns The generated plan content as Markdown.
   */
  private async generatePlan(
    description: string,
    constitution: string,
    spec: string,
  ): Promise<string> {
    const userMessage = [
      'Generate a technical implementation plan for the following project.',
      '',
      '## Project Description',
      description,
      '',
      '## Constitution',
      constitution,
      '',
      '## Specification',
      spec,
    ].join('\n');

    return this.callLLM(SPEC_PROMPTS.plan, userMessage);
  }

  /**
   * Step 4: Generate an ordered task breakdown.
   *
   * Produces a list of concrete, actionable tasks with IDs, descriptions,
   * file paths, dependencies, and parallelism flags.
   *
   * @param description - Natural language project description.
   * @param constitution - Previously generated constitution content.
   * @param spec - Previously generated specification content.
   * @param plan - Previously generated plan content.
   * @returns The generated task list content as Markdown.
   */
  private async generateTasks(
    description: string,
    constitution: string,
    spec: string,
    plan: string,
  ): Promise<string> {
    const userMessage = [
      'Generate an ordered task breakdown for the following project.',
      '',
      '## Project Description',
      description,
      '',
      '## Constitution',
      constitution,
      '',
      '## Specification',
      spec,
      '',
      '## Plan',
      plan,
    ].join('\n');

    return this.callLLM(SPEC_PROMPTS.tasks, userMessage);
  }

  /**
   * Step 5: Generate a coherence analysis report.
   *
   * Audits all previous artifacts for coverage gaps, contradictions,
   * ambiguities, and constitution violations.
   *
   * @param constitution - Previously generated constitution content.
   * @param spec - Previously generated specification content.
   * @param plan - Previously generated plan content.
   * @param tasks - Previously generated task list content.
   * @returns The generated analysis report content as Markdown.
   */
  private async generateAnalysis(
    constitution: string,
    spec: string,
    plan: string,
    tasks: string,
  ): Promise<string> {
    const userMessage = [
      'Analyze the coherence of the following specification artifacts.',
      '',
      '## Constitution',
      constitution,
      '',
      '## Specification',
      spec,
      '',
      '## Plan',
      plan,
      '',
      '## Tasks',
      tasks,
    ].join('\n');

    return this.callLLM(SPEC_PROMPTS.analysis, userMessage);
  }

  /**
   * Step 6: Build the workflow execution graph from tasks and plan.
   *
   * Calls the LLM to parse the task list into execution nodes with
   * dependencies, then constructs a valid {@link Graph} with edges,
   * topology detection, and cost estimates. The graph is fully validated
   * (DAG check, reference integrity, root/orphan checks) before being returned.
   *
   * @param tasks - Previously generated task list content.
   * @param plan - Previously generated plan content.
   * @returns A validated Graph object with nodes, edges, topology, and cost estimates.
   * @throws {GraphValidationError} If the LLM produces an invalid graph (cycles, missing references, etc.).
   */
  private async buildGraph(tasks: string, plan: string): Promise<Graph> {
    const userMessage = [
      'Build an execution workflow graph from the following tasks and plan.',
      '',
      '## Tasks',
      tasks,
      '',
      '## Plan',
      plan,
    ].join('\n');

    const responseText = await this.callLLM(SPEC_PROMPTS.graph, userMessage);

    // Parse and validate the JSON graph definition from the LLM output
    const parsed = extractJson(responseText);
    const graphDef = validateGraphDefinition(parsed);

    // Check for duplicate node IDs before building the map
    const seenIds = new Set<string>();
    for (const def of graphDef.nodes) {
      if (seenIds.has(def.id)) {
        throw new GraphValidationError(
          'duplicate_node_id',
          `Duplicate node ID "${def.id}" in LLM graph output`,
          [def.id],
        );
      }
      seenIds.add(def.id);
    }

    // Build the node map
    const nodes: Record<string, Node> = {};
    for (const def of graphDef.nodes) {
      nodes[def.id] = createNodeFromDefinition(def);
      this.broadcaster?.emitGraphModified('node_added', def.id, {
        title: def.title,
        instructionsSummary: def.instructions.slice(0, 120),
      });
    }

    // Build edges from dependency declarations
    const edges: Edge[] = [];
    for (const def of graphDef.nodes) {
      for (const depId of def.dependencies) {
        if (!seenIds.has(depId)) {
          throw new GraphValidationError(
            'invalid_edge_reference',
            `Graph node "${def.id}" depends on unknown node "${depId}"`,
            [def.id, depId],
          );
        }
        edges.push({ from: depId, to: def.id });
        this.broadcaster?.emitGraphModified('edge_added', def.id, {
          from: depId,
          to: def.id,
        });
      }
    }

    // Preliminary topology (will be re-verified by validateAndOptimizeGraph)
    const topology = detectTopology(Array.from(seenIds), edges);
    const rawGraph: Graph = { nodes, edges, topology };

    // Full validation: DAG check, integrity, topology re-detection, cost estimation
    const costConfig: CostEstimationConfig = {
      ...DEFAULT_COST_ESTIMATION_CONFIG,
      model: this.config.model,
    };
    const { graph } = validateAndOptimizeGraph(rawGraph, costConfig);

    return graph;
  }
}
