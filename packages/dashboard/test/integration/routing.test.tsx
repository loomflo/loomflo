// ============================================================================
// Routing integration test
//
// Mounts <App /> under MemoryRouter and verifies that navigating between
// routes works without crashing. Contexts are stubbed via vi.mock so the
// test does not need a live daemon.
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/context/AppContext.js", () => ({
  AppProvider: ({ children }: { children: React.ReactNode }) => children,
  useAppContext: () => ({
    baseUrl: "http://x",
    token: "tok",
    apiClient: {} as unknown,
    wsClient: {} as unknown,
    wsStatus: "open",
    useMock: false,
  }),
  useApi: () => ({}),
  useWs: () => ({ on: () => () => {} }),
  useWsStatus: () => "open",
  useUseMock: () => false,
}));

const stableServers = {};
vi.mock("../../src/hooks/useMcp.js", () => ({
  useMcp: () => ({
    servers: stableServers,
    loading: false,
    error: null,
    refresh: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useWorkflow.js", () => ({
  useWorkflow: () => ({
    workflow: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../src/hooks/useNode.js", () => ({
  useNode: () => ({
    node: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
    live: { sessionEvents: [], mcpCalls: [], sessions: [] },
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

vi.mock("../../src/hooks/useConfig.js", () => ({
  useConfig: () => ({
    config: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
    update: vi.fn(),
  }),
}));

vi.mock("../../src/components/loom/LoomChatPanel.js", () => ({
  LoomChatPanel: () => null,
}));

vi.mock("../../src/context/ProjectStoreContext.js", () => ({
  ProjectStoreProvider: ({ children }: { children: React.ReactNode }) => children,
  useProjects: () => [
    {
      id: "proj_aaaaaaaa",
      name: "demo",
      projectPath: "/Users/x/demo",
      createdAt: "2025-01-01T00:00:00Z",
      lastActivityAt: "2025-01-01T00:00:00Z",
      status: "running",
      workflowStatus: "running",
      nodeCount: { spec: 0, worker: 1, done: 0 },
      config: { template: "default", stack: ["ts"], level: 2 },
      createdBy: "user",
    },
  ],
  useStore: () => ({
    list: () => [],
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    subscribe: () => () => {},
    simulateExternalProjectInit: vi.fn(),
    get: vi.fn(),
  }),
  useProject: () => undefined,
  useProjectStore: () => ({
    projects: [
      {
        id: "proj_aaaaaaaa",
        name: "demo",
        projectPath: "/Users/x/demo",
        createdAt: "2025-01-01T00:00:00Z",
        lastActivityAt: "2025-01-01T00:00:00Z",
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

vi.mock("../../src/context/ThemeContext.js", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

import { App } from "../../src/App.js";

describe("App routing", () => {
  it("/ redirects to /projects (Projects page renders)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /^Projets$/ })).toBeInTheDocument();
  });

  it("/projects renders the projects page", () => {
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /^Projets$/ })).toBeInTheDocument();
  });

  it("/projects/new/wizard renders the wizard (lazy)", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/new/wizard"]}>
        <App />
      </MemoryRouter>,
    );
    // Wizard is lazy-loaded — wait for it to swap in.
    await waitFor(() => expect(screen.getAllByRole("textbox").length).toBeGreaterThan(0));
  });

  it("unknown route renders the 404 page", () => {
    render(
      <MemoryRouter initialEntries={["/totally-unknown"]}>
        <App />
      </MemoryRouter>,
    );
    // 404 is eager (NotFoundPage is not lazy), so we can assert immediately.
    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Retour aux projets/ });
    fireEvent.click(link);
  });
});
