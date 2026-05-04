/**
 * Unit tests for the canUseTool callback factory.
 */

import { describe, it, expect } from "vitest";
import { buildCanUseTool } from "../../src/runtimes/can-use-tool.js";

const W = "mcp__loomflo__write_file";
const E = "mcp__loomflo__edit_file";
const READ = "mcp__loomflo__read_file";

const noOpts = {
  signal: new AbortController().signal,
};

describe("buildCanUseTool", () => {
  it("allows non-write tools regardless of scope", async () => {
    const fn = buildCanUseTool([]);
    const r = await fn(READ, { path: "anywhere.ts" }, noOpts);
    expect(r.behavior).toBe("allow");
  });

  it("allows a write inside the scope", async () => {
    const fn = buildCanUseTool(["src/**"]);
    const r = await fn(W, { path: "src/foo.ts", content: "x" }, noOpts);
    expect(r.behavior).toBe("allow");
  });

  it("denies a write outside the scope with an explanatory message", async () => {
    const fn = buildCanUseTool(["src/**"]);
    const r = await fn(W, { path: "tests/foo.test.ts", content: "x" }, noOpts);
    expect(r.behavior).toBe("deny");
    if (r.behavior === "deny") {
      expect(r.message).toMatch(/outside.*allowed file scope/i);
      expect(r.message).toContain("src/**");
    }
  });

  it("denies edit_file outside scope (same logic as write_file)", async () => {
    const fn = buildCanUseTool(["docs/**"]);
    const r = await fn(E, { path: "src/foo.ts", oldText: "a", newText: "b" }, noOpts);
    expect(r.behavior).toBe("deny");
  });

  it("denies all writes when scope is empty (e.g. Loomi/Loom/Loomex)", async () => {
    const fn = buildCanUseTool([]);
    const r = await fn(W, { path: "anywhere.ts", content: "x" }, noOpts);
    expect(r.behavior).toBe("deny");
    if (r.behavior === "deny") {
      expect(r.message).toMatch(/no file scope/i);
    }
  });

  it("denies a write with missing path argument", async () => {
    const fn = buildCanUseTool(["**/*"]);
    const r = await fn(W, { content: "x" }, noOpts);
    expect(r.behavior).toBe("deny");
    if (r.behavior === "deny") {
      expect(r.message).toMatch(/missing.*path/i);
    }
  });

  it("normalises leading './' and leading '/' before matching", async () => {
    const fn = buildCanUseTool(["src/**"]);
    const r1 = await fn(W, { path: "./src/a.ts", content: "" }, noOpts);
    const r2 = await fn(W, { path: "/src/b.ts", content: "" }, noOpts);
    expect(r1.behavior).toBe("allow");
    expect(r2.behavior).toBe("allow");
  });

  it("supports multi-glob scopes", async () => {
    const fn = buildCanUseTool(["src/**", "tests/**"]);
    expect((await fn(W, { path: "src/a.ts", content: "" }, noOpts)).behavior).toBe("allow");
    expect((await fn(W, { path: "tests/a.test.ts", content: "" }, noOpts)).behavior).toBe(
      "allow",
    );
    expect((await fn(W, { path: "docs/a.md", content: "" }, noOpts)).behavior).toBe("deny");
  });
});
