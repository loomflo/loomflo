import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, type RenderResult } from "@testing-library/react";

export interface RenderRouteOptions {
  path?: string;
  initialPath?: string;
  wrappers?: Array<(p: { children: ReactNode }) => ReactNode>;
}

/**
 * Render a single route under MemoryRouter at a chosen path. Optional
 * `wrappers` are applied innermost-first around the routed element.
 */
export function renderRoute(
  element: ReactNode,
  opts: RenderRouteOptions = {},
): RenderResult {
  const { path = "/", initialPath = path, wrappers = [] } = opts;
  let wrapped: ReactNode = element;
  for (const W of wrappers) {
    wrapped = <W>{wrapped}</W>;
  }
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={path} element={wrapped} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Combine providers into a single wrapper component. */
export function combine(
  ...providers: Array<(p: { children: ReactNode }) => ReactNode>
) {
  return function Combined({ children }: { children: ReactNode }) {
    let out: ReactNode = children;
    for (let i = providers.length - 1; i >= 0; i--) {
      const P = providers[i]!;
      out = <P>{out}</P>;
    }
    return <>{out}</>;
  };
}
