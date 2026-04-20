import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { renderTree } from "../../../src/observation/tree.js";

describe("renderTree", () => {
  it("renders a simple chain", () => {
    const graph = {
      nodes: {
        a: { id: "a", title: "root", status: "completed" },
        b: { id: "b", title: "mid", status: "running" },
        c: { id: "c", title: "leaf", status: "pending" },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
      topology: ["a", "b", "c"],
    };
    const out = stripAnsi(renderTree("demo", graph));
    expect(out).toContain("demo");
    expect(out).toContain("root");
    expect(out).toContain("mid");
    expect(out).toContain("leaf");
    // Check tree structure chars
    expect(out).toMatch(/[├└]── .*mid/);
  });

  it("renders a branching DAG with shared children under each parent", () => {
    const graph = {
      nodes: {
        a: { id: "a", title: "r", status: "done" },
        b: { id: "b", title: "L", status: "done" },
        c: { id: "c", title: "R", status: "done" },
        d: { id: "d", title: "X", status: "pend" },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
      topology: ["a", "b", "c", "d"],
    };
    const out = stripAnsi(renderTree("demo", graph));
    // d ("X") should appear twice — once under b and once under c
    expect(out.match(/X/g)?.length).toBe(2);
  });
});
