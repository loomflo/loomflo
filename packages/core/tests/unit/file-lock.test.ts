import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock, FileLockTimeoutError } from "../../src/persistence/file-lock.js";

describe("withFileLock", () => {
  let tmp: string;
  let lockFile: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "loomflo-lock-"));
    lockFile = join(tmp, "daemon.lock");
    await writeFile(lockFile, "");
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("runs the critical section and returns its value", async () => {
    const result = await withFileLock(lockFile, async () => 42, { timeoutMs: 1000 });
    expect(result).toBe(42);
  });

  it("serialises two concurrent critical sections", async () => {
    const log: string[] = [];
    const p1 = withFileLock(
      lockFile,
      async () => {
        log.push("p1:start");
        await new Promise((r) => setTimeout(r, 30));
        log.push("p1:end");
        return "a";
      },
      { timeoutMs: 2000 },
    );
    const p2 = withFileLock(
      lockFile,
      async () => {
        log.push("p2:start");
        await new Promise((r) => setTimeout(r, 10));
        log.push("p2:end");
        return "b";
      },
      { timeoutMs: 2000 },
    );
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe("a");
    expect(b).toBe("b");
    const p1Start = log.indexOf("p1:start");
    const p1End = log.indexOf("p1:end");
    const p2Start = log.indexOf("p2:start");
    const p2End = log.indexOf("p2:end");
    expect(p1End).toBeLessThan(p2Start);
    expect(p2End).toBeGreaterThan(p1End);
  });

  it("throws FileLockTimeoutError when the lock cannot be acquired in time", async () => {
    const holder = withFileLock(
      lockFile,
      async () => {
        await new Promise((r) => setTimeout(r, 500));
      },
      { timeoutMs: 2000 },
    );
    await expect(withFileLock(lockFile, async () => 1, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      FileLockTimeoutError,
    );
    await holder;
  });
});
