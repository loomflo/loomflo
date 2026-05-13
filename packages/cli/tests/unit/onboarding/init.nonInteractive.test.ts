import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({ port: 42000, token: "t", pid: 9, version: "0.3.0" }),
}));

const mockFetch = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({}) }));
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../../src/onboarding/index.js", () => ({
  runWizard: vi.fn(),
}));

import { runWizard } from "../../../src/onboarding/index.js";

describe("loomflo init — non-interactive", () => {
  beforeEach(() => {
    process.chdir(mkdtempSync(join(tmpdir(), "loomflo-init-ni-")));
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("implies --non-interactive when no TTY is detected", async () => {
    (runWizard as ReturnType<typeof vi.fn>).mockResolvedValue({
      confirmed: true,
      providerProfileId: "default",
      answers: { providerProfileId: "default", level: 2, budgetLimit: 0, defaultDelay: 1000, retryDelay: 2000, validatorRetryDelay: 500, validatorMaxAttempts: 3 },
    });
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--profile", "default", "--level", "2", "--budget", "0", "--default-delay", "1000", "--retry-delay", "2000", "--yes"]);
    const call = (runWizard as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { flags: { nonInteractive: boolean } };
    expect(call.flags.nonInteractive).toBe(true);
  });

  it("prints an actionable error listing missing flags under --non-interactive", async () => {
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      errors.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    (runWizard as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("missing required flag: --level"));
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--non-interactive"]);
    expect(errors.join("")).toContain("--level");
  });
});
