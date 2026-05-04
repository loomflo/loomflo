/**
 * ClaudeAgentRuntime — wraps `@anthropic-ai/claude-agent-sdk`.
 *
 * Translates loomflo's `SessionConfig` into the SDK's `Options` shape, opens a
 * `query()` session, and re-emits SDK messages as our normalised
 * `SessionEvent` stream.
 *
 * For Phase 1 we use the stable `query()` API (one-shot, async-iterable). The
 * unstable_v2 stateful API will be considered later if multi-turn within a
 * single open session becomes needed.
 *
 * Spec : specs/003-multi-runtime-orchestration/spec-v2.md §L1
 *
 * @module runtimes/claude-agent
 */

import { randomUUID } from "node:crypto";
import { query, type Options as SdkOptions } from "@anthropic-ai/claude-agent-sdk";
import {
  createLoomaAgentDefinition,
  createLoomaSubagentDefinition,
} from "../agents-config/looma.js";
import { createLoomiAgentDefinition } from "../agents-config/loomi.js";
import { createLoomAgentDefinition } from "../agents-config/loom.js";
import {
  createLoomexAgentDefinition,
  createLoomexSubagentDefinition,
} from "../agents-config/loomex.js";
import type { LoomfloAgentDefinition } from "../agents-config/index.js";
import { createLoomfloMcpServer } from "../mcp/loomflo-tools.js";
import { buildCanUseTool } from "./can-use-tool.js";
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

const CLAUDE_AGENT_CAPABILITIES: RuntimeCapabilities = {
  supportsMcp: true,
  supportsCanUseTool: true,
  supportsSessionPersistence: true,
  supportsStreaming: true,
  supportsSubagents: true,
  supportsByokProvider: false, // Anthropic only — for OpenAI/Gemini, use CopilotRuntime
};

const CLAUDE_AGENT_NAME: RuntimeName = "claude-agent";

// ============================================================================
// AgentDefinition selection
// ============================================================================

/**
 * Build a loomflo `LoomfloAgentDefinition` for the requested role.
 *
 * Each agent factory needs role-specific params (project description for Loom,
 * node instructions for Loomi/Looma, tasks to verify for Loomex). For Phase 1
 * we derive minimal params from `SessionConfig.initialPrompt` — Phase 2 will
 * thread full structured context through `SessionConfig`.
 *
 * Exported as a pure function for unit testing.
 */
export function buildAgentDefinitionForRole(config: SessionConfig): LoomfloAgentDefinition {
  const initial = config.initialPrompt ?? "";
  switch (config.agentRole) {
    case "loom":
      return createLoomAgentDefinition({
        projectDescription: initial,
      });
    case "loomi":
      return createLoomiAgentDefinition({
        nodeTitle: config.context.nodeId,
        nodeInstructions: initial,
        workerCount: 1,
        fileScopes: { [config.context.agentId]: config.fileScope ?? [] },
      });
    case "looma":
      return createLoomaAgentDefinition({
        taskDescription: initial,
        fileScope: config.fileScope ?? [],
        nodeInstructions: initial,
      });
    case "loomex":
      return createLoomexAgentDefinition({
        nodeTitle: config.context.nodeId,
        nodeInstructions: initial,
        tasksToVerify: [],
      });
  }
}

/**
 * Convert a loomflo `LoomfloAgentDefinition` to the SDK's `AgentDefinition`
 * shape. Optional overrides for prompt and model let the caller customize a
 * specific agent (e.g. the main thread) without touching the underlying
 * factory output.
 *
 * Exported for unit testing.
 */
export function toSdkAgentDef(
  def: LoomfloAgentDefinition,
  promptOverride?: string,
  modelOverride?: string,
): { description: string; prompt: string; tools: string[]; model: string } {
  return {
    description: def.description,
    prompt: promptOverride ?? def.prompt,
    tools: [...def.allowedTools],
    model: modelOverride && modelOverride.length > 0 ? modelOverride : def.defaultModel,
  };
}

// ============================================================================
// Auth env injection
// ============================================================================

