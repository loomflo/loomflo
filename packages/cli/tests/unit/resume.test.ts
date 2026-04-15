import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

const mockRequest = vi.fn();
const mockResolveProject = vi.fn();
const mockOpenClient = vi.fn();

vi.mock("../../src/project-resolver.js", () => ({
  resolveProject: (...a: unknown[]) => mockResolveProject(...a),
}));

vi.mock("../../src/client.js", () => ({
  openClient: (...a: unknown[]) => mockOpenClient(...a),
}));

import { createResumeCommand } from "../../src/commands/resume.js";

const IDENTITY = {
  id: "proj_abc12345",
  name: "test-proj",
  providerProfileId: "default",
  createdAt: "2026-04-15T00:00:00Z",
};

let stdoutWrites: string[];
let stderrWrites: string[];

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
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

  mockRequest.mockReset();
  mockResolveProject.mockReset();
  mockOpenClient.mockReset();

  mockResolveProject.mockResolvedValue({
    identity: IDENTITY,
    projectRoot: "/tmp/test",
    created: false,
  });

  mockOpenClient.mockResolvedValue({
    projectId: IDENTITY.id,
    info: { port: 4000, token: "t", pid: 1234, version: "0.2.0" },
    request: mockRequest,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function runResume(args: string[] = ["node", "resume"]): Promise<void> {
  const cmd = createResumeCommand();
  cmd.exitOverride();
  await cmd.parseAsync(args);
}

function stdoutPlain(): string {
  return stdoutWrites.map(stripAnsi).join("");
}

describe("resume command — happy path", () => {
  it("should display resume summary with completed, reset, rescheduled, and resumedFrom", async () => {
    mockRequest.mockResolvedValue({
      status: "running",
      resumeInfo: {
        resumedFrom: "node-3",
        completedNodeIds: ["node-1", "node-2"],
        resetNodeIds: ["node-3", "node-4"],
        rescheduledNodeIds: ["node-5"],
      },
    });

    await runResume();

    const plain = stdoutPlain();
    expect(plain).toContain("\u2713");
    expect(plain).toContain("resumed");
    expect(plain).toContain("2 completed nodes");
    expect(plain).toContain("2 interrupted nodes");
    expect(plain).toContain("node-3");
    expect(plain).toContain("node-4");
    expect(plain).toContain("1 nodes");
    expect(plain).toContain("node-3");
  });
});

describe("resume command — daemon not running", () => {
  it("should write error to stderr when openClient rejects", async () => {
    mockOpenClient.mockRejectedValue(
      new Error("Daemon is not running. Run 'loomflo start' first."),
    );

    await runResume();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("Daemon is not running");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe("resume command — request error", () => {
  it("should write error to stderr when request throws", async () => {
    mockRequest.mockRejectedValue(new Error("POST /workflow/resume -> HTTP 409"));

    await runResume();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("POST /workflow/resume -> HTTP 409");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe("resume command — not a loomflo project", () => {
  it("should write error to stderr when resolveProject rejects", async () => {
    mockResolveProject.mockRejectedValue(
      new Error("/tmp is not a loomflo project (no .loomflo/project.json found)."),
    );

    await runResume();

    const plain = stderrWrites.map(stripAnsi).join("");
    expect(plain).toContain("not a loomflo project");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe("resume command — minimal resume info", () => {
  it("should skip optional sections when arrays are empty and resumedFrom is null", async () => {
    mockRequest.mockResolvedValue({
      status: "running",
      resumeInfo: {
        resumedFrom: null,
        completedNodeIds: [],
        resetNodeIds: [],
        rescheduledNodeIds: [],
      },
    });

    await runResume();

    const plain = stdoutPlain();
    expect(plain).toContain("resumed");
    expect(plain).not.toContain("completed nodes");
    expect(plain).not.toContain("interrupted nodes");
  });
});
