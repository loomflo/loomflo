import { describe, expect, it, vi } from "vitest";

import { runWizard } from "../../../src/onboarding/index.js";
import { createFakePromptBackend } from "../../../src/onboarding/prompts.js";

vi.mock("../../../src/onboarding/validators.js", () => ({
  validateAnthropicOauth: vi.fn(async () => ({ ok: true })),
  validateAnthropicApiKey: vi.fn(async () => ({ ok: true })),
  validateOpenAICompat: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@loomflo/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@loomflo/core");
  return {
    ...actual,
    ProviderProfiles: class {
      async list() {
        return {};
      }
      async get(name: string) {
        return name === "default" ? { type: "anthropic-oauth" } : null;
      }
      async upsert() {}
    },
  };
});

describe("runWizard", () => {
  it("completes the interactive happy path (anthropic-oauth, level 2)", async () => {
    const fake = createFakePromptBackend([
      { kind: "select", value: "new" }, // no existing profiles
      { kind: "select", value: "anthropic-oauth" }, // type
      { kind: "input", value: "default" }, // profile name
      { kind: "select", value: "2" }, // level
      { kind: "number", value: 0 }, // budget
      { kind: "number", value: 1000 }, // defaultDelay
      { kind: "number", value: 2000 }, // retryDelay
      { kind: "confirm", value: false }, // advanced? no
      { kind: "confirm", value: true }, // start?
    ]);

    const result = await runWizard({ prompt: fake, flags: {} });
    expect(result.confirmed).toBe(true);
    expect(result.answers).toMatchObject({
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
    });
  });

  it("skips prompts when every flag is provided and --yes is set", async () => {
    const fake = createFakePromptBackend([]); // no prompts allowed
    const result = await runWizard({
      prompt: fake,
      flags: {
        profile: "default",
        level: 2,
        budget: 0,
        defaultDelay: 1000,
        retryDelay: 2000,
        advanced: false,
        yes: true,
        nonInteractive: false,
      },
    });
    expect(result.confirmed).toBe(true);
    expect(result.answers.level).toBe(2);
  });

  it("fails fast in non-interactive mode when values are missing", async () => {
    const fake = createFakePromptBackend([]);
    await expect(
      runWizard({ prompt: fake, flags: { nonInteractive: true } }),
    ).rejects.toThrow(/missing required/);
  });
});
