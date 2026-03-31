import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler, parseDelay } from "../../src/workflow/scheduler.js";

// ===========================================================================
// parseDelay
// ===========================================================================

describe("parseDelay", () => {
  it("returns 0 for undefined", () => {
    expect(parseDelay(undefined)).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(parseDelay("")).toBe(0);
  });

  it('returns 0 for "0"', () => {
    expect(parseDelay("0")).toBe(0);
  });

  it("parses seconds", () => {
    expect(parseDelay("30s")).toBe(30_000);
    expect(parseDelay("1s")).toBe(1_000);
  });

  it("parses minutes", () => {
    expect(parseDelay("5m")).toBe(300_000);
    expect(parseDelay("30m")).toBe(1_800_000);
  });

  it("parses hours", () => {
    expect(parseDelay("1h")).toBe(3_600_000);
    expect(parseDelay("2h")).toBe(7_200_000);
  });

  it("parses days", () => {
    expect(parseDelay("1d")).toBe(86_400_000);
  });

  it("treats bare number as seconds", () => {
    expect(parseDelay("10")).toBe(10_000);
  });

  it('returns 0 for "0s", "0m", "0h", "0d"', () => {
    expect(parseDelay("0s")).toBe(0);
    expect(parseDelay("0m")).toBe(0);
    expect(parseDelay("0h")).toBe(0);
    expect(parseDelay("0d")).toBe(0);
  });

  it("throws on invalid format", () => {
    expect(() => parseDelay("abc")).toThrow("Invalid delay format");
    expect(() => parseDelay("10x")).toThrow("Invalid delay format");
    expect(() => parseDelay("-5s")).toThrow("Invalid delay format");
    expect(() => parseDelay("1.5h")).toThrow("Invalid delay format");
  });
});

