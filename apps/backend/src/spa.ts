import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { env } from "./env.ts";
import { spaCsp } from "./middleware/csp.ts";
import type { AppEnv } from "./types.ts";

// Serve the built dashboard SPA (apps/dashboard/dist) from the backend, so production is
// one process: API + SSR public pages + the SPA, all on the app origin. Mounted
// LAST in the app composition — every real route wins first; what's left is
// either a static asset or a client-routed page that gets index.html.
//
// In dev this stays unmounted (apps/dashboard/dist usually absent or stale) and the Vite
// dev server proxies to the backend instead — same-origin either way.

// DASHBOARD_DIST_DIR wins; otherwise the monorepo layout (apps/backend/../dashboard/dist),
// resolved from this file so it works from src/ (tsx) and dist/ alike.
export function resolveSpaDir(): string | null {
  const backendRoot = fileURLToPath(new URL("..", import.meta.url));
  const dir =
    env.DASHBOARD_DIST_DIR ?? join(backendRoot, "..", "dashboard", "dist");
  return existsSync(join(dir, "index.html")) ? dir : null;
}

export function mountSpa(app: Hono<AppEnv>, dir: string): void {
  app.use("*", async (c, next) => {
    // Anything that reaches this point is SPA territory — but an unknown /api
    // or /auth path should fail like an API, not serve index.html.
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/auth/")) {
      return c.json({ error: "not found" }, 404);
    }
    // Headers must be set BEFORE the static handler builds its response. This
    // replaces the strict no-script SSR policy the public router put on the
    // request; the SPA needs to run its own bundle.
    c.header("Content-Security-Policy", spaCsp());
    // Vite asset filenames are content-hashed → cache forever; index.html (and
    // anything else) must revalidate so deploys take effect.
    c.header(
      "Cache-Control",
      path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    await next();
  });
  app.use("*", serveStatic({ root: dir }));
  app.get("*", serveStatic({ root: dir, path: "index.html" }));
}
