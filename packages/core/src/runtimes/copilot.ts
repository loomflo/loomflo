/**
 * CopilotRuntime — wraps `@github/copilot-sdk`.
 *
 * Provides a second AgentRuntime option that drives sessions through the
 * official GitHub Copilot CLI (via the SDK's JSON-RPC bridge to the
 * `@github/copilot` binary). Uses the user's Copilot subscription for
 * billing by default; supports BYOK for Anthropic / OpenAI when the user
 * wants to bypass Copilot pricing.
 *
 * Phase 3 scope: one-shot send via `sendAndWait`. Multi-turn within a
 * single open session works (CopilotSession is stateful) but the
 * RuntimeSession contract returned here is one-shot like ClaudeAgentRuntime.
 *
 * @module runtimes/copilot
 */

import { randomUUID } from "node:crypto";
import {
  approveAll,
  CopilotClient,
  type CopilotSession,
  type ProviderConfig as CopilotProviderConfig,
} from "@github/copilot-sdk";
import { buildCopilotTools } from "./copilot-tools.js";
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

const COPILOT_CAPABILITIES: RuntimeCapabilities = {
  supportsMcp: true, // via stdio/http server config (Phase 3+)
  supportsCanUseTool: false, // permissions are per-call via onPermissionRequest
  supportsSessionPersistence: true, // resumeSession on the SDK
  supportsStreaming: true,
  supportsSubagents: false, // customAgents exists but Phase 3 doesn't wire them
  supportsByokProvider: true, // provider.type "openai" | "azure" | "anthropic"
};

const COPILOT_RUNTIME_NAME: RuntimeName = "copilot";

// ============================================================================
// Provider mapping
// ============================================================================

/**
 * Translate `ResolvedCredentials` into the Copilot SDK's ProviderConfig.
 *
 * Returns `undefined` to mean "use the Copilot subscription" (default Copilot
 * billing / authentication via the bundled CLI). Returns a ProviderConfig to
 * route requests directly to Anthropic / OpenAI with the user's key (BYOK).
 *
 * Exported for unit testing.
 */
export function buildCopilotProvider(
  creds: ResolvedCredentials,
): CopilotProviderConfig | undefined {
  switch (creds.kind) {
    case "oauth-copilot":
      return undefined;
    case "api-key-anthropic":
      return {
        type: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: creds.apiKey,
      };
    case "api-key-openai":
      return {
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: creds.apiKey,
      };
    case "api-key-copilot-byok":
      return {
        type: creds.provider,
        baseUrl:
          creds.provider === "anthropic"
            ? "https://api.anthropic.com"
            : "https://api.openai.com/v1",
        apiKey: creds.apiKey,
      };
    case "oauth-claude-code":
      throw new Error(
        "CopilotRuntime does not support oauth-claude-code credentials. Use ClaudeAgentRuntime instead.",
      );
  }
}

// ============================================================================
// Session translation
// ============================================================================

/**
 * Wrap a `CopilotSession` from the SDK as our normalised `RuntimeSession`.
 *
 * Translates the SDK's typed events into `SessionEvent` and accumulates cost
 * from the final assistant.message event (Copilot doesn't emit cost_update
 * events incrementally — usage / cost arrive with the final message).
 */
class CopilotRuntimeSession implements RuntimeSession {
  readonly id: string;
  readonly runtimeName: RuntimeName = COPILOT_RUNTIME_NAME;

  private readonly handlers = new Set<SessionEventHandler>();
  private cumulativeCost = { inputTokens: 0, outputTokens: 0, usd: 0 };
  private completed = false;

  constructor(
    private readonly sdkSession: CopilotSession,
    initialPrompt: string,
  ) {
    this.id = randomUUID();
    void this.drive(initialPrompt);
  }

