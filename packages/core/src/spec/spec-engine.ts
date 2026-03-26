import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LLMProvider } from '../providers/base.js';
import type { Graph, LLMResponse, Node, Edge, TopologyType } from '../types.js';

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
}

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
  | { type: 'spec_pipeline_completed'; artifacts: SpecArtifact[]; graph: Graph };

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
// Placeholder Prompts (actual prompts defined in T051 — spec/prompts.ts)
// ============================================================================

/**
 * System prompts for each spec pipeline step.
 *
 * These are placeholder strings. The actual prompt content will be
 * implemented in T051 (spec/prompts.ts) and imported here.
 */
export const SPEC_PROMPTS = {
  constitution: [
    'You are Loomprint, a specification agent that generates foundational quality principles.',
    'Given a project description, produce a constitution document defining non-negotiable',
    'quality principles, delivery standards, technology constraints, and governance rules.',
    'Output a complete Markdown document.',
  ].join(' '),

  spec: [
    'You are Loomscope, a specification agent that generates functional specifications.',
    'Given a project description and its constitution, produce a specification document with',
    'user stories, features, functional requirements, constraints, assumptions, and out-of-scope',
    'items. Focus on WHAT the system does, not HOW it is implemented.',
    'Output a complete Markdown document.',
  ].join(' '),

  plan: [
    'You are Loomcraft, a planning agent that generates technical implementation plans.',
    'Given a project description, its constitution, and functional specification, produce a',
    'technical plan covering stack decisions, project structure, data model, architecture',
    'decisions, build phases, and key implementation decisions.',
    'Output a complete Markdown document.',
  ].join(' '),

  tasks: [
    'You are Loompath, a task planning agent that generates ordered task breakdowns.',
    'Given a project description, its constitution, specification, and plan, produce an',
    'ordered task list with task IDs, descriptions, file paths, dependencies, parallelism',
    'flags, and user story associations. Each task must be concrete and actionable.',
    'Output a complete Markdown document.',
  ].join(' '),

  analysis: [
    'You are Loomscan, an analysis agent that audits coherence across specification artifacts.',
    'Given the constitution, specification, plan, and tasks, check for: coverage gaps between',
    'spec requirements and tasks, contradictions between artifacts, ambiguities that could cause',
    'implementation issues, and constitution violations. Produce a coverage matrix and list all',
    'findings. Output a complete Markdown document.',
  ].join(' '),

  graph: [
    'You are Loomkit, a graph building agent that constructs execution workflow graphs.',
    'Given the task list and plan, group related tasks into execution nodes and determine',
    'their dependencies. Output ONLY a JSON object (no surrounding text) with this structure:',
    '{ "nodes": [{ "id": "node-1", "title": "Node Title", "instructions": "Markdown instructions",',
    '"dependencies": ["node-id-of-dependency"] }] }.',
    'Each node groups tasks that should be executed together. Dependencies reference other node IDs.',
    'The first node must have no dependencies. Ensure the graph is a valid DAG with no cycles.',
  ].join(' '),
} as const;

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

  /**
   * Create a new SpecEngine instance.
   *
   * @param config - Engine configuration including provider, model, and project path.
   */
  constructor(config: SpecEngineConfig) {
    this.config = config;
    this.specsDir = join(config.projectPath, '.loomflo', 'specs');
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

    // Step 0: Generate constitution
    const constitution = await this.executeStep(
      0, 'constitution',
      () => this.generateConstitution(description),
      onProgress,
    );
    const constitutionArtifact = await this.writeArtifact('constitution.md', constitution);
    artifacts.push(constitutionArtifact);
    this.notifyStepCompleted(0, 'constitution', constitutionArtifact.path, onProgress);

    // Step 1: Generate spec
    const spec = await this.executeStep(
      1, 'spec',
      () => this.generateSpec(description, constitution),
      onProgress,
    );
    const specArtifact = await this.writeArtifact('spec.md', spec);
    artifacts.push(specArtifact);
    this.notifyStepCompleted(1, 'spec', specArtifact.path, onProgress);

    // Step 2: Generate plan
    const plan = await this.executeStep(
      2, 'plan',
      () => this.generatePlan(description, constitution, spec),
      onProgress,
    );
    const planArtifact = await this.writeArtifact('plan.md', plan);
    artifacts.push(planArtifact);
    this.notifyStepCompleted(2, 'plan', planArtifact.path, onProgress);

    // Step 3: Generate tasks
    const tasks = await this.executeStep(
      3, 'tasks',
      () => this.generateTasks(description, constitution, spec, plan),
      onProgress,
    );
    const tasksArtifact = await this.writeArtifact('tasks.md', tasks);
    artifacts.push(tasksArtifact);
    this.notifyStepCompleted(3, 'tasks', tasksArtifact.path, onProgress);

    // Step 4: Generate analysis
    const analysis = await this.executeStep(
      4, 'analysis',
      () => this.generateAnalysis(constitution, spec, plan, tasks),
      onProgress,
    );
    const analysisArtifact = await this.writeArtifact('analysis-report.md', analysis);
    artifacts.push(analysisArtifact);
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
   * dependencies, then constructs a valid {@link Graph} with edges
   * and topology detection.
   *
   * @param tasks - Previously generated task list content.
   * @param plan - Previously generated plan content.
   * @returns A validated Graph object with nodes, edges, and topology.
   * @throws If the LLM response cannot be parsed into a valid graph.
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

    // Build the node map
    const nodes: Record<string, Node> = {};
    for (const def of graphDef.nodes) {
      nodes[def.id] = createNodeFromDefinition(def);
    }

    // Build edges from dependency declarations
    const edges: Edge[] = [];
    const nodeIds = new Set(Object.keys(nodes));

    for (const def of graphDef.nodes) {
      for (const depId of def.dependencies) {
        if (!nodeIds.has(depId)) {
          throw new Error(
            `Graph node "${def.id}" depends on unknown node "${depId}"`,
          );
        }
        edges.push({ from: depId, to: def.id });
      }
    }

    // Detect topology
    const topology = detectTopology(Array.from(nodeIds), edges);

    return { nodes, edges, topology };
  }
}
