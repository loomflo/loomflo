import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import stripAnsi from "strip-ansi";

vi.mock("../../src/client.js", () => ({
  readDaemonConfig: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:os", () => ({
  platform: vi.fn(() => "linux"),
}));

import { exec } from "node:child_process";
import { readDaemonConfig } from "../../src/client.js";
import { createDashboardCommand } from "../../src/commands/dashboard.js";

const mockReadDaemonConfig = readDaemonConfig as ReturnType<typeof vi.fn>;
const mockExec = exec as unknown as ReturnType<typeof vi.fn>;

let stdoutWrites: string[];

beforeEach(() => {
  stdoutWrites = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    stdoutWrites.push(typeof c === "string" ? c : c.toString());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  mockReadDaemonConfig.mockReset();
  mockExec.mockReset().mockImplementation(() => {});
  mockReadDaemonConfig.mockResolvedValue({ port: 41234, token: "tok-abc", pid: 1 });
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("loomflo dashboard — token fragment", () => {
  it("prints a URL containing #token=<token>", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard", "--no-open"]);
    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("http://127.0.0.1:41234/#token=tok-abc");
  });

  it("passes the fragment URL to the browser open command", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard"]);
    const [command] = mockExec.mock.calls[0] as [string];
    expect(command).toContain("#token=tok-abc");
  });

  it("omits token fragment when --port is used (no daemon config)", async () => {
    const cmd = createDashboardCommand();
    cmd.exitOverride();
    await cmd.parseAsync(["node", "dashboard", "--port", "8080", "--no-open"]);
    const plain = stdoutWrites.map(stripAnsi).join("");
    expect(plain).toContain("http://127.0.0.1:8080");
    expect(plain).not.toContain("#token=");
  });
});
