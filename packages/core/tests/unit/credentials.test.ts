import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

import {
  resolveCredentials,
  tryResolveCredentials,
  readClaudeCodeCredentials,
} from "../../src/providers/credentials.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temp directory for credential files. */
function makeTempDir(): string {
  return join(tmpdir(), `loomflo-creds-test-${randomBytes(6).toString("hex")}`);
}

/** Write a Claude Code credentials file with the given OAuth data. */
async function writeCredentials(dir: string, oauth: Record<string, unknown>): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, ".credentials.json");
  await writeFile(filePath, JSON.stringify({ claudeAiOauth: oauth }), "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("credentials", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // resolveCredentials
  // =========================================================================

  describe("resolveCredentials", () => {
    it("resolves ANTHROPIC_API_KEY from environment", async () => {
      const result = await resolveCredentials({
        env: { ANTHROPIC_API_KEY: "sk-ant-api-test-key" },
        claudeCredentialsPath: join(tempDir, "nonexistent"),
      });

      expect(result.source).toBe("env:ANTHROPIC_API_KEY");
      expect(result.config.apiKey).toBe("sk-ant-api-test-key");
      expect(result.config.oauthToken).toBeUndefined();
    });

    it("resolves ANTHROPIC_OAUTH_TOKEN from environment", async () => {
      const result = await resolveCredentials({
        env: { ANTHROPIC_OAUTH_TOKEN: "oauth-test-token" },
        claudeCredentialsPath: join(tempDir, "nonexistent"),
      });

      expect(result.source).toBe("env:ANTHROPIC_OAUTH_TOKEN");
      expect(result.config.oauthToken).toBe("oauth-test-token");
      expect(result.config.apiKey).toBeUndefined();
    });

    it("resolves OAuth token from Claude Code credentials file", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "cc-oauth-access-token",
        refreshToken: "cc-oauth-refresh-token",
        expiresAt: Date.now() + 3_600_000, // 1 hour from now
        scopes: ["user:inference", "user:profile"],
      });

      const result = await resolveCredentials({
        env: {},
        claudeCredentialsPath: credPath,
      });

      expect(result.source).toBe("claude-code-oauth");
      const token =
        typeof result.config.oauthToken === "function"
          ? await result.config.oauthToken()
          : result.config.oauthToken;
      expect(token).toBe("cc-oauth-access-token");
      expect(result.config.apiKey).toBeUndefined();
    });

    it("prioritizes ANTHROPIC_API_KEY over ANTHROPIC_OAUTH_TOKEN", async () => {
      const result = await resolveCredentials({
        env: {
          ANTHROPIC_API_KEY: "sk-ant-api-key",
          ANTHROPIC_OAUTH_TOKEN: "oauth-token",
        },
        claudeCredentialsPath: join(tempDir, "nonexistent"),
      });

      expect(result.source).toBe("env:ANTHROPIC_API_KEY");
      expect(result.config.apiKey).toBe("sk-ant-api-key");
    });

    it("prioritizes ANTHROPIC_OAUTH_TOKEN over Claude Code credentials", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "cc-token",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["user:inference"],
      });

      const result = await resolveCredentials({
        env: { ANTHROPIC_OAUTH_TOKEN: "explicit-oauth-token" },
        claudeCredentialsPath: credPath,
      });

      expect(result.source).toBe("env:ANTHROPIC_OAUTH_TOKEN");
      expect(result.config.oauthToken).toBe("explicit-oauth-token");
    });

    it("throws when no credentials are found", async () => {
      await expect(
        resolveCredentials({
          env: {},
          claudeCredentialsPath: join(tempDir, "nonexistent"),
        }),
      ).rejects.toThrow("No Anthropic credentials found");
    });

    it("ignores empty ANTHROPIC_API_KEY", async () => {
      await expect(
        resolveCredentials({
          env: { ANTHROPIC_API_KEY: "" },
          claudeCredentialsPath: join(tempDir, "nonexistent"),
        }),
      ).rejects.toThrow("No Anthropic credentials found");
    });

    it("ignores empty ANTHROPIC_OAUTH_TOKEN", async () => {
      await expect(
        resolveCredentials({
          env: { ANTHROPIC_OAUTH_TOKEN: "" },
          claudeCredentialsPath: join(tempDir, "nonexistent"),
        }),
      ).rejects.toThrow("No Anthropic credentials found");
    });
  });

  // =========================================================================
  // readClaudeCodeCredentials
  // =========================================================================

  describe("readClaudeCodeCredentials", () => {
    it("reads valid credentials with all fields", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["user:inference", "user:profile"],
        subscriptionType: "pro",
        rateLimitTier: "tier3",
      });

      const result = await readClaudeCodeCredentials(credPath);

      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("access-123");
      expect(result!.refreshToken).toBe("refresh-456");
    });

    it("returns null when file does not exist", async () => {
      const result = await readClaudeCodeCredentials(join(tempDir, "missing.json"));
      expect(result).toBeNull();
    });

    it("returns null when file contains invalid JSON", async () => {
      await mkdir(tempDir, { recursive: true });
      const filePath = join(tempDir, "bad.json");
      await writeFile(filePath, "not json!", "utf-8");

      const result = await readClaudeCodeCredentials(filePath);
      expect(result).toBeNull();
    });

    it("returns null when claudeAiOauth is missing", async () => {
      await mkdir(tempDir, { recursive: true });
      const filePath = join(tempDir, "empty.json");
      await writeFile(filePath, JSON.stringify({ someOtherKey: true }), "utf-8");

      const result = await readClaudeCodeCredentials(filePath);
      expect(result).toBeNull();
    });

    it("returns null when accessToken is empty", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["user:inference"],
      });

      const result = await readClaudeCodeCredentials(credPath);
      expect(result).toBeNull();
    });

    it("returns null when token is expired", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "expired-token",
        expiresAt: Date.now() - 1000, // expired 1 second ago
        scopes: ["user:inference"],
      });

      const result = await readClaudeCodeCredentials(credPath);
      expect(result).toBeNull();
    });

    it("returns null when scopes do not include user:inference", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "no-inference-token",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["user:profile"],
      });

      const result = await readClaudeCodeCredentials(credPath);
      expect(result).toBeNull();
    });

    it("accepts token without expiresAt (non-expiring token)", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "no-expiry-token",
        scopes: ["user:inference"],
      });

      const result = await readClaudeCodeCredentials(credPath);
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("no-expiry-token");
    });

    it("accepts token without scopes (no scope enforcement)", async () => {
      const credPath = await writeCredentials(tempDir, {
        accessToken: "no-scopes-token",
        expiresAt: Date.now() + 3_600_000,
      });

      const result = await readClaudeCodeCredentials(credPath);
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe("no-scopes-token");
    });
  });

  // =========================================================================
  // tryResolveCredentials
  // =========================================================================

  describe("tryResolveCredentials", () => {
    it("returns credentials when available", async () => {
      const result = await tryResolveCredentials({
        env: { ANTHROPIC_API_KEY: "test-key" },
        claudeCredentialsPath: join(tempDir, "nonexistent"),
      });

      expect(result).not.toBeNull();
      expect(result!.source).toBe("env:ANTHROPIC_API_KEY");
    });

    it("returns null when no credentials found (does not throw)", async () => {
      const result = await tryResolveCredentials({
        env: {},
        claudeCredentialsPath: join(tempDir, "nonexistent"),
      });

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Integration: credential -> AnthropicProvider
  // =========================================================================

  describe("integration with ProviderConfigSchema", () => {
    it("resolved API key config passes ProviderConfigSchema validation", async () => {
      const { ProviderConfigSchema } = await import("../../src/providers/base.js");

      const resolved = await resolveCredentials({
        env: { ANTHROPIC_API_KEY: "sk-ant-api-test" },
        claudeCredentialsPath: join(tempDir, "nonexistent"),
      });

      const result = ProviderConfigSchema.safeParse(resolved.config);
      expect(result.success).toBe(true);
    });

    it("resolved OAuth config passes ProviderConfigSchema validation", async () => {
      const { ProviderConfigSchema } = await import("../../src/providers/base.js");

      const credPath = await writeCredentials(tempDir, {
        accessToken: "cc-token",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["user:inference"],
      });

      const resolved = await resolveCredentials({
        env: {},
        claudeCredentialsPath: credPath,
      });

      const result = ProviderConfigSchema.safeParse(resolved.config);
      expect(result.success).toBe(true);
    });
  });
});
