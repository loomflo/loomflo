import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import type { PartialConfig, Config } from "../../src/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

/** Minimal fake FSWatcher returned by the mocked `watch`. */
class FakeWatcher extends EventEmitter {
  close = vi.fn();
}

let fakeWatcher: FakeWatcher;

vi.mock("node:fs", () => ({
  watch: vi.fn((_path: string, _cb: unknown) => {
    // `fakeWatcher` is reassigned in beforeEach, but the mock captures
    // the outer variable reference so it always returns the latest instance.
    return fakeWatcher;
  }),
}));

// Import after mocks are set up
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { watch } from "node:fs";
import { ConfigManager, DEFAULT_CONFIG, resolveConfig } from "../../src/config.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockWatch = vi.mocked(watch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mockReadFile to return specific content per file path,
 * and ENOENT for all others.
 */
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

/**
 * Create a ConfigManager and automatically clean it up after the test.
 * Returns the manager instance for assertions.
 */
async function createManager(
  opts: { projectPath?: string; overrides?: PartialConfig } = {},
): Promise<ConfigManager> {
  const mgr = await ConfigManager.create(opts);
  return mgr;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
  fakeWatcher = new FakeWatcher();
  // Re-bind mock implementation so it returns the fresh fakeWatcher
  mockWatch.mockImplementation((_path: unknown, _cb: unknown) => fakeWatcher as never);
  // Default: all file reads return ENOENT
  stubFiles({});
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ===== 3-level config merge =====

describe("ConfigManager 3-level config merge", () => {
  it("merges global + project + overrides in correct precedence order", async () => {
    stubFiles({
      "/mock-home/.loomflo/config.json": JSON.stringify({ provider: "openai", apiRateLimit: 30 }),
      "/project/.loomflo/config.json": JSON.stringify({
        provider: "anthropic",
        dashboardPort: 4000,
      }),
    });

    const mgr = await createManager({
      projectPath: "/project",
      overrides: { apiRateLimit: 120 },
    });
    const cfg = mgr.getConfig();

    // Override wins over global
    expect(cfg.apiRateLimit).toBe(120);
    // Project wins over global
    expect(cfg.provider).toBe("anthropic");
    // Project-specific value preserved
    expect(cfg.dashboardPort).toBe(4000);
    // Defaults still present for untouched fields
    expect(cfg.sandboxCommands).toBe(true);

    mgr.destroy();
  });

  it("applies level preset then layers global and project on top", async () => {
    stubFiles({
      "/mock-home/.loomflo/config.json": JSON.stringify({
        level: 1,
        models: { loomi: "custom-orchestrator" },
      }),
    });

    const mgr = await createManager({ overrides: {} });
    const cfg = mgr.getConfig();

    // Level 1 preset sets reviewerEnabled=false
    expect(cfg.reviewerEnabled).toBe(false);
    // Global override on top of level-1 preset
    expect(cfg.models.loomi).toBe("custom-orchestrator");
    // Rest of level-1 preset preserved
    expect(cfg.models.loom).toBe("claude-sonnet-4-6");

    mgr.destroy();
  });

  it("uses defaults when no config files exist and no overrides given", async () => {
    const mgr = await createManager();
    const cfg = mgr.getConfig();

    // Level 3 is the default; level-3 preset sets all models to opus
    expect(cfg.level).toBe(3);
    expect(cfg.models.loomi).toBe("claude-opus-4-6");
    expect(cfg.provider).toBe("anthropic");

    mgr.destroy();
  });

  it("deep-merges nested models across all three levels", async () => {
    stubFiles({
      "/mock-home/.loomflo/config.json": JSON.stringify({ models: { loom: "global-loom" } }),
      "/project/.loomflo/config.json": JSON.stringify({ models: { loomi: "project-loomi" } }),
    });

    const mgr = await createManager({
      projectPath: "/project",
      overrides: { models: { looma: "override-looma" } } as PartialConfig,
    });
    const cfg = mgr.getConfig();

    expect(cfg.models.loom).toBe("global-loom");
    expect(cfg.models.loomi).toBe("project-loomi");
    expect(cfg.models.looma).toBe("override-looma");
    // loomex falls through to level-3 preset
    expect(cfg.models.loomex).toBe("claude-opus-4-6");

    mgr.destroy();
  });
});

// ===== updateConfig() =====

describe("ConfigManager.updateConfig()", () => {
  it("deep-merges a partial update into the project config layer", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.updateConfig({ apiRateLimit: 200, allowNetwork: true });
    const cfg = mgr.getConfig();

    expect(cfg.apiRateLimit).toBe(200);
    expect(cfg.allowNetwork).toBe(true);
    // Other defaults preserved
    expect(cfg.provider).toBe("anthropic");

    mgr.destroy();
  });

  it("deep-merges nested objects without clobbering sibling keys", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.updateConfig({ models: { loom: "updated-loom" } } as Partial<Config>);
    const cfg = mgr.getConfig();

    expect(cfg.models.loom).toBe("updated-loom");
    // Level-3 preset values for other model keys preserved
    expect(cfg.models.loomi).toBe("claude-opus-4-6");

    mgr.destroy();
  });

  it("persists updated project config to disk", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.updateConfig({ apiRateLimit: 99 });

    // Allow async persist to execute
    await vi.waitFor(() => {
      expect(mockMkdir).toHaveBeenCalledWith("/project/.loomflo", { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/project/.loomflo/config.json",
        expect.stringContaining('"apiRateLimit": 99'),
        "utf-8",
      );
    });

    mgr.destroy();
  });

  it("accumulates successive updates", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.updateConfig({ apiRateLimit: 50 });
    mgr.updateConfig({ dashboardPort: 8080 });
    const cfg = mgr.getConfig();

    expect(cfg.apiRateLimit).toBe(50);
    expect(cfg.dashboardPort).toBe(8080);

    mgr.destroy();
  });

  it("returns the newly resolved config", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    const result = mgr.updateConfig({ provider: "openai" });

    expect(result.provider).toBe("openai");
    expect(result).toBe(mgr.getConfig());

    mgr.destroy();
  });
});

