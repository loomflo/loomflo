import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({ port: 42000, token: "t", pid: 9, version: "0.3.0" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../../src/onboarding/index.js", () => ({
  runWizard: vi.fn().mockResolvedValue({
    confirmed: true,
    providerProfileId: "default",
    answers: {
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
    },
  }),
}));

let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "loomflo-init-"));
  await mkdir(join(tmp, ".loomflo"), { recursive: true });
  process.chdir(tmp);

  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/projects/") && u.includes("/workflow/init") && init?.method === "POST") {
      return { ok: true, json: async () => ({ id: "wf_1", status: "generating" }) };
    }
    if (u.includes("/projects/") && (!init || !init.method || init.method === "GET")) {
      return { ok: false, status: 404, json: async () => null };
    }
    if (u.includes("/projects") && init?.method === "POST") {
      return { ok: true, json: async () => ({ id: "proj_x", name: "sandbox" }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("loomflo init", () => {
  it("runs the wizard and writes project.json with the chosen profile", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init"]);
    const raw = await readFile(join(tmp, ".loomflo", "project.json"), "utf-8");
    const parsed = JSON.parse(raw) as { providerProfileId: string };
    expect(parsed.providerProfileId).toBe("default");
  });

  it("writes project.json with 0600 mode (P0-3)", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init"]);
    const projectFile = join(tmp, ".loomflo", "project.json");
    const mode = (await stat(projectFile)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("re-runs on a pre-existing 0644 project.json and tightens it to 0600", async () => {
    const projectFile = join(tmp, ".loomflo", "project.json");
    await writeFile(projectFile, JSON.stringify({ id: "proj_x", name: "sandbox" }), {
      mode: 0o644,
    });
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init"]);
    const mode = (await stat(projectFile)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("writes config.json with 0600 mode (R5)", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init"]);
    const configFile = join(tmp, ".loomflo", "config.json");
    const mode = (await stat(configFile)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("exits non-zero and prints an error when wizard is not confirmed", async () => {
    const { runWizard } = await import("../../../src/onboarding/index.js");
    (runWizard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ confirmed: false, providerProfileId: "default", answers: {} });
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init"]);
    expect(process.exitCode).toBe(1);
  });
});
