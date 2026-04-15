/**
 * Unit tests for the isOAuthTokenValid() function from credentials.ts.
 *
 * T4.5 — returns true when token expires in the future (> 5 min buffer)
 * T4.6 — returns false when token is expired
 *
 * NOTE: isOAuthTokenValid() does not yet exist in credentials.ts.
 * These tests will FAIL until T209 is implemented. That is expected (TDD).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises — vi.hoisted ensures the fn is available when vi.mock is hoisted
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn<[string, string], Promise<string>>(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

import { isOAuthTokenValid } from "../../../src/providers/credentials.js";

describe("isOAuthTokenValid", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("T4.5 — returns true when token expires in the future (more than 5 minutes)", async () => {
    const futureExpiry = Date.now() + 2 * 60 * 60 * 1000; // 2 hours from now
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-mock",
          expiresAt: futureExpiry,
        },
      }),
    );
    const valid = await isOAuthTokenValid();
    expect(valid).toBe(true);
  });

  it("T4.6 — returns false when token is expired", async () => {
    const pastExpiry = Date.now() - 60 * 60 * 1000; // 1 hour ago
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-expired",
          expiresAt: pastExpiry,
        },
      }),
    );
    const valid = await isOAuthTokenValid();
    expect(valid).toBe(false);
  });

  it("T4.6b — returns false when credentials file is missing", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    const valid = await isOAuthTokenValid();
    expect(valid).toBe(false);
  });

  it("T4.6c — returns false when expiresAt is within 5 minute buffer", async () => {
    const soonExpiry = Date.now() + 2 * 60 * 1000; // 2 minutes from now (within 5 min buffer)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-soon",
          expiresAt: soonExpiry,
        },
      }),
    );
    const valid = await isOAuthTokenValid();
    expect(valid).toBe(false);
  });
});

// ============================================================================
// resolveOpenAICompatCredentials
// ============================================================================

import { resolveOpenAICompatCredentials } from "../../../src/providers/credentials.js";

describe("resolveOpenAICompatCredentials", () => {
  // T-P3.5
  it("T-P3.5 — MOONSHOT_API_KEY → providerName 'moonshot', correct baseUrl", async () => {
    const result = await resolveOpenAICompatCredentials({
      env: { MOONSHOT_API_KEY: "sk-moonshot-test" },
    });
    expect(result.providerName).toBe("moonshot");
    expect(result.apiKey).toBe("sk-moonshot-test");
    expect(result.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(result.defaultModel).toBe("moonshot-v1-8k");
  });

  // T-P3.6
  it("T-P3.6 — NVIDIA_API_KEY → providerName 'nvidia', correct baseUrl", async () => {
    const result = await resolveOpenAICompatCredentials({
      env: { NVIDIA_API_KEY: "nvapi-test" },
    });
    expect(result.providerName).toBe("nvidia");
    expect(result.apiKey).toBe("nvapi-test");
    expect(result.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(result.defaultModel).toBe("meta/llama-3.1-8b-instruct");
  });

  // T-P3.7
  it("T-P3.7 — No keys set → throws with helpful error", () => {
    expect(() => resolveOpenAICompatCredentials({ env: {} })).toThrow(
      "No OpenAI-compatible credentials found",
    );
  });

  // T-P3.8
  it("T-P3.8 — OPENAI_COMPAT_MODEL overrides defaultModel", async () => {
    const result = await resolveOpenAICompatCredentials({
      env: {
        MOONSHOT_API_KEY: "sk-moonshot-test",
        OPENAI_COMPAT_MODEL: "moonshot-v1-128k",
      },
    });
    expect(result.defaultModel).toBe("moonshot-v1-128k");
  });
});