// ===== reload() =====

describe("ConfigManager.reload()", () => {
  it("re-reads global and project config files from disk", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    // Simulate config files appearing on disk after initial creation
    stubFiles({
      "/mock-home/.loomflo/config.json": JSON.stringify({ provider: "openai" }),
      "/project/.loomflo/config.json": JSON.stringify({ dashboardPort: 5000 }),
    });

    const cfg = await mgr.reload();

    expect(cfg.provider).toBe("openai");
    expect(cfg.dashboardPort).toBe(5000);

    mgr.destroy();
  });

  it("re-merges with overrides that still take precedence", async () => {
    const mgr = await createManager({
      projectPath: "/project",
      overrides: { apiRateLimit: 999 },
    });

    stubFiles({
      "/project/.loomflo/config.json": JSON.stringify({ apiRateLimit: 50 }),
    });

    const cfg = await mgr.reload();

    // Override still wins
    expect(cfg.apiRateLimit).toBe(999);

    mgr.destroy();
  });

  it("replaces in-memory project config with fresh disk content", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    // First: set a value via updateConfig
    mgr.updateConfig({ allowNetwork: true });
    expect(mgr.getConfig().allowNetwork).toBe(true);

    // Simulate disk now has a different value (e.g., someone reverted it)
    stubFiles({
      "/project/.loomflo/config.json": JSON.stringify({ allowNetwork: false }),
    });

    const cfg = await mgr.reload();

    expect(cfg.allowNetwork).toBe(false);

    mgr.destroy();
  });

  it("returns the newly resolved config", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    const result = await mgr.reload();

    expect(result).toEqual(mgr.getConfig());

    mgr.destroy();
  });
});

// ===== configChanged event =====

describe("ConfigManager emits configChanged on actual changes", () => {
  it("emits configChanged when updateConfig changes the resolved config", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    const listener = vi.fn();
    mgr.on("configChanged", listener);

    mgr.updateConfig({ apiRateLimit: 200 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ apiRateLimit: 200 }));

    mgr.destroy();
  });

  it("emits configChanged when reload detects a change", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    const listener = vi.fn();
    mgr.on("configChanged", listener);

    stubFiles({
      "/project/.loomflo/config.json": JSON.stringify({ dashboardPort: 9999 }),
    });
    await mgr.reload();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ dashboardPort: 9999 }));

    mgr.destroy();
  });

  it("passes the full resolved config to the event listener", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    let receivedConfig: Config | undefined;
    mgr.on("configChanged", (cfg: Config) => {
      receivedConfig = cfg;
    });

    mgr.updateConfig({ provider: "openai" });

    expect(receivedConfig).toBeDefined();
    expect(receivedConfig!.provider).toBe("openai");
    // Full config, not just the partial
    expect(receivedConfig!.level).toBe(3);
    expect(receivedConfig!.models).toBeDefined();

    mgr.destroy();
  });
});

// ===== No configChanged when values unchanged =====

