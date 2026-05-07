import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockApi = {
  pauseWorkflow: vi.fn(),
  resumeWorkflow: vi.fn(),
  startWorkflow: vi.fn(),
};

const mockWorkflow = {
  id: "wf",
  status: "running" as const,
  description: "demo",
  projectPath: "/tmp",
  graph: {
    nodes: {
      n1: {
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
      },
    },
    edges: [],
    topology: "linear" as const,
  },
  config: {} as unknown,
  createdAt: "t",
  updatedAt: "t",
  totalCost: 0,
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
  useWorkflow: () => ({
    workflow: mockWorkflow,
    loading: false,
    error: null,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../../src/hooks/useChat.js", () => ({
  useChat: () => ({
    messages: [],
    sending: false,
    loading: false,
    error: null,
    send: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../../src/components/loom/LoomChatPanel.js", () => ({
  LoomChatPanel: () => null,
}));

import { WorkflowPage } from "../../src/pages/WorkflowPage.js";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
});

describe("WorkflowPage", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/workflow"]}>
        <Routes>
          <Route path="/projects/:projectId/workflow" element={<WorkflowPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
