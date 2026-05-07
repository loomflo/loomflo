import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { NotFoundPage } from "../../src/pages/NotFoundPage.js";
import { renderRoute } from "./test-utils.js";

describe("NotFoundPage", () => {
  it("shows the 404 copy and a link back to /projects", () => {
    renderRoute(<NotFoundPage />);
    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.getByText(/Cette page n'existe pas/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Retour aux projets/ });
    expect(link.getAttribute("href")).toBe("/projects");
  });
});
