import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export function NotFoundPage(): ReactElement {
  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted flex flex-col items-center justify-center gap-4">
      <h1 className="text-loom-accent text-xl">404 — not here</h1>
      <Link to="/" className="text-loom-accent underline">
        back to project list
      </Link>
    </div>
  );
}
