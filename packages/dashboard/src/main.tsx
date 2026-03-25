import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/**
 * Root application component placeholder.
 * Will be replaced with router and layout once dashboard pages are implemented.
 */
function App(): React.ReactElement {
  return <h1>Loomflo Dashboard</h1>;
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
