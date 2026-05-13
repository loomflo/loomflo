import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearStoredToken, clearTokenFromHash, readToken } from "../../src/lib/token.js";

const ORIGIN = "http://localhost:3000";

function setHash(hash: string): void {
  window.history.replaceState({}, "", `${ORIGIN}/${hash ? "#" + hash : ""}`);
}

beforeEach(() => {
  sessionStorage.clear();
  setHash("");
});

afterEach(() => {
  sessionStorage.clear();
  setHash("");
});

describe("readToken", () => {
  it("returns null when nothing in URL or sessionStorage", () => {
    expect(readToken()).toBeNull();
  });

  it("parses a token=… hash and stores it", () => {
    setHash("token=secret-abc");
    const token = readToken();
    expect(token).toBe("secret-abc");
    expect(sessionStorage.getItem("loomflo.token")).toBe("secret-abc");
  });

  it("URL-decodes the token", () => {
    setHash("token=hello%20world");
    expect(readToken()).toBe("hello world");
  });

  it("clears the token from the URL hash after read", () => {
    setHash("token=cleanup-me");
    readToken();
    expect(window.location.hash).toBe("");
  });

  it("preserves other hash fragments after stripping the token", () => {
    setHash("foo=bar&token=abc&baz=qux");
    readToken();
    // The remaining hash should still contain foo + baz, but not token=abc.
    expect(window.location.hash).not.toContain("token=");
    expect(window.location.hash).toContain("foo=bar");
    expect(window.location.hash).toContain("baz=qux");
  });

  it("falls back to sessionStorage when hash has no token", () => {
    sessionStorage.setItem("loomflo.token", "stored-token");
    expect(readToken()).toBe("stored-token");
  });

  it("hash token wins over previously stored token", () => {
    sessionStorage.setItem("loomflo.token", "old");
    setHash("token=new");
    expect(readToken()).toBe("new");
    expect(sessionStorage.getItem("loomflo.token")).toBe("new");
  });
});

describe("clearStoredToken", () => {
  it("removes the entry from sessionStorage", () => {
    sessionStorage.setItem("loomflo.token", "x");
    clearStoredToken();
    expect(sessionStorage.getItem("loomflo.token")).toBeNull();
  });
});

describe("clearTokenFromHash", () => {
  it("is a no-op when no token in hash", () => {
    setHash("foo=bar");
    clearTokenFromHash();
    expect(window.location.hash).toBe("#foo=bar");
  });

  it("strips a leading #token=…", () => {
    setHash("token=zzz");
    clearTokenFromHash();
    expect(window.location.hash).toBe("");
  });
});

