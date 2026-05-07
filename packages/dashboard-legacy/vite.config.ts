import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite configuration for the Loomflo Dashboard.
 *
 * Proxies `/api`, `/ws`, and daemon routes to the backend.
 * Set `VITE_API_URL` to override the default daemon target (`http://127.0.0.1:3000`).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env["VITE_API_URL"] ?? "http://127.0.0.1:3000";

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
        "/ws": {
          target: apiUrl,
          ws: true,
        },
        "/health": { target: apiUrl, changeOrigin: true },
        "/workflow": { target: apiUrl, changeOrigin: true },
        "/nodes": { target: apiUrl, changeOrigin: true },
        "/memory": { target: apiUrl, changeOrigin: true },
        "/events": { target: apiUrl, changeOrigin: true },
        "/specs": { target: apiUrl, changeOrigin: true },
        "/chat": { target: apiUrl, changeOrigin: true },
        "/config": { target: apiUrl, changeOrigin: true },
        "/costs": { target: apiUrl, changeOrigin: true },
        "/shutdown": { target: apiUrl, changeOrigin: true },
      },
    },
  };
});
