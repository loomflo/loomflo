import { describe, expect, it } from "vitest";

import { createFakePromptBackend } from "../../../src/onboarding/prompts.js";

describe("prompts — fake backend", () => {
  it("returns queued answers in FIFO order", async () => {
    const fake = createFakePromptBackend([
      { kind: "select", value: "2" },
      { kind: "input", value: "0" },
    ]);

    expect(await fake.select({ message: "Level?", choices: [] })).toBe("2");
    expect(await fake.input({ message: "Budget?" })).toBe("0");
  });

  it("throws when the queue is empty", async () => {
    const fake = createFakePromptBackend([]);
    await expect(fake.input({ message: "x" })).rejects.toThrow(
      /fake backend ran out of answers/,
    );
  });
});
