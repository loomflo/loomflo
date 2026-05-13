import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMMANDS_DIR = join(__dirname, "../..", "..", "src", "commands");

async function listFiles(dir: string): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const ent of ents) {
    if (ent.isFile() && ent.name.endsWith(".ts")) files.push(join(dir, ent.name));
  }
  return files;
}

describe("regression: no console.* in commands", () => {
  it("no command file contains console.log / console.error / console.warn", async () => {
    const files = await listFiles(COMMANDS_DIR);
    const offenders: string[] = [];
    for (const f of files) {
      const src = await readFile(f, "utf-8");
      if (/console\.(log|error|warn)\(/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
