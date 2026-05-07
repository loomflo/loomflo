// ============================================================================
// Integration: the full create-project flow at the API level.
//
// Validates the contract the wizard relies on: PUT /credentials, then
// POST /projects with the right shape. Doesn't drive the wizard UI itself
// (1664 LOC) but exercises the API interactions the wizard issues.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/lib/api.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("create-project flow", () => {
  it("upsertCredential then createProject sends the expected REST contract", async () => {
    const api = new ApiClient({ baseUrl: "http://daemon", token: "tok" });

    fetchMock
      .mockResolvedValueOnce(
        jsonRes({ credential: { name: "openai", type: "openai", apiKeyPreview: "sk-…x" } }),
      )
      .mockResolvedValueOnce(
        jsonRes({
          id: "proj_aaaaaaaa",
          name: "demo",
          projectPath: "/tmp/demo",
          providerProfileId: "openai",
          status: "idle",
          startedAt: "t",
          cost: 0,
          currentNodeId: null,
        }),
      );

    await api.upsertCredential("openai", { type: "openai", apiKey: "sk-secret" });
    const project = await api.createProject({
      id: "proj_aaaaaaaa",
      name: "demo",
      projectPath: "/tmp/demo",
      providerProfileId: "openai",
    });

    expect(project.id).toBe("proj_aaaaaaaa");

    const [credCall, projCall] = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(credCall![0]).toBe("http://daemon/credentials/openai");
    expect(credCall![1].method).toBe("PUT");
    expect(JSON.parse(credCall![1].body as string)).toEqual({
      type: "openai",
      apiKey: "sk-secret",
    });

    expect(projCall![0]).toBe("http://daemon/projects");
    expect(projCall![1].method).toBe("POST");
    const body = JSON.parse(projCall![1].body as string);
    expect(body).toMatchObject({
      id: "proj_aaaaaaaa",
      name: "demo",
      providerProfileId: "openai",
    });
  });

  it("propagates ApiError when the daemon rejects the create", async () => {
    const api = new ApiClient({ baseUrl: "http://daemon", token: "tok" });
    fetchMock.mockResolvedValueOnce(jsonRes({ error: "bad project id" }, 400));
    await expect(
      api.createProject({
        id: "bad-id",
        name: "x",
        projectPath: "/tmp",
        providerProfileId: "default",
      }),
    ).rejects.toThrow();
  });
});
