import { MemoryRouter } from "react-router-dom";
import { render, screen, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/token.js", () => ({
  readToken: () => "t",
  clearTokenFromHash: vi.fn(),
}));

vi.mock("../../src/lib/api.js", () => ({
  api: () => ({
    listProjects: vi.fn().mockResolvedValue([
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", cost: 0.42, startedAt: null },
      { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, cost: 0, startedAt: null },
    ]),
    getWorkflow: vi.fn().mockResolvedValue({
      id: "wf",
      status: "running",
      description: "",
      projectPath: "/a",
      graph: { nodes: {}, edges: [], topology: "linear" },
      config: { budgetLimit: null },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      totalCost: 0,
    }),
    getNodes: vi.fn().mockResolvedValue([]),
    getCosts: vi.fn().mockResolvedValue({ entries: [], totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0 }),
    getEvents: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue({}),
  }),
  DashboardOutdatedError: class extends Error {},
}));

vi.mock("../../src/hooks/useWebSocket.js", () => ({
  useWebSocket: () => ({ connected: true, lastError: null }),
}));

import { App } from "../../src/App.js";
import { ProjectProvider } from "../../src/context/ProjectContext.js";

afterEach(cleanup);

function renderWithRouter(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProjectProvider baseUrl="http://localhost:42000">
        <App />
      </ProjectProvider>
    </MemoryRouter>,
  );
}

describe("routing", () => {
  it("/ renders the landing with both project cards", async () => {
    renderWithRouter("/");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("/projects/proj_a renders the Home page inside the layout", async () => {
    renderWithRouter("/projects/proj_a");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("loomflo")).toBeInTheDocument();
  });

  it("/projects/unknown redirects to /", async () => {
    renderWithRouter("/projects/unknown");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
