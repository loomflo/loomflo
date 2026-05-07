import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { AppProvider } from "./context/AppContext.js";
import { ThemeProvider } from "./context/ThemeContext.js";
import { ProjectStoreProvider } from "./context/ProjectStoreContext.js";
import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Loomflo: #root element not found in index.html");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <ThemeProvider>
          <ProjectStoreProvider>
            <App />
          </ProjectStoreProvider>
        </ThemeProvider>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
