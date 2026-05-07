import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Config } from "../../src/lib/types.js";

const mockApi = {
  pauseWorkflow: vi.fn(),
  resumeWorkflow: vi.fn(),
};

const mockConfig: Partial<Config> = {
  level: 2,
  defaultDelay: "10m",
  reviewerEnabled: true,
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
    store: { remove: vi.fn(), update: vi.fn() } as unknown,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../src/hooks/useConfig.js", () => ({
  useConfig: () => ({
    config: mockConfig as Config,
    loading: false,
    error: null,
    refresh: vi.fn(),
    update: vi.fn(() => Promise.resolve(mockConfig as Config)),
  }),
}));

// IMPORTANT: keep the returned object reference stable across renders or
// the page's useEffect on `mcpServers` will loop forever.
const mcpStub = {
  servers: {} as Record<string, never>,
  loading: false,
  error: null,
  refresh: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
};
vi.mock("../../src/hooks/useMcp.js", () => ({
  useMcp: () => mcpStub,
}));

import { SettingsPage } from "../../src/pages/SettingsPage.js";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  /* nothing */
});

describe("SettingsPage", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/settings"]}>
        <Routes>
          <Route path="/projects/:projectId/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeTruthy();
  });
});
