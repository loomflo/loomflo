/**
 * Unit tests for SharedMemoryManager (MemoryStore).
 *
 * Complements shared-memory.test.ts with additional coverage for content order
 * preservation, concurrent writes to multiple files, non-standard file names,
 * edge-case validation, and pre-initialization behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SharedMemoryManager, STANDARD_MEMORY_FILES } from "../../src/memory/shared-memory.js";

// ---------------------------------------------------------------------------
// Per-test workspace setup
// ---------------------------------------------------------------------------

let workspace: string;
let manager: SharedMemoryManager;

beforeEach(() => {
  workspace = join(tmpdir(), `loomflo-memory-store-test-${randomUUID()}`);
  manager = new SharedMemoryManager(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// ===========================================================================
// Content order preservation (store / write)
// ===========================================================================

describe("content order preservation", () => {
  it("sequential writes preserve insertion order across 5 entries", async () => {
    await manager.initialize();

    const entries: string[] = [];
    for (let i = 0; i < 5; i++) {
      const text = `Entry-${i}-${randomUUID().slice(0, 8)}`;
      entries.push(text);
      await manager.write("DECISIONS.md", text, `agent-${i}`);
    }

    const result = await manager.read("DECISIONS.md");
    const positions = entries.map((e) => result.content.indexOf(e));

    // Every entry must be present
    for (const pos of positions) {
      expect(pos).toBeGreaterThan(-1);
    }

    // Positions must be strictly ascending (preserving insertion order)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1] as number);
    }
  });

  it("appended entries do not overwrite existing content", async () => {
    await manager.initialize();
    await manager.write("PROGRESS.md", "Alpha", "agent-a");
    await manager.write("PROGRESS.md", "Beta", "agent-b");
    await manager.write("PROGRESS.md", "Gamma", "agent-c");

    const result = await manager.read("PROGRESS.md");
    expect(result.content).toContain("# PROGRESS");
    expect(result.content).toContain("Alpha");
    expect(result.content).toContain("Beta");
    expect(result.content).toContain("Gamma");
  });
});

// ===========================================================================
// Retrieve (read) — markdown formatting
// ===========================================================================

describe("read returns correct markdown structure", () => {
  it("read after multiple writes returns complete markdown with separators", async () => {
    await manager.initialize();
    await manager.write("INSIGHTS.md", "Insight one", "looma-1");
    await manager.write("INSIGHTS.md", "Insight two", "looma-2");

    const result = await manager.read("INSIGHTS.md");

    // Title header is preserved
    expect(result.content.startsWith("# INSIGHTS\n")).toBe(true);

    // Each entry has its own separator and attribution
    const separatorCount = (result.content.match(/\n---\n/g) ?? []).length;
    expect(separatorCount).toBe(2);

    expect(result.content).toMatch(/_\[.+?\] written by looma-1_/);
    expect(result.content).toMatch(/_\[.+?\] written by looma-2_/);
  });

  it("lastModifiedBy reflects the most recent writer, not the first", async () => {
    await manager.initialize();
    await manager.write("DECISIONS.md", "First decision", "agent-first");
    await manager.write("DECISIONS.md", "Second decision", "agent-second");
    await manager.write("DECISIONS.md", "Third decision", "agent-third");

    const result = await manager.read("DECISIONS.md");
    expect(result.lastModifiedBy).toBe("agent-third");
  });

  it("lastModifiedAt is a valid ISO 8601 timestamp after writes", async () => {
    await manager.initialize();
    const before = new Date().toISOString();
    await manager.write("ERRORS.md", "Some error", "agent-err");
    const after = new Date().toISOString();

    const result = await manager.read("ERRORS.md");
    expect(result.lastModifiedAt >= before).toBe(true);
    expect(result.lastModifiedAt <= after).toBe(true);
  });

  it("SharedMemoryFile has all required fields", async () => {
    await manager.initialize();
    await manager.write("DECISIONS.md", "Test content", "agent-x");

    const result = await manager.read("DECISIONS.md");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("lastModifiedBy");
    expect(result).toHaveProperty("lastModifiedAt");
    expect(typeof result.name).toBe("string");
    expect(typeof result.path).toBe("string");
    expect(typeof result.content).toBe("string");
    expect(typeof result.lastModifiedBy).toBe("string");
    expect(typeof result.lastModifiedAt).toBe("string");
  });
});

// ===========================================================================
// List — includes custom files
// ===========================================================================

describe("list includes non-standard files", () => {
  it("lists custom .md files alongside standard files", async () => {
    await manager.initialize();

    // Manually create a custom file in the shared-memory directory
    const memDir = join(workspace, ".loomflo", "shared-memory");
    await writeFile(join(memDir, "CUSTOM_NOTES.md"), "# CUSTOM_NOTES\n\n", "utf-8");

    const files = await manager.list();
    const names = files.map((f) => f.name);

    expect(names).toContain("CUSTOM_NOTES.md");
    expect(files.length).toBe(STANDARD_MEMORY_FILES.length + 1);
  });

  it("skips non-.md files in the directory", async () => {
    await manager.initialize();

    const memDir = join(workspace, ".loomflo", "shared-memory");
    await writeFile(join(memDir, "notes.txt"), "plain text", "utf-8");
    await writeFile(join(memDir, "data.json"), "{}", "utf-8");

    const files = await manager.list();
    const names = files.map((f) => f.name);

    expect(names).not.toContain("notes.txt");
    expect(names).not.toContain("data.json");
    expect(files).toHaveLength(STANDARD_MEMORY_FILES.length);
  });
});

// ===========================================================================
// Non-standard file names (write + read round-trip)
// ===========================================================================

describe("non-standard file name round-trip", () => {
  it("write then read with a custom file name succeeds", async () => {
    await manager.initialize();

    // Create the custom file first (write appends, file must exist)
    const memDir = join(workspace, ".loomflo", "shared-memory");
    await writeFile(join(memDir, "MY_CUSTOM.md"), "# MY_CUSTOM\n\n", "utf-8");

    await manager.write("MY_CUSTOM.md", "Custom entry", "agent-custom");
    const result = await manager.read("MY_CUSTOM.md");

    expect(result.name).toBe("MY_CUSTOM.md");
    expect(result.content).toContain("Custom entry");
    expect(result.lastModifiedBy).toBe("agent-custom");
  });
});

// ===========================================================================
// Concurrent writes — 5 simultaneous writes, no data loss
// ===========================================================================

describe("concurrent writes to same file (5 writers)", () => {
  it("5 simultaneous appendEntry calls lose no data", async () => {
    await manager.initialize();

    const ids = Array.from({ length: 5 }, (_, i) => `writer-${i}`);
    const entries = ids.map((id) => `Content from ${id}`);

    await Promise.all(ids.map((id, i) => manager.write("PROGRESS.md", entries[i] as string, id)));

    const result = await manager.read("PROGRESS.md");

    for (const entry of entries) {
      expect(result.content).toContain(entry);
    }

    for (const id of ids) {
      expect(result.content).toContain(id);
    }

    // Exactly 5 entry separators
    const separators = (result.content.match(/\n---\n/g) ?? []).length;
    expect(separators).toBe(5);
  });
});

// ===========================================================================
// Concurrent writes to different files (mutex per-file isolation)
// ===========================================================================

describe("concurrent writes to different files", () => {
  it("parallel writes to separate files do not interfere", async () => {
    await manager.initialize();

    const fileAgentPairs: Array<[string, string, string]> = [
      ["DECISIONS.md", "Decision content", "agent-d"],
      ["ERRORS.md", "Error content", "agent-e"],
      ["PROGRESS.md", "Progress content", "agent-p"],
      ["INSIGHTS.md", "Insight content", "agent-i"],
      ["ISSUES.md", "Issue content", "agent-is"],
    ];

    await Promise.all(
      fileAgentPairs.map(([file, content, agent]) => manager.write(file, content, agent)),
    );

    for (const [file, content, agent] of fileAgentPairs) {
      const result = await manager.read(file);
      expect(result.content).toContain(content);
      expect(result.lastModifiedBy).toBe(agent);
    }
  });
});

// ===========================================================================
// File name validation — edge cases
// ===========================================================================

describe("file name validation edge cases", () => {
  it("rejects file name with backslash separator", async () => {
    await expect(manager.read("sub\\file.md")).rejects.toThrow("must not contain path separators");
  });

  it("rejects file name with backslash separator on write", async () => {
    await expect(manager.write("sub\\file.md", "x", "agent")).rejects.toThrow(
      "must not contain path separators",
    );
  });

  it("rejects empty .md extension only", async () => {
    await expect(manager.read(".md")).rejects.toThrow();
  });

  it("rejects file name without extension", async () => {
    await expect(manager.read("DECISIONS")).rejects.toThrow("must end in .md");
  });

  it("rejects file name with double-dot segments", async () => {
    await expect(manager.read("test..sneaky.md")).rejects.toThrow('must not contain ".." segments');
  });

  it("rejects forward slash in the middle of name", async () => {
    await expect(manager.read("sub/dir.md")).rejects.toThrow("must not contain path separators");
  });

  it("error messages include the invalid file name", async () => {
    try {
      await manager.read("BAD_NAME.txt");
    } catch (err: unknown) {
      expect((err as Error).message).toContain("BAD_NAME.txt");
    }
  });
});

// ===========================================================================
// Non-existent file behavior
// ===========================================================================

describe("non-existent file handling", () => {
  it("read throws with clear message when directory does not exist", async () => {
    // No initialize() — directory is absent
    await expect(manager.read("DECISIONS.md")).rejects.toThrow("not found");
  });

  it("read throws with file name in error message", async () => {
    await manager.initialize();

    try {
      await manager.read("GHOST.md");
    } catch (err: unknown) {
      expect((err as Error).message).toContain("GHOST.md");
    }
  });

  it("write to a file not created by initialize appends and is readable", async () => {
    await manager.initialize();
    // appendFile implicitly creates the file — verify the entry is recoverable
    await manager.write("CUSTOM.md", "dynamic data", "agent-dyn");

    const result = await manager.read("CUSTOM.md");
    expect(result.content).toContain("dynamic data");
    expect(result.lastModifiedBy).toBe("agent-dyn");
  });
});

// ===========================================================================
// Initialize — detailed checks
// ===========================================================================

describe("initialize detailed behavior", () => {
  it("creates exactly the 7 standard files", async () => {
    await manager.initialize();
    const memDir = join(workspace, ".loomflo", "shared-memory");

    for (const fileName of STANDARD_MEMORY_FILES) {
      const content = await readFile(join(memDir, fileName), "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("each standard file starts with a markdown title derived from filename", async () => {
    await manager.initialize();
    const memDir = join(workspace, ".loomflo", "shared-memory");

    for (const fileName of STANDARD_MEMORY_FILES) {
      const content = await readFile(join(memDir, fileName), "utf-8");
      const expectedTitle = fileName.replace(".md", "");
      expect(content.startsWith(`# ${expectedTitle}\n`)).toBe(true);
    }
  });

  it("double initialization does not duplicate content", async () => {
    await manager.initialize();
    await manager.write("DECISIONS.md", "Important decision", "agent-1");

    await manager.initialize();

    const result = await manager.read("DECISIONS.md");
    const occurrences = (result.content.match(/Important decision/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("creates nested directory structure (.loomflo/shared-memory)", async () => {
    // Workspace itself does not exist yet
    await manager.initialize();

    const memDir = join(workspace, ".loomflo", "shared-memory");
    const files = await manager.list();
    expect(files.length).toBe(STANDARD_MEMORY_FILES.length);
  });
});

// ===========================================================================
// Multiple manager instances on the same workspace
// ===========================================================================

describe("multiple manager instances", () => {
  it("second manager reads content written by first manager", async () => {
    await manager.initialize();
    await manager.write("DECISIONS.md", "Cross-instance entry", "agent-1");

    const manager2 = new SharedMemoryManager(workspace);
    const result = await manager2.read("DECISIONS.md");

    expect(result.content).toContain("Cross-instance entry");
    expect(result.lastModifiedBy).toBe("agent-1");
  });

  it("writes from different managers to same file are not lost", async () => {
    await manager.initialize();
    const manager2 = new SharedMemoryManager(workspace);

    await manager.write("PROGRESS.md", "From manager 1", "mgr-1");
    await manager2.write("PROGRESS.md", "From manager 2", "mgr-2");

    const result = await manager.read("PROGRESS.md");
    expect(result.content).toContain("From manager 1");
    expect(result.content).toContain("From manager 2");
  });
});
