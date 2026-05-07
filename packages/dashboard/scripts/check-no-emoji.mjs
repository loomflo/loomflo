#!/usr/bin/env node
// ============================================================================
// Dashboard "no emoji" linter.
//
// Walks src/ and asserts no character in the emoji code-point ranges shows up
// in any TS/TSX/CSS/HTML file. The constitution forbids emojis from the
// dashboard codebase — the prototype uses inline SVG icons instead.
//
// Run: `node scripts/check-no-emoji.mjs` from packages/dashboard/.
// Exits 0 on success, 1 with a list of offending lines on failure.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Emoji-ish code point ranges — mirrors common Unicode blocks used by emoji
// shortcodes. Conservative on purpose: we want to flag any visual glyph used
// instead of an icon, even at the cost of a false positive on rare typography.
const EMOJI_RANGES = [
  [0x1f300, 0x1faff], // Symbols & Pictographs / Emoticons / Transport / Etc.
  [0x2600, 0x26ff], // Miscellaneous symbols
  [0x2700, 0x27bf], // Dingbats
  [0x1f000, 0x1f02f], // Mahjong / playing cards (used in some packs)
  [0x1f0a0, 0x1f0ff],
  [0x1f100, 0x1f1ff], // Enclosed Alphanumeric supplement / regional flags
];
function isEmoji(codePoint) {
  for (const [lo, hi] of EMOJI_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

function lineHasEmoji(line) {
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isEmoji(cp)) return ch;
  }
  return null;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC = resolve(__dirname, "..", "src");
const EXTS = new Set([".ts", ".tsx", ".css", ".html"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".loomflo", "scripts"]);

function walk(dir, results = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, results);
    else if (EXTS.has(extname(full))) results.push(full);
  }
  return results;
}

const violations = [];
for (const file of walk(SRC)) {
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const ch = lineHasEmoji(line);
    if (ch) {
      violations.push(`${file}:${String(i + 1)}: U+${ch.codePointAt(0).toString(16).toUpperCase()} — ${line.trim().slice(0, 120)}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`Emojis found in dashboard source (${String(violations.length)} occurrences):`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log("OK — no emojis in dashboard source.");
