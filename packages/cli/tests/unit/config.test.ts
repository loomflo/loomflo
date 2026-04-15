/**
 * Unit tests for packages/cli/src/commands/config.ts — createConfigCommand.
 *
 * Covers config get with empty config (ENOENT), full display, and unknown key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { createConfigCommand } from "../../src/commands/config.js";

// ---------------------------------------------------------------------------
// Mock typecasts
// ---------------------------------------------------------------------------

const mockReadFile = readFile as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run the config command with the given CLI arguments.
 *
 * @param args - Arguments to pass after `node config`.
 * @returns A promise that resolves or rejects based on command execution.
 */
async function runConfig(args: string[]): Promise<void> {
  const cmd = createConfigCommand();
  cmd.exitOverride();
  await cmd.parseAsync(["node", "config", ...args]);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let stdoutWrites: string[];
let stderrWrites: string[];

beforeEach(() => {
  stdoutWrites = [];
  stderrWrites = [];

  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });

  vi.spyOn(process.stderr, "write").mockImplementation((c) => {
    stderrWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });

  // Default: empty config (ENOENT for both global and project config files)
  const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  mockReadFile.mockRejectedValue(enoent);
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// ===========================================================================
// config get — empty config defaults
// ===========================================================================

describe("config get — empty config defaults", () => {
  it("should return 'anthropic' for 'config get provider'", async () => {
    await runConfig(["get", "provider"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("provider");
    expect(plain).toContain("anthropic");
    expect(process.exitCode).toBeUndefined();
  });

  it("should return 'claude-opus-4-6' for 'config get models.loom'", async () => {
    await runConfig(["get", "models.loom"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("models.loom");
    expect(plain).toContain("claude-opus-4-6");
    expect(process.exitCode).toBeUndefined();
  });

  it("should return '0' for 'config get defaultDelay'", async () => {
    await runConfig(["get", "defaultDelay"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("defaultDelay");
    expect(plain).toContain("0");
    expect(process.exitCode).toBeUndefined();
  });

  it("should return 'null' for 'config get budgetLimit'", async () => {
    await runConfig(["get", "budgetLimit"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("budgetLimit");
    expect(plain).toContain("null");
    expect(process.exitCode).toBeUndefined();
  });
});

// ===========================================================================
// config — full display
// ===========================================================================

describe("config — full display on empty config", () => {
  it("should output heading and kv pairs with provider: anthropic", async () => {
    await runConfig([]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("Configuration");
    expect(plain).toContain("provider");
    expect(plain).toContain("anthropic");
    expect(process.exitCode).toBeUndefined();
  });
});

// ===========================================================================
// config get — unknown key
// ===========================================================================

describe("config get — unknown key", () => {
  it("should write error to stderr for 'config get nonExistentKey'", async () => {
    await runConfig(["get", "nonExistentKey"]);

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain('unknown config key "nonExistentKey"');
    expect(process.exitCode).toBe(1);
  });
});
