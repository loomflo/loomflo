import type { ReactElement } from "react";
import { Link, Navigate } from "react-router-dom";

import { useProject } from "../context/ProjectContext.js";
import type { ProjectSummary } from "../lib/types.js";

export function LandingPage(): ReactElement {
  const { allProjects, error } = useProject();

  if (error !== null) {
    return (
      <div className="p-8 text-loom-err">Failed to load projects: {error.message}</div>
    );
  }

  if (allProjects.length === 1) {
    const only = allProjects[0] as ProjectSummary;
    return <Navigate to={`/projects/${only.id}`} replace />;
  }

  if (allProjects.length === 0) {
    return (
      <div className="min-h-screen bg-loom-bg text-loom-muted p-10">
        <h1 className="text-loom-accent text-lg">No projects yet</h1>
        <p className="text-loom-dim mt-2">
          Run <code className="text-loom-accent">loomflo start</code> inside a project directory to register it here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-loom-bg text-loom-muted p-8">
      <h1 className="text-loom-accent text-xl mb-6">Projects</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {allProjects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }): ReactElement {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="bg-loom-panel rounded-md p-4 hover:bg-loom-panel-2 block"
    >
      <div className="flex items-center justify-between">
        <div className="text-loom-accent font-semibold">{project.name}</div>
        <StatusDot status={project.status} />
      </div>
      <div className="text-loom-dim text-sm mt-2 space-y-1">
        <div>{project.currentNodeId ?? "—"}</div>
        <div>${project.cost.toFixed(2)}</div>
      </div>
    </Link>
  );
}

function StatusDot({ status }: { status: ProjectSummary["status"] }): ReactElement {
  const cls =
    status === "running"
      ? "bg-loom-accent"
      : status === "blocked" || status === "failed"
        ? "bg-loom-err"
        : "bg-loom-dim";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}
