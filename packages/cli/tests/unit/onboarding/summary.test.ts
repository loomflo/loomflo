import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { renderSummary } from "../../../src/onboarding/summary.js";
import type { WizardAnswers } from "../../../src/onboarding/types.js";

describe("renderSummary", () => {
  const answers: WizardAnswers = {
    providerProfileId: "default",
    level: 2,
    budgetLimit: 0,
    defaultDelay: 1000,
    retryDelay: 2000,
    validatorRetryDelay: 500,
    validatorMaxAttempts: 3,
  };

  it("renders a heading + kv list", () => {
    const out = stripAnsi(renderSummary({ projectName: "my-todo-app", answers }));
    expect(out).toContain("my-todo-app");
    expect(out).toContain("provider");
    expect(out).toContain("default");
    expect(out).toContain("level");
    expect(out).toContain("2");
    expect(out).toContain("budget");
    expect(out).toContain("unlimited");
  });

  it("formats budget 0 as 'unlimited' and non-zero as '$X.XX'", () => {
    const zero = stripAnsi(renderSummary({ projectName: "x", answers }));
    expect(zero).toContain("unlimited");
    const paid = stripAnsi(
      renderSummary({ projectName: "x", answers: { ...answers, budgetLimit: 10 } }),
    );
    expect(paid).toContain("$10.00");
  });

  it("includes advanced overrides when present", () => {
    const out = stripAnsi(
      renderSummary({
        projectName: "x",
        answers: {
          ...answers,
          advanced: {
            maxRetriesPerNode: 7,
            maxRetriesPerTask: 2,
            maxLoomasPerLoomi: 5,
            reviewerEnabled: false,
            agentTimeout: 60000,
          },
        },
      }),
    );
    expect(out).toContain("maxRetries");
    expect(out).toContain("7");
  });
});
