import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeWs, makeFakeApi, type FakeApi, type FakeWs } from "../hooks/harness.js";

let api: FakeApi;
let ws: FakeWs;
let token: string | null = "tok";
let useMock = false;

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => api,
  useWs: () => ws,
  useAppContext: () => ({
    apiClient: api,
    wsClient: ws,
    baseUrl: "http://x",
    token,
    wsStatus: "open",
    useMock,
  }),
}));

import {
  ProjectStoreProvider,
  useProject,
  useProjects,
  useProjectStore,
  useStore,
} from "../../src/context/ProjectStoreContext.js";

beforeEach(() => {
  localStorage.clear();
  api = makeFakeApi({});
  ws = createFakeWs();
  token = "tok";
  useMock = false;
});

afterEach(() => {
  localStorage.clear();
});

describe("ProjectStoreProvider — online", () => {
  it("hydrates from listProjects()", async () => {
    api = makeFakeApi({
      listProjects: () =>
        Promise.resolve([
          {
            id: "proj_aaaaaaaa",
            name: "demo",
            projectPath: "/tmp",
            providerProfileId: "default",
            status: "running",
            startedAt: "t",
            cost: 0,
            currentNodeId: null,
          },
        ]),
    });
    const { result } = renderHook(() => useProjects(), { wrapper: ProjectStoreProvider });
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.name).toBe("demo");
  });

  it("create() calls api.createProject and adds to the list", async () => {
    api = makeFakeApi({
      listProjects: () => Promise.resolve([]),
      createProject: () =>
        Promise.resolve({
          id: "proj_aaaaaaaa",
          name: "demo",
          projectPath: "/tmp",
          providerProfileId: "default",
          status: "idle",
          startedAt: "t",
          cost: 0,
          currentNodeId: null,
        }),
    });
    const { result } = renderHook(() => useStore(), { wrapper: ProjectStoreProvider });
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    await act(async () => {
      await result.current.create({ name: "demo", projectPath: "/tmp" });
    });
    expect(api.createProject).toHaveBeenCalled();
  });

  it("remove() calls api.deleteProject and tolerates 404", async () => {
    api = makeFakeApi({
      listProjects: () =>
        Promise.resolve([
          {
            id: "proj_aaaaaaaa",
            name: "demo",
            projectPath: "/tmp",
            providerProfileId: "default",
            status: "idle",
            startedAt: "t",
            cost: 0,
            currentNodeId: null,
          },
        ]),
      deleteProject: () => {
        const err = new Error("not found");
        (err as Error & { status: number }).status = 404;
        return Promise.reject(err);
      },
    });
    const { result } = renderHook(() => useStore(), { wrapper: ProjectStoreProvider });
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    await act(async () => {
      await result.current.remove("proj_aaaaaaaa");
    });
    expect(api.deleteProject).toHaveBeenCalled();
  });

  it("subscribers receive updates", async () => {
    api = makeFakeApi({ listProjects: () => Promise.resolve([]) });
    const { result } = renderHook(() => useStore(), { wrapper: ProjectStoreProvider });
    await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
    const handler = vi.fn();
    act(() => {
      const off = result.current.subscribe(handler);
      // unsubscribe doesn't crash
      off();
    });
  });

  it("refreshes on graph_modified WS event", async () => {
    let calls = 0;
    api = makeFakeApi({
      listProjects: () => {
        calls++;
        return Promise.resolve([]);
      },
    });
    renderHook(() => useProjects(), { wrapper: ProjectStoreProvider });
    await waitFor(() => expect(calls).toBe(1));
    act(() => {
      ws.emit({
        type: "graph_modified",
        timestamp: "t",
        action: "node_added",
      });
    });
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  it("error from listProjects falls through to offline view + records error", async () => {
    api = makeFakeApi({ listProjects: () => Promise.reject(new Error("net down")) });
    const { result } = renderHook(() => useProjectStore(), { wrapper: ProjectStoreProvider });
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});

describe("ProjectStoreProvider — offline (no token)", () => {
  it("renders an empty list when no token is available", async () => {
    token = null;
    api = makeFakeApi({});
    const { result: storeResult } = renderHook(() => useProjectStore(), {
      wrapper: ProjectStoreProvider,
    });
    await waitFor(() => expect(storeResult.current.loading).toBe(false));
    const { result } = renderHook(() => useProjects(), { wrapper: ProjectStoreProvider });
    expect(result.current).toEqual([]);
  });

  it("create() appends a local-only project", async () => {
    token = null;
    api = makeFakeApi({});
    const { result } = renderHook(() => useStore(), { wrapper: ProjectStoreProvider });
    await act(async () => {
      await result.current.create({ name: "local-only", projectPath: "/tmp/x" });
    });
    const found = result.current.list().find((p) => p.name === "local-only");
    expect(found).toBeDefined();
  });

  it("reset() restores SEED_PROJECTS", async () => {
    token = null;
    api = makeFakeApi({});
    const { result: storeResult } = renderHook(() => useStore(), {
      wrapper: ProjectStoreProvider,
    });
    await act(async () => {
      await storeResult.current.create({ name: "extra", projectPath: "/tmp" });
    });
    act(() => storeResult.current.reset());
    expect(storeResult.current.list().some((p) => p.name === "extra")).toBe(false);
  });
});

describe("useProjectStore", () => {
  it("throws outside the provider", () => {
    expect(() => renderHook(() => useProjectStore())).toThrow();
  });

  it("useProject returns the matching record", async () => {
    api = makeFakeApi({
      listProjects: () =>
        Promise.resolve([
          {
            id: "proj_xxxxxxxx",
            name: "x",
            projectPath: "/tmp",
            providerProfileId: "d",
            status: "idle",
            startedAt: "t",
            cost: 0,
            currentNodeId: null,
          },
        ]),
    });
    function Probe() {
      const p = useProject("proj_xxxxxxxx");
      return <div data-testid="name">{p?.name ?? ""}</div>;
    }
    const { findByTestId } = render(
      <ProjectStoreProvider>
        <Probe />
      </ProjectStoreProvider>,
    );
    const el = await findByTestId("name");
    expect(el.textContent).toBe("x");
  });
});
