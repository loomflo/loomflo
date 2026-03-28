import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoomiConfig, LoomiResult, TeamPlan } from '../../src/agents/loomi.js';
import { runLoomi } from '../../src/agents/loomi.js';
import type { LLMProvider, CompletionParams } from '../../src/providers/base.js';
import type { LLMResponse, ReviewReport, ContentBlock } from '../../src/types.js';
import { CostTracker } from '../../src/costs/tracker.js';
import { MessageBus } from '../../src/agents/message-bus.js';
import type { AgentLoopResult } from '../../src/agents/base-agent.js';
import type { EscalationHandlerLike, EscalationRequest } from '../../src/tools/escalate.js';
import type { Tool } from '../../src/tools/base.js';

// ===========================================================================
// Mocks
// ===========================================================================

// Mock the base-agent module to control worker results
vi.mock('../../src/agents/base-agent.js', () => ({
  runAgentLoop: vi.fn(),
}));

// Mock persistence to avoid filesystem access
vi.mock('../../src/persistence/events.js', () => ({
  createEvent: vi.fn(() => ({
    id: 'mock-event-id',
    type: 'node_started',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    agentId: 'loomi-node-1',
    timestamp: new Date().toISOString(),
    details: {},
  })),
  appendEvent: vi.fn(async () => undefined),
}));

// Get the mocked runAgentLoop reference
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runAgentLoop: mockedRunAgentLoop } = await import('../../src/agents/base-agent.js');
const mockRunAgentLoop = vi.mocked(mockedRunAgentLoop);

// ===========================================================================
// Helpers
// ===========================================================================

/** Creates a standard successful AgentLoopResult. */
function makeSuccessResult(agentId?: string): AgentLoopResult {
  return {
    output: `Task completed by ${agentId ?? 'worker'}`,
    tokenUsage: { input: 100, output: 50 },
    status: 'completed',
  };
}

/** Creates a failed AgentLoopResult. */
function makeFailedResult(error?: string): AgentLoopResult {
  return {
    output: '',
    tokenUsage: { input: 80, output: 20 },
    status: 'failed',
    error: error ?? 'LLM call failed',
  };
}

/** Creates a mock team plan JSON response from the LLM. */
function makeTeamPlanResponse(workers: { id: string; task: string; scope: string[] }[]): string {
  const plan: TeamPlan = {
    reasoning: 'Splitting work for efficient execution',
    workers: workers.map((w) => ({
      id: w.id,
      taskDescription: w.task,
      writeScope: w.scope,
    })),
  };
  return JSON.stringify(plan);
}

/** Creates a PASS review report. */
function makePassReview(): ReviewReport {
  return {
    verdict: 'PASS',
    tasksVerified: [
      { taskId: 'looma-1', status: 'pass', details: 'All good' },
    ],
    details: 'Everything looks correct.',
    recommendation: 'None',
    createdAt: new Date().toISOString(),
  };
}

/** Creates a FAIL review report, optionally specifying which tasks failed. */
function makeFailReview(failedTaskIds?: string[]): ReviewReport {
  const tasks = failedTaskIds ?? ['looma-1'];
  return {
    verdict: 'FAIL',
    tasksVerified: tasks.map((id) => ({
      taskId: id,
      status: 'fail' as const,
      details: `Task ${id} has issues`,
    })),
    details: 'Some tasks need rework.',
    recommendation: 'Fix the identified issues and retry.',
    createdAt: new Date().toISOString(),
  };
}

/** Creates a BLOCKED review report. */
function makeBlockedReview(): ReviewReport {
  return {
    verdict: 'BLOCKED',
    tasksVerified: [
      { taskId: 'looma-1', status: 'blocked', details: 'Missing dependency' },
    ],
    details: 'Cannot proceed without external dependency.',
    recommendation: 'Add a prerequisite node for the dependency.',
    createdAt: new Date().toISOString(),
  };
}

/** Creates a mock LLM response with the given text. */
function makeLLMResponse(text: string): LLMResponse {
  return {
    content: [{ type: 'text' as const, text }],
    stopReason: 'end_turn' as const,
    usage: { inputTokens: 200, outputTokens: 100 },
    model: 'claude-sonnet-4-6',
  };
}

/** Creates a mock LLMProvider that returns planned responses in order. */
function makeMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    complete: vi.fn(async (_params: CompletionParams): Promise<LLMResponse> => {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`Unexpected LLM call #${String(callIndex + 1)} — no more responses configured`);
      }
      callIndex++;
      return response;
    }),
  };
}

/** Creates a mock escalation handler that records calls. */
function makeMockEscalationHandler(): EscalationHandlerLike & { calls: EscalationRequest[] } {
  const calls: EscalationRequest[] = [];
  return {
    calls,
    escalate: vi.fn(async (request: EscalationRequest) => {
      calls.push(request);
    }),
  };
}

