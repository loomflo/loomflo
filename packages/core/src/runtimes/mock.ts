/**
 * MockAgentRuntime — emits scripted events without calling any LLM API.
 *
 * Designed for:
 *  - Cheap E2E tests of the daemon's NodeExecutor wiring (no $ cost).
 *  - Local development feedback loops (no API key required).
 *  - Demoing the dashboard with realistic-looking events.
 *
 * Behavior:
 *  - Picks one of N pre-built scenarios (random by default, deterministic if
 *    `seed` is set).
 *  - Replays the scenario's events on the SessionEvent stream with realistic
 *    timing (configurable speed multiplier).
 *  - Honors abort() / dispose() cleanly.
 *  - Tools called by the scenario are simulated — no real filesystem mutation.
 *
 * NOT a substitute for the real ClaudeAgentRuntime in production paths.
 *
 * @module runtimes/mock
 */

import { randomUUID } from "node:crypto";
import type {
  AgentRuntime,
  ModelInfo,
  ResolvedCredentials,
  RuntimeCapabilities,
  RuntimeName,
  RuntimeSession,
  SessionConfig,
  SessionEvent,
  SessionEventHandler,
} from "./base.js";

// ============================================================================
// Capabilities
// ============================================================================

const MOCK_CAPABILITIES: RuntimeCapabilities = {
  supportsMcp: true,
  supportsCanUseTool: false,
  supportsSessionPersistence: false,
  supportsStreaming: true,
  supportsSubagents: false,
  supportsByokProvider: true,
};

// Note: name kept distinct from production runtime names to avoid confusion.
// Cast to RuntimeName at the boundary; daemon-level routing handles it.
const MOCK_RUNTIME_NAME = "mock" as RuntimeName;

// ============================================================================
// Scenario definitions
// ============================================================================

/**
 * A scripted scenario — sequence of events the mock will emit, with optional
 * delays between them (in ms before timing multiplier is applied).
 */
export interface MockScenario {
  /** Identifier shown in logs / tests. */
  name: string;
  /** Ordered events. Each one is emitted after `delayMs` (default 50). */
  steps: MockScenarioStep[];
}

export interface MockScenarioStep {
  /** Wait this many ms (× timingMultiplier) before emitting. */
  delayMs?: number;
  event: SessionEvent;
}

/**
 * Default scenario pool — covers happy path, tool use, and a failure case.
 * These are reasonable approximations of real Claude Agent SDK output for
 * a level-1 workflow node.
 */
