/**
 * Unit tests for the per-project MCP config persistence layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listMcpServers,
  readMcpConfig,
  removeMcpServer,
  upsertMcpServer,
} from "../../src/persistence/mcp-config.js";

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), "loomflo-mcp-cfg-"));
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true });
});

describe("readMcpConfig", () => {
  it("returns empty config when the file does not exist", async () => {
    const cfg = await readMcpConfig(projectPath);
    expect(cfg.version).toBe(1);
    expect(cfg.servers).toEqual({});
  });

  it("recovers gracefully from a corrupt file", async () => {
    await upsertMcpServer(projectPath, "valid", {
      type: "stdio",
      command: "echo",
      enabled: true,
    });
    // Corrupt the file
    const path = join(projectPath, ".loomflo/mcp.json");
    await readFile(path, "utf-8");
    await (await import("node:fs/promises")).writeFile(path, "{ not json", "utf-8");
    const cfg = await readMcpConfig(projectPath);
    expect(cfg.servers).toEqual({});
  });
});

describe("upsertMcpServer", () => {
  it("creates a stdio entry", async () => {
    await upsertMcpServer(projectPath, "filesystem", {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      enabled: true,
    });
    const cfg = await readMcpConfig(projectPath);
    expect(cfg.servers["filesystem"]?.type).toBe("stdio");
    if (cfg.servers["filesystem"]?.type === "stdio") {
      expect(cfg.servers["filesystem"].command).toBe("npx");
      expect(cfg.servers["filesystem"].args).toEqual([
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/tmp",
      ]);
    }
  });

  it("creates an http entry", async () => {
    await upsertMcpServer(projectPath, "remote", {
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer xxx" },
      enabled: true,
    });
    const cfg = await readMcpConfig(projectPath);
    expect(cfg.servers["remote"]?.type).toBe("http");
  });

  it("replaces an existing entry on second upsert", async () => {
    await upsertMcpServer(projectPath, "x", {
      type: "stdio",
      command: "first",
      enabled: true,
    });
    await upsertMcpServer(projectPath, "x", {
      type: "stdio",
      command: "second",
      enabled: false,
    });
    const cfg = await readMcpConfig(projectPath);
    if (cfg.servers["x"]?.type === "stdio") {
      expect(cfg.servers["x"].command).toBe("second");
      expect(cfg.servers["x"].enabled).toBe(false);
    } else {
      throw new Error("expected stdio entry");
    }
  });
});

describe("removeMcpServer", () => {
  it("returns true when an entry was removed", async () => {
    await upsertMcpServer(projectPath, "x", {
      type: "stdio",
      command: "echo",
      enabled: true,
    });
    const removed = await removeMcpServer(projectPath, "x");
    expect(removed).toBe(true);
    const cfg = await readMcpConfig(projectPath);
    expect(cfg.servers["x"]).toBeUndefined();
  });

  it("returns false when nothing to remove", async () => {
    const removed = await removeMcpServer(projectPath, "missing");
    expect(removed).toBe(false);
  });
});

describe("listMcpServers", () => {
  it("returns all servers across multiple upserts", async () => {
    await upsertMcpServer(projectPath, "a", { type: "stdio", command: "x", enabled: true });
    await upsertMcpServer(projectPath, "b", { type: "sse", url: "https://x.example", enabled: true });
    const servers = await listMcpServers(projectPath);
    expect(Object.keys(servers).sort()).toEqual(["a", "b"]);
  });
});
