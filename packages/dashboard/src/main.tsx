import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App.js";
import { ProjectProvider } from "./context/ProjectContext.js";
import "./index.css";

const baseUrl = window.location.origin;

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ProjectProvider baseUrl={baseUrl}>
        <App />
      </ProjectProvider>
    </BrowserRouter>
  </StrictMode>,
);
