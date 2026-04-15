// packages/cli/tests/integration/concurrent-start.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "@loomflo/core";

describe("concurrent start file lock", () => {
  let tmpDir: string;
  let lockFile: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "loomflo-lock-"));
    lockFile = join(tmpDir, "daemon.lock");
    await writeFile(lockFile, "");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("serialises three concurrent critical sections via the lock file", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const critical = async (): Promise<void> => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 25));
      concurrent--;
    };

    await Promise.all([
      withFileLock(lockFile, critical, { timeoutMs: 5000 }),
      withFileLock(lockFile, critical, { timeoutMs: 5000 }),
      withFileLock(lockFile, critical, { timeoutMs: 5000 }),
    ]);

    expect(maxConcurrent).toBe(1);
  });
});
