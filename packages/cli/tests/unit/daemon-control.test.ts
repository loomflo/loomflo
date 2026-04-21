import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { isCompatibleVersion, MIN_DAEMON_VERSION, findOrphanDaemonPid } from "../../src/daemon-control.js";

describe("daemon-control", () => {
  it("accepts 0.3.0 as compatible", () => {
    expect(isCompatibleVersion("0.3.0")).toBe(true);
  });

  it("rejects 0.1.0", () => {
    expect(isCompatibleVersion("0.1.0")).toBe(false);
  });

  it("accepts higher 0.3.x patch versions", () => {
    expect(isCompatibleVersion("0.3.3")).toBe(true);
  });

  it("rejects 0.2.x as below minimum", () => {
    expect(isCompatibleVersion("0.2.3")).toBe(false);
  });

  it("rejects a missing version string", () => {
    expect(isCompatibleVersion(undefined)).toBe(false);
  });

  it("exposes the minimum version constant", () => {
    expect(MIN_DAEMON_VERSION).toBe("0.3.0");
  });
});

// ---------------------------------------------------------------------------
// findOrphanDaemonPid: /proc-based orphan scan (Linux only)
// ---------------------------------------------------------------------------

// These tests only run on Linux — on other platforms the helper always returns null.
const describeLinux = platform() === "linux" ? describe : describe.skip;

describeLinux("findOrphanDaemonPid", () => {
  let fakeProc: string;

  beforeEach(async () => {
    fakeProc = await mkdtemp(join(tmpdir(), "loomflo-proc-"));
  });

  afterEach(async () => {
    await rm(fakeProc, { recursive: true, force: true });
  });

  /** Create a numeric PID directory with the given NUL-separated cmdline. */
  async function mkPid(pid: string, cmdline: string): Promise<void> {
    const dir = join(fakeProc, pid);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "cmdline"), cmdline, { encoding: "utf-8" });
  }

  it("returns a single orphan PID when exactly one daemon-entry.js is running", async () => {
    await mkPid("1111", "node\0/home/u/loomflo/packages/core/dist/daemon-entry.js\0");
    await mkPid("2222", "bash\0");
    // self directory should be ignored even if it looks numeric
    const pid = await findOrphanDaemonPid({ procRoot: fakeProc, isAlive: () => true });
    expect(pid).toBe(1111);
  });

  it("returns null when no daemon-entry.js is present", async () => {
    await mkPid("3333", "node\0/usr/bin/other.js\0");
    await mkPid("4444", "bash\0");
    const pid = await findOrphanDaemonPid({ procRoot: fakeProc, isAlive: () => true });
    expect(pid).toBeNull();
  });

  it("returns null when multiple daemon-entry.js processes are found (ambiguous)", async () => {
    await mkPid("5555", "node\0/a/core/dist/daemon-entry.js\0");
    await mkPid("6666", "node\0/b/core/dist/daemon-entry.js\0");
    const pid = await findOrphanDaemonPid({ procRoot: fakeProc, isAlive: () => true });
    expect(pid).toBeNull();
  });

  it("ignores entries whose liveness check fails", async () => {
    await mkPid("7777", "node\0/x/core/dist/daemon-entry.js\0");
    const pid = await findOrphanDaemonPid({ procRoot: fakeProc, isAlive: () => false });
    expect(pid).toBeNull();
  });

  it("ignores non-numeric /proc entries (e.g. 'self', 'thread-self')", async () => {
    const selfDir = join(fakeProc, "self");
    await mkdir(selfDir, { recursive: true });
    await writeFile(join(selfDir, "cmdline"), "node\0daemon-entry.js\0");
    await mkPid("8888", "node\0/y/core/dist/daemon-entry.js\0");
    const pid = await findOrphanDaemonPid({ procRoot: fakeProc, isAlive: () => true });
    expect(pid).toBe(8888);
  });

  it("returns null when procRoot cannot be read", async () => {
    const pid = await findOrphanDaemonPid({
      procRoot: join(fakeProc, "does-not-exist"),
      isAlive: () => true,
    });
    expect(pid).toBeNull();
  });
});