describe("ConfigManager does NOT emit configChanged when values are unchanged", () => {
  it("does not emit when updateConfig produces the same resolved config", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    const cfg = mgr.getConfig();
    const listener = vi.fn();
    mgr.on("configChanged", listener);

    // Update with the same values that are already resolved
    mgr.updateConfig({ level: cfg.level, provider: cfg.provider });

    expect(listener).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("does not emit when reload produces the same resolved config", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    const listener = vi.fn();
    mgr.on("configChanged", listener);

    // Reload with the same (empty) files — config stays at defaults
    await mgr.reload();

    expect(listener).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("does not emit when update sets a field that overrides already mask", async () => {
    const mgr = await createManager({
      projectPath: "/project",
      overrides: { apiRateLimit: 100 },
    });
    const listener = vi.fn();
    mgr.on("configChanged", listener);

    // Project-level change is masked by override, resolved config unchanged
    mgr.updateConfig({ apiRateLimit: 50 });

    expect(listener).not.toHaveBeenCalled();

    mgr.destroy();
  });
});

// ===== Mid-execution change semantics =====

describe("mid-execution change semantics", () => {
  /**
   * Design contract: config changes apply to the **next node activation only**.
   * The execution engine is responsible for snapshotting config before each
   * node run. ConfigManager's contract is that updateConfig() immediately
   * updates the in-memory config, making changes visible to the next
   * getConfig() call.
   */

  it("updateConfig immediately updates the in-memory config", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    const before = mgr.getConfig();
    expect(before.apiRateLimit).toBe(60); // default via level-3

    mgr.updateConfig({ apiRateLimit: 300 });

    const after = mgr.getConfig();
    expect(after.apiRateLimit).toBe(300);

    mgr.destroy();
  });

  it("successive rapid updates are all reflected in getConfig()", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.updateConfig({ apiRateLimit: 100 });
    mgr.updateConfig({ apiRateLimit: 200 });
    mgr.updateConfig({ apiRateLimit: 300 });

    expect(mgr.getConfig().apiRateLimit).toBe(300);

    mgr.destroy();
  });

  it("getConfig() after update returns a new object (not a stale reference)", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    const snapshot1 = mgr.getConfig();
    mgr.updateConfig({ dashboardPort: 8080 });
    const snapshot2 = mgr.getConfig();

    // The two references must not be the same object — callers who
    // snapshot config before a node run won't see later mutations.
    expect(snapshot1).not.toBe(snapshot2);
    expect(snapshot1.dashboardPort).toBe(3000);
    expect(snapshot2.dashboardPort).toBe(8080);

    mgr.destroy();
  });
});

// ===== destroy() =====

describe("ConfigManager.destroy()", () => {
  it("closes the file watcher", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.destroy();

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  it("removes all event listeners", async () => {
    const mgr = await createManager({ projectPath: "/project" });
    mgr.on("configChanged", vi.fn());
    mgr.on("configChanged", vi.fn());

    mgr.destroy();

    expect(mgr.listenerCount("configChanged")).toBe(0);
  });

  it("is safe to call destroy() multiple times", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    mgr.destroy();
    mgr.destroy();

    // close() only called once because the watcher is nulled on first destroy
    expect(fakeWatcher.close).toHaveBeenCalledTimes(1);
  });

  it("clears pending debounce timers", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const mgr = await createManager({ projectPath: "/project" });

    // Trigger a file change to start a debounce timer
    const watchCallback = mockWatch.mock.calls[0]?.[1] as
      | ((eventType: string, filename: string | null) => void)
      | undefined;
    if (watchCallback) {
      watchCallback("change", "config.json");
    }

    mgr.destroy();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
    mgr.destroy();
  });
});

// ===== Missing project directory =====

describe("ConfigManager handles missing project directory gracefully", () => {
  it("creates successfully without a projectPath", async () => {
    const mgr = await createManager();
    const cfg = mgr.getConfig();

    expect(cfg).toBeDefined();
    expect(cfg.level).toBe(3);

    mgr.destroy();
  });

  it("does not attempt to watch when projectPath is undefined", async () => {
    const mgr = await createManager();

    expect(mockWatch).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("handles watch() throwing when directory does not exist", async () => {
    mockWatch.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    // Should not throw
    const mgr = await createManager({ projectPath: "/nonexistent" });
    const cfg = mgr.getConfig();

    expect(cfg).toBeDefined();
    expect(cfg.level).toBe(3);

    mgr.destroy();
  });

  it("does not persist when projectPath is undefined", async () => {
    const mgr = await createManager();

    mgr.updateConfig({ apiRateLimit: 200 });

    // Give async operations a chance to run
    await new Promise((r) => setTimeout(r, 10));

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it("does not crash when watcher emits an error", async () => {
    const mgr = await createManager({ projectPath: "/project" });

    // Simulate the watcher emitting an error
    fakeWatcher.emit("error", new Error("watcher error"));

    // Manager should still be functional
    const cfg = mgr.getConfig();
    expect(cfg).toBeDefined();

    mgr.destroy();
  });
});
