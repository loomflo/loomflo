import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Mocks (for loadConfigFile / resolveConfig tests that need FS mocking)
// ---------------------------------------------------------------------------

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:os");
  return {
    ...actual,
    homedir: vi.fn(() => "/mock-home"),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
  };
});

vi.mock("node:fs", () => ({
  watch: vi.fn(() => {
    const { EventEmitter } = require("node:events") as typeof import("node:events");
    const w = new EventEmitter();
    (w as EventEmitter & { close: () => void }).close = vi.fn();
    return w;
  }),
}));

import { readFile } from "node:fs/promises";
import {
  ConfigSchema,
  PartialConfigSchema,
  DEFAULT_CONFIG,
  deepMerge,
  loadConfigFile,
  resolveConfig,
} from "../../src/config.js";
import type { PartialConfig, Config } from "../../src/config.js";

const mockReadFile = vi.mocked(readFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Configure mockReadFile to return content per path, ENOENT for others. */
function stubFiles(files: Record<string, string>): void {
  mockReadFile.mockImplementation(async (path: Parameters<typeof readFile>[0]) => {
    const p = typeof path === "string" ? path : String(path);
    if (p in files) {
      return files[p];
    }
    const err = new Error(`ENOENT: no such file: ${p}`) as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  stubFiles({});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Extended edge-case tests for config.ts covering validation error messages,
 * zero/negative boundary values, unknown fields, environment variable overrides,
 * CLI overrides via resolveConfig, and 3-level merge completeness.
 */
describe("ConfigSchema edge-case validation", () => {
  describe("invalid types produce error messages containing the field name", () => {
    it("rejects agentTokenLimit: 'not-a-number' with field path in error", () => {
      const result = ConfigSchema.safeParse({ agentTokenLimit: "not-a-number" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = result.error.message;
        expect(message).toContain("agentTokenLimit");
      }
    });

    it("rejects maxRetriesPerNode: true with field path in error", () => {
      const result = ConfigSchema.safeParse({ maxRetriesPerNode: true });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("maxRetriesPerNode");
      }
    });

    it("rejects budgetLimit: 'unlimited' with field path in error", () => {
      const result = ConfigSchema.safeParse({ budgetLimit: "unlimited" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("budgetLimit");
      }
    });

    it("rejects models: 'all-opus' (string instead of object) with field path in error", () => {
      const result = ConfigSchema.safeParse({ models: "all-opus" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("models");
      }
    });

    it("rejects dashboardPort: [] (array instead of number) with field path in error", () => {
      const result = ConfigSchema.safeParse({ dashboardPort: [3000] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("dashboardPort");
      }
    });
  });

  describe("negative value rejection", () => {
    it("rejects negative budgetLimit", () => {
      const result = ConfigSchema.safeParse({ budgetLimit: -10 });
      expect(result.success).toBe(false);
    });

    it("rejects negative maxRetriesPerTask", () => {
      const result = ConfigSchema.safeParse({ maxRetriesPerTask: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects negative apiRateLimit", () => {
      const result = ConfigSchema.safeParse({ apiRateLimit: -5 });
      expect(result.success).toBe(false);
    });

    it("rejects negative agentTokenLimit", () => {
      const result = ConfigSchema.safeParse({ agentTokenLimit: -1000 });
      expect(result.success).toBe(false);
    });
  });

  describe("zero value boundaries", () => {
    it("rejects agentTokenLimit: 0 (requires positive)", () => {
      const result = ConfigSchema.safeParse({ agentTokenLimit: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects apiRateLimit: 0 (requires positive)", () => {
      const result = ConfigSchema.safeParse({ apiRateLimit: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects agentTimeout: 0 (requires positive)", () => {
      const result = ConfigSchema.safeParse({ agentTimeout: 0 });
      expect(result.success).toBe(false);
    });

    it("accepts budgetLimit: 0 (nonnegative allows zero)", () => {
      const result = ConfigSchema.safeParse({ budgetLimit: 0 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.budgetLimit).toBe(0);
      }
    });

    it("accepts maxRetriesPerNode: 0 (nonnegative allows zero)", () => {
      const result = ConfigSchema.safeParse({ maxRetriesPerNode: 0 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxRetriesPerNode).toBe(0);
      }
    });

    it("accepts maxRetriesPerTask: 0 (nonnegative allows zero)", () => {
      const result = ConfigSchema.safeParse({ maxRetriesPerTask: 0 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxRetriesPerTask).toBe(0);
      }
    });
  });

  describe("floating-point where integer is required", () => {
    it("rejects maxRetriesPerNode: 2.5 (requires int)", () => {
      const result = ConfigSchema.safeParse({ maxRetriesPerNode: 2.5 });
      expect(result.success).toBe(false);
    });

    it("rejects dashboardPort: 3000.7 (requires int)", () => {
      const result = ConfigSchema.safeParse({ dashboardPort: 3000.7 });
      expect(result.success).toBe(false);
    });

    it("rejects agentTimeout: 100.5 (requires int)", () => {
      const result = ConfigSchema.safeParse({ agentTimeout: 100.5 });
      expect(result.success).toBe(false);
    });

    it("accepts budgetLimit: 10.5 (no int constraint)", () => {
      const result = ConfigSchema.safeParse({ budgetLimit: 10.5 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.budgetLimit).toBe(10.5);
      }
    });
  });

  describe("unknown fields handling", () => {
    it("strips unknown top-level fields in ConfigSchema (default zod strip mode)", () => {
      const result = ConfigSchema.safeParse({
        unknownField: "should-be-stripped",
        anotherExtra: 42,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("unknownField" in result.data).toBe(false);
        expect("anotherExtra" in result.data).toBe(false);
      }
    });

    it("strips unknown nested fields inside models", () => {
      const result = ConfigSchema.safeParse({
        models: {
          loom: "test-model",
          unknownAgent: "should-be-stripped",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("unknownAgent" in result.data.models).toBe(false);
        expect(result.data.models.loom).toBe("test-model");
      }
    });

    it("rejects unknown fields with strict parsing", () => {
      const result = ConfigSchema.strict().safeParse({
        unknownField: "not-allowed",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("PartialConfigSchema validation", () => {
  it("accepts an empty object", () => {
    const result = PartialConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a single optional field", () => {
    const result = PartialConfigSchema.safeParse({ provider: "openai" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("openai");
    }
  });

  it("rejects invalid value types in partial config", () => {
    const result = PartialConfigSchema.safeParse({ dashboardPort: "not-a-port" });
    expect(result.success).toBe(false);
  });

  it("does not inject defaults for missing fields", () => {
    const result = PartialConfigSchema.safeParse({ provider: "openai" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBeUndefined();
      expect(result.data.budgetLimit).toBeUndefined();
      expect(result.data.models).toBeUndefined();
    }
  });
});

describe("missing optional fields - defaults applied", () => {
  it("config with only level produces all other fields from defaults + preset", () => {
    const result = ConfigSchema.parse({ level: 2 });
    expect(result.level).toBe(2);
    expect(result.defaultDelay).toBe("0");
    expect(result.reviewerEnabled).toBe(true);
    expect(result.maxRetriesPerNode).toBe(3);
    expect(result.maxRetriesPerTask).toBe(2);
    expect(result.maxLoomasPerLoomi).toBeNull();
    expect(result.retryStrategy).toBe("adaptive");
    expect(result.models).toBeDefined();
    expect(result.provider).toBe("anthropic");
    expect(result.budgetLimit).toBeNull();
    expect(result.pauseOnBudgetReached).toBe(true);
    expect(result.sandboxCommands).toBe(true);
    expect(result.allowNetwork).toBe(false);
    expect(result.dashboardPort).toBe(3000);
    expect(result.dashboardAutoOpen).toBe(true);
    expect(result.agentTimeout).toBe(600_000);
    expect(result.agentTokenLimit).toBe(100_000);
    expect(result.apiRateLimit).toBe(60);
  });

  it("config with only provider produces defaults for everything else", () => {
    const result = ConfigSchema.parse({ provider: "openai" });
    expect(result.provider).toBe("openai");
    expect(result.level).toBe(3);
    expect(result.dashboardPort).toBe(3000);
    expect(result.agentTimeout).toBe(600_000);
  });
});

describe("deepMerge extended edge cases", () => {
  it("replaces arrays entirely, does not concatenate", () => {
    const target = { tags: ["a", "b", "c"], nested: { list: [1, 2] } };
    const source = { tags: ["x"], nested: { list: [9, 8, 7] } };
    const result = deepMerge(target, source);
    expect(result.tags).toEqual(["x"]);
    expect(result.nested.list).toEqual([9, 8, 7]);
  });

  it("replaces an empty array with a populated array", () => {
    const result = deepMerge({ items: [] as number[] }, { items: [1, 2, 3] });
    expect(result.items).toEqual([1, 2, 3]);
  });

  it("replaces a populated array with an empty array", () => {
    const result = deepMerge({ items: [1, 2, 3] }, { items: [] as number[] });
    expect(result.items).toEqual([]);
  });

  it("handles three-level deep nesting", () => {
    const target = { a: { b: { c: 1, d: 2 }, e: 3 } };
    const source = { a: { b: { c: 10 } } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: { b: { c: 10, d: 2 }, e: 3 } });
  });

  it("source object with nested null replaces nested object", () => {
    const target = { nested: { deep: { value: 42 } } };
    const source = { nested: { deep: null } };
    const result = deepMerge(
      target as Record<string, unknown>,
      source as Partial<Record<string, unknown>>,
    );
    expect(result.nested).toEqual({ deep: null });
  });

  it("overwrites a primitive with a nested object from source", () => {
    const target = { value: 42 };
    const source = { value: { nested: true } };
    const result = deepMerge(
      target as Record<string, unknown>,
      source as Partial<Record<string, unknown>>,
    );
    expect(result.value).toEqual({ nested: true });
  });

  it("does not treat arrays as plain objects to recurse into", () => {
    const target = { data: [{ id: 1 }, { id: 2 }] };
    const source = { data: [{ id: 3 }] };
    const result = deepMerge(target, source);
    // Arrays are replaced, not recursively merged element-by-element
    expect(result.data).toEqual([{ id: 3 }]);
    expect(result.data).toHaveLength(1);
  });
});

describe("loadConfigFile extended edge cases", () => {
  it("returns raw parsed JSON, preserving only explicit keys", async () => {
    stubFiles({
      "/partial.json": JSON.stringify({ provider: "openai" }),
    });
    const result = await loadConfigFile("/partial.json");
    // Should not inject zod defaults for models, level, etc.
    expect(result).toEqual({ provider: "openai" });
    expect("level" in result).toBe(false);
    expect("models" in result).toBe(false);
  });

  it("validates and rejects a config where agentTokenLimit is zero", async () => {
    stubFiles({
      "/zero.json": JSON.stringify({ agentTokenLimit: 0 }),
    });
    await expect(loadConfigFile("/zero.json")).rejects.toThrow("Invalid config");
  });

  it("validates and rejects a config with negative budgetLimit", async () => {
    stubFiles({
      "/neg.json": JSON.stringify({ budgetLimit: -5 }),
    });
    await expect(loadConfigFile("/neg.json")).rejects.toThrow("Invalid config");
  });

  it("accepts a config with budgetLimit: 0", async () => {
    stubFiles({
      "/zero-budget.json": JSON.stringify({ budgetLimit: 0 }),
    });
    const result = await loadConfigFile("/zero-budget.json");
    expect(result.budgetLimit).toBe(0);
  });

  it("accepts empty JSON object", async () => {
    stubFiles({
      "/empty.json": JSON.stringify({}),
    });
    const result = await loadConfigFile("/empty.json");
    expect(result).toEqual({});
  });
});

describe("resolveConfig - direct 3-level merge", () => {
  it("CLI overrides take precedence over project which takes precedence over global", () => {
    const global: PartialConfig = { provider: "openai", apiRateLimit: 30, dashboardPort: 4000 };
    const project: PartialConfig = { provider: "anthropic", dashboardPort: 5000 };
    const cli: PartialConfig = { dashboardPort: 8080 };

    const config = resolveConfig(global, project, cli);

    // CLI wins for dashboardPort
    expect(config.dashboardPort).toBe(8080);
    // Project wins for provider (over global)
    expect(config.provider).toBe("anthropic");
    // Global wins for apiRateLimit (no project/cli override)
    expect(config.apiRateLimit).toBe(30);
    // Default wins for agentTimeout (not set anywhere)
    expect(config.agentTimeout).toBe(600_000);
  });

  it("all three levels contribute different fields to the final result", () => {
    const global: PartialConfig = { allowNetwork: true };
    const project: PartialConfig = { sandboxCommands: false };
    const cli: PartialConfig = { dashboardAutoOpen: false };

    const config = resolveConfig(global, project, cli);

    expect(config.allowNetwork).toBe(true);
    expect(config.sandboxCommands).toBe(false);
    expect(config.dashboardAutoOpen).toBe(false);
    // Remaining fields still at defaults
    expect(config.provider).toBe("anthropic");
    expect(config.level).toBe(3);
  });

  it("nested models merge across all three levels", () => {
    const global: PartialConfig = { models: { loom: "global-loom" } } as PartialConfig;
    const project: PartialConfig = { models: { loomi: "project-loomi" } } as PartialConfig;
    const cli: PartialConfig = { models: { looma: "cli-looma" } } as PartialConfig;

    const config = resolveConfig(global, project, cli);

    expect(config.models.loom).toBe("global-loom");
    expect(config.models.loomi).toBe("project-loomi");
    expect(config.models.looma).toBe("cli-looma");
    // loomex falls through to level-3 preset
    expect(config.models.loomex).toBe("claude-opus-4-6");
  });

  it("level from CLI overrides level from project", () => {
    const global: PartialConfig = {};
    const project: PartialConfig = { level: 1 };
    const cli: PartialConfig = { level: 3 };

    const config = resolveConfig(global, project, cli);

    // Level 3 preset applied, not level 1
    expect(config.level).toBe(3);
    expect(config.models.loom).toBe("claude-opus-4-6");
  });

  it("level from global is used when project and CLI do not set it", () => {
    const global: PartialConfig = { level: 2 };
    const project: PartialConfig = {};
    const cli: PartialConfig = {};

    const config = resolveConfig(global, project, cli);

    expect(config.level).toBe(2);
    // Level 2 preset values
    expect(config.maxLoomasPerLoomi).toBe(2);
  });

  it("explicit project values override level preset values", () => {
    const global: PartialConfig = {};
    const project: PartialConfig = { level: 1, reviewerEnabled: true };
    const cli: PartialConfig = {};

    const config = resolveConfig(global, project, cli);

    // Level 1 preset sets reviewerEnabled=false, but project explicitly overrides
    expect(config.level).toBe(1);
    expect(config.reviewerEnabled).toBe(true);
  });

  it("resolveConfig with all empty layers returns defaults with level-3 preset", () => {
    const config = resolveConfig({}, {}, {});

    expect(config.level).toBe(3);
    expect(config.models.loom).toBe("claude-opus-4-6");
    expect(config.models.loomi).toBe("claude-opus-4-6");
    expect(config.provider).toBe("anthropic");
    expect(config.apiRateLimit).toBe(60);
  });

  it("resolveConfig throws on invalid merged result", () => {
    const global: PartialConfig = {};
    const project: PartialConfig = {};
    // Force an invalid value that passes PartialConfig but fails final validation
    const cli = { dashboardPort: 0 } as PartialConfig;

    expect(() => resolveConfig(global, project, cli)).toThrow();
  });
});

describe("environment variable override", () => {
  it.skip("LOOMFLO_MAX_TOKENS env var override is not implemented - config.ts does not read env vars", () => {
    // config.ts does not support environment variable injection.
    // Configuration is loaded exclusively from JSON files and programmatic overrides.
    // If env var support is added in the future, tests should verify:
    // - LOOMFLO_AGENT_TOKEN_LIMIT overrides agentTokenLimit
    // - LOOMFLO_API_RATE_LIMIT overrides apiRateLimit
    // - LOOMFLO_BUDGET_LIMIT overrides budgetLimit
    // - Env vars are applied between project config and CLI overrides in precedence
  });
});

describe("ConfigSchema boundary values", () => {
  it("accepts dashboardPort at minimum boundary (1)", () => {
    const result = ConfigSchema.safeParse({ dashboardPort: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dashboardPort).toBe(1);
    }
  });

  it("accepts dashboardPort at maximum boundary (65535)", () => {
    const result = ConfigSchema.safeParse({ dashboardPort: 65535 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dashboardPort).toBe(65535);
    }
  });

  it("accepts agentTokenLimit: 1 (minimum positive int)", () => {
    const result = ConfigSchema.safeParse({ agentTokenLimit: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentTokenLimit).toBe(1);
    }
  });

  it("accepts apiRateLimit: 1 (minimum positive int)", () => {
    const result = ConfigSchema.safeParse({ apiRateLimit: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiRateLimit).toBe(1);
    }
  });

  it("accepts maxLoomasPerLoomi: null (unlimited)", () => {
    const result = ConfigSchema.safeParse({ maxLoomasPerLoomi: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxLoomasPerLoomi).toBeNull();
    }
  });

  it("rejects maxLoomasPerLoomi: 0 (requires positive when set)", () => {
    const result = ConfigSchema.safeParse({ maxLoomasPerLoomi: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects maxLoomasPerLoomi: -1 (requires positive when set)", () => {
    const result = ConfigSchema.safeParse({ maxLoomasPerLoomi: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts budgetLimit: null (no limit)", () => {
    const result = ConfigSchema.safeParse({ budgetLimit: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgetLimit).toBeNull();
    }
  });
});
