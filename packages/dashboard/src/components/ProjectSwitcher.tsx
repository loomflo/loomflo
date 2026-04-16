import type { ReactElement } from "react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useProject } from "../context/ProjectContext.js";

export function ProjectSwitcher(): ReactElement {
  const { allProjects } = useProject();
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const current = allProjects.find((p) => p.id === projectId);

  const onPick = (id: string): void => {
    setOpen(false);
    const subPath = location.pathname.replace(/^\/projects\/[^/]+/, "");
    void navigate(`/projects/${id}${subPath}`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="bg-loom-panel-2 text-loom-accent px-3 py-1 rounded flex items-center gap-2"
        onClick={() => { setOpen((v) => !v); }}
      >
        <span>{current?.name ?? projectId ?? "select"}</span>
        <span className="text-loom-muted text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-loom-panel border border-loom-dim/30 rounded shadow-md min-w-[200px] z-10">
          {allProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => { onPick(p.id); }}
              className={`px-3 py-2 cursor-pointer hover:bg-loom-panel-2 ${p.id === projectId ? "text-loom-accent" : "text-loom-muted"}`}
            >
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
