import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SharedMemoryManager, STANDARD_MEMORY_FILES } from "../../src/memory/shared-memory.js";

// ---------------------------------------------------------------------------
// Shared workspace setup
// ---------------------------------------------------------------------------

let workspace: string;
let manager: SharedMemoryManager;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "loomflo-shared-memory-test-"));
  manager = new SharedMemoryManager(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ===========================================================================
// Initialization
// ===========================================================================

describe("initialize", () => {
  it("creates the shared-memory directory", async () => {
    await manager.initialize();
    const dirStat = await stat(join(workspace, ".loomflo", "shared-memory"));
    expect(dirStat.isDirectory()).toBe(true);
  });

  it("creates all 7 standard files with title headers", async () => {
    await manager.initialize();
    const memDir = join(workspace, ".loomflo", "shared-memory");

    for (const fileName of STANDARD_MEMORY_FILES) {
      const content = await readFile(join(memDir, fileName), "utf-8");
      const title = fileName.replace(".md", "");
      expect(content).toBe(`# ${title}\n\n`);
    }
  });

  it("is idempotent — does not overwrite existing files", async () => {
    await manager.initialize();
    const memDir = join(workspace, ".loomflo", "shared-memory");

    // Write custom content to one file
    const filePath = join(memDir, "DECISIONS.md");
    await writeFile(filePath, "# DECISIONS\n\nCustom content\n", "utf-8");

    // Re-initialize
    await manager.initialize();

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("# DECISIONS\n\nCustom content\n");
  });

  it("STANDARD_MEMORY_FILES contains exactly 7 entries", () => {
    expect(STANDARD_MEMORY_FILES).toHaveLength(7);
  });
});

// ===========================================================================
// read
// ===========================================================================

describe("read", () => {
  it("returns correct content and metadata for a file", async () => {
    await manager.initialize();
    const result = await manager.read("DECISIONS.md");
    expect(result.name).toBe("DECISIONS.md");
    expect(result.content).toBe("# DECISIONS\n\n");
    expect(result.path).toBe(join(workspace, ".loomflo", "shared-memory", "DECISIONS.md"));
    expect(result.lastModifiedBy).toBe("system");
    expect(result.lastModifiedAt).toBeTruthy();
  });

  it("throws for non-existent file", async () => {
    await manager.initialize();
    await expect(manager.read("NONEXISTENT.md")).rejects.toThrow("not found");
  });

  it("throws for invalid file name (no .md extension)", async () => {
    await expect(manager.read("DECISIONS.txt")).rejects.toThrow("must end in .md");
  });

  it("throws for path traversal (name contains /)", async () => {
    await expect(manager.read("../secret.md")).rejects.toThrow("must not contain path separators");
  });

  it("throws for path traversal (name contains ..)", async () => {
    await expect(manager.read("foo..bar.md")).rejects.toThrow('must not contain ".." segments');
  });

  it("parses lastModifiedBy and lastModifiedAt from entry headers", async () => {
    await manager.initialize();
    await manager.write("DECISIONS.md", "Use TypeScript", "looma-1");

    const result = await manager.read("DECISIONS.md");
    expect(result.lastModifiedBy).toBe("looma-1");
    // lastModifiedAt should be an ISO 8601 timestamp
    expect(new Date(result.lastModifiedAt).toISOString()).toBe(result.lastModifiedAt);
  });
});

// ===========================================================================
// write
// ===========================================================================

describe("write", () => {
  it("appends content with timestamp and agent attribution header", async () => {
    await manager.initialize();
    await manager.write("PROGRESS.md", "Step 1 complete", "looma-2");

    const content = await readFile(
      join(workspace, ".loomflo", "shared-memory", "PROGRESS.md"),
      "utf-8",
    );
    expect(content).toContain("Step 1 complete");
    expect(content).toContain("looma-2");
  });

  it("creates entry with separator (---), timestamp, and agent ID", async () => {
    await manager.initialize();
    await manager.write("ERRORS.md", "Something failed", "looma-3");

    const content = await readFile(
      join(workspace, ".loomflo", "shared-memory", "ERRORS.md"),
      "utf-8",
    );
    expect(content).toContain("---");
    expect(content).toMatch(/_\[.+?\] written by looma-3_/);
    expect(content).toContain("Something failed");
  });

  it("rejects invalid file names", async () => {
    await expect(manager.write("BAD.txt", "content", "agent")).rejects.toThrow("must end in .md");
    await expect(manager.write("../evil.md", "content", "agent")).rejects.toThrow(
      "must not contain path separators",
    );
    await expect(manager.write("a..b.md", "content", "agent")).rejects.toThrow(
      'must not contain ".." segments',
    );
  });

  it("serialized writes: concurrent writes do not corrupt content", async () => {
    await manager.initialize();

    const writes = Array.from({ length: 20 }, (_, i) =>
      manager.write("PROGRESS.md", `Entry ${i}`, `agent-${i}`),
    );
    await Promise.all(writes);

    const content = await readFile(
      join(workspace, ".loomflo", "shared-memory", "PROGRESS.md"),
      "utf-8",
    );

    // All 20 entries must be present
    for (let i = 0; i < 20; i++) {
      expect(content).toContain(`Entry ${i}`);
      expect(content).toContain(`agent-${i}`);
    }

    // Count separators — should have exactly 20
    const separators = content.match(/\n---\n/g);
    expect(separators).toHaveLength(20);
  });
});

// ===========================================================================
// list
// ===========================================================================

describe("list", () => {
  it("returns all files after initialization", async () => {
    await manager.initialize();
    const files = await manager.list();
    expect(files).toHaveLength(7);

    const names = files.map((f) => f.name).sort();
    const expected = [...STANDARD_MEMORY_FILES].sort();
    expect(names).toEqual(expected);
  });

  it("returns empty array when directory does not exist", async () => {
    const files = await manager.list();
    expect(files).toEqual([]);
  });
});

// ===========================================================================
// Standard files
// ===========================================================================

describe("getStandardFiles", () => {
  it("returns a copy of standard files array", () => {
    const files = manager.getStandardFiles();
    expect(files).toEqual([...STANDARD_MEMORY_FILES]);

    // Mutating the returned array should not affect the original
    files.push("EXTRA.md");
    expect(manager.getStandardFiles()).toHaveLength(7);
  });

  it("all 7 standard file names are correct", () => {
    const files = manager.getStandardFiles();
    expect(files).toEqual([
      "DECISIONS.md",
      "ERRORS.md",
      "PROGRESS.md",
      "PREFERENCES.md",
      "ISSUES.md",
      "INSIGHTS.md",
      "ARCHITECTURE_CHANGES.md",
    ]);
  });
});

// ===========================================================================
// Format
// ===========================================================================

describe("entry format", () => {
  it("written entries match expected format: separator + timestamp header + content", async () => {
    await manager.initialize();
    await manager.write("DECISIONS.md", "Chose React", "looma-5");

    const content = await readFile(
      join(workspace, ".loomflo", "shared-memory", "DECISIONS.md"),
      "utf-8",
    );

    // File starts with header, then entry
    expect(content).toMatch(
      /^# DECISIONS\n\n\n---\n_\[\d{4}-\d{2}-\d{2}T.+?\] written by looma-5_\n\nChose React\n$/,
    );
  });

  it("multiple writes produce multiple properly formatted entries", async () => {
    await manager.initialize();
    await manager.write("INSIGHTS.md", "First insight", "agent-a");
    await manager.write("INSIGHTS.md", "Second insight", "agent-b");

    const content = await readFile(
      join(workspace, ".loomflo", "shared-memory", "INSIGHTS.md"),
      "utf-8",
    );

    // Two separator blocks
    const entries = content.split("\n---\n");
    expect(entries).toHaveLength(3); // header + 2 entries

    expect(entries[1]).toMatch(/_\[.+?\] written by agent-a_/);
    expect(entries[1]).toContain("First insight");

    expect(entries[2]).toMatch(/_\[.+?\] written by agent-b_/);
    expect(entries[2]).toContain("Second insight");
  });
});
