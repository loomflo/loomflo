import { describe, expect, it } from "vitest";

import {
  WizardFlagsSchema,
  type WizardAnswers,
  type WizardFlags,
} from "../../../src/onboarding/types.js";

describe("WizardFlagsSchema", () => {
  it("accepts the full shape with coercions", () => {
    const parsed = WizardFlagsSchema.parse({
      provider: "anthropic-oauth",
      profile: "default",
      level: "2",
      budget: "0",
      defaultDelay: "1000",
      retryDelay: "2000",
      advanced: false,
      yes: false,
      nonInteractive: false,
    });
    expect(parsed.level).toBe(2);
    expect(parsed.budget).toBe(0);
    expect(parsed.defaultDelay).toBe(1000);
  });

  it("accepts partial and applies defaults where appropriate", () => {
    const parsed = WizardFlagsSchema.parse({});
    expect(parsed.advanced).toBe(false);
    expect(parsed.yes).toBe(false);
    expect(parsed.nonInteractive).toBe(false);
  });

  it("rejects invalid level", () => {
    expect(() => WizardFlagsSchema.parse({ level: "7" })).toThrow();
  });

  it("satisfies the WizardAnswers shape for downstream consumers", () => {
    const a: WizardAnswers = {
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
      advanced: {
        maxRetriesPerNode: 3,
        maxRetriesPerTask: 2,
        maxLoomasPerLoomi: 5,
        reviewerEnabled: true,
        agentTimeout: 120000,
      },
    };
    expect(a.level).toBe(2);
  });
});
