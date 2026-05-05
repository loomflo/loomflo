/**
 * Per-project MCP server config persisted at `<projectPath>/.loomflo/mcp.json`.
 *
 * Used by the dashboard MCP server manager to let users add stdio / sse / http
 * MCP servers that get injected into agent sessions alongside the loomflo
 * built-in MCP server.
 *
 * Atomic JSON writes via temp + rename, mirroring the pattern in
 * persistence/state.ts.
 *
 * @module persistence/mcp-config
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Stdio MCP server entry. */
export interface McpStdioConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

/** Server-Sent Events MCP server entry (remote). */
export interface McpSseConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

/** Streamable HTTP MCP server entry (remote). */
export interface McpHttpConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export type McpServerConfigEntry = McpStdioConfig | McpSseConfig | McpHttpConfig;

interface McpConfigFile {
  version: number;
  servers: Record<string, McpServerConfigEntry>;
}

const FILE_NAME = ".loomflo/mcp.json";
const CURRENT_VERSION = 1;

function pathFor(projectPath: string): string {
  return join(projectPath, FILE_NAME);
}

/** Read the MCP config file for a project. Missing or corrupt → empty. */
export async function readMcpConfig(projectPath: string): Promise<McpConfigFile> {
  const filePath = pathFor(projectPath);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: CURRENT_VERSION, servers: {} };
    }
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "servers" in parsed &&
      typeof (parsed as McpConfigFile).servers === "object"
    ) {
      return {
        version: CURRENT_VERSION,
        servers: (parsed as McpConfigFile).servers,
      };
    }
  } catch {
    /* fall through */
  }
  return { version: CURRENT_VERSION, servers: {} };
}

async function writeMcpConfig(projectPath: string, file: McpConfigFile): Promise<void> {
  const filePath = pathFor(projectPath);
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${String(process.pid)}.${String(Date.now())}`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await rename(tmp, filePath);
}

/** Upsert a single MCP server entry. */
export async function upsertMcpServer(
  projectPath: string,
  name: string,
  entry: McpServerConfigEntry,
): Promise<void> {
  const file = await readMcpConfig(projectPath);
  file.servers[name] = entry;
  await writeMcpConfig(projectPath, file);
}

/** Remove a single MCP server entry. Returns true if it existed. */
export async function removeMcpServer(projectPath: string, name: string): Promise<boolean> {
  const file = await readMcpConfig(projectPath);
  if (!(name in file.servers)) return false;
  const { [name]: _removed, ...rest } = file.servers;
  await writeMcpConfig(projectPath, { ...file, servers: rest });
  return true;
}

/** List the configured MCP servers for a project. */
export async function listMcpServers(
  projectPath: string,
): Promise<Record<string, McpServerConfigEntry>> {
  const file = await readMcpConfig(projectPath);
  return file.servers;
}
