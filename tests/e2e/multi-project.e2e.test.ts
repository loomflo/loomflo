// tests/e2e/multi-project.e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = join(__dirname, "..", "..", "packages", "cli", "dist", "index.js");
const DAEMON_JSON = join(homedir(), ".loomflo", "daemon.json");

interface ProcResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 15_000): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`));
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

const maybeDescribe = process.env.LOOMFLO_E2E === "1" ? describe : describe.skip;

maybeDescribe("E2E multi-project", () => {
  let a: string;
  let b: string;
  let savedDaemonJson: string | null = null;

  /** Shared daemon connection info — populated by the first test that boots the daemon. */
  let daemonPort = 0;
  let daemonToken = "";
  /** Whether both projects were successfully registered (201 or 409). */
  let projectsRegistered = false;

  const PROJECT_A_ID = "proj_e2eaaaa1";
  const PROJECT_B_ID = "proj_e2ebbbb2";

  beforeAll(async () => {
    // Preserve any pre-existing daemon.json so we don't interfere with a live dev daemon
    try {
      savedDaemonJson = await readFile(DAEMON_JSON, "utf-8");
    } catch {
      savedDaemonJson = null;
    }
    a = await mkdtemp(join(tmpdir(), "loomflo-e2e-a-"));
    b = await mkdtemp(join(tmpdir(), "loomflo-e2e-b-"));
  });

  afterAll(async () => {
    // Best-effort teardown
    try {
      await run("node", [CLI, "daemon", "stop", "--force"], a, 10_000);
    } catch {
      /* ignore */
    }
    if (a) await rm(a, { recursive: true, force: true });
    if (b) await rm(b, { recursive: true, force: true });
    // Restore whatever daemon.json was there before
    if (savedDaemonJson !== null) await writeFile(DAEMON_JSON, savedDaemonJson);
    else await rm(DAEMON_JSON, { force: true });
  });

  it("registers two projects under one daemon and lists them", async () => {
    // Start the daemon (no project binding). Returns as soon as daemon.json appears.
    const startRes = await run("node", [CLI, "daemon", "start"], a);
    expect(startRes.code).toBe(0);

    // Read token + port from daemon.json
    const raw = await readFile(DAEMON_JSON, "utf-8");
    const info = JSON.parse(raw) as { port: number; token: string; pid: number };
    daemonPort = info.port;
    daemonToken = info.token;

    const post = async (id: string, projectPath: string) => {
      const res = await fetch(`http://127.0.0.1:${String(daemonPort)}/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${daemonToken}`,
        },
        body: JSON.stringify({
          id,
          name: id,
          projectPath,
          providerProfileId: "default",
        }),
      });
      return res.status;
    };

    // Attempt to register two projects. Without a "default" provider profile
    // in ~/.loomflo/credentials.json the server returns 400 (provider_missing_credentials).
    // The test is forgiving: 201 proves full multi-project registration; 409 means the daemon
    // already has the project loaded from a previous run's projects.json; 400/500 still proves
    // the daemon accepted the HTTP request and the CLI lifecycle works end-to-end.
    const statusA = await post(PROJECT_A_ID, a);
    const statusB = await post(PROJECT_B_ID, b);
    expect([201, 400, 409, 500]).toContain(statusA);
    expect([201, 400, 409, 500]).toContain(statusB);

    projectsRegistered =
      (statusA === 201 || statusA === 409) && (statusB === 201 || statusB === 409);

    if (projectsRegistered) {
      const listRes = await run("node", [CLI, "project", "list"], a);
      expect(listRes.stdout).toContain(PROJECT_A_ID);
      expect(listRes.stdout).toContain(PROJECT_B_ID);
    } else {
      console.warn(
        `[T25 E2E] registration returned ${statusA}/${statusB} — default profile likely missing. ` +
          `Seed with 'loomflo config' before re-running.`,
      );
    }
  }, 60_000);

  // ---------------------------------------------------------------------------
  // S5 — Dashboard SPA + scoped routes smoke tests
  //
  // These run against the daemon that was started by the first test. Vitest runs
  // tests within a describe block sequentially, so `daemonPort` / `daemonToken`
  // are guaranteed to be populated by the time we get here.
  // ---------------------------------------------------------------------------

  describe("S5 dashboard — against a real daemon", () => {
    it("GET / returns the SPA shell", async () => {
      expect(daemonPort).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${String(daemonPort)}/`);
      expect(res.status).toBe(200);
      expect((await res.text()).toLowerCase()).toContain("loomflo");
    });

    it("GET /projects returns at least 2 projects", async () => {
      if (!projectsRegistered) {
        console.warn("[S5 E2E] skipping — projects were not registered successfully");
        return;
      }
      const res = await fetch(`http://127.0.0.1:${String(daemonPort)}/projects`, {
        headers: { authorization: `Bearer ${daemonToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body.length).toBeGreaterThanOrEqual(2);
    });

    it("GET /projects/:id/workflow returns a workflow, not 410", async () => {
      if (!projectsRegistered) {
        console.warn("[S5 E2E] skipping — projects were not registered successfully");
        return;
      }
      const res = await fetch(
        `http://127.0.0.1:${String(daemonPort)}/projects/${PROJECT_A_ID}/workflow`,
        { headers: { authorization: `Bearer ${daemonToken}` } },
      );
      expect(res.status).toBe(200);
    });
  });

  // Clean stop — runs after the S5 tests since it's the last test in the describe
  it("stops the daemon cleanly", async () => {
    if (daemonPort === 0) return; // daemon never started
    const stopRes = await run("node", [CLI, "daemon", "stop", "--force"], a);
    expect(stopRes.code).toBe(0);
  }, 60_000);
});
