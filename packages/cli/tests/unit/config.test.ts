/**
 * Unit tests for packages/cli/src/commands/config.ts — createConfigCommand.
 *
 * Covers config get with empty config (ENOENT), full display, and unknown key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

let mockProcessExit: ReturnType<typeof vi.fn>;
let mockConsoleLog: ReturnType<typeof vi.fn>;
let mockConsoleError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockProcessExit = vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  }) as unknown as ReturnType<typeof vi.fn>;

  mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  // Default: empty config (ENOENT for both global and project config files)
  const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  mockReadFile.mockRejectedValue(enoent);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// config get — empty config defaults
// ===========================================================================

describe("config get — empty config defaults", () => {
  it("should return 'anthropic' for 'config get provider'", async () => {
    await runConfig(["get", "provider"]);

    expect(mockConsoleLog).toHaveBeenCalledWith("anthropic");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it("should return 'claude-opus-4-6' for 'config get models.loom'", async () => {
    await runConfig(["get", "models.loom"]);

    expect(mockConsoleLog).toHaveBeenCalledWith("claude-opus-4-6");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it("should return '0' for 'config get defaultDelay'", async () => {
    await runConfig(["get", "defaultDelay"]);

    expect(mockConsoleLog).toHaveBeenCalledWith("0");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });

  it("should return 'null' for 'config get budgetLimit'", async () => {
    await runConfig(["get", "budgetLimit"]);

    expect(mockConsoleLog).toHaveBeenCalledWith("null");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// config — full display
// ===========================================================================

describe("config — full display on empty config", () => {
  it("should output JSON with provider: anthropic", async () => {
    await runConfig([]);

    expect(mockConsoleLog).toHaveBeenCalledOnce();
    const output = mockConsoleLog.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed["provider"]).toBe("anthropic");
    expect(mockProcessExit).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// config get — unknown key
// ===========================================================================

describe("config get — unknown key", () => {
  it("should print error to stderr for 'config get nonExistentKey'", async () => {
    await expect(runConfig(["get", "nonExistentKey"])).rejects.toThrow("process.exit");

    expect(mockConsoleError).toHaveBeenCalledWith('Error: unknown config key "nonExistentKey"');
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });
});
