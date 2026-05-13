import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite configuration for the Loomflo Dashboard.
 *
 * Proxies REST + WS daemon routes to the backend so the SPA can talk
 * to a locally running daemon during dev. Override the daemon target
 * with VITE_API_URL.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env["VITE_API_URL"] ?? "http://127.0.0.1:3000";

  const passthrough = (target: string) => ({ target, changeOrigin: true });

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/ws": { target: apiUrl, ws: true },
        "/health": passthrough(apiUrl),
        "/daemon": passthrough(apiUrl),
        "/projects": passthrough(apiUrl),
        "/runtimes": passthrough(apiUrl),
        "/credentials": passthrough(apiUrl),
        "/mock": passthrough(apiUrl),
        "/workflow": passthrough(apiUrl),
        "/nodes": passthrough(apiUrl),
        "/memory": passthrough(apiUrl),
        "/events": passthrough(apiUrl),
        "/specs": passthrough(apiUrl),
        "/chat": passthrough(apiUrl),
        "/config": passthrough(apiUrl),
        "/costs": passthrough(apiUrl),
        "/mcp": passthrough(apiUrl),
        "/shutdown": passthrough(apiUrl),
      },
    },
  };
});
