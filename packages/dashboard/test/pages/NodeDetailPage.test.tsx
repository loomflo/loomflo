import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockApi = {
  pauseWorkflow: vi.fn(),
  resumeWorkflow: vi.fn(),
};

const mockNode = {
  id: "n1",
  title: "N1",
  status: "running" as const,
  instructions: "",
  delay: "0",
  resumeAt: null,
  agents: [],
  fileOwnership: {},
  retryCount: 0,
  maxRetries: 1,
  reviewReport: null,
  cost: 0,
  startedAt: null,
  completedAt: null,
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
        projectPath: "/tmp",
        createdAt: "t",
        lastActivityAt: "t",
        status: "running",
        workflowStatus: "running",
        nodeCount: { spec: 0, worker: 1, done: 0 },
        config: { template: "default", stack: ["ts"], level: 2 },
        createdBy: "user",
      },
    ],
    store: {} as unknown,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../src/hooks/useWorkflow.js", () => ({
  useWorkflow: () => ({ workflow: null, loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("../../src/hooks/useNode.js", () => ({
  useNode: () => ({
    node: mockNode,
    loading: false,
    error: null,
    refresh: vi.fn(),
    live: { sessionEvents: [], mcpCalls: [], sessions: [] },
  }),
}));

vi.mock("../../src/components/loom/LoomChatPanel.js", () => ({
  LoomChatPanel: () => null,
}));

import { NodeDetailPage } from "../../src/pages/NodeDetailPage.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  /* nothing */
});

describe("NodeDetailPage", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/nodes/n1"]}>
        <Routes>
          <Route
            path="/projects/:projectId/nodes/:nodeId"
            element={<NodeDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
