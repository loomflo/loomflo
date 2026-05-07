// ============================================================================
// Accessibility audit (axe-core via jest-axe)
//
// Renders the 5 main pages under stub providers and asserts no critical
// violations. Critical / serious are gated; minor (best-practice) violations
// are not failed on, since the dashboard ships with several non-blocking
// suggestions (e.g. landmark-one-main on intentionally framed routes).
// ============================================================================

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { axe } from "jest-axe";

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
  useWorkflow: () => ({ workflow: null, loading: false, error: null, refresh: vi.fn() }),
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

const projects = [
  {
    id: "proj_aaaaaaaa",
    name: "demo",
    projectPath: "/Users/x/demo",
    createdAt: "2025-01-01T00:00:00Z",
    lastActivityAt: "2025-01-01T00:00:00Z",
    status: "running" as const,
    workflowStatus: "running" as const,
    nodeCount: { spec: 0, worker: 1, done: 0 },
    config: { template: "default", stack: ["ts"], level: 2 as const },
    createdBy: "user" as const,
  },
];

vi.mock("../../src/context/ProjectStoreContext.js", () => ({
  ProjectStoreProvider: ({ children }: { children: React.ReactNode }) => children,
  useProjects: () => projects,
  useStore: () => ({
    list: () => projects,
    get: (id: string) => projects.find((p) => p.id === id),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    subscribe: () => () => {},
    simulateExternalProjectInit: vi.fn(),
  }),
  useProject: (id: string) => projects.find((p) => p.id === id),
  useProjectStore: () => ({ projects, store: {} as unknown, loading: false, error: null }),
}));

vi.mock("../../src/context/ThemeContext.js", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

import { ProjectsPage } from "../../src/pages/ProjectsPage.js";
import { WizardPage } from "../../src/pages/WizardPage.js";
import { BrainstormPage } from "../../src/pages/BrainstormPage.js";
import { WorkflowPage } from "../../src/pages/WorkflowPage.js";
import { SettingsPage } from "../../src/pages/SettingsPage.js";
import { NotFoundPage } from "../../src/pages/NotFoundPage.js";

interface AxeViolation {
  impact?: "minor" | "moderate" | "serious" | "critical";
  id?: string;
}

async function expectNoCritical(container: HTMLElement): Promise<void> {
  const result = (await axe(container)) as unknown as { violations: AxeViolation[] };
  const blocking = result.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact ?? "?"}] ${v.id ?? "unknown"}`)
      .join("\n  ");
    throw new Error(`Found ${String(blocking.length)} critical/serious axe violations:\n  ${summary}`);
  }
}

describe("a11y — main pages", () => {
  it("ProjectsPage has no critical/serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );
    await expectNoCritical(container);
  });

  it("WizardPage has no critical/serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/new/wizard"]}>
        <WizardPage />
      </MemoryRouter>,
    );
    await expectNoCritical(container);
  });

  it("BrainstormPage has no critical/serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/brainstorm"]}>
        <Routes>
          <Route path="/projects/:projectId/brainstorm" element={<BrainstormPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await expectNoCritical(container);
  });

  it("WorkflowPage has no critical/serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/workflow"]}>
        <Routes>
          <Route path="/projects/:projectId/workflow" element={<WorkflowPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await expectNoCritical(container);
  });

  it("SettingsPage has no critical/serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/proj_aaaaaaaa/settings"]}>
        <Routes>
          <Route path="/projects/:projectId/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await expectNoCritical(container);
  });

  it("NotFoundPage has no critical/serious axe violations", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/x"]}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    await expectNoCritical(container);
  });
});
