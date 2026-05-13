// ============================================================================
// Integration: credentials CRUD via the real ApiClient + hook
//
// Mocks fetch so we can drive the daemon contract end-to-end and validate
// the hook + ApiClient + REST surface compose correctly.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiClient } from "../../src/lib/api.js";

let api: ApiClient;
let credentials: Array<{ name: string; type: string }> = [];

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
}));

import { useCredentials } from "../../src/hooks/useCredentials.js";

beforeEach(() => {
  credentials = [{ name: "anthropic", type: "anthropic-oauth" }];
  api = new ApiClient({ baseUrl: "http://daemon", token: "tok" });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url === "http://daemon/credentials" && method === "GET") {
      return new Response(JSON.stringify({ credentials }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("http://daemon/credentials/") && method === "PUT") {
      const name = decodeURIComponent(url.split("/").pop()!);
      const body = JSON.parse(init!.body as string) as { type: string };
      const existing = credentials.find((c) => c.name === name);
      const cred = { name, type: body.type };
      if (existing) Object.assign(existing, cred);
      else credentials.push(cred);
      return new Response(JSON.stringify({ credential: cred }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("http://daemon/credentials/") && method === "DELETE") {
      const name = decodeURIComponent(url.split("/").pop()!);
      credentials = credentials.filter((c) => c.name !== name);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("credentials CRUD", () => {
  it("loads, adds, and removes a credential through the live API", async () => {
    const { result } = renderHook(() => useCredentials());
    await waitFor(() => expect(result.current.credentials).toHaveLength(1));

    await act(async () => {
      await result.current.upsert("openai", { type: "openai", apiKey: "sk-x" });
    });
    await waitFor(() => expect(result.current.credentials).toHaveLength(2));
    expect(result.current.credentials.some((c) => c.name === "openai")).toBe(true);

    await act(async () => {
      await result.current.remove("anthropic");
    });
    await waitFor(() => expect(result.current.credentials).toHaveLength(1));
    expect(result.current.credentials.some((c) => c.name === "anthropic")).toBe(false);
  });
});
