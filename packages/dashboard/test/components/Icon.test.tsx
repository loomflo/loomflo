import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, type IconName } from "../../src/components/Icon.js";

describe("Icon", () => {
  it("exposes every named icon as a React component", () => {
    const names = Object.keys(Icon) as IconName[];
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const Comp = Icon[name];
      expect(typeof Comp).toBe("function");
    }
  });

  it("renders SVG markup with the standard stroke props", () => {
    const { container } = render(<Icon.Plus width="14" height="14" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("stroke")).toBe("currentColor");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("forwards arbitrary props to the SVG element", () => {
    const { container } = render(<Icon.Sparkles className="custom" aria-label="sparkles" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("custom");
    expect(svg.getAttribute("aria-label")).toBe("sparkles");
  });

  it("renders all icons without throwing", () => {
    const names = Object.keys(Icon) as IconName[];
    for (const name of names) {
      const Comp = Icon[name];
      const { unmount } = render(<Comp />);
      unmount();
    }
  });
});
