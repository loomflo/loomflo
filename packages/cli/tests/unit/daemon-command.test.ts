// packages/cli/tests/unit/daemon-command.test.ts
import { describe, it, expect } from "vitest";
import { createDaemonCommand } from "../../src/commands/daemon.js";

describe("daemon command", () => {
  it("has start/stop/status/restart subcommands", () => {
    const cmd = createDaemonCommand();
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["restart", "start", "status", "stop"]);
  });

  it("stop supports --force flag", () => {
    const cmd = createDaemonCommand();
    const stop = cmd.commands.find((c) => c.name() === "stop")!;
    const hasForce = stop.options.some((o) => o.long === "--force");
    expect(hasForce).toBe(true);
  });

  it("each subcommand supports --json flag", () => {
    const cmd = createDaemonCommand();
    for (const sub of cmd.commands) {
      const hasJson = sub.options.some((o) => o.long === "--json");
      expect(hasJson, `${sub.name()} should have --json`).toBe(true);
    }
  });
});
