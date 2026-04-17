/**
 * P0-2 regression guard: the onboarding wizard must retry a failing provider
 * validator up to 3 times before surfacing a terminal error.
 *
 * The previous behaviour (throw on first failure) forced the user to restart
 * the wizard on any transient network blip. Spec L112 mandates a bounded
 * retry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWizard } from "../../../src/onboarding/index.js";
import { createFakePromptBackend } from "../../../src/onboarding/prompts.js";

const validateAnthropicOauth = vi.fn();
const validateAnthropicApiKey = vi.fn();
const validateOpenAICompat = vi.fn();

vi.mock("../../../src/onboarding/validators.js", () => ({
  validateAnthropicOauth: (...args: unknown[]): unknown => validateAnthropicOauth(...args),
  validateAnthropicApiKey: (...args: unknown[]): unknown => validateAnthropicApiKey(...args),
  validateOpenAICompat: (...args: unknown[]): unknown => validateOpenAICompat(...args),
}));

vi.mock("@loomflo/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@loomflo/core");
  return {
    ...actual,
    ProviderProfiles: class {
      async list(): Promise<Record<string, unknown>> {
        return { default: { type: "anthropic-oauth" } };
      }
      async get(name: string): Promise<unknown> {
        return name === "default" ? { type: "anthropic-oauth" } : null;
      }
      async upsert(): Promise<void> {}
    },
  };
});

describe("runExistingValidator retry (P0-2)", () => {
  beforeEach(() => {
    validateAnthropicOauth.mockReset();
    validateAnthropicApiKey.mockReset();
    validateOpenAICompat.mockReset();
  });

  it("succeeds when the validator passes on the 3rd attempt", async () => {
    validateAnthropicOauth
      .mockResolvedValueOnce({ ok: false, reason: "transient 503" })
      .mockResolvedValueOnce({ ok: false, reason: "transient 503" })
      .mockResolvedValueOnce({ ok: true });

    const result = await runWizard({
      prompt: createFakePromptBackend([]),
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
    expect(validateAnthropicOauth).toHaveBeenCalledTimes(3);
  });

  it("throws after 3 consecutive failures and reports the last reason", async () => {
    validateAnthropicOauth.mockResolvedValue({
      ok: false,
      reason: "network down",
      hint: "check your wifi",
    });

    await expect(
      runWizard({
        prompt: createFakePromptBackend([]),
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
      }),
    ).rejects.toThrow(/after 3 attempts.*network down/);
    expect(validateAnthropicOauth).toHaveBeenCalledTimes(3);
  });

  it("stops at the first success and does not retry further", async () => {
    validateAnthropicOauth.mockResolvedValueOnce({ ok: true });

    await runWizard({
      prompt: createFakePromptBackend([]),
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
    expect(validateAnthropicOauth).toHaveBeenCalledTimes(1);
  });

  it("bails immediately on non-retryable errors (e.g. 401 invalid_api_key)", async () => {
    validateAnthropicOauth.mockResolvedValue({
      ok: false,
      reason: "Anthropic API key is invalid or revoked",
      hint: "Check the key in the console.",
      retryable: false,
    });

    await expect(
      runWizard({
        prompt: createFakePromptBackend([]),
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
      }),
    ).rejects.toThrow(/invalid or revoked/);
    // Should only be called once — no point retrying a deterministic auth failure.
    expect(validateAnthropicOauth).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff between retries", async () => {
    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    // Intercept setTimeout to record delay values without actually waiting.
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (ms && ms >= 500) delays.push(ms);
      return origSetTimeout(fn, 0);
    }) as typeof setTimeout);

    validateAnthropicOauth
      .mockResolvedValueOnce({ ok: false, reason: "503", retryable: true })
      .mockResolvedValueOnce({ ok: false, reason: "503", retryable: true })
      .mockResolvedValueOnce({ ok: true });

    await runWizard({
      prompt: createFakePromptBackend([]),
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

    // Expect backoff delays: 500ms before attempt 2, 1000ms before attempt 3.
    expect(delays).toEqual([500, 1000]);
    vi.restoreAllMocks();
  });
});
