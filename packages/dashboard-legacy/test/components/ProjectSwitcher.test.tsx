import { MemoryRouter, Routes, Route } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/ProjectContext.js", () => ({
  useProject: () => ({
    allProjects: [
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: null, cost: 0, startedAt: null },
      { id: "proj_b", name: "beta",  projectPath: "/b", status: "idle",    currentNodeId: null, cost: 0, startedAt: null },
    ],
    projectId: "proj_a",
    setProjectId: vi.fn(),
  }),
}));

import { ProjectSwitcher } from "../../src/components/ProjectSwitcher.js";

describe("ProjectSwitcher", () => {
  afterEach(() => cleanup());

  it("renders the active project label", () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj_a/graph"]}>
        <Routes>
          <Route path="/projects/:projectId/*" element={<ProjectSwitcher />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("navigates to the same sub-page on another project when an option is clicked", () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj_a/graph"]}>
        <Routes>
          <Route path="/projects/:projectId/*" element={<ProjectSwitcher />} />
        </Routes>
      </MemoryRouter>,
    );
    // Open the dropdown
    fireEvent.click(screen.getByRole("button", { name: /alpha/ }));
    // Pick the other project
    fireEvent.click(screen.getByText("beta"));
    // After navigation, the button should now show "beta" as the active project
    expect(screen.getByRole("button", { name: /beta/ })).toBeInTheDocument();
  });
});
