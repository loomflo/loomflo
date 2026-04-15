import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((): never => {
    throw new Error("process.exit");
  });

  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

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

describe("loomflo resume — themed output", () => {
  it("prints check-line with resume info via process.stdout.write", async () => {
    mockRequest.mockResolvedValue({
      status: "running",
      resumeInfo: {
        resumedFrom: "node-3",
        completedNodeIds: ["node-1", "node-2"],
        resetNodeIds: ["node-3"],
        rescheduledNodeIds: [],
      },
    });

    const cmd = createResumeCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "resume"]);

    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("\u2713");
    expect(plain).toContain("resumed");
  });
});

describe("loomflo resume --json", () => {
  it("prints a JSON record with resume info", async () => {
    mockRequest.mockResolvedValue({
      status: "running",
      resumeInfo: {
        resumedFrom: "node-3",
        completedNodeIds: ["node-1"],
        resetNodeIds: ["node-3"],
        rescheduledNodeIds: [],
      },
    });

    const cmd = createResumeCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "resume", "--json"]);

    const raw = stdoutWrites.join("").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("resumeInfo");
  });
});
