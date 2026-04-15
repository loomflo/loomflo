// packages/core/tests/integration/legacy-migration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProjectIdentity } from "../../src/persistence/project-identity.js";

describe("legacy migration", () => {
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "loomflo-migrate-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("creates project.json when only state.json exists", async () => {
    await mkdir(join(work, ".loomflo"));
    await writeFile(join(work, ".loomflo", "state.json"), JSON.stringify({ id: "wf" }));

    const ident = await ensureProjectIdentity(work);
    expect(ident.id).toMatch(/^proj_[0-9a-f]{8}$/);

    const raw = await readFile(join(work, ".loomflo", "project.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(ident);
  });
});
