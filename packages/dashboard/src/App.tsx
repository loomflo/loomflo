import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";

// The heavy routes (~1000+ LOC each) lazy-load to keep the initial bundle
// small. ProjectsPage stays eager — it's the default entry and the user
// always lands there first.
const WizardPage = lazy(() =>
  import("./pages/WizardPage.js").then((m) => ({ default: m.WizardPage })),
);
const BrainstormPage = lazy(() =>
  import("./pages/BrainstormPage.js").then((m) => ({ default: m.BrainstormPage })),
);
const WorkflowPage = lazy(() =>
  import("./pages/WorkflowPage.js").then((m) => ({ default: m.WorkflowPage })),
);
const NodeDetailPage = lazy(() =>
  import("./pages/NodeDetailPage.js").then((m) => ({ default: m.NodeDetailPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.js").then((m) => ({ default: m.SettingsPage })),
);

function PageFallback() {
  return <div style={{ padding: 32, color: "var(--fg-3)" }}>Chargement…</div>;
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new/wizard" element={<WizardPage />} />
        <Route path="/projects/:projectId/brainstorm" element={<BrainstormPage />} />
        <Route path="/projects/:projectId/workflow" element={<WorkflowPage />} />
        <Route path="/projects/:projectId/nodes/:nodeId" element={<NodeDetailPage />} />
        <Route path="/projects/:projectId/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
