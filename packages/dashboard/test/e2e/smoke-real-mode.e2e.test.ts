// ============================================================================
// Dashboard E2E — real mode smoke test
//
// SKIPPED unless LOOMFLO_E2E=1. Requires a daemon running locally
// (without LOOMFLO_MOCK_API=1) on http://127.0.0.1:3000 with the token
// in ~/.loomflo/daemon.json.
//
// Validates create + delete + list of a project end-to-end through the
// real REST surface — the contract the wizard relies on.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "../../src/lib/api.js";

const SHOULD_RUN = process.env["LOOMFLO_E2E"] === "1";
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

async function readDaemon(): Promise<{ port: number; token: string }> {
  const path = join(homedir(), ".loomflo", "daemon.json");
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as { port: number; token: string };
}

function randomProjectId(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return `proj_${out}`;
}

describeMaybe("dashboard E2E — real mode", () => {
  it("creates a project, lists it, then deletes it", async () => {
    const info = await readDaemon();
    const api = new ApiClient({
      baseUrl: `http://127.0.0.1:${String(info.port)}`,
      token: info.token,
    });

    const id = randomProjectId();
    const created = await api.createProject({
      id,
      name: "e2e-smoke",
      projectPath: "/tmp/e2e-smoke",
      providerProfileId: "default",
    });
    expect(created.id).toBe(id);

    const listed = await api.listProjects();
    expect(listed.some((p) => p.id === id)).toBe(true);

    await api.deleteProject(id);
    const listedAfter = await api.listProjects();
    expect(listedAfter.some((p) => p.id === id)).toBe(false);
  });
});
