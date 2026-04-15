import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/project-resolver.js";

describe("resolveProject", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-cli-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates identity if absent when createIfMissing=true", async () => {
    const result = await resolveProject({ cwd: tmp, createIfMissing: true });
    expect(result.created).toBe(true);
    expect(result.identity.name).toBe(tmp.split("/").pop());
  });

  it("returns existing identity from walk-up", async () => {
    const root = join(tmp, "myproj");
    const nested = join(root, "src", "deep");
    await mkdir(nested, { recursive: true });
    await mkdir(join(root, ".loomflo"));
    await writeFile(
      join(root, ".loomflo", "project.json"),
      JSON.stringify({
        id: "proj_12345678",
        name: "myproj",
        providerProfileId: "default",
        createdAt: new Date().toISOString(),
      }),
    );

    const result = await resolveProject({ cwd: nested, createIfMissing: false });
    expect(result.created).toBe(false);
    expect(result.identity.id).toBe("proj_12345678");
    expect(result.projectRoot).toBe(root);
  });

  it("throws when no identity and createIfMissing=false", async () => {
    await expect(resolveProject({ cwd: tmp, createIfMissing: false })).rejects.toThrow(
      /not a loomflo project/i,
    );
  });
});
