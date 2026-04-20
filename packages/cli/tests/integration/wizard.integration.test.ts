import { readFile, mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ProviderProfiles } from "@loomflo/core";
import { runWizard } from "../../src/onboarding/index.js";
import { createFakePromptBackend } from "../../src/onboarding/prompts.js";

vi.mock("../../src/onboarding/validators.js", () => ({
  validateAnthropicOauth: vi.fn(async () => ({ ok: true })),
  validateAnthropicApiKey: vi.fn(async () => ({ ok: true })),
  validateOpenAICompat: vi.fn(async () => ({ ok: true })),
}));

describe("wizard integration", () => {
  let dir: string;
  let profiles: ProviderProfiles;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loomflo-wiz-int-"));
    await mkdir(dir, { recursive: true });
    profiles = new ProviderProfiles(join(dir, "credentials.json"));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("creates a new profile and returns valid answers", async () => {
    const prompt = createFakePromptBackend([
      { kind: "select", value: "new" }, // no existing
      { kind: "select", value: "anthropic-oauth" },
      { kind: "input", value: "default" },
      { kind: "select", value: "2" },
      { kind: "number", value: 0 },
      { kind: "number", value: 1000 },
      { kind: "number", value: 2000 },
      { kind: "number", value: 500 }, // validatorRetryDelay
      { kind: "number", value: 3 }, // validatorMaxAttempts
      { kind: "confirm", value: false }, // advanced? no
      { kind: "confirm", value: true }, // start?
    ]);
    const result = await runWizard({ prompt, flags: {}, profiles });
    expect(result.confirmed).toBe(true);
    const raw = await readFile(join(dir, "credentials.json"), "utf-8");
    const parsed = JSON.parse(raw) as { profiles: Record<string, unknown> };
    expect(parsed.profiles["default"]).toMatchObject({ type: "anthropic-oauth" });
  });

  it("reuses an existing profile on re-run", async () => {
    await profiles.upsert("default", { type: "anthropic-oauth" });
    const prompt = createFakePromptBackend([
      { kind: "select", value: "default" }, // existing profile picked
      { kind: "select", value: "2" },
      { kind: "number", value: 0 },
      { kind: "number", value: 1000 },
      { kind: "number", value: 2000 },
      { kind: "number", value: 500 }, // validatorRetryDelay
      { kind: "number", value: 3 }, // validatorMaxAttempts
      { kind: "confirm", value: false },
      { kind: "confirm", value: true },
    ]);
    const result = await runWizard({ prompt, flags: {}, profiles });
    expect(result.providerProfileId).toBe("default");
  });
});
