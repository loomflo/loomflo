import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/ProjectContext.js", () => ({
  useProject: () => ({
    allProjects: [
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: "n1", cost: 0.42, startedAt: "2026-04-15T00:00:00Z" },
      { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, cost: 0, startedAt: null },
    ],
    client: { listProjects: vi.fn() },
    error: null,
  }),
}));

import { LandingPage } from "../../src/pages/Landing.js";

describe("LandingPage", () => {
  it("renders one card per registered project", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });
});
