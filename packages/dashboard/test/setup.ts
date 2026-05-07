import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom does not implement IntersectionObserver, ResizeObserver, or matchMedia.
// The dashboard uses these for scroll-spy + responsive helpers; stub them so
// pages can mount under the test environment.
class StubIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof window !== "undefined") {
  if (!window.IntersectionObserver) {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      StubIntersectionObserver;
  }
  if (!window.ResizeObserver) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      StubResizeObserver;
  }
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
  if (!window.scrollTo) {
    (window as unknown as { scrollTo: unknown }).scrollTo = () => {};
  }
}
