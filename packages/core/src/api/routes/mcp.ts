/**
 * /projects/:projectId/mcp routes — CRUD for per-project MCP server configs.
 *
 * Mounted under the project-scoped namespace, so handlers can read the
 * project workspace path from `req.runtime.workflow.projectPath`.
 *
 * Storage: `<projectPath>/.loomflo/mcp.json` via persistence/mcp-config.ts.
 *
 * Consumed by the dashboard MCP manager page and (later) by the daemon's
 * NodeExecutor when building the SessionConfig for an agent run.
 *
 * @module api/routes/mcp
 */

import type { FastifyPluginAsync } from "fastify";
import {
  listMcpServers,
  removeMcpServer,
  upsertMcpServer,
  type McpServerConfigEntry,
} from "../../persistence/mcp-config.js";
import type { ProjectRuntime } from "../../daemon-types.js";

// ============================================================================
// Validation
// ============================================================================

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateEntry(
  body: unknown,
): { ok: true; entry: McpServerConfigEntry } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const enabled = b["enabled"] === undefined ? true : Boolean(b["enabled"]);
  switch (b["type"]) {
    case "stdio": {
      if (typeof b["command"] !== "string" || b["command"].length === 0) {
        return { ok: false, error: "stdio MCP server requires a non-empty command string" };
      }
      const entry: McpServerConfigEntry = {
        type: "stdio",
        command: b["command"],
        ...(Array.isArray(b["args"]) ? { args: (b["args"] as unknown[]).map(String) } : {}),
        ...(typeof b["env"] === "object" && b["env"] !== null
          ? { env: b["env"] as Record<string, string> }
          : {}),
        enabled,
      };
      return { ok: true, entry };
    }
    case "sse":
    case "http": {
      if (typeof b["url"] !== "string" || b["url"].length === 0) {
        return { ok: false, error: `${b["type"] as string} MCP server requires a url string` };
      }
      const entry: McpServerConfigEntry = {
        type: b["type"] as "sse" | "http",
        url: b["url"],
        ...(typeof b["headers"] === "object" && b["headers"] !== null
          ? { headers: b["headers"] as Record<string, string> }
          : {}),
        enabled,
      };
      return { ok: true, entry };
    }
    default:
      return { ok: false, error: `Unknown MCP server type: ${String(b["type"])}` };
  }
}

// ============================================================================
// Routes
// ============================================================================

interface ScopedRequest {
  runtime?: ProjectRuntime;
}

function projectPathFromRequest(req: ScopedRequest): string | null {
  const runtime = req.runtime;
  if (!runtime) return null;
  // ProjectRuntime in this codebase exposes the workspace path via the
  // workflow it manages. Fall back to runtime.projectPath if present.
  const wf = (runtime as unknown as { workflow?: { projectPath?: string } }).workflow;
  if (wf && typeof wf.projectPath === "string") return wf.projectPath;
  const direct = (runtime as unknown as { projectPath?: string }).projectPath;
  if (typeof direct === "string") return direct;
  return null;
}

export function mcpRoutes(): FastifyPluginAsync {
  return async (server) => {
    /** GET /mcp — list every configured MCP server for this project. */
    server.get("/mcp", async (req, reply) => {
      const projectPath = projectPathFromRequest(req as ScopedRequest);
      if (!projectPath) {
        await reply.code(500).send({ error: "Project runtime missing on request" });
        return;
      }
      const servers = await listMcpServers(projectPath);
      return { servers };
    });

    /** PUT /mcp/:name — create or replace an MCP server entry. */
    server.put<{ Params: { name: string }; Body: unknown }>(
      "/mcp/:name",
      async (req, reply) => {
        const projectPath = projectPathFromRequest(req as ScopedRequest);
        if (!projectPath) {
          await reply.code(500).send({ error: "Project runtime missing on request" });
          return;
        }
        const { name } = req.params;
        if (!NAME_RE.test(name)) {
          await reply.code(400).send({
            error: "Invalid name: alphanumerics, dash, underscore (max 64 chars)",
          });
          return;
        }
        const validation = validateEntry(req.body);
        if (!validation.ok) {
          await reply.code(400).send({ error: validation.error });
          return;
        }
        await upsertMcpServer(projectPath, name, validation.entry);
        await reply.code(200).send({ name, server: validation.entry });
      },
    );

    /** DELETE /mcp/:name — remove an MCP server entry. */
    server.delete<{ Params: { name: string } }>("/mcp/:name", async (req, reply) => {
      const projectPath = projectPathFromRequest(req as ScopedRequest);
      if (!projectPath) {
        await reply.code(500).send({ error: "Project runtime missing on request" });
        return;
      }
      const removed = await removeMcpServer(projectPath, req.params.name);
      if (!removed) {
        await reply.code(404).send({ error: `No MCP server named "${req.params.name}"` });
        return;
      }
      await reply.code(204).send();
    });
  };
}
