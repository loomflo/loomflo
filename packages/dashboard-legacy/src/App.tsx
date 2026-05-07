import { type ReactElement, useEffect } from "react";
import { Routes, Route, useParams, Navigate, Outlet } from "react-router-dom";

import { useProject } from "./context/ProjectContext.js";
import { HomePage } from "./pages/Home.js";
import { GraphPage } from "./pages/Graph.js";
import { NodePage } from "./pages/Node.js";
import { SpecsPage } from "./pages/Specs.js";
import { MemoryPage } from "./pages/Memory.js";
import { ChatPage } from "./pages/Chat.js";
import { CostsPage } from "./pages/Costs.js";
import { ConfigPage } from "./pages/Config.js";
import { LandingPage } from "./pages/Landing.js";
import { NotFoundPage } from "./pages/NotFound.js";
import { Layout } from "./components/Layout.js";

function ProjectGuard(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const ctx = useProject();

  useEffect(() => {
    if (projectId !== undefined && projectId !== ctx.projectId) {
      ctx.setProjectId(projectId);
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
  }, [projectId, ctx.projectId, ctx.setProjectId]);

  if (projectId === undefined) return <Navigate to="/" replace />;
  if (ctx.allProjects.length > 0 && !ctx.allProjects.some((p) => p.id === projectId)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<ProjectGuard />}>
        <Route path="/projects/:projectId" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="node/:id" element={<NodePage />} />
          <Route path="specs" element={<SpecsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="config" element={<ConfigPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
