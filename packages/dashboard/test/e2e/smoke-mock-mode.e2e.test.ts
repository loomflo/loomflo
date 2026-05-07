// ============================================================================
// Dashboard E2E — mock mode smoke test
//
// SKIPPED unless LOOMFLO_E2E=1. Requires a daemon running locally with
// LOOMFLO_MOCK_API=1 on http://127.0.0.1:3000 and an issued token in
// ~/.loomflo/daemon.json.
//
// To run:
//   1. Build core: `pnpm --filter @loomflo/core build`
//   2. Start daemon: `LOOMFLO_MOCK_API=1 node packages/core/dist/daemon-entry.js`
//   3. LOOMFLO_E2E=1 pnpm --filter @loomflo/dashboard test \
//        test/e2e/smoke-mock-mode.e2e.test.ts
//
// The test validates the dashboard's ApiClient against the daemon's mock
// surface end-to-end: `/mock/projects`, `/mock/workflow`, `/mock/events`.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "../../src/lib/api.js";

const SHOULD_RUN = process.env["LOOMFLO_E2E"] === "1";
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

interface DaemonInfo {
  port: number;
  token: string;
}

async function readDaemonInfo(): Promise<DaemonInfo> {
  const path = join(homedir(), ".loomflo", "daemon.json");
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as DaemonInfo;
  if (!parsed.port || !parsed.token) {
    throw new Error("Invalid daemon.json (missing port or token)");
  }
  return parsed;
}

describeMaybe("dashboard E2E — mock mode", () => {
  it("hits /mock/projects via the ApiClient and returns the seeded list", async () => {
    const info = await readDaemonInfo();
    const api = new ApiClient({
      baseUrl: `http://127.0.0.1:${String(info.port)}`,
      token: info.token,
      useMock: true,
    });
    const projects = await api.listProjects();
    expect(Array.isArray(projects)).toBe(true);
  });

  it("loads a mock workflow via getWorkflow", async () => {
    const info = await readDaemonInfo();
    const api = new ApiClient({
      baseUrl: `http://127.0.0.1:${String(info.port)}`,
      token: info.token,
      useMock: true,
    });
    const workflow = await api.getWorkflow("any");
    expect(workflow.id).toBeTruthy();
    expect(workflow.graph).toBeTruthy();
    expect(workflow.graph.nodes).toBeTruthy();
  });

  it("seeds via /mock/seed", async () => {
    const info = await readDaemonInfo();
    const api = new ApiClient({
      baseUrl: `http://127.0.0.1:${String(info.port)}`,
      token: info.token,
    });
    const seed = await api.mockSeed();
    expect(seed.workflow).toBeTruthy();
    expect(Array.isArray(seed.events)).toBe(true);
    expect(Array.isArray(seed.projects)).toBe(true);
  });
});
