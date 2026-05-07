import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/context/AppContext.js", () => ({
  useApi: () => ({
    runtimeAvailability: () => Promise.resolve({ clis: {} }),
    upsertCredential: vi.fn(),
  }),
  useAppContext: () => ({ token: "tok", baseUrl: "http://x", useMock: false }),
  useWs: () => ({ on: () => () => {} }),
  useWsStatus: () => "open",
}));

vi.mock("../../src/context/ProjectStoreContext.js", () => ({
  useStore: () => ({
    list: () => [],
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    subscribe: () => () => {},
  }),
  useProjects: () => [],
}));

vi.mock("../../src/context/ThemeContext.js", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));

import { WizardPage } from "../../src/pages/WizardPage.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

function renderWizard() {
  return render(
    <MemoryRouter>
      <WizardPage />
    </MemoryRouter>,
  );
}

describe("WizardPage", () => {
  it("renders without crashing", () => {
    renderWizard();
    // Wizard step header should be visible (step 1 — folder).
    // Look for any of the step-1 CTAs (path input).
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });
});
