import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, afterEach } from "vitest";

import { LOGO, renderLogo, printLogo } from "../../../src/theme/logo.js";

describe("theme/logo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("LOGO contains the six ANSI Shadow rows", () => {
    expect(LOGO).toHaveLength(6);
    expect(LOGO[0]).toContain("██");
    expect(LOGO[5]).toContain("╚══════╝");
  });

  it("renderLogo emits each glyph row on its own line with a trailing newline", () => {
    const plain = stripAnsi(renderLogo());
    const rows = plain.split("\n");
    // 6 content rows + empty trailing entry from the final newline
    expect(rows).toHaveLength(LOGO.length + 1);
    for (let i = 0; i < LOGO.length; i++) {
      expect(rows[i]).toBe(LOGO[i]);
    }
    expect(rows[LOGO.length]).toBe("");
  });

  it("renderLogo frame matches the expected plain byte sequence", () => {
    const expected = `${LOGO.join("\n")}\n`;
    expect(stripAnsi(renderLogo())).toBe(expected);
  });

  it("printLogo writes the rendered frame to process.stdout", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });
    printLogo();
    expect(writes.join("")).toBe(renderLogo());
  });
});
