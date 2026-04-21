import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../src/daemon-control.js", () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue({ port: 42000, token: "t", pid: 9, version: "0.3.0" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../../src/onboarding/index.js", () => ({
  runWizard: vi.fn().mockResolvedValue({
    confirmed: true,
    providerProfileId: "default",
    answers: {
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
      validatorRetryDelay: 500,
      validatorMaxAttempts: 3,
    },
  }),
}));

vi.mock("../../../src/onboarding/prompts.inquirer.js", () => ({
  inquirerBackend: {
    input: vi.fn(),
    password: vi.fn(),
    confirm: vi.fn().mockResolvedValue(false),
    select: vi.fn(),
    number: vi.fn(),
  },
}));

let tmp: string;
let stdoutWrites: string[];
let stderrWrites: string[];

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "loomflo-init-wf-"));
  await mkdir(join(tmp, ".loomflo"), { recursive: true });
  process.chdir(tmp);
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

  const { runWizard } = await import("../../../src/onboarding/index.js");
  (runWizard as ReturnType<typeof vi.fn>).mockReset();
  (runWizard as ReturnType<typeof vi.fn>).mockResolvedValue({
    confirmed: true,
    providerProfileId: "default",
    answers: {
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
      validatorRetryDelay: 500,
      validatorMaxAttempts: 3,
    },
  });

  const { ensureDaemonRunning } = await import("../../../src/daemon-control.js");
  (ensureDaemonRunning as ReturnType<typeof vi.fn>).mockReset();
  (ensureDaemonRunning as ReturnType<typeof vi.fn>).mockResolvedValue({
    port: 42000,
    token: "t",
    pid: 9,
    version: "0.3.0",
  });

  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/workflow/init") && init?.method === "POST") {
      return { ok: true, status: 201, json: async () => ({ id: "wf_1", status: "spec", description: "x" }) };
    }
    if (u.endsWith("/workflow")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "wf_1",
          status: "building",
          description: "x",
          projectPath: tmp,
          totalCost: 0,
          createdAt: "",
          updatedAt: "",
          graph: { nodes: { a: {}, b: {} }, edges: [], topology: "linear" },
        }),
      };
    }
    if (u.includes("/projects/") && (!init || !init.method || init.method === "GET")) {
      return { ok: false, status: 404, json: async () => null };
    }
    if (u.endsWith("/projects") && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ id: "proj_x", name: "sandbox" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  stdoutWrites = [];
  stderrWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => {
    stderrWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loomflo init — workflow seeding", () => {
  it("non-interactive with --description runs workflow init and reports nodes", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync([
      "node",
      "init",
      "--description",
      "build a todo app",
      "--yes",
    ]);
    const out = stdoutWrites.join("");
    expect(out).toContain("workflow");
    expect(out).toContain("ready");
    expect(out).toContain("2 nodes");
    // POST /workflow/init was called
    const calls = mockFetch.mock.calls.map((c) => String(c[0] as string));
    expect(calls.some((u) => u.endsWith("/workflow/init"))).toBe(true);
    expect(process.exitCode).not.toBe(1);
  });

  it("non-interactive with --skip-workflow prints the hint and does not call /workflow/init", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--skip-workflow", "--yes"]);
    const out = stdoutWrites.join("");
    expect(out).toContain("loomflo workflow init");
    const calls = mockFetch.mock.calls.map((c) => String(c[0] as string));
    expect(calls.some((u) => u.endsWith("/workflow/init"))).toBe(false);
  });

  it("non-interactive without description or skip exits 1 with E_INIT", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--yes"]);
    expect(process.exitCode).toBe(1);
    const err = stderrWrites.join("");
    expect(err).toContain("--description");
  });

  it("json mode with --description emits the workflow in the payload", async () => {
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync([
      "node",
      "init",
      "--json",
      "--description",
      "make thing",
      "--yes",
    ]);
    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as {
      workflow: { id: string; status: string; nodeCount: number } | null;
    };
    expect(parsed.workflow).toEqual({ id: "wf_1", status: "building", nodeCount: 2 });
  });

  it("surfaces 409 conflict from /workflow/init as an error exit", async () => {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/workflow/init") && init?.method === "POST") {
        return { ok: false, status: 409, json: async () => ({ error: "A workflow is already active" }) };
      }
      if (u.includes("/projects/") && (!init || !init.method || init.method === "GET")) {
        return { ok: false, status: 404, json: async () => null };
      }
      if (u.endsWith("/projects") && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ id: "proj_x", name: "sandbox" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const { createInitCommand } = await import("../../../src/commands/init.js");
    await createInitCommand().parseAsync([
      "node",
      "init",
      "--description",
      "x",
      "--yes",
    ]);
    expect(process.exitCode).toBe(1);
  });
});
