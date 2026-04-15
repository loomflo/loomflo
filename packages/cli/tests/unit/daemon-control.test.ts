import { describe, it, expect } from "vitest";
import { isCompatibleVersion, MIN_DAEMON_VERSION } from "../../src/daemon-control.js";

describe("daemon-control", () => {
  it("accepts 0.2.0 as compatible", () => {
    expect(isCompatibleVersion("0.2.0")).toBe(true);
  });

  it("rejects 0.1.0", () => {
    expect(isCompatibleVersion("0.1.0")).toBe(false);
  });

  it("accepts higher 0.2.x patch versions", () => {
    expect(isCompatibleVersion("0.2.3")).toBe(true);
  });

  it("rejects a missing version string", () => {
    expect(isCompatibleVersion(undefined)).toBe(false);
  });

  it("exposes the minimum version constant", () => {
    expect(MIN_DAEMON_VERSION).toBe("0.2.0");
  });
});
