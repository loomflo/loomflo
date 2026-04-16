import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";

export function Layout(): ReactElement {
  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted">
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