/** Creates a mock SharedMemoryManager. */
function makeMockSharedMemory(): { write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> } {
  return {
    write: vi.fn(async () => undefined),
    read: vi.fn(async () => ({
      content: '',
      name: 'PROGRESS.md',
      path: '/tmp/test/.loomflo/shared-memory/PROGRESS.md',
      lastModifiedBy: 'system',
      lastModifiedAt: new Date().toISOString(),
    })),
  };
}

/**
 * Builds a LoomiConfig with the given overrides for testing.
 *
 * @param overrides - Partial config overrides.
 * @returns A fully configured LoomiConfig for tests.
 */
function makeLoomiConfig(overrides?: Partial<{
  provider: LLMProvider;
  escalationHandler: EscalationHandlerLike;
  reviewCallback: () => Promise<ReviewReport | null>;
  maxRetriesPerNode: number;
  maxRetriesPerTask: number;
}>): LoomiConfig {
  const defaultPlan = makeTeamPlanResponse([
    { id: 'looma-1', task: 'Implement auth module', scope: ['src/auth/**'] },
  ]);

  const provider = overrides?.provider ?? makeMockProvider([
    makeLLMResponse(defaultPlan),
  ]);

  const escalationHandler = overrides?.escalationHandler ?? makeMockEscalationHandler();

  return {
    nodeId: 'node-1',
    nodeTitle: 'Auth Module',
    instructions: 'Implement authentication with JWT',
    workspacePath: '/tmp/test-workspace',
    provider,
    model: 'claude-sonnet-4-6',
    config: {
      daemon: { host: '127.0.0.1', port: 3100 },
      models: {
        loom: 'claude-opus-4-6',
        loomi: 'claude-sonnet-4-6',
        looma: 'claude-sonnet-4-6',
        loomex: 'claude-sonnet-4-6',
      },
      agentTimeout: 300000,
      agentTokenLimit: 100000,
      maxLoomasPerLoomi: 5,
      maxRetriesPerNode: overrides?.maxRetriesPerNode ?? 3,
      maxRetriesPerTask: overrides?.maxRetriesPerTask ?? 2,
      reviewerEnabled: true,
      delayBetweenNodes: '0',
      budgetLimit: null,
      costPerInputToken: { 'claude-sonnet-4-6': 0.000003, 'claude-opus-4-6': 0.000015 },
      costPerOutputToken: { 'claude-sonnet-4-6': 0.000015, 'claude-opus-4-6': 0.000075 },
    },
    messageBus: new MessageBus(),
    eventLog: { workflowId: 'wf-test-1' },
    costTracker: new CostTracker(),
    sharedMemory: makeMockSharedMemory() as unknown as LoomiConfig['sharedMemory'],
    escalationHandler,
    workerTools: [] as Tool[],
    reviewCallback: overrides?.reviewCallback,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Loomi Retry Cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Happy path — no retry needed
  // =========================================================================

  describe('happy path (no retry)', () => {
    it('completes successfully when all workers succeed and no review callback', async () => {
      mockRunAgentLoop.mockResolvedValue(makeSuccessResult('looma-1'));

      const config = makeLoomiConfig();
      const result = await runLoomi(config);

      expect(result.status).toBe('completed');
      expect(result.retryCount).toBe(0);
      expect(result.completedAgents).toContain('looma-1');
      expect(result.failedAgents).toHaveLength(0);
    });

    it('completes successfully when review returns PASS', async () => {
      mockRunAgentLoop.mockResolvedValue(makeSuccessResult('looma-1'));

      const config = makeLoomiConfig({
        reviewCallback: async () => makePassReview(),
      });
      const result = await runLoomi(config);

      expect(result.status).toBe('completed');
      expect(result.retryCount).toBe(0);
      expect(result.failedAgents).toHaveLength(0);
    });

    it('completes when review callback returns null (reviewer disabled)', async () => {
      mockRunAgentLoop.mockResolvedValue(makeSuccessResult('looma-1'));

      const config = makeLoomiConfig({
        reviewCallback: async () => null,
      });
      const result = await runLoomi(config);

      expect(result.status).toBe('completed');
      expect(result.retryCount).toBe(0);
    });
  });

  // =========================================================================
  // Worker failure → retry
  // =========================================================================

  describe('worker failure → retry', () => {
    it('retries failed workers and succeeds on second attempt', async () => {
      // First attempt: worker fails
      // Second attempt: worker succeeds
      mockRunAgentLoop
        .mockResolvedValueOnce(makeFailedResult('LLM error'))
        .mockResolvedValueOnce(makeSuccessResult('looma-1'));

      const config = makeLoomiConfig({
        maxRetriesPerNode: 3,
      });
      const result = await runLoomi(config);

      expect(result.status).toBe('completed');
      expect(result.retryCount).toBe(1);
      expect(mockRunAgentLoop).toHaveBeenCalledTimes(2);
    });

    it('escalates when worker keeps failing and max retries exhausted', async () => {
      // All attempts fail
      mockRunAgentLoop.mockResolvedValue(makeFailedResult('Persistent error'));

      const escalationHandler = makeMockEscalationHandler();
      const config = makeLoomiConfig({
        maxRetriesPerNode: 2,
        escalationHandler,
      });
      const result = await runLoomi(config);

      expect(result.status).toBe('escalated');
      expect(escalationHandler.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Review FAIL → retry with adapted prompts
  // =========================================================================

  describe('review FAIL → retry', () => {
    it('retries with adapted prompt when review returns FAIL', async () => {
      let reviewCallCount = 0;

      // Workers always succeed (it's the review that fails then passes)
      mockRunAgentLoop.mockResolvedValue(makeSuccessResult('looma-1'));

      // Planning response + retry adaptation response
      const provider = makeMockProvider([
        makeLLMResponse(makeTeamPlanResponse([
          { id: 'looma-1', task: 'Implement auth', scope: ['src/auth/**'] },
        ])),
        // Adapted plan for retry
        makeLLMResponse(makeTeamPlanResponse([
          { id: 'looma-1', task: 'Fix auth issues from review feedback', scope: ['src/auth/**'] },
        ])),
      ]);

      const config = makeLoomiConfig({
        provider,
        reviewCallback: async () => {
          reviewCallCount++;
          if (reviewCallCount === 1) {
            return makeFailReview(['looma-1']);
          }
          return makePassReview();
        },
      });

      const result = await runLoomi(config);

      expect(result.status).toBe('completed');
      expect(result.retryCount).toBe(1);
      expect(reviewCallCount).toBe(2);
      // Planning call + adaptation call = 2 LLM calls to the provider
      expect(vi.mocked(provider.complete)).toHaveBeenCalledTimes(2);
    });

    it('escalates when review keeps returning FAIL after max retries', async () => {
      mockRunAgentLoop.mockResolvedValue(makeSuccessResult('looma-1'));

      // Need enough LLM responses: 1 planning + N adaptation calls
      const responses = [
        makeLLMResponse(makeTeamPlanResponse([
          { id: 'looma-1', task: 'Implement auth', scope: ['src/auth/**'] },
        ])),
        // Adaptation calls for each retry
        makeLLMResponse(makeTeamPlanResponse([
          { id: 'looma-1', task: 'Fix attempt 1', scope: ['src/auth/**'] },
        ])),
        makeLLMResponse(makeTeamPlanResponse([
          { id: 'looma-1', task: 'Fix attempt 2', scope: ['src/auth/**'] },
        ])),
        makeLLMResponse(makeTeamPlanResponse([
          { id: 'looma-1', task: 'Fix attempt 3', scope: ['src/auth/**'] },
        ])),
      ];

      const escalationHandler = makeMockEscalationHandler();
      const config = makeLoomiConfig({
        provider: makeMockProvider(responses),
        maxRetriesPerNode: 2,
        escalationHandler,
        reviewCallback: async () => makeFailReview(['looma-1']),
      });

      const result = await runLoomi(config);

      expect(result.status).toBe('escalated');
      expect(escalationHandler.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Review BLOCKED → immediate escalation
  // =========================================================================

  describe('review BLOCKED → immediate escalation', () => {
    it('escalates immediately on BLOCKED verdict without retrying', async () => {
      mockRunAgentLoop.mockResolvedValue(makeSuccessResult('looma-1'));

      const escalationHandler = makeMockEscalationHandler();
      const config = makeLoomiConfig({
        escalationHandler,
        reviewCallback: async () => makeBlockedReview(),
      });

      const result = await runLoomi(config);

      expect(result.status).toBe('escalated');
      expect(result.retryCount).toBe(0);
      expect(escalationHandler.calls).toHaveLength(1);
      expect(escalationHandler.calls[0]!.reason).toContain('BLOCKED');
    });
  });

  // =========================================================================
  // Per-task retry limits
  // =========================================================================

  describe('per-task retry limits', () => {
    it('permanently fails workers that exceed per-task retry limit', async () => {
      // Use 2 workers; one always fails, one always succeeds
      const planResponse = makeTeamPlanResponse([
        { id: 'looma-good', task: 'Good task', scope: ['src/good/**'] },
        { id: 'looma-bad', task: 'Bad task', scope: ['src/bad/**'] },
      ]);

      // Adaptation responses
      const adaptResponse = makeTeamPlanResponse([
        { id: 'looma-bad', task: 'Adapted bad task', scope: ['src/bad/**'] },
      ]);

      const provider = makeMockProvider([
        makeLLMResponse(planResponse),
        makeLLMResponse(adaptResponse),
        makeLLMResponse(adaptResponse),
        makeLLMResponse(adaptResponse),
      ]);

      // Worker results: good succeeds, bad always fails
      mockRunAgentLoop.mockImplementation(async (config: unknown) => {
        const cfg = config as { agentId: string };
        if (cfg.agentId === 'looma-good') {
          return makeSuccessResult('looma-good');
        }
        return makeFailedResult('Bad worker error');
      });

      const escalationHandler = makeMockEscalationHandler();
      const loomiConfig = makeLoomiConfig({
        provider,
        maxRetriesPerNode: 5,
        maxRetriesPerTask: 1,
        escalationHandler,
      });

      const result = await runLoomi(loomiConfig);

      // Should escalate because the bad worker exhausted per-task limit
      expect(result.status).toBe('escalated');
      expect(result.failedAgents).toContain('looma-bad');
    });
  });

  // =========================================================================
  // Multiple workers with mixed results
  // =========================================================================

  describe('multiple workers with mixed results', () => {
    it('only retries failed workers, not successful ones', async () => {
      const planResponse = makeTeamPlanResponse([
        { id: 'looma-a', task: 'Task A', scope: ['src/a/**'] },
        { id: 'looma-b', task: 'Task B', scope: ['src/b/**'] },
      ]);

      const provider = makeMockProvider([
        makeLLMResponse(planResponse),
      ]);

      let callCount = 0;
      mockRunAgentLoop.mockImplementation(async (config: unknown) => {
        callCount++;
        const cfg = config as { agentId: string };
        if (cfg.agentId === 'looma-a') {
          return makeSuccessResult('looma-a');
        }
        // looma-b: fail first time, succeed second time
        if (callCount <= 2) {
          return makeFailedResult('Temporary error');
        }
        return makeSuccessResult('looma-b');
      });

      const loomiConfig = makeLoomiConfig({ provider });
      const result = await runLoomi(loomiConfig);

      expect(result.status).toBe('completed');
      expect(result.completedAgents).toContain('looma-a');
      expect(result.completedAgents).toContain('looma-b');
    });
  });

  // =========================================================================
  // Planning failure
  // =========================================================================

  describe('planning failure', () => {
    it('returns failed status when LLM planning call throws', async () => {
      const provider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
      };

      const config = makeLoomiConfig({ provider });
      const result = await runLoomi(config);

      expect(result.status).toBe('failed');
      expect(result.retryCount).toBe(0);
      expect(result.completedAgents).toHaveLength(0);
      expect(result.failedAgents).toHaveLength(0);
    });
  });

  // =========================================================================
  // Result structure verification
  // =========================================================================

  describe('result structure', () => {
    it('returns correct retryCount matching actual retries performed', async () => {
      let attempt = 0;
      mockRunAgentLoop.mockImplementation(async () => {
        attempt++;
        if (attempt <= 2) {
          return makeFailedResult('Error');
        }
        return makeSuccessResult('looma-1');
      });

      const config = makeLoomiConfig({ maxRetriesPerNode: 5 });
      const result = await runLoomi(config);

      expect(result.status).toBe('completed');
      expect(result.retryCount).toBe(2);
    });

    it('includes all completed agents across retries in the result', async () => {
      const planResponse = makeTeamPlanResponse([
        { id: 'looma-1', task: 'Task 1', scope: ['src/1/**'] },
        { id: 'looma-2', task: 'Task 2', scope: ['src/2/**'] },
      ]);

      const provider = makeMockProvider([
        makeLLMResponse(planResponse),
      ]);

      // First round: looma-1 succeeds, looma-2 fails
      // Second round: looma-2 succeeds
      let looma2Attempts = 0;
      mockRunAgentLoop.mockImplementation(async (config: unknown) => {
        const cfg = config as { agentId: string };
        if (cfg.agentId === 'looma-1') {
          return makeSuccessResult('looma-1');
        }
        looma2Attempts++;
        if (looma2Attempts === 1) {
          return makeFailedResult('First attempt failed');
        }
        return makeSuccessResult('looma-2');
      });

      const loomiConfig = makeLoomiConfig({ provider });
      const result = await runLoomi(loomiConfig);

      expect(result.status).toBe('completed');
      expect(result.completedAgents).toContain('looma-1');
      expect(result.completedAgents).toContain('looma-2');
    });
  });
});
