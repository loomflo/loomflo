import { Navigate, Route, Routes } from "react-router-dom";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { WizardPage } from "./pages/WizardPage.js";
import { BrainstormPage } from "./pages/BrainstormPage.js";
import { WorkflowPage } from "./pages/WorkflowPage.js";
import { NodeDetailPage } from "./pages/NodeDetailPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";

export function App() {
  return (
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
  );
}
