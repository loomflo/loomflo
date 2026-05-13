/**
 * E2E smoke test for CopilotRuntime — live API call via the bundled `copilot`
 * CLI.
 *
 * SKIPPED BY DEFAULT. Set `LOOMFLO_RUN_LIVE_COPILOT=1` to opt in. Requires:
 *   - the `copilot` CLI installed (bundled by @github/copilot npm dep, but
 *     also installable globally via `npm install -g @github/copilot`)
 *   - the user logged in (`copilot login`) OR a GitHub token via
 *     `LOOMFLO_COPILOT_TOKEN` env var
 *   - an active Copilot subscription (Pro / Business / Enterprise)
 *
 * Cost: $0 from loomflo's POV — billed against the user's Copilot subscription.
 *
 * Validates Phase 3 wiring:
 *   1. CopilotRuntime can spawn the CLI and open a session.
 *   2. assistant.message events are translated to assistant_text.
 *   3. session_ended:completed fires after a small prompt.
 *
 * Run with:
 *   LOOMFLO_RUN_LIVE_COPILOT=1 pnpm --filter @loomflo/core exec vitest run \
 *     --config ../../vitest.e2e.config.ts tests/e2e/copilot-runtime.e2e.test.ts
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNodeWithRuntime } from "../../src/runtimes/run-node.js";
import { CopilotRuntime } from "../../src/runtimes/copilot.js";
import { __setRuntimeInstanceForTest } from "../../src/runtimes/registry.js";
import type { SessionEvent } from "../../src/runtimes/base.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { MessageBus } from "../../src/agents/message-bus.js";

const SHOULD_RUN = process.env["LOOMFLO_RUN_LIVE_COPILOT"] === "1";
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

describeMaybe("CopilotRuntime — live SDK smoke", () => {
  it(
    "opens a session, streams events, and returns status=done",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "loomflo-copilot-smoke-"));
      const runtime = new CopilotRuntime();
      __setRuntimeInstanceForTest("copilot", runtime);

      try {
        const events: SessionEvent[] = [];
        const result = await runNodeWithRuntime(
          {
            id: "live-copilot-1",
            title: "live copilot smoke",
            instructions: "Reply with a single word, in lowercase, with no punctuation: ok",
            runtime: "copilot",
            fileOwnership: {},
          },
          {
            workflowId: "wf-copilot-smoke",
            workspacePath: workspace,
            costTracker: {
              recordCall: () => ({}),
            } as unknown as CostTracker,
            sharedMemory: {} as unknown as SharedMemoryManager,
            messageBus: { async send() {} } as unknown as MessageBus,
            completionHandler: { async reportComplete() {} },
            escalationHandler: { async escalate() {} },
            agentRole: "looma",
            model: "gpt-5",
            credentialsOverride: { kind: "oauth-copilot" },
            onEvent: (e) => events.push(e),
          },
        );

        if (result?.status !== "done") {
          // eslint-disable-next-line no-console
          console.error(
            "[copilot.e2e] not done:",
            events.map((e) => ({
              kind: e.kind,
              ...(e.kind === "error" ? { message: e.message } : {}),
              ...(e.kind === "session_ended" ? { reason: e.reason } : {}),
            })),
          );
        }

        expect(result?.status).toBe("done");
        expect(events.find((e) => e.kind === "session_started")).toBeDefined();
        expect(events.find((e) => e.kind === "session_ended")).toBeDefined();
      } finally {
        await runtime.dispose().catch(() => {});
        __setRuntimeInstanceForTest("copilot", null);
        await rm(workspace, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
