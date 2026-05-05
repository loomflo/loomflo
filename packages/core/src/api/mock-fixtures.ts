/**
 * Mock data fixtures for the dashboard development mode.
 *
 * Returns realistic, type-safe samples of the API responses the dashboard
 * consumes (workflows, nodes, events, agents, etc.) so the frontend can be
 * developed without a live daemon.
 *
 * Activated via the `LOOMFLO_MOCK_API=1` env var; the resulting fixtures are
 * exposed under `/mock/*` routes (see api/routes/mock.ts).
 *
 * @module api/mock-fixtures
 */

import type {
  AgentInfo,
  Edge,
  Event,
  Graph,
  Node,
  ReviewReport,
  Workflow,
} from "../types.js";

const ISO = (offsetMin: number): string =>
  new Date(Date.now() + offsetMin * 60_000).toISOString();

function makeAgent(id: string, role: AgentInfo["role"], status: AgentInfo["status"]): AgentInfo {
  return {
    id,
    role,
    status,
    cost: 0,
    model: role === "loom" ? "claude-opus-4-5" : "claude-sonnet-4-6",
    fileScope: role === "looma" ? ["src/**"] : [],
    completedAt: status === "completed" ? ISO(-1) : null,
    failureReason: null,
  };
}

function makeNode(
  id: string,
  title: string,
  status: Node["status"],
  options: Partial<Node> = {},
): Node {
  return {
    id,
    title,
    status,
    instructions: options.instructions ?? `Mock instructions for ${title}.`,
    delay: options.delay ?? "0",
    resumeAt: options.resumeAt ?? null,
    agents: options.agents ?? [],
    fileOwnership: options.fileOwnership ?? {},
    retryCount: options.retryCount ?? 0,
    maxRetries: options.maxRetries ?? 3,
    reviewReport: options.reviewReport ?? null,
    cost: options.cost ?? 0,
    startedAt: options.startedAt ?? null,
    completedAt: options.completedAt ?? null,
    providerRetryState: options.providerRetryState ?? null,
    runtime: options.runtime ?? "loomi-native",
  };
}

const reviewPass: ReviewReport = {
  verdict: "PASS",
  taskVerdicts: [
    { taskId: "n2-task-1", verdict: "PASS", reasoning: "Files look clean", evidence: [] },
  ],
  issues: [],
  summary: "Implementation matches the spec; no blockers.",
};

// ---------------------------------------------------------------------------
// Workflow fixture
// ---------------------------------------------------------------------------

const NODES: Node[] = [
  makeNode("n1", "Specify the feature", "done", {
    runtime: "claude-agent",
    cost: 0.42,
    startedAt: ISO(-15),
    completedAt: ISO(-12),
    agents: [makeAgent("loomi-n1", "loomi", "completed")],
    fileOwnership: { "loomi-n1": [] },
  }),
  makeNode("n2", "Implement the API endpoint", "running", {
    runtime: "claude-agent",
    cost: 0.18,
    startedAt: ISO(-3),
    agents: [
      makeAgent("loomi-n2", "loomi", "running"),
      makeAgent("looma-n2-1", "looma", "running"),
      makeAgent("looma-n2-2", "looma", "completed"),
    ],
    fileOwnership: {
      "looma-n2-1": ["src/api/**"],
      "looma-n2-2": ["src/models/**"],
    },
  }),
  makeNode("n3", "Add unit tests", "waiting", {
    runtime: "copilot",
    delay: "10m",
    resumeAt: ISO(7),
    agents: [],
    fileOwnership: {},
  }),
  makeNode("n4", "Review", "pending", {
    runtime: "claude-agent",
    delay: "0",
    agents: [],
    fileOwnership: {},
    reviewReport: reviewPass,
  }),
];

const EDGES: Edge[] = [
  { from: "n1", to: "n2" },
  { from: "n2", to: "n3" },
  { from: "n3", to: "n4" },
];

const GRAPH: Graph = {
  nodes: Object.fromEntries(NODES.map((n) => [n.id, n])),
  edges: EDGES,
  topology: "linear",
};

export const MOCK_WORKFLOW: Workflow = {
  id: "wf-mock-001",
  name: "Mock workflow — payments feature",
  description: "Demonstration workflow with one done node, one running, two pending.",
  status: "running",
  projectPath: "/tmp/mock-project",
  config: {} as Workflow["config"],
  graph: GRAPH,
  totalCost: 0.6,
  budgetLimit: 5,
  createdAt: ISO(-30),
  updatedAt: ISO(-1),
  workflowVersion: 1,
} as Workflow;

// ---------------------------------------------------------------------------
// Events fixture
// ---------------------------------------------------------------------------

export const MOCK_EVENTS: Event[] = [
  {
    ts: ISO(-15),
    type: "node_started",
    workflowId: MOCK_WORKFLOW.id,
    nodeId: "n1",
    agentId: null,
    details: { nodeTitle: "Specify the feature" },
  },
  {
    ts: ISO(-12),
    type: "node_completed",
    workflowId: MOCK_WORKFLOW.id,
    nodeId: "n1",
    agentId: null,
    details: { nodeTitle: "Specify the feature" },
  },
  {
    ts: ISO(-3),
    type: "node_started",
    workflowId: MOCK_WORKFLOW.id,
    nodeId: "n2",
    agentId: null,
    details: { nodeTitle: "Implement the API endpoint" },
  },
  {
    ts: ISO(-2),
    type: "agent_started",
    workflowId: MOCK_WORKFLOW.id,
    nodeId: "n2",
    agentId: "looma-n2-1",
    details: { role: "looma", task: "Implement POST /payments" },
  },
  {
    ts: ISO(-1),
    type: "cost_tracked",
    workflowId: MOCK_WORKFLOW.id,
    nodeId: "n2",
    agentId: "looma-n2-1",
    details: {
      model: "claude-sonnet-4-6",
      inputTokens: 4200,
      outputTokens: 380,
      costUsd: 0.052,
    },
  },
] as Event[];

// ---------------------------------------------------------------------------
// Projects fixture
// ---------------------------------------------------------------------------

export const MOCK_PROJECTS = [
  {
    id: "p-mock-001",
    name: "payments-feature",
    projectPath: "/tmp/mock-project",
    workflowId: MOCK_WORKFLOW.id,
    createdAt: ISO(-180),
    updatedAt: ISO(-1),
  },
  {
    id: "p-mock-002",
    name: "marketing-site",
    projectPath: "/tmp/mock-marketing",
    workflowId: null,
    createdAt: ISO(-720),
    updatedAt: ISO(-360),
  },
];

// ---------------------------------------------------------------------------
// Runtime availability fixture (CLI detection)
// ---------------------------------------------------------------------------

export const MOCK_CLI_AVAILABILITY = {
  "claude-code": {
    installed: true,
    authenticated: true,
    version: "2.1.126",
    path: "/usr/local/bin/claude",
  },
  copilot: {
    installed: true,
    authenticated: false,
    version: "1.0.40",
    path: "/usr/local/bin/copilot",
  },
  codex: { installed: false, authenticated: false, path: "codex" },
};
