/**
 * Scheduler for managing node delay timers.
 *
 * Handles the 'waiting' state: when a node becomes eligible (predecessors done),
 * the scheduler manages the countdown via {@link setTimeout}. Supports delay
 * string parsing, resumeAt timestamp persistence, and restart recovery.
 */

/** Internal state for a scheduled node timer. */
interface ScheduledEntry {
  /** The setTimeout handle for cancellation. */
  timer: ReturnType<typeof setTimeout>;
  /** ISO 8601 absolute timestamp when the delay expires. */
  resumeAt: string;
  /** The callback to invoke when the delay expires. */
  callback: () => void;
}

/** Regex for parsing delay strings: digits followed by an optional unit (s, m, h, d). */
const DELAY_PATTERN = /^(\d+)([smhd])?$/;

/** Multipliers to convert delay units to milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a delay string into milliseconds.
 *
 * @param delay - Delay string (e.g., "30s", "5m", "1h", "1d", "0", "").
 * @returns Milliseconds represented by the delay string.
 * @throws Error if the delay string format is invalid.
 */
export function parseDelay(delay: string | undefined): number {
  if (delay === undefined || delay === "" || delay === "0") {
    return 0;
  }

  const match = DELAY_PATTERN.exec(delay);
  if (!match) {
    throw new Error(
      `Invalid delay format: "${delay}". ` +
        'Expected "0", "", or a number followed by s/m/h/d (e.g., "30s", "5m", "1h", "1d").',
    );
  }

  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multiplier = UNIT_MS[unit];

  if (multiplier === undefined) {
    throw new Error(`Unknown delay unit: "${unit}".`);
  }

  if (value === 0) {
    return 0;
  }

  return value * multiplier;
}

/**
 * Manages node delay scheduling using {@link setTimeout}.
 *
 * When a node enters the 'waiting' state, the scheduler computes the
 * absolute `resumeAt` timestamp and starts a timer. The `resumeAt` value
 * can be persisted in `workflow.json` so that on restart, the scheduler
 * can recover: if past due, it fires immediately; if still in the future,
 * it schedules the remaining time.
 */
export class Scheduler {
  private readonly entries: Map<string, ScheduledEntry> = new Map();

  /**
   * Schedules a node to fire after the given delay.
   *
   * If the delay resolves to zero milliseconds, the callback is invoked
   * synchronously and no timer entry is stored.
   *
   * @param nodeId - Unique identifier of the node to schedule.
   * @param delay - Delay string (e.g., "30s", "5m", "1h", "1d", "0", "").
   * @param callback - Function to invoke when the delay expires.
   * @throws Error if the node is already scheduled.
   * @throws Error if the delay string format is invalid.
   */
  scheduleNode(nodeId: string, delay: string, callback: () => void): void {
    if (this.entries.has(nodeId)) {
      throw new Error(`Node "${nodeId}" is already scheduled.`);
    }

    const ms = parseDelay(delay);

    if (ms === 0) {
      callback();
      return;
    }

    const resumeAt = new Date(Date.now() + ms).toISOString();
    const timer = setTimeout(() => {
      this.entries.delete(nodeId);
      callback();
    }, ms);

    this.entries.set(nodeId, { timer, resumeAt, callback });
  }

  /**
   * Cancels a pending timer for a node.
   *
   * @param nodeId - Unique identifier of the node to cancel.
   * @throws Error if the node is not currently scheduled.
   */
  cancelNode(nodeId: string): void {
    const entry = this.entries.get(nodeId);
    if (!entry) {
      throw new Error(`Node "${nodeId}" is not scheduled.`);
    }
    clearTimeout(entry.timer);
    this.entries.delete(nodeId);
  }

  /**
   * Returns the ISO 8601 resumeAt timestamp for a scheduled node.
   *
   * @param nodeId - Unique identifier of the node.
   * @returns The ISO 8601 timestamp when the delay expires, or `null` if not scheduled.
   */
  getResumeAt(nodeId: string): string | null {
    return this.entries.get(nodeId)?.resumeAt ?? null;
  }

  /**
   * Returns the remaining time in milliseconds for a scheduled node.
   *
   * @param nodeId - Unique identifier of the node.
   * @returns Remaining milliseconds until the delay expires, or `0` if not scheduled or past due.
   */
  getRemainingMs(nodeId: string): number {
    const entry = this.entries.get(nodeId);
    if (!entry) {
      return 0;
    }
    const remaining = new Date(entry.resumeAt).getTime() - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Checks whether a node has a pending timer.
   *
   * @param nodeId - Unique identifier of the node.
   * @returns `true` if the node is currently scheduled, `false` otherwise.
   */
  isScheduled(nodeId: string): boolean {
    return this.entries.has(nodeId);
  }

  /**
   * Reschedules a node from a persisted resumeAt timestamp (restart recovery).
   *
   * If the resumeAt time is in the past, the callback is invoked synchronously.
   * If it is in the future, a timer is set for the remaining duration.
   *
   * @param nodeId - Unique identifier of the node to reschedule.
   * @param resumeAt - ISO 8601 timestamp from persisted state.
   * @param callback - Function to invoke when the delay expires.
   * @throws Error if the node is already scheduled.
   */
  rescheduleFromPersistence(nodeId: string, resumeAt: string, callback: () => void): void {
    if (this.entries.has(nodeId)) {
      throw new Error(`Node "${nodeId}" is already scheduled.`);
    }

    const remaining = new Date(resumeAt).getTime() - Date.now();

    if (remaining <= 0) {
      callback();
      return;
    }

    const timer = setTimeout(() => {
      this.entries.delete(nodeId);
      callback();
    }, remaining);

    this.entries.set(nodeId, { timer, resumeAt, callback });
  }

  /**
   * Cancels all pending timers. Used during shutdown.
   */
  cancelAll(): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }

  /**
   * Returns the number of currently pending timers.
   *
   * @returns Count of scheduled nodes.
   */
  getScheduledCount(): number {
    return this.entries.size;
  }
}
