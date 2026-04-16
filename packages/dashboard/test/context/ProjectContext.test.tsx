import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/api.js", () => ({
  api: () => ({
    listProjects: vi.fn().mockResolvedValue([
      { id: "proj_a", name: "alpha", projectPath: "/a", status: "running", currentNodeId: null, cost: 0, startedAt: null },
    ]),
  }),
  DashboardOutdatedError: class extends Error {},
}));

vi.mock("../../src/lib/token.js", () => ({
  readToken: () => "t",
  clearTokenFromHash: vi.fn(),
}));

import { ProjectProvider, useProject } from "../../src/context/ProjectContext.js";

function Probe(): JSX.Element {
  const ctx = useProject();
  return <div data-testid="probe">{ctx.allProjects.map((p) => p.name).join(",")}</div>;
}

describe("ProjectContext", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("loomflo.token", "t");
  });

  it("loads the project list on mount and exposes it via useProject", async () => {
    render(
      <ProjectProvider baseUrl="http://localhost:42000">
        <Probe />
      </ProjectProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByTestId("probe").textContent).toContain("alpha");
  });

  it("throws a helpful error when useProject is called outside the provider", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ProjectProvider/);
    err.mockRestore();
  });
});
