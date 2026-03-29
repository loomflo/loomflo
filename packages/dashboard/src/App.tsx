import type { ReactElement } from "react";
import { Routes, Route, NavLink, Outlet } from "react-router-dom";

import { ChatPage } from "./pages/Chat.js";
import { HomePage } from "./pages/Home.js";
import { MemoryPage } from "./pages/Memory.js";
import { NodePage } from "./pages/Node.js";
import { SpecsPage } from "./pages/Specs.js";

/** Navigation items displayed in the sidebar. */
const NAV_ITEMS: readonly { path: string; label: string }[] = [
  { path: "/", label: "Home" },
  { path: "/graph", label: "Graph" },
  { path: "/specs", label: "Specs" },
  { path: "/memory", label: "Memory" },
  { path: "/chat", label: "Chat" },
  { path: "/costs", label: "Costs" },
  { path: "/config", label: "Config" },
] as const;

/**
 * Shared layout component with a navigation sidebar and content area.
 *
 * @returns The layout wrapping all routed pages.
 */
function Layout(): ReactElement {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <nav className="flex w-56 flex-col border-r border-gray-800 bg-gray-900 p-4">
        <h1 className="mb-6 text-lg font-bold tracking-tight">Loomflo</h1>
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ path, label }) => (
            <li key={path}>
              <NavLink
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  `block rounded px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
                  }`
                }
              >
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

/** Placeholder page component. */
function Graph(): ReactElement {
  return <h2 className="text-2xl font-semibold">Graph</h2>;
}

/** Placeholder page component. */
function Costs(): ReactElement {
  return <h2 className="text-2xl font-semibold">Costs</h2>;
}

/** Placeholder page component. */
function Config(): ReactElement {
  return <h2 className="text-2xl font-semibold">Config</h2>;
}

/**
 * Root application component with React Router route definitions.
 *
 * @returns The routed application tree.
 */
export function App(): ReactElement {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="graph" element={<Graph />} />
        <Route path="node/:id" element={<NodePage />} />
        <Route path="specs" element={<SpecsPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="costs" element={<Costs />} />
        <Route path="config" element={<Config />} />
      </Route>
    </Routes>
  );
}