export const DEFAULT_MOCK_SCENARIOS: MockScenario[] = [
  {
    name: "happy-path-text-only",
    steps: [
      { delayMs: 100, event: { kind: "assistant_text", text: "Analyse en cours…", isDelta: false } },
      {
        delayMs: 400,
        event: { kind: "assistant_text", text: "Implémentation terminée.", isDelta: false },
      },
      {
        delayMs: 100,
        event: { kind: "cost_update", inputTokens: 1240, outputTokens: 85, usd: 0.012 },
      },
      { delayMs: 50, event: { kind: "session_idle" } },
    ],
  },
  {
    name: "happy-path-with-tool-call",
    steps: [
      {
        delayMs: 120,
        event: { kind: "assistant_text", text: "Je vais lire le fichier README.", isDelta: false },
      },
      {
        delayMs: 80,
        event: {
          kind: "tool_call",
          toolName: "mcp__loomflo__read_file",
          input: { path: "README.md" },
          toolUseId: "tu_001",
        },
      },
      {
        delayMs: 200,
        event: {
          kind: "tool_result",
          toolUseId: "tu_001",
          ok: true,
          output: "# README\n\nProjet de démo.",
        },
      },
      {
        delayMs: 250,
        event: { kind: "assistant_text", text: "README lu, projet démo identifié.", isDelta: false },
      },
      {
        delayMs: 50,
        event: { kind: "cost_update", inputTokens: 2100, outputTokens: 145, usd: 0.024 },
      },
      { delayMs: 50, event: { kind: "session_idle" } },
    ],
  },
  {
    name: "happy-path-with-write",
    steps: [
      {
        delayMs: 100,
        event: { kind: "assistant_text", text: "Création du fichier.", isDelta: false },
      },
      {
        delayMs: 80,
        event: {
          kind: "tool_call",
          toolName: "mcp__loomflo__write_file",
          input: { path: "src/hello.ts", content: "export const hello = 'world';\n" },
          toolUseId: "tu_002",
        },
      },
      {
        delayMs: 100,
        event: {
          kind: "tool_result",
          toolUseId: "tu_002",
          ok: true,
          output: "Successfully wrote 31 bytes to src/hello.ts",
        },
      },
      {
        delayMs: 200,
        event: { kind: "assistant_text", text: "Fichier créé avec succès.", isDelta: false },
      },
      {
        delayMs: 50,
        event: { kind: "cost_update", inputTokens: 1850, outputTokens: 120, usd: 0.020 },
      },
      { delayMs: 50, event: { kind: "session_idle" } },
    ],
  },
  {
    name: "happy-path-multi-worker-with-review",
    steps: [
      {
        delayMs: 120,
        event: {
          kind: "assistant_text",
          text: "Loomi : je délègue l'implémentation à Looma.",
          isDelta: false,
        },
      },
      {
        delayMs: 80,
        event: {
          kind: "tool_call",
          toolName: "Agent",
          input: {
            subagent_type: "looma",
            prompt: "Implémente la feature et écrit les tests associés.",
          },
          toolUseId: "tu_dispatch_looma_1",
        },
      },
      {
        delayMs: 400,
        event: {
          kind: "tool_result",
          toolUseId: "tu_dispatch_looma_1",
          ok: true,
          output: "Looma : 3 fichiers créés, 1 modifié, tests verts.",
        },
      },
      {
        delayMs: 100,
        event: {
          kind: "assistant_text",
          text: "Loomi : workers terminés, je lance la review.",
          isDelta: false,
        },
      },
      {
        delayMs: 80,
        event: {
          kind: "tool_call",
          toolName: "Agent",
          input: {
            subagent_type: "loomex",
            prompt: "Vérifie la conformité du travail vs les instructions du node.",
          },
          toolUseId: "tu_dispatch_loomex_1",
        },
      },
      {
        delayMs: 300,
        event: {
          kind: "tool_result",
          toolUseId: "tu_dispatch_loomex_1",
          ok: true,
          output: "Loomex : verdict PASS — toutes les exigences satisfaites.",
        },
      },
      {
        delayMs: 100,
        event: {
          kind: "assistant_text",
          text: "Loomi : node terminé avec succès (review PASS).",
          isDelta: false,
        },
      },
      {
        delayMs: 50,
        event: { kind: "cost_update", inputTokens: 4200, outputTokens: 380, usd: 0.052 },
      },
      { delayMs: 50, event: { kind: "session_idle" } },
    ],
  },
  {
    name: "failure-rate-limit-then-succeed",
    steps: [
      {
        delayMs: 100,
        event: { kind: "assistant_text", text: "Démarrage…", isDelta: false },
      },
      { delayMs: 200, event: { kind: "rate_limited", retryAfterMs: 500 } },
      {
        delayMs: 600,
        event: { kind: "assistant_text", text: "Reprise après rate limit.", isDelta: false },
      },
      {
        delayMs: 50,
        event: { kind: "cost_update", inputTokens: 950, outputTokens: 60, usd: 0.009 },
      },
      { delayMs: 50, event: { kind: "session_idle" } },
    ],
  },
];

// ============================================================================
// Random selection
// ============================================================================

