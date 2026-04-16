import { beforeEach, describe, expect, it } from "vitest";

import { readToken, clearTokenFromHash } from "../../src/lib/token.js";

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("token", () => {
  it("reads from #token= in location.hash and stores in sessionStorage", () => {
    window.history.replaceState({}, "", "/#token=abc123");
    const t = readToken();
    expect(t).toBe("abc123");
    expect(sessionStorage.getItem("loomflo.token")).toBe("abc123");
  });

  it("falls back to sessionStorage when hash is absent", () => {
    sessionStorage.setItem("loomflo.token", "xyz");
    window.history.replaceState({}, "", "/");
    expect(readToken()).toBe("xyz");
  });

  it("returns null when neither source provides a token", () => {
    expect(readToken()).toBeNull();
  });

  it("clearTokenFromHash() removes #token=… but keeps the path", () => {
    window.history.replaceState({}, "", "/graph#token=abc");
    clearTokenFromHash();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/graph");
  });
});
