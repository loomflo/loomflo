import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite configuration for the Loomflo Dashboard.
 *
 * Proxies `/api` and `/ws` requests to the daemon at 127.0.0.1:3100.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://127.0.0.1:3100",
        ws: true,
      },
    },
  },
});
