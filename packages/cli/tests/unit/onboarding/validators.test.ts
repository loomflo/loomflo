import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nock from "nock";

import {
  validateAnthropicOauth,
  validateAnthropicApiKey,
  validateOpenAICompat,
} from "../../../src/onboarding/validators.js";

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("validateAnthropicOauth", () => {
  it("returns ok when Claude Code token is valid", async () => {
    vi.doMock("@loomflo/core", async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return {
        ...real,
        isOAuthTokenValid: async () => true,
      };
    });
    const { validateAnthropicOauth: fresh } = await import(
      "../../../src/onboarding/validators.js"
    );
    const res = await fresh();
    expect(res.ok).toBe(true);
  });

  it("returns not-ok with a claude-login hint when missing", async () => {
    vi.doMock("@loomflo/core", async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return {
        ...real,
        isOAuthTokenValid: async () => false,
      };
    });
    const { validateAnthropicOauth: fresh } = await import(
      "../../../src/onboarding/validators.js"
    );
    const res = await fresh();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.hint).toContain("claude login");
    }
  });
});

describe("validateAnthropicApiKey", () => {
  it("returns ok when /v1/messages responds 200", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(200, { id: "msg_probe" });

    const res = await validateAnthropicApiKey("sk-ant-xxx");
    expect(res.ok).toBe(true);
  });

  it("returns not-ok on 401 with the Anthropic error code", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(401, { error: { type: "authentication_error", message: "invalid api key" } });

    const res = await validateAnthropicApiKey("sk-ant-bad");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("invalid");
    }
  });
});

describe("validateOpenAICompat", () => {
  it("returns ok when GET /models responds 200 with data array", async () => {
    nock("https://api.openai.com")
      .get("/v1/models")
      .reply(200, { data: [{ id: "gpt-4o" }] });

    const res = await validateOpenAICompat({
      apiKey: "sk-proj-xxx",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(res.ok).toBe(true);
  });

  it("returns not-ok when base URL is unreachable", async () => {
    nock("https://example.invalid").get("/v1/models").replyWithError("ENOTFOUND");
    const res = await validateOpenAICompat({
      apiKey: "x",
      baseUrl: "https://example.invalid/v1",
    });
    expect(res.ok).toBe(false);
  });
});
