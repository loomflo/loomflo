/**
 * /runtimes routes — list available agent runtimes, their capabilities,
 * the local CLI availability, and per-runtime model catalog.
 *
 * Daemon-level (not project-scoped). Consumed by the dashboard wizard
 * (provider selection) and the runtime picker per node.
 *
 * @module api/routes/runtimes
 */

import type { FastifyPluginAsync } from "fastify";
import { ClaudeAgentRuntime } from "../../runtimes/claude-agent.js";
import { CopilotRuntime } from "../../runtimes/copilot.js";
import { MockAgentRuntime } from "../../runtimes/mock.js";
import { detectAgentCli, detectAllAgentClis, type AgentCliName } from "../cli-detection.js";

// ============================================================================
// Types
// ============================================================================

export type RuntimeListEntry = {
  /** Identifier matching `Node.runtime` enum. */
  name: "loomi-native" | "claude-agent" | "copilot" | "mock";
  /** Human-readable label. */
  displayName: string;
  /** When true, this runtime ships in the registry (vs. legacy loomi-native). */
  registered: boolean;
  /** Capabilities surface for the UI (informational). */
  capabilities?: {
    supportsMcp: boolean;
    supportsCanUseTool: boolean;
    supportsSessionPersistence: boolean;
    supportsStreaming: boolean;
    supportsSubagents: boolean;
    supportsByokProvider: boolean;
  };
  /** When applicable, which CLI the runtime depends on. */
  cli?: AgentCliName;
};

const claudeAgent = new ClaudeAgentRuntime();
const copilot = new CopilotRuntime();
const mock = new MockAgentRuntime();

const RUNTIME_LIST: RuntimeListEntry[] = [
  {
    name: "loomi-native",
    displayName: "Loomi-native (legacy)",
    registered: false,
    // No capabilities object — the legacy path doesn't implement AgentRuntime.
  },
  {
    name: "claude-agent",
    displayName: "Claude Agent SDK",
    registered: true,
    capabilities: claudeAgent.capabilities,
    cli: "claude-code",
  },
  {
    name: "copilot",
    displayName: "GitHub Copilot SDK",
    registered: true,
    capabilities: copilot.capabilities,
    cli: "copilot",
  },
  {
    name: "mock",
    displayName: "Mock (scripted, no API call)",
    registered: true,
    capabilities: mock.capabilities,
  },
];

// ============================================================================
// Routes
// ============================================================================

export const runtimesRoutes: FastifyPluginAsync = async (server) => {
  /** GET /runtimes — list every runtime with its capabilities. */
  server.get("/runtimes", async () => {
    return { runtimes: RUNTIME_LIST };
  });

  /** GET /runtimes/:name/availability — detect local CLI + auth state. */
  server.get<{ Params: { name: string } }>(
    "/runtimes/:name/availability",
    async (req, reply) => {
      const { name } = req.params;
      const entry = RUNTIME_LIST.find((r) => r.name === name);
      if (!entry) {
        await reply.code(404).send({ error: `Unknown runtime: ${name}` });
        return;
      }
      if (!entry.cli) {
        return { installed: true, authenticated: true, runtimeName: name, cli: null };
      }
      const av = await detectAgentCli(entry.cli);
      return { ...av, runtimeName: name, cli: entry.cli };
    },
  );

  /** GET /runtimes/availability — bulk: detect all CLIs in parallel. */
  server.get("/runtimes/availability", async () => {
    return { clis: await detectAllAgentClis() };
  });

  /** GET /runtimes/:name/models — list models for a runtime. */
  server.get<{ Params: { name: string } }>(
    "/runtimes/:name/models",
    async (req, reply) => {
      const { name } = req.params;
      switch (name) {
        case "claude-agent":
          return { models: await claudeAgent.listAvailableModels({ kind: "oauth-claude-code" }) };
        case "copilot":
          return { models: await copilot.listAvailableModels({ kind: "oauth-copilot" }) };
        case "mock":
          return { models: await mock.listAvailableModels({ kind: "oauth-claude-code" }) };
        case "loomi-native":
          return { models: [] }; // legacy path doesn't expose a catalog.
        default:
          await reply.code(404).send({ error: `Unknown runtime: ${name}` });
          return;
      }
    },
  );
};