/**
 * Translate `ResolvedCredentials` into env vars consumed by the SDK / spawned CLI.
 *
 * - oauth-claude-code  : SDK auto-picks up `~/.claude/.credentials.json` (no env needed).
 * - api-key-anthropic  : sets ANTHROPIC_API_KEY.
 * - others             : not supported by Claude Agent runtime (raises).
 *
 * Exported as a pure function for unit testing.
 */
export function buildSdkAuthEnv(creds: ResolvedCredentials): Record<string, string> {
  switch (creds.kind) {
    case "oauth-claude-code":
      return {}; // SDK reads ~/.claude/.credentials.json automatically.
    case "api-key-anthropic":
      return { ANTHROPIC_API_KEY: creds.apiKey };
    case "api-key-openai":
    case "oauth-copilot":
    case "api-key-copilot-byok":
      throw new Error(
        `ClaudeAgentRuntime does not support credentials of kind "${creds.kind}". ` +
          "Use CopilotRuntime instead.",
      );
  }
}

// ============================================================================
// SDK Options builder
// ============================================================================

/** Result of `buildSdkOptions` — both the SDK options and the loomflo MCP instance. */
export interface BuiltSdkOptions {
  options: SdkOptions;
  agentDef: LoomfloAgentDefinition;
}

/**
 * Build the SDK `Options` for a session.
 *
 * Wires:
 * - `agents`        : single entry for the requested role (subagents added in Phase 2).
 * - `agent`         : sets the main thread to that role.
 * - `mcpServers`    : `loomflo` in-memory server + any user-provided servers.
 * - `tools: []`     : disables built-in Claude Code tools.
 * - `allowedTools`  : exact MCP tool names allowed (no permission prompt).
 * - `cwd`, `env`    : workspace + auth.
 *
 * Exported as a pure function for unit testing.
 */
export function buildSdkOptions(config: SessionConfig): BuiltSdkOptions {
  const agentDef = buildAgentDefinitionForRole(config);

  const loomfloMcp = createLoomfloMcpServer({
    workspacePath: config.workspacePath,
    agentRole: config.agentRole,
    agentId: config.context.agentId,
    nodeId: config.context.nodeId,
    fileScope: config.fileScope ?? [],
    messageBus: config.context.messageBus,
    completionHandler: config.context.completionHandler,
    escalationHandler: config.context.escalationHandler,
  });

  // Merge user-provided MCP servers if any. For Phase 1 we only support
  // inMemory and stdio refs — sse/http will come with Phase 3.
  const userMcpServers: Record<string, unknown> = {};
  for (const ref of config.mcpServers) {
    if (ref.kind === "inMemory") {
      userMcpServers[ref.name] = ref.instance;
    } else if (ref.kind === "stdio") {
      userMcpServers[ref.name] = {
        type: "stdio",
        command: ref.command,
        args: ref.args ?? [],
        env: ref.env,
      };
    }
    // sse/http silently ignored in Phase 1.
  }

  const sdkAgentDef = toSdkAgentDef(agentDef, config.systemPromptOverride, config.model);

  // Phase 2.2: when the main agent is `loomi` (or `loom`), register the
  // looma + loomex subagent skeletons so the SDK's built-in `Agent` tool
  // can dispatch to them. The skeleton prompts establish the persona; the
  // actual task is supplied by the dispatcher via Agent({prompt: ...}).
  //
  // Limitation: canUseTool is session-wide in the SDK, so per-subagent file
  // scope isolation is NOT enforced here. The loomi-native runtime remains
  // the path for strict multi-agent isolation; phase 3+ will explore
  // loomflo-orchestrated parallel sessions for the SDK runtimes.
  const agentsMap: Record<string, ReturnType<typeof toSdkAgentDef>> = {
    [config.agentRole]: sdkAgentDef,
  };
  if (config.agentRole === "loomi" || config.agentRole === "loom") {
    if (!agentsMap["looma"]) {
      agentsMap["looma"] = toSdkAgentDef(createLoomaSubagentDefinition());
    }
    if (!agentsMap["loomex"]) {
      agentsMap["loomex"] = toSdkAgentDef(createLoomexSubagentDefinition());
    }
  }

  // Allow pointing the SDK at a Claude Code binary outside its bundled
  // optional package (useful when the user already has `claude` installed
  // globally, e.g. via the official native installer).
  const pathOverride =
    process.env["LOOMFLO_CLAUDE_CODE_PATH"] ?? process.env["CLAUDE_CODE_PATH"];

  const options: SdkOptions = {
    cwd: config.workspacePath,
    tools: [], // Disable built-in Claude Code tools — only MCP tools allowed.
    allowedTools: agentDef.allowedTools,
    canUseTool: buildCanUseTool(config.fileScope ?? []),
    mcpServers: {
      loomflo: loomfloMcp as never,
      ...userMcpServers,
    } as SdkOptions["mcpServers"],
    agents: agentsMap as SdkOptions["agents"],
    agent: config.agentRole,
    env: { ...process.env, ...buildSdkAuthEnv(config.credentials) },
    ...(pathOverride ? { pathToClaudeCodeExecutable: pathOverride } : {}),
    ...(config.budget?.maxTokens !== undefined ? { maxTokens: config.budget.maxTokens } : {}),
    ...(config.resumeSessionId !== undefined ? { resume: config.resumeSessionId } : {}),
  };

  return { options, agentDef };
}

