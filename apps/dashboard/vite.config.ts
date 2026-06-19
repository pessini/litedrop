import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// Vite dev/build config for the litedrop dashboard SPA.
//
// In dev we proxy the backend paths to the Hono server on :8080 so the SPA is
// served same-origin. That means the pasted API key (Authorization: Bearer)
// and any session cookie both reach the backend without CORS — and it mirrors
// production, where the SPA is served from (or reverse-proxied onto) the app
// origin alongside the API. Override the target with VITE_PROXY_TARGET.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET ?? "http://localhost:8080";
const PROXY_PATHS = [
  "/api",
  "/auth",
  "^/[A-Za-z0-9_-]{12}(?:/|$)",
  "^/c(?:/|$)",
  "/healthz",
];

export default defineConfig({
  plugins: [vue()],
  server: {
    // Bind to all interfaces so the port is reachable from outside the dev
    // container (loopback-only binding isn't forwarded to the host).
    host: true,
    port: 5173,
    proxy: Object.fromEntries(
      PROXY_PATHS.map((path) => [
        path,
        { target: PROXY_TARGET, changeOrigin: true },
      ]),
    ),
  },
});
