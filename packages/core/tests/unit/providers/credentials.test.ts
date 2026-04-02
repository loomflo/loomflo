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
