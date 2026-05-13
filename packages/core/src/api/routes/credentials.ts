/**
 * /credentials routes — CRUD for provider profiles stored in
 * ~/.loomflo/credentials.json.
 *
 * Daemon-level (not project-scoped). Consumed by the dashboard wizard
 * (provider/credentials selection) and the credentials manager page.
 *
 * Security: API keys are stored with 0600 perms via ProviderProfiles. The
 * GET endpoints redact apiKey values from responses by default.
 *
 * @module api/routes/credentials
 */

import type { FastifyPluginAsync } from "fastify";
import { ProviderProfiles, type ProviderProfile } from "../../providers/profiles.js";

// ============================================================================
// Types
// ============================================================================

export interface CredentialsRoutesOptions {
  /** ProviderProfiles instance reading/writing the credentials file. */
  profiles: ProviderProfiles;
}

/** Public-safe representation: redacts apiKey values to "***" + last 4 chars. */
type RedactedProfile = { name: string } & (
  | { type: "anthropic-oauth" }
  | { type: "anthropic"; apiKeyPreview: string }
  | { type: "openai"; apiKeyPreview: string; baseUrl?: string; defaultModel?: string }
  | { type: "moonshot"; apiKeyPreview: string; baseUrl?: string; defaultModel?: string }
  | { type: "nvidia"; apiKeyPreview: string; baseUrl?: string; defaultModel?: string }
);

function redactApiKey(key: string): string {
  if (key.length <= 4) return "****";
  return `***${key.slice(-4)}`;
}

function toRedacted(name: string, p: ProviderProfile): RedactedProfile {
  switch (p.type) {
    case "anthropic-oauth":
      return { name, type: "anthropic-oauth" };
    case "anthropic":
      return { name, type: "anthropic", apiKeyPreview: redactApiKey(p.apiKey) };
    case "openai":
    case "moonshot":
    case "nvidia":
      return {
        name,
        type: p.type,
        apiKeyPreview: redactApiKey(p.apiKey),
        ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        ...(p.defaultModel ? { defaultModel: p.defaultModel } : {}),
      };
  }
}

// ============================================================================
// Validation
// ============================================================================

function validateUpsert(body: unknown): { ok: true; profile: ProviderProfile } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const type = b["type"];
  switch (type) {
    case "anthropic-oauth":
      return { ok: true, profile: { type: "anthropic-oauth" } };
    case "anthropic":
      if (typeof b["apiKey"] !== "string" || b["apiKey"].length < 8) {
        return { ok: false, error: "anthropic profile requires a non-empty apiKey string" };
      }
      return { ok: true, profile: { type: "anthropic", apiKey: b["apiKey"] } };
    case "openai":
    case "moonshot":
    case "nvidia": {
      if (typeof b["apiKey"] !== "string" || b["apiKey"].length < 8) {
        return { ok: false, error: `${type} profile requires a non-empty apiKey string` };
      }
      const profile: ProviderProfile = {
        type,
        apiKey: b["apiKey"],
        ...(typeof b["baseUrl"] === "string" ? { baseUrl: b["baseUrl"] } : {}),
        ...(typeof b["defaultModel"] === "string" ? { defaultModel: b["defaultModel"] } : {}),
      };
      return { ok: true, profile };
    }
    default:
      return { ok: false, error: `Unknown profile type: ${String(type)}` };
  }
}

// ============================================================================
// Routes
// ============================================================================

export function credentialsRoutes(options: CredentialsRoutesOptions): FastifyPluginAsync {
  const { profiles } = options;
  return async (server) => {
    /** GET /credentials — list every named profile (apiKey redacted). */
    server.get("/credentials", async () => {
      const list = await profiles.list();
      const items: RedactedProfile[] = Object.entries(list).map(([name, p]) =>
        toRedacted(name, p),
      );
      return { credentials: items };
    });

    /** GET /credentials/:name — fetch a specific profile (apiKey redacted). */
    server.get<{ Params: { name: string } }>("/credentials/:name", async (req, reply) => {
      const { name } = req.params;
      const p = await profiles.get(name);
      if (!p) {
        await reply.code(404).send({ error: `No credentials named "${name}"` });
        return;
      }
      return { credential: toRedacted(name, p) };
    });

    /** PUT /credentials/:name — create or replace a profile. */
    server.put<{ Params: { name: string }; Body: unknown }>(
      "/credentials/:name",
      async (req, reply) => {
        const { name } = req.params;
        if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(name)) {
          await reply.code(400).send({
            error: "Invalid name: use alphanumerics, dot, dash or underscore (max 64 chars)",
          });
          return;
        }
        const validation = validateUpsert(req.body);
        if (!validation.ok) {
          await reply.code(400).send({ error: validation.error });
          return;
        }
        await profiles.upsert(name, validation.profile);
        const stored = await profiles.get(name);
        if (!stored) {
          await reply.code(500).send({ error: "Profile vanished after upsert" });
          return;
        }
        await reply.code(200).send({ credential: toRedacted(name, stored) });
      },
    );

    /** DELETE /credentials/:name — remove a profile. */
    server.delete<{ Params: { name: string } }>(
      "/credentials/:name",
      async (req, reply) => {
        const { name } = req.params;
        const existing = await profiles.get(name);
        if (!existing) {
          await reply.code(404).send({ error: `No credentials named "${name}"` });
          return;
        }
        await profiles.remove(name);
        await reply.code(204).send();
      },
    );
  };
}
