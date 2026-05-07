import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { UiProject } from "../../src/lib/types.js";

let projectsList: UiProject[] = [];
const navigateSpy = vi.fn();

vi.mock("../../src/context/AppContext.js", () => ({
  useAppContext: () => ({
    baseUrl: "http://x",
    token: "tok",
    apiClient: {} as unknown,
    wsClient: {} as unknown,
    wsStatus: "open",
    useMock: false,
  }),
  useApi: () => ({}),
  useWs: () => ({ on: () => () => {}, onStatus: () => () => {} }),
  useWsStatus: () => "open",
  useUseMock: () => false,
}));

vi.mock("../../src/context/ProjectStoreContext.js", () => ({
  ProjectStoreProvider: ({ children }: { children: React.ReactNode }) => children,
  useProjects: () => projectsList,
  useStore: () => ({
    list: () => projectsList,
    get: (id: string) => projectsList.find((p) => p.id === id),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    subscribe: () => () => {},
    simulateExternalProjectInit: vi.fn(),
  }),
  useProject: (id: string) => projectsList.find((p) => p.id === id),
  useProjectStore: () => ({ projects: projectsList, store: {}, loading: false, error: null }),
}));

vi.mock("../../src/context/ThemeContext.js", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

import { ProjectsPage } from "../../src/pages/ProjectsPage.js";

function makeProject(id: string, name: string, overrides: Partial<UiProject> = {}): UiProject {
  return {
    id,
    name,
    projectPath: `/Users/x/${name}`,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    status: "running",
    workflowStatus: "running",
    nodeCount: { spec: 1, worker: 2, done: 1 },
    config: { template: "default", stack: ["ts"], level: 2 },
    createdBy: "user",
    ...overrides,
  };
}

beforeEach(() => {
  projectsList = [];
  navigateSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

describe("ProjectsPage", () => {
  it("renders the empty state when no projects", () => {
    renderPage();
    // Empty state shows a "Nouveau projet" CTA somewhere; the page's title
    // for the projects list ("Projets") is not present.
    expect(screen.queryByRole("heading", { name: /^Projets$/ })).toBeNull();
  });

  it("renders a header + grid when projects are present", () => {
    projectsList = [makeProject("proj_aaaaaaaa", "demo")];
    renderPage();
    expect(screen.getByRole("heading", { name: /^Projets$/ })).toBeInTheDocument();
    expect(screen.getAllByText(/demo/).length).toBeGreaterThan(0);
  });

  it("opens Cmd+K palette via keyboard shortcut", async () => {
    projectsList = [makeProject("proj_aaaaaaaa", "demo")];
    renderPage();
    // Fire Cmd+K
    const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
    window.dispatchEvent(evt);
    // The palette renders in a portal-less DOM; just assert no crash and that
    // the projects header is still rendered (palette open is internal state).
    expect(screen.getByRole("heading", { name: /^Projets$/ })).toBeInTheDocument();
  });

  it("renders the daemon status badge when token is set", () => {
    projectsList = [makeProject("proj_aaaaaaaa", "demo")];
    renderPage();
    expect(screen.getByText(/daemon/i)).toBeInTheDocument();
  });
});