  private emit(event: SessionEvent): void {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch {
        /* swallow */
      }
    }
  }

  private async drive(initialPrompt: string): Promise<void> {
    this.emit({ kind: "session_started", sessionId: this.id });

    // Stream typed events from the SDK to our normalised event stream.
    const offDelta = this.sdkSession.on("assistant.message_delta", (event: unknown) => {
      const e = event as { data?: { deltaContent?: string } };
      const text = e.data?.deltaContent;
      if (typeof text === "string" && text.length > 0) {
        this.emit({ kind: "assistant_text", text, isDelta: true });
      }
    });
    const offMessage = this.sdkSession.on("assistant.message", (event: unknown) => {
      const e = event as { data?: { content?: string; usage?: unknown } };
      const text = e.data?.content;
      if (typeof text === "string" && text.length > 0) {
        this.emit({ kind: "assistant_text", text, isDelta: false });
      }
    });

    try {
      const finalMsg = await this.sdkSession.sendAndWait({ prompt: initialPrompt });

      // Pull cost / usage off the final message if present.
      const usage = (finalMsg?.data as { usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number } } | undefined)?.usage;
      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      const usd = usage?.costUsd ?? 0;
      if (inputTokens > 0 || outputTokens > 0 || usd > 0) {
        this.cumulativeCost = {
          inputTokens: this.cumulativeCost.inputTokens + inputTokens,
          outputTokens: this.cumulativeCost.outputTokens + outputTokens,
          usd: this.cumulativeCost.usd + usd,
        };
        this.emit({ kind: "cost_update", inputTokens, outputTokens, usd });
      }

      this.emit({ kind: "session_idle" });
      this.completed = true;
      this.emit({ kind: "session_ended", reason: "completed" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ kind: "error", message, cause: err });
      this.emit({ kind: "session_ended", reason: "error" });
    } finally {
      offDelta();
      offMessage();
    }
  }

  send(prompt: string): Promise<void> {
    return Promise.reject(
      new Error(
        `CopilotRuntime: send() is one-shot in Phase 3. prompt="${prompt.slice(0, 40)}..."`,
      ),
    );
  }

  on(handler: SessionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async abort(): Promise<void> {
    await this.sdkSession.abort();
  }

  async dispose(): Promise<void> {
    if (!this.completed) await this.abort();
    try {
      await this.sdkSession.disconnect();
    } catch {
      /* swallow */
    }
    this.handlers.clear();
  }

  getCostSoFar(): { inputTokens: number; outputTokens: number; usd: number } {
    return { ...this.cumulativeCost };
  }
}

// ============================================================================
// CopilotRuntime
// ============================================================================

/**
 * Adapter for `@github/copilot-sdk`.
 *
 * Maintains a single shared `CopilotClient` per process — the SDK spawns the
 * CLI binary on first `start()` and reuses it across sessions. The client
 * is created lazily on first `startSession()` call.
 */
export class CopilotRuntime implements AgentRuntime {
  readonly name: RuntimeName = COPILOT_RUNTIME_NAME;
  readonly capabilities: RuntimeCapabilities = COPILOT_CAPABILITIES;

  private clientPromise: Promise<CopilotClient> | undefined;

  private async getClient(): Promise<CopilotClient> {
    this.clientPromise ??= (async () => {
      const opts: ConstructorParameters<typeof CopilotClient>[0] = {};
      const cliPath =
        process.env["LOOMFLO_COPILOT_CLI_PATH"] ?? process.env["COPILOT_CLI_PATH"];
      if (cliPath) opts.cliPath = cliPath;
      const client = new CopilotClient(opts);
      await client.start();
      return client;
    })();
    return this.clientPromise;
  }

  /** Disposes the shared client (for graceful daemon shutdown / tests). */
  async dispose(): Promise<void> {
    if (!this.clientPromise) return;
    const client = await this.clientPromise;
    await client.stop().catch(() => {
      /* swallow */
    });
    this.clientPromise = undefined;
  }

  async startSession(config: SessionConfig): Promise<RuntimeSession> {
    const client = await this.getClient();

    const tools = buildCopilotTools({
      workspacePath: config.workspacePath,
      agentRole: config.agentRole,
      agentId: config.context.agentId,
      nodeId: config.context.nodeId,
      fileScope: config.fileScope ?? [],
      messageBus: config.context.messageBus,
      completionHandler: config.context.completionHandler,
      escalationHandler: config.context.escalationHandler,
    });

    const provider = buildCopilotProvider(config.credentials);

    const sdkSession = await client.createSession({
      ...(config.model ? { model: config.model } : {}),
      tools,
      ...(provider ? { provider } : {}),
      // Permissions: approve all tool calls (the underlying loomflo tools
      // already enforce file scope + workspace boundaries — see
      // packages/core/src/tools/file-write.ts and the canUseTool callback
      // wired by the ClaudeAgentRuntime). The Copilot SDK doesn't expose a
      // canUseTool, so the loomflo tool implementations are the sole gate.
      onPermissionRequest: approveAll,
      ...(config.systemPromptOverride
        ? {
            systemMessage: {
              kind: "replace",
              prompt: config.systemPromptOverride,
            } as never,
          }
        : {}),
      ...(config.resumeSessionId ? { sessionId: config.resumeSessionId } : {}),
    });

    return new CopilotRuntimeSession(sdkSession, config.initialPrompt ?? "");
  }

  listAvailableModels(_credentials: ResolvedCredentials): Promise<ModelInfo[]> {
    // Phase 3 ships a hardcoded baseline. Phase 4+ will call client.listModels()
    // for a live list (requires the CLI to be started).
    return Promise.resolve([
      { id: "gpt-5", displayName: "GPT-5 (Copilot)", provider: "openai", available: true },
      { id: "gpt-4.1", displayName: "GPT-4.1 (Copilot)", provider: "openai", available: true },
      {
        id: "claude-sonnet-4.5",
        displayName: "Claude Sonnet 4.5 (via Copilot)",
        provider: "anthropic",
        available: true,
      },
      {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro (Copilot)",
        provider: "google",
        available: true,
      },
    ]);
  }
}
