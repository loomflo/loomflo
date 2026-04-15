import { describe, it, expect } from "vitest";
import { createProjectCommand } from "../../src/commands/project.js";

describe("project command", () => {
  it("has list/remove/prune subcommands", () => {
    const cmd = createProjectCommand();
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["list", "prune", "remove"]);
  });
});