// ============================================================================
// ClaudeAgentSession
// ============================================================================

/**
 * Live session driven by `query()` from the SDK.
 *
 * Spawns the query loop on construction and emits normalised events as the
 * SDK streams messages. `dispose()` aborts the in-flight query and clears
 * subscribers.
 */
class ClaudeAgentSession implements RuntimeSession {
  readonly id: string;
  readonly runtimeName: RuntimeName = CLAUDE_AGENT_NAME;

  private readonly handlers = new Set<SessionEventHandler>();
  private readonly abortController = new AbortController();
  private cumulativeCost = { inputTokens: 0, outputTokens: 0, usd: 0 };
  private queryCompleted = false;
  private queryPromise: Promise<void> | undefined;

  constructor(
    private readonly sdkOptions: SdkOptions,
    private readonly initialPrompt: string,
  ) {
    this.id = randomUUID();
    this.queryPromise = this.runQueryLoop();
  }

  private emit(event: SessionEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        /* Handler errors must not break the session loop. */
      }
    }
  }

  private async runQueryLoop(): Promise<void> {
    this.emit({ kind: "session_started", sessionId: this.id });

    try {
      const optionsWithAbort: SdkOptions = {
        ...this.sdkOptions,
        abortController: this.abortController,
      };
      const stream = query({
        prompt: this.initialPrompt,
        options: optionsWithAbort,
      });

      for await (const msg of stream) {
        if (this.abortController.signal.aborted) break;
        this.processSdkMessage(msg);
      }

      this.queryCompleted = true;
      this.emit({ kind: "session_ended", reason: "completed" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (this.abortController.signal.aborted) {
        this.emit({ kind: "session_ended", reason: "aborted" });
      } else {
        this.emit({ kind: "error", message, cause: e });
        this.emit({ kind: "session_ended", reason: "error" });
      }
    }
  }

  /**
   * Translate a single SDK message into one or more `SessionEvent`s.
   *
   * Exposed via #processSdkMessage to keep `runQueryLoop` small. We deliberately
   * loosen the message type to `unknown` because the SDK union has many
   * variants we don't act on; we narrow inline on the `type` discriminant.
   */
  private processSdkMessage(msg: unknown): void {
    if (msg === null || typeof msg !== "object" || !("type" in msg)) return;
    const m = msg as { type: string } & Record<string, unknown>;

    switch (m.type) {
      case "assistant": {
        const inner = m["message"] as { content?: unknown[] } | undefined;
        const blocks = inner?.content ?? [];
        for (const b of blocks) {
          if (b === null || typeof b !== "object" || !("type" in b)) continue;
          const block = b as { type: string } & Record<string, unknown>;
          if (block.type === "text" && typeof block["text"] === "string") {
            this.emit({ kind: "assistant_text", text: block["text"], isDelta: false });
          } else if (block.type === "tool_use") {
            this.emit({
              kind: "tool_call",
              toolName: String(block["name"] ?? "unknown"),
              input: (block["input"] as Record<string, unknown> | undefined) ?? {},
              toolUseId: String(block["id"] ?? ""),
            });
          }
        }
        return;
      }

      case "user": {
        // Tool results come through user messages with content blocks of type tool_result.
        const inner = m["message"] as { content?: unknown[] } | undefined;
        const blocks = inner?.content ?? [];
        for (const b of blocks) {
          if (b === null || typeof b !== "object" || !("type" in b)) continue;
          const block = b as { type: string } & Record<string, unknown>;
          if (block.type === "tool_result") {
            this.emit({
              kind: "tool_result",
              toolUseId: String(block["tool_use_id"] ?? ""),
              ok: block["is_error"] !== true,
              output: block["content"],
            });
          }
        }
        return;
      }

      case "rate_limit_event": {
        const retryAfter = m["retry_after_ms"];
        this.emit({
          kind: "rate_limited",
          ...(typeof retryAfter === "number" ? { retryAfterMs: retryAfter } : {}),
        });
        return;
      }

      case "result": {
        const usd = typeof m["total_cost_usd"] === "number" ? m["total_cost_usd"] : 0;
        const usage = m["usage"] as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        const input = usage?.input_tokens ?? 0;
        const output = usage?.output_tokens ?? 0;
        this.cumulativeCost = {
          inputTokens: this.cumulativeCost.inputTokens + input,
          outputTokens: this.cumulativeCost.outputTokens + output,
          usd: this.cumulativeCost.usd + usd,
        };
        this.emit({
          kind: "cost_update",
          inputTokens: input,
          outputTokens: output,
          usd,
        });
        this.emit({ kind: "session_idle" });
        return;
      }

      // system / partial-assistant / status / hooks / others — currently not surfaced.
      default:
        return;
    }
  }

  send(prompt: string): Promise<void> {
    // Phase 1 uses one-shot `query()`. Multi-turn within an open session
    // requires the unstable_v2 API and will be added in Phase 2.
    return Promise.reject(
      new Error(
        `send() not yet supported in Phase 1 (one-shot query). prompt="${prompt.slice(0, 40)}..."`,
      ),
    );
  }

  on(handler: SessionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async abort(): Promise<void> {
    this.abortController.abort();
    if (this.queryPromise) {
      await this.queryPromise.catch(() => {
        /* swallow */
      });
    }
  }

  async dispose(): Promise<void> {
    if (!this.queryCompleted) {
      await this.abort();
    }
    this.handlers.clear();
  }

  getCostSoFar(): { inputTokens: number; outputTokens: number; usd: number } {
    return { ...this.cumulativeCost };
  }
}

// ============================================================================
// ClaudeAgentRuntime
// ============================================================================

/**
 * Runtime adapter for `@anthropic-ai/claude-agent-sdk`.
 *
 * Loomflo creates a single instance per daemon (or per project, if isolation
 * is desired) and calls `startSession(...)` for every node execution.
 */
export class ClaudeAgentRuntime implements AgentRuntime {
  readonly name: RuntimeName = CLAUDE_AGENT_NAME;
  readonly capabilities: RuntimeCapabilities = CLAUDE_AGENT_CAPABILITIES;

  startSession(config: SessionConfig): Promise<RuntimeSession> {
    const { options } = buildSdkOptions(config);
    const session = new ClaudeAgentSession(options, config.initialPrompt ?? "");
    return Promise.resolve(session);
  }

  listAvailableModels(_credentials: ResolvedCredentials): Promise<ModelInfo[]> {
    // Phase 1 ships a hardcoded baseline. Phase 2 will query the live API.
    return Promise.resolve([
      {
        id: "claude-opus-4-5",
        displayName: "Claude Opus 4.5",
        provider: "anthropic",
        available: true,
        contextTokens: 200_000,
      },
      {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        provider: "anthropic",
        available: true,
        contextTokens: 200_000,
      },
      {
        id: "claude-haiku-4-5",
        displayName: "Claude Haiku 4.5",
        provider: "anthropic",
        available: true,
        contextTokens: 200_000,
      },
    ]);
  }
}
