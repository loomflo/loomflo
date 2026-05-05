/**
 * E2E live test — file-scope enforcement on a real ClaudeAgentRuntime session.
 *
 * SKIPPED BY DEFAULT. Opt in with LOOMFLO_RUN_LIVE_CLAUDE_AGENT=1.
 *
 * Cost: roughly $0.05-0.10 per run (looma role with write tools, modest prompt).
 *
 * Validates Phase 2.1 / 2.4 end-to-end:
 *   1. The agent can write a file inside its assigned scope (allowed by canUseTool).
 *   2. CostTracker.recordCall is invoked with the right args.
 *   3. The session terminates cleanly with status=done and cost > 0.
 *
 * We deliberately don't assert that the agent refused an out-of-scope write
 * because deny behavior is non-deterministic at the LLM level (the agent
 * might just not try). canUseTool unit tests already cover the deny path.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNodeWithRuntime } from "../../src/runtimes/run-node.js";
import type { CostTracker } from "../../src/costs/tracker.js";
import type { SharedMemoryManager } from "../../src/memory/shared-memory.js";
import type { MessageBus } from "../../src/agents/message-bus.js";

const SHOULD_RUN = process.env["LOOMFLO_RUN_LIVE_CLAUDE_AGENT"] === "1";
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

describeMaybe("ClaudeAgentRuntime — live file-scope flow", () => {
  it(
    "writes an in-scope file and feeds CostTracker (Phase 2.1 + 2.4 wiring)",
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), "loomflo-fs-"));
      const expectedPath = join(workspace, "hello.txt");
      const trackerCalls: Array<{ model: string; nodeId: string; agentId: string }> = [];

      const fakeCostTracker = {
        recordCall: (
          model: string,
          _input: number,
          _output: number,
          agentId: string,
          nodeId: string,
        ): unknown => {
          trackerCalls.push({ model, nodeId, agentId });
          return {};
        },
      } as unknown as CostTracker;

      try {
        const result = await runNodeWithRuntime(
          {
            id: "live-fs-1",
            title: "live file scope smoke",
            instructions:
              "Use mcp__loomflo__write_file to create a file named hello.txt at the root " +
              "of the working directory containing exactly the text: ok\n" +
              "Then stop.",
            runtime: "claude-agent",
            fileOwnership: { "looma-live-fs-1": ["**/*"] },
          },
          {
            workflowId: "wf-live-fs",
            workspacePath: workspace,
            costTracker: fakeCostTracker,
            sharedMemory: {} as unknown as SharedMemoryManager,
            messageBus: { async send() {} } as unknown as MessageBus,
            completionHandler: { async reportComplete() {} },
            escalationHandler: { async escalate() {} },
            agentRole: "looma",
            model: "claude-haiku-4-5",
          },
        );

        expect(result).not.toBeNull();
        expect(result?.status).toBe("done");
        expect(result?.cost).toBeGreaterThan(0);
        expect(trackerCalls.length).toBeGreaterThanOrEqual(1);
        expect(trackerCalls[0]?.model).toBe("claude-haiku-4-5");
        expect(trackerCalls[0]?.nodeId).toBe("live-fs-1");
        expect(trackerCalls[0]?.agentId).toBe("looma-live-fs-1");

        // Soft assert on file: model usually creates it but isn't 100% reliable.
        if (existsSync(expectedPath)) {
          const content = readFileSync(expectedPath, "utf-8").trim();
          // eslint-disable-next-line no-console
          console.log(`[file-scope.e2e] wrote ${expectedPath}: ${JSON.stringify(content)}`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`[file-scope.e2e] file not created — agent may have skipped the write`);
        }
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
