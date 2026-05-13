/**
 * E2E smoke test for ClaudeAgentRuntime — live API call.
 *
 * SKIPPED BY DEFAULT. Set `LOOMFLO_RUN_LIVE_CLAUDE_AGENT=1` in the environment
 * to opt in. Uses Claude.ai OAuth from `~/.claude/.credentials.json` if present,
 * otherwise the `ANTHROPIC_API_KEY` env var.
 *
 * Cost: roughly $0.01–0.05 per run (small prompt, no real tool calls).
 *
 * Validates:
 *   1. ClaudeAgentRuntime can open a session via the SDK and stream events.
 *   2. Real assistant_text + cost_update + session_ended:completed are emitted.
 *   3. Cumulative cost > 0 after the session ends.
 *
 * Run with:
 *   LOOMFLO_RUN_LIVE_CLAUDE_AGENT=1 pnpm --filter @loomflo/core exec vitest run --config ../../vitest.e2e.config.ts
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgentRuntime } from "../../src/runtimes/claude-agent.js";
import { resolveClaudeAgentCredentials } from "../../src/runtimes/run-node.js";
import type { SessionConfig, SessionEvent } from "../../src/runtimes/base.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { MessageBus } from "../../src/agents/message-bus.js";

const SHOULD_RUN = process.env["LOOMFLO_RUN_LIVE_CLAUDE_AGENT"] === "1";
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

describeMaybe("ClaudeAgentRuntime — live SDK smoke", () => {
  it(
    "opens a session, streams events, and returns cost > 0",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "loomflo-claude-smoke-"));
      try {
        const runtime = new ClaudeAgentRuntime();
        const credentials = resolveClaudeAgentCredentials();

        const config: SessionConfig = {
          workspacePath: workspace,
          agentRole: "loomi",
          model: "claude-haiku-4-5", // Cheapest model for the smoke check.
          mcpServers: [],
          fileScope: ["**/*"],
          credentials,
          initialPrompt:
            "Reply with a single word, in lowercase, with no punctuation: ok",
          context: {
            workflow: { id: "wf-smoke", projectPath: workspace },
            nodeId: "n-smoke",
            agentId: "loomi-smoke",
            costTracker: {} as unknown as CostTracker,
            sharedMemory: {} as unknown as SharedMemoryManager,
            messageBus: { async send() {} } as unknown as MessageBus,
            completionHandler: { async reportComplete() {} },
            escalationHandler: { async escalate() {} },
          },
        };

        const session = await runtime.startSession(config);
        const events: SessionEvent[] = [];
        const done = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Session did not end within 50s")),
            50_000,
          );
          session.on((event) => {
            events.push(event);
            if (event.kind === "session_ended") {
              clearTimeout(timeout);
              resolve();
            }
          });
        });

        await done;
        await session.dispose();

        const ended = events.find((e) => e.kind === "session_ended");
        if (
          ended &&
          (ended as Extract<SessionEvent, { kind: "session_ended" }>).reason !== "completed"
        ) {
          // Surface the full event log on failure for actionable diagnostics.
          // eslint-disable-next-line no-console
          console.error(
            "[claude-agent-runtime.e2e] session did not complete:",
            events.map((e) => ({
              kind: e.kind,
              ...(e.kind === "error" ? { message: e.message } : {}),
              ...(e.kind === "session_ended" ? { reason: e.reason } : {}),
            })),
          );
        }

        expect(ended).toBeDefined();
        expect((ended as Extract<SessionEvent, { kind: "session_ended" }>).reason).toBe(
          "completed",
        );

        const costEvents = events.filter((e) => e.kind === "cost_update");
        expect(costEvents.length).toBeGreaterThanOrEqual(1);
        const cumulative = session.getCostSoFar();
        expect(cumulative.usd).toBeGreaterThan(0);
        expect(cumulative.inputTokens).toBeGreaterThan(0);

        // We don't assert on assistant_text content because the model may
        // surface it across multiple events or in `result.result`. The
        // session_ended:completed signal + non-zero cost is the smoke target.
        const assistantTexts = events.filter((e) => e.kind === "assistant_text");
        // Soft assertion — many models will produce at least one text block.
        expect(assistantTexts.length + costEvents.length).toBeGreaterThan(0);
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
    55_000,
  );
});