/**
 * Tiny deterministic LCG for reproducible scenario picking when `seed` is set.
 * Sufficient for test stability — not cryptographic.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// ============================================================================
// MockSession
// ============================================================================

class MockSession implements RuntimeSession {
  readonly id: string;
  readonly runtimeName: RuntimeName = MOCK_RUNTIME_NAME;

  private readonly handlers = new Set<SessionEventHandler>();
  private readonly abortController = new AbortController();
  private cumulativeCost = { inputTokens: 0, outputTokens: 0, usd: 0 };
  private replayPromise: Promise<void> | undefined;
  private completed = false;

  constructor(
    private readonly scenario: MockScenario,
    private readonly timingMultiplier: number,
  ) {
    this.id = randomUUID();
    // Defer replay start by one tick so callers can attach handlers
    // synchronously after `await startSession(...)` and still observe
    // `session_started`.
    this.replayPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.replay().then(resolve, resolve);
      }, 0);
    });
  }

  private emit(event: SessionEvent): void {
    if (event.kind === "cost_update") {
      this.cumulativeCost = {
        inputTokens: this.cumulativeCost.inputTokens + event.inputTokens,
        outputTokens: this.cumulativeCost.outputTokens + event.outputTokens,
        usd: this.cumulativeCost.usd + event.usd,
      };
    }
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        /* swallow handler errors */
      }
    }
  }

  private async replay(): Promise<void> {
    this.emit({ kind: "session_started", sessionId: this.id });

    for (const step of this.scenario.steps) {
      if (this.abortController.signal.aborted) {
        this.emit({ kind: "session_ended", reason: "aborted" });
        return;
      }
      const wait = (step.delayMs ?? 50) * this.timingMultiplier;
      if (wait > 0) await this.sleepInterruptible(wait);
      if (this.abortController.signal.aborted) {
        this.emit({ kind: "session_ended", reason: "aborted" });
        return;
      }
      this.emit(step.event);
    }

    this.completed = true;
    this.emit({ kind: "session_ended", reason: "completed" });
  }

  /** Sleep that resolves early on abort (no leftover timers). */
  private sleepInterruptible(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abortController.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  send(prompt: string): Promise<void> {
    return Promise.reject(
      new Error(
        `MockAgentRuntime is one-shot — send() unsupported. prompt="${prompt.slice(0, 40)}..."`,
      ),
    );
  }

  on(handler: SessionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async abort(): Promise<void> {
    this.abortController.abort();
    if (this.replayPromise) {
      await this.replayPromise.catch(() => {
        /* swallow */
      });
    }
  }

  async dispose(): Promise<void> {
    if (!this.completed) await this.abort();
    this.handlers.clear();
  }

  getCostSoFar(): { inputTokens: number; outputTokens: number; usd: number } {
    return { ...this.cumulativeCost };
  }
}

// ============================================================================
// MockAgentRuntime
// ============================================================================

export interface MockAgentRuntimeOptions {
  /** Pool of scenarios to pick from. Defaults to DEFAULT_MOCK_SCENARIOS. */
  scenarios?: MockScenario[];
  /** Force a specific scenario by name (overrides random selection). */
  forceScenario?: string;
  /** Seed for the random scenario picker (for reproducible tests). */
  seed?: number;
  /**
   * Multiplier applied to each step's `delayMs` (default 1.0).
   * Set to 0 to fire all events immediately (useful for unit tests).
   */
  timingMultiplier?: number;
}

/**
 * Fake AgentRuntime emitting scripted SessionEvent streams.
 *
 * Implements the full AgentRuntime contract so it can be slotted anywhere a
 * real runtime is expected — daemon NodeExecutor, dashboard previews, etc.
 */
export class MockAgentRuntime implements AgentRuntime {
  readonly name: RuntimeName = MOCK_RUNTIME_NAME;
  readonly capabilities: RuntimeCapabilities = MOCK_CAPABILITIES;

  private readonly scenarios: MockScenario[];
  private readonly forceScenario: string | undefined;
  private readonly rng: () => number;
  private readonly timingMultiplier: number;

  constructor(opts: MockAgentRuntimeOptions = {}) {
    this.scenarios = opts.scenarios ?? DEFAULT_MOCK_SCENARIOS;
    if (this.scenarios.length === 0) {
      throw new Error("MockAgentRuntime requires at least one scenario");
    }
    this.forceScenario = opts.forceScenario;
    this.rng = opts.seed !== undefined ? makeRng(opts.seed) : Math.random;
    this.timingMultiplier = opts.timingMultiplier ?? 1.0;
  }

  /** Pick a scenario — by name if forced, else by RNG. Exposed for tests. */
  pickScenario(): MockScenario {
    if (this.forceScenario) {
      const found = this.scenarios.find((s) => s.name === this.forceScenario);
      if (!found) {
        throw new Error(`MockAgentRuntime: scenario "${this.forceScenario}" not found`);
      }
      return found;
    }
    const idx = Math.floor(this.rng() * this.scenarios.length);
    return this.scenarios[idx] ?? this.scenarios[0]!;
  }

  startSession(_config: SessionConfig): Promise<RuntimeSession> {
    const scenario = this.pickScenario();
    const session = new MockSession(scenario, this.timingMultiplier);
    return Promise.resolve(session);
  }

  listAvailableModels(_credentials: ResolvedCredentials): Promise<ModelInfo[]> {
    return Promise.resolve([
      {
        id: "mock-fast",
        displayName: "Mock — fast scripted",
        provider: "mock",
        available: true,
        contextTokens: 200_000,
      },
      {
        id: "mock-slow",
        displayName: "Mock — slow scripted",
        provider: "mock",
        available: true,
        contextTokens: 200_000,
      },
    ]);
  }
}
