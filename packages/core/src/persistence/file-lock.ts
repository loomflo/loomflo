import lockfile from "proper-lockfile";

/** Thrown when the lock cannot be acquired within the configured timeout. */
export class FileLockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Could not acquire file lock on ${path} within ${String(timeoutMs)}ms`);
    this.name = "FileLockTimeoutError";
  }
}

/** Options for {@link withFileLock}. */
export interface WithFileLockOptions {
  /** Maximum time to wait for the lock (milliseconds). */
  timeoutMs: number;
  /** Interval between retry attempts (milliseconds). Default: 50. */
  retryIntervalMs?: number;
}

/** Serialise a critical section behind an advisory file lock. */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: WithFileLockOptions,
): Promise<T> {
  const retryIntervalMs = options.retryIntervalMs ?? 50;
  const maxRetries = Math.max(1, Math.ceil(options.timeoutMs / retryIntervalMs));

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(filePath, {
      retries: {
        retries: maxRetries,
        minTimeout: retryIntervalMs,
        maxTimeout: retryIntervalMs,
      },
      stale: 10_000,
    });
  } catch (err) {
    if ((err as Error).message.includes("Lock file is already being held")) {
      throw new FileLockTimeoutError(filePath, options.timeoutMs);
    }
    throw err;
  }

  try {
    return await fn();
  } finally {
    await release().catch(() => undefined);
  }
}
