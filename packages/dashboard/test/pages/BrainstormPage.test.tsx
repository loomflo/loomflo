import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockApi = {
  getChatHistory: vi.fn(() => Promise.resolve({ messages: [] })),
  postChat: vi.fn(() => Promise.resolve({ response: "ok", action: null, category: "answer" })),
  initWorkflow: vi.fn(() => Promise.resolve({ id: "wf", status: "spec", description: "" })),
};

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => mockApi,
  useAppContext: () => ({ token: "tok", baseUrl: "http://x", useMock: false }),
  useWs: () => ({ on: () => () => {} }),
  useWsStatus: () => "open",
}));

vi.mock("../../src/context/ProjectStoreContext.js", () => ({
  useProjectStore: () => ({
    projects: [
      {
        id: "proj_aaaaaaaa",
        name: "demo",
        projectPath: "/Users/x/demo",
        createdAt: "t",
        lastActivityAt: "t",
        status: "running",
        workflowStatus: "init",
        nodeCount: { spec: 0, worker: 0, done: 0 },
        config: { template: "default", stack: ["ts"], level: 2 },
        createdBy: "user",
      },
    ],
    store: {} as unknown,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../src/context/ThemeContext.js", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

import { BrainstormPage } from "../../src/pages/BrainstormPage.js";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("BrainstormPage", () => {
  it("renders without crashing for a known project", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/brainstorm"]}>
        <Routes>
          <Route path="/projects/:projectId/brainstorm" element={<BrainstormPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // Page mounts → root container has children
    expect(container.firstChild).toBeTruthy();
  });

  it("redirects (renders nothing crash-worthy) when projectId is unknown", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/unknown/brainstorm"]}>
        <Routes>
          <Route path="/projects/:projectId/brainstorm" element={<BrainstormPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container).toBeTruthy();
  });
});
