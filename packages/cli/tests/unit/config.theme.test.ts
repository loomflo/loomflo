import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createConfigCommand } from "../../src/commands/config.js";

// ---------------------------------------------------------------------------
// Mock typecasts
// ---------------------------------------------------------------------------

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let stdoutWrites: string[];

beforeEach(() => {
  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  });

  // Default: empty config (ENOENT for both global and project config files)
  const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  mockReadFile.mockRejectedValue(enoent);
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// config set — themed output
// ===========================================================================

describe("loomflo config set — themed output", () => {
  it("prints check-line with updated confirmation via process.stdout.write", async () => {
    const cmd = createConfigCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "config", "set", "provider", "anthropic", "--global"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("updated");
  });

  it("includes key name in themed output", async () => {
    const cmd = createConfigCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "config", "set", "provider", "anthropic", "--global"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("provider");
  });
});

// ===========================================================================
// config set --json
// ===========================================================================

describe("loomflo config set --json", () => {
  it("prints a JSON record with key and value", async () => {
    const cmd = createConfigCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "config", "set", "provider", "anthropic", "--global", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("key", "provider");
    expect(parsed).toHaveProperty("value", "anthropic");
  });
});

// ===========================================================================
// config (display) — themed output
// ===========================================================================

describe("loomflo config — themed display", () => {
  it("writes merged config through process.stdout.write", async () => {
    const cmd = createConfigCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "config"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    // The merged config should include default provider
    expect(plain).toContain("provider");
    expect(plain).toContain("anthropic");
  });
});

// ===========================================================================
// config --json (display)
// ===========================================================================

describe("loomflo config --json — display", () => {
  it("prints a JSON object with merged config", async () => {
    const cmd = createConfigCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "config", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("provider", "anthropic");
  });
});
