import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";

import { useProject } from "../context/ProjectContext.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";

export function TopBar(): ReactElement {
  const { allProjects } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const current = allProjects.find((p) => p.id === projectId);

  return (
    <div className="flex items-center justify-between bg-loom-panel border-b border-loom-dim/20 px-4 py-2">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-loom-accent font-bold">
          loomflo
        </Link>
        <span className="text-loom-dim">/</span>
        <span className="text-loom-muted">{current?.name ?? projectId}</span>
      </div>
      <ProjectSwitcher />
    </div>
  );
}
