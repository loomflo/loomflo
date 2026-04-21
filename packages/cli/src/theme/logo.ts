// packages/cli/src/theme/logo.ts
//
// ASCII splash logo rendered at the top of `loomflo init` in interactive mode.
// The glyphs below are the ANSI Shadow figlet variant of the word "LOOMFLO".
// Inlined as a constant so no runtime figlet dependency is required.

import { theme } from "./theme.js";

/** Raw ASCII glyphs for the LOOMFLO splash logo. */
export const LOGO = [
  "██╗      ██████╗  ██████╗ ███╗   ███╗███████╗██╗      ██████╗ ",
  "██║     ██╔═══██╗██╔═══██╗████╗ ████║██╔════╝██║     ██╔═══██╗",
  "██║     ██║   ██║██║   ██║██╔████╔██║█████╗  ██║     ██║   ██║",
  "██║     ██║   ██║██║   ██║██║╚██╔╝██║██╔══╝  ██║     ██║   ██║",
  "███████╗╚██████╔╝╚██████╔╝██║ ╚═╝ ██║██║     ███████╗╚██████╔╝",
  "╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚══════╝ ╚═════╝ ",
] as const;

/**
 * Render the logo as a single string with a trailing newline.
 * Each glyph line is tinted with the `accent` palette tone.
 */
export function renderLogo(): string {
  return LOGO.map((line) => theme.accent(line)).join("\n") + "\n";
}

/**
 * Print the LOOMFLO splash logo to stdout. Intended for interactive
 * `loomflo init` only; callers are responsible for gating on TTY / --json.
 */
export function printLogo(): void {
  process.stdout.write(renderLogo());
}
