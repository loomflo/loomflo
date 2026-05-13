/**
 * Unit tests for /credentials routes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialsRoutes } from "../../src/api/routes/credentials.js";
import { ProviderProfiles } from "../../src/providers/profiles.js";

let workDir: string;
let credPath: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "loomflo-creds-"));
  credPath = join(workDir, "credentials.json");
  app = Fastify();
  await app.register(credentialsRoutes({ profiles: new ProviderProfiles(credPath) }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(workDir, { recursive: true, force: true });
});

describe("GET /credentials", () => {
  it("returns an empty list when no credentials are stored", async () => {
    const res = await app.inject({ method: "GET", url: "/credentials" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ credentials: [] });
  });

  it("redacts apiKey values", async () => {
    await app.inject({
      method: "PUT",
      url: "/credentials/work",
      payload: { type: "anthropic", apiKey: "sk-ant-supersecretkey123" },
    });
    const res = await app.inject({ method: "GET", url: "/credentials" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { credentials: Array<{ apiKeyPreview?: string }> };
    expect(body.credentials[0]?.apiKeyPreview).toBe("***y123");
  });
});

describe("PUT /credentials/:name", () => {
  it("creates a new anthropic profile", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/credentials/personal",
      payload: { type: "anthropic", apiKey: "sk-ant-12345678" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { credential: { name: string; type: string } };
    expect(body.credential.name).toBe("personal");
    expect(body.credential.type).toBe("anthropic");
  });

  it("creates an openai profile with optional fields", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/credentials/work",
      payload: {
        type: "openai",
        apiKey: "sk-12345678",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      credential: { type: string; baseUrl?: string; defaultModel?: string };
    };
    expect(body.credential.baseUrl).toBe("https://api.openai.com/v1");
    expect(body.credential.defaultModel).toBe("gpt-4o");
  });

  it("creates an anthropic-oauth profile with no apiKey", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/credentials/oauth",
      payload: { type: "anthropic-oauth" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an unknown profile type", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/credentials/x",
      payload: { type: "totally-unknown" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing apiKey for an api-key type", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/credentials/x",
      payload: { type: "anthropic" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid name (special chars)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/credentials/with%20space",
      payload: { type: "anthropic", apiKey: "sk-1234567890" },
    });
    // Either 400 from our validator or 404/400 from Fastify routing — both acceptable.
    expect([400, 404]).toContain(res.statusCode);
  });
});

describe("GET /credentials/:name", () => {
  it("returns 404 for an unknown name", async () => {
    const res = await app.inject({ method: "GET", url: "/credentials/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("returns the profile after a put", async () => {
    await app.inject({
      method: "PUT",
      url: "/credentials/x",
      payload: { type: "anthropic", apiKey: "sk-ant-abcdefgh" },
    });
    const res = await app.inject({ method: "GET", url: "/credentials/x" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { credential: { type: string; apiKeyPreview?: string } };
    expect(body.credential.type).toBe("anthropic");
    expect(body.credential.apiKeyPreview).toBe("***efgh");
  });
});

describe("DELETE /credentials/:name", () => {
  it("returns 204 after deletion", async () => {
    await app.inject({
      method: "PUT",
      url: "/credentials/tmp",
      payload: { type: "anthropic", apiKey: "sk-ant-12345678" },
    });
    const del = await app.inject({ method: "DELETE", url: "/credentials/tmp" });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: "/credentials/tmp" });
    expect(get.statusCode).toBe(404);
  });

  it("returns 404 when the profile doesn't exist", async () => {
    const del = await app.inject({ method: "DELETE", url: "/credentials/nope" });
    expect(del.statusCode).toBe(404);
  });
});
