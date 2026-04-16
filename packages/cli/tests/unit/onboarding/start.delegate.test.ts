import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockCreateInitCommand = vi.fn(() => ({
  parseAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/commands/init.js", () => ({
  createInitCommand: mockCreateInitCommand,
}));

vi.mock("../../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({ port: 42000, token: "t", pid: 9, version: "0.2.0" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "loomflo-start-"));
  process.chdir(tmp);
  mockCreateInitCommand.mockClear();

  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/projects/") && (!init || !init.method || init.method === "GET")) {
      return { ok: false, status: 404, json: async () => null };
    }
    if (u.includes("/projects") && init?.method === "POST") {
      return { ok: true, json: async () => ({ id: "proj_x", name: "sandbox", status: "idle" }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("loomflo start — virgin project", () => {
  it("invokes the init command when no project.json exists", async () => {
    const { createStartCommand } = await import("../../../src/commands/start.js");
    await createStartCommand().parseAsync(["node", "start"]);
    expect(mockCreateInitCommand).toHaveBeenCalled();
  });
});
