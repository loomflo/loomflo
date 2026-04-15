import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({
    port: 41234,
    token: "t",
    pid: 99,
    version: "0.2.0",
  }),
  getRunningDaemon: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { createInitCommand } from "../../src/commands/init.js";
import { ensureDaemonRunning } from "../../src/daemon-control.js";

let tmp: string;
let stdoutWrites: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "loomflo-init-theme-"));

  (ensureDaemonRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    port: 41234,
    token: "t",
    pid: 99,
    version: "0.2.0",
  });

  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/projects/") && u.includes("/workflow/init") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "wf_abc", status: "generating" }),
      };
    }
    if (u.includes("/projects/") && (!init || !init.method || init.method === "GET")) {
      return { ok: false, status: 404, json: async () => null };
    }
    if (u.includes("/projects") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "proj_test1234", status: "idle" }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });

  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

describe("loomflo init — themed output", () => {
  it("prints check-line for workflow initialization", async () => {
    const cmd = createInitCommand();
    cmd.exitOverride();
    await cmd.parseAsync([
      "node",
      "init",
      "Build a todo application with authentication",
      "--project-path",
      tmp,
    ]);
    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("workflow");
  });
});

describe("loomflo init --json", () => {
  it("prints JSON with project and workflow info", async () => {
    const cmd = createInitCommand();
    cmd.exitOverride();
    await cmd.parseAsync([
      "node",
      "init",
      "Build a todo application with authentication",
      "--json",
      "--project-path",
      tmp,
    ]);
    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("project");
    expect(parsed).toHaveProperty("workflow");
  });
});
