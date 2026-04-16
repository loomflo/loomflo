import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({
    port: 41234,
    token: "t",
    pid: 99,
    version: "0.3.0",
  }),
  getRunningDaemon: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { createStartCommand } from "../../src/commands/start.js";
import { ensureDaemonRunning } from "../../src/daemon-control.js";

let tmp: string;
let stdoutWrites: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "loomflo-start-theme-"));
  // Create project.json so start doesn't delegate to init.
  await mkdir(join(tmp, ".loomflo"), { recursive: true });
  await writeFile(
    join(tmp, ".loomflo", "project.json"),
    JSON.stringify({ id: "proj_test1234", name: "test", providerProfileId: "default", createdAt: "2026-04-15T00:00:00Z" }),
  );

  (ensureDaemonRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    port: 41234,
    token: "t",
    pid: 99,
    version: "0.3.0",
  });

  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/projects/") && (!init || !init.method || init.method === "GET")) {
      return { ok: false, status: 404, json: async () => null };
    }
    if (u.includes("/projects") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "proj_test1234", status: "idle" }),
      };
    }
    if (u.includes("/events")) {
      return { ok: false };
    }
    return { ok: true, json: async () => ({}) };
  });

  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

describe("loomflo start — themed output", () => {
  it("prints check-line for daemon + project on success", async () => {
    const cmd = createStartCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "start", "--project-path", tmp]);
    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("daemon running");
  });
});

describe("loomflo start --json", () => {
  it("prints a JSON record with daemon+project info", async () => {
    const cmd = createStartCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "start", "--json", "--project-path", tmp]);
    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("daemon");
    expect(parsed).toHaveProperty("project");
  });
});