// ===========================================================================
// Scheduler
// ===========================================================================

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.cancelAll();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // scheduleNode
  // -----------------------------------------------------------------------

  describe("scheduleNode", () => {
    it("calls callback synchronously for zero delay", () => {
      const cb = vi.fn();
      scheduler.scheduleNode("node-1", "0", cb);
      expect(cb).toHaveBeenCalledOnce();
      expect(scheduler.isScheduled("node-1")).toBe(false);
    });

    it("calls callback synchronously for empty string delay", () => {
      const cb = vi.fn();
      scheduler.scheduleNode("node-1", "", cb);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("schedules callback for non-zero delay", () => {
      const cb = vi.fn();
      scheduler.scheduleNode("node-1", "10s", cb);

      expect(cb).not.toHaveBeenCalled();
      expect(scheduler.isScheduled("node-1")).toBe(true);

      vi.advanceTimersByTime(10_000);
      expect(cb).toHaveBeenCalledOnce();
      expect(scheduler.isScheduled("node-1")).toBe(false);
    });

    it("computes correct resumeAt timestamp", () => {
      const now = new Date("2026-03-27T12:00:00.000Z");
      vi.setSystemTime(now);

      scheduler.scheduleNode("node-1", "5m", vi.fn());

      const resumeAt = scheduler.getResumeAt("node-1");
      expect(resumeAt).toBe("2026-03-27T12:05:00.000Z");
    });

    it("throws if node is already scheduled", () => {
      scheduler.scheduleNode("node-1", "10s", vi.fn());
      expect(() => scheduler.scheduleNode("node-1", "5s", vi.fn())).toThrow("already scheduled");
    });

    it("throws on invalid delay format", () => {
      expect(() => scheduler.scheduleNode("node-1", "bad", vi.fn())).toThrow(
        "Invalid delay format",
      );
    });
  });

  // -----------------------------------------------------------------------
  // cancelNode
  // -----------------------------------------------------------------------

  describe("cancelNode", () => {
    it("cancels a pending timer", () => {
      const cb = vi.fn();
      scheduler.scheduleNode("node-1", "10s", cb);
      scheduler.cancelNode("node-1");

      expect(scheduler.isScheduled("node-1")).toBe(false);

      vi.advanceTimersByTime(10_000);
      expect(cb).not.toHaveBeenCalled();
    });

    it("throws if node is not scheduled", () => {
      expect(() => scheduler.cancelNode("node-1")).toThrow("not scheduled");
    });
  });

  // -----------------------------------------------------------------------
  // getResumeAt
  // -----------------------------------------------------------------------

  describe("getResumeAt", () => {
    it("returns null for unscheduled node", () => {
      expect(scheduler.getResumeAt("node-1")).toBeNull();
    });

    it("returns ISO timestamp for scheduled node", () => {
      vi.setSystemTime(new Date("2026-03-27T10:00:00.000Z"));
      scheduler.scheduleNode("node-1", "1h", vi.fn());
      expect(scheduler.getResumeAt("node-1")).toBe("2026-03-27T11:00:00.000Z");
    });
  });

  // -----------------------------------------------------------------------
  // getRemainingMs
  // -----------------------------------------------------------------------

  describe("getRemainingMs", () => {
    it("returns 0 for unscheduled node", () => {
      expect(scheduler.getRemainingMs("node-1")).toBe(0);
    });

    it("returns remaining time accurately", () => {
      vi.setSystemTime(new Date("2026-03-27T10:00:00.000Z"));
      scheduler.scheduleNode("node-1", "30s", vi.fn());

      vi.advanceTimersByTime(10_000);
      expect(scheduler.getRemainingMs("node-1")).toBe(20_000);
    });

    it("returns 0 when past due", () => {
      vi.setSystemTime(new Date("2026-03-27T10:00:00.000Z"));
      scheduler.scheduleNode("node-1", "5s", vi.fn());

      // Manually advance system time past the resumeAt without triggering timers
      vi.setSystemTime(new Date("2026-03-27T10:00:10.000Z"));
      expect(scheduler.getRemainingMs("node-1")).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // isScheduled
  // -----------------------------------------------------------------------

  describe("isScheduled", () => {
    it("returns false for unknown node", () => {
      expect(scheduler.isScheduled("node-1")).toBe(false);
    });

    it("returns true for scheduled node", () => {
      scheduler.scheduleNode("node-1", "10s", vi.fn());
      expect(scheduler.isScheduled("node-1")).toBe(true);
    });

    it("returns false after timer fires", () => {
      scheduler.scheduleNode("node-1", "10s", vi.fn());
      vi.advanceTimersByTime(10_000);
      expect(scheduler.isScheduled("node-1")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // rescheduleFromPersistence
  // -----------------------------------------------------------------------

  describe("rescheduleFromPersistence", () => {
    it("executes immediately when resumeAt is in the past", () => {
      vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
      const cb = vi.fn();

      scheduler.rescheduleFromPersistence("node-1", "2026-03-27T11:00:00.000Z", cb);

      expect(cb).toHaveBeenCalledOnce();
      expect(scheduler.isScheduled("node-1")).toBe(false);
    });

    it("schedules remaining time when resumeAt is in the future", () => {
      vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
      const cb = vi.fn();

      scheduler.rescheduleFromPersistence("node-1", "2026-03-27T12:00:30.000Z", cb);

      expect(cb).not.toHaveBeenCalled();
      expect(scheduler.isScheduled("node-1")).toBe(true);
      expect(scheduler.getRemainingMs("node-1")).toBe(30_000);

      vi.advanceTimersByTime(30_000);
      expect(cb).toHaveBeenCalledOnce();
      expect(scheduler.isScheduled("node-1")).toBe(false);
    });

    it("executes immediately when resumeAt equals now", () => {
      vi.setSystemTime(new Date("2026-03-27T12:00:00.000Z"));
      const cb = vi.fn();

      scheduler.rescheduleFromPersistence("node-1", "2026-03-27T12:00:00.000Z", cb);

      expect(cb).toHaveBeenCalledOnce();
    });

    it("throws if node is already scheduled", () => {
      scheduler.scheduleNode("node-1", "10s", vi.fn());
      expect(() =>
        scheduler.rescheduleFromPersistence("node-1", "2026-03-27T13:00:00.000Z", vi.fn()),
      ).toThrow("already scheduled");
    });
  });

  // -----------------------------------------------------------------------
  // cancelAll
  // -----------------------------------------------------------------------

  describe("cancelAll", () => {
    it("cancels all pending timers", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      scheduler.scheduleNode("node-1", "10s", cb1);
      scheduler.scheduleNode("node-2", "20s", cb2);

      scheduler.cancelAll();

      expect(scheduler.getScheduledCount()).toBe(0);
      vi.advanceTimersByTime(20_000);
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();
    });

    it("is safe to call when no timers exist", () => {
      expect(() => scheduler.cancelAll()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // getScheduledCount
  // -----------------------------------------------------------------------

  describe("getScheduledCount", () => {
    it("returns 0 when empty", () => {
      expect(scheduler.getScheduledCount()).toBe(0);
    });

    it("tracks scheduled nodes correctly", () => {
      scheduler.scheduleNode("node-1", "10s", vi.fn());
      scheduler.scheduleNode("node-2", "20s", vi.fn());
      expect(scheduler.getScheduledCount()).toBe(2);

      vi.advanceTimersByTime(10_000);
      expect(scheduler.getScheduledCount()).toBe(1);

      vi.advanceTimersByTime(10_000);
      expect(scheduler.getScheduledCount()).toBe(0);
    });
  });
});
