/**
 * Unit tests for `deriveFileScope` — the helper that turns a node's
 * fileOwnership map into the agent-specific glob list passed to canUseTool.
 */

import { describe, it, expect } from "vitest";
import { deriveFileScope } from "../../src/runtimes/run-node.js";

describe("deriveFileScope", () => {
  it("returns empty scope for non-looma roles (no project writes)", () => {
    const node = { fileOwnership: { "looma-1": ["src/**"] } };
    expect(deriveFileScope(node, "loom", "loom-1")).toEqual([]);
    expect(deriveFileScope(node, "loomi", "loomi-1")).toEqual([]);
    expect(deriveFileScope(node, "loomex", "loomex-1")).toEqual([]);
  });

  it("returns the agent's own ownership entry when present", () => {
    const node = {
      fileOwnership: {
        "looma-A": ["src/api/**"],
        "looma-B": ["src/ui/**"],
      },
    };
    expect(deriveFileScope(node, "looma", "looma-A")).toEqual(["src/api/**"]);
    expect(deriveFileScope(node, "looma", "looma-B")).toEqual(["src/ui/**"]);
  });

  it("falls back to the union of all entries when the agent has no entry", () => {
    const node = {
      fileOwnership: {
        "looma-A": ["src/**"],
        "looma-B": ["tests/**"],
      },
    };
    expect(deriveFileScope(node, "looma", "looma-X")).toEqual(["src/**", "tests/**"]);
  });

  it("falls back to ['**\\/*'] when fileOwnership is empty (single-agent run)", () => {
    expect(deriveFileScope({ fileOwnership: {} }, "looma", "looma-1")).toEqual(["**/*"]);
    expect(deriveFileScope({}, "looma", "looma-1")).toEqual(["**/*"]);
  });
});
