import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({ port: 42000, token: "t", pid: 9, version: "0.2.0" }),
}));

const mockFetch = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../../src/onboarding/index.js", () => ({
  runWizard: vi.fn(),
}));

describe("loomflo init — re-run on configured project", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "loomflo-init-rerun-"));
    await mkdir(join(tmp, ".loomflo"), { recursive: true });
    await writeFile(
      join(tmp, ".loomflo", "project.json"),
      JSON.stringify({ id: "proj_x", name: "existing", providerProfileId: "default", createdAt: "2026-04-15T00:00:00Z" }),
    );
    await writeFile(
      join(tmp, ".loomflo", "config.json"),
      JSON.stringify({ budgetLimit: 0, level: 2, defaultDelay: 1000, retryDelay: 2000 }),
    );
    process.chdir(tmp);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("shows a one-line recap and skips the wizard with --yes", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--yes"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toMatch(/existing/);
    expect(plain).toMatch(/level.*2/);
    expect(plain).toMatch(/budget/);
  });
});
