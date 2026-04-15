import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderProfiles, type ProviderProfile } from "../../src/providers/profiles.js";

describe("ProviderProfiles", () => {
  let tmp: string;
  let file: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-profiles-"));
    file = join(tmp, "credentials.json");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns empty object when file is absent", async () => {
    const p = new ProviderProfiles(file);
    expect(await p.list()).toEqual({});
  });

  it("upserts and retrieves a profile", async () => {
    const p = new ProviderProfiles(file);
    const prof: ProviderProfile = { type: "openai", apiKey: "sk-x", defaultModel: "gpt-4" };
    await p.upsert("openai-personal", prof);
    expect(await p.get("openai-personal")).toEqual(prof);
  });

  it("removes a profile", async () => {
    const p = new ProviderProfiles(file);
    await p.upsert("a", { type: "openai", apiKey: "x" });
    await p.upsert("b", { type: "openai", apiKey: "y" });
    await p.remove("a");
    expect(await p.get("a")).toBeNull();
    expect(await p.get("b")).not.toBeNull();
  });

  it("writes 0600 permissions", async () => {
    const p = new ProviderProfiles(file);
    await p.upsert("a", { type: "openai", apiKey: "x" });
    const s = await stat(file);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("recovers from corrupt JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, "not json at all");
    const p = new ProviderProfiles(file);
    expect(await p.list()).toEqual({});
    const raw = await readFile(file, "utf-8");
    expect(JSON.parse(raw)).toEqual({ profiles: {} });
  });
});
