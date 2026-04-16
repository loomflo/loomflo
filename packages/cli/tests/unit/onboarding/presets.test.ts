import { describe, expect, it } from "vitest";

import { presetDefaults } from "../../../src/onboarding/presets.js";

describe("presetDefaults", () => {
  it("level 1 — fast/cheap (tight retries, short delays)", () => {
    const d = presetDefaults(1);
    expect(d.defaultDelay).toBe(500);
    expect(d.retryDelay).toBe(1000);
    expect(d.maxRetriesPerNode).toBe(1);
    expect(d.reviewerEnabled).toBe(false);
  });

  it("level 2 — balanced (our default)", () => {
    const d = presetDefaults(2);
    expect(d.defaultDelay).toBe(1000);
    expect(d.retryDelay).toBe(2000);
    expect(d.maxRetriesPerNode).toBe(3);
    expect(d.reviewerEnabled).toBe(true);
  });

  it("level 3 — deep (longer delays, more retries, reviewer on)", () => {
    const d = presetDefaults(3);
    expect(d.defaultDelay).toBe(2000);
    expect(d.retryDelay).toBe(5000);
    expect(d.maxRetriesPerNode).toBe(5);
    expect(d.reviewerEnabled).toBe(true);
  });

  it("custom falls back to level 2 before advanced prompts override", () => {
    const d = presetDefaults("custom");
    expect(d).toEqual(presetDefaults(2));
  });
});
