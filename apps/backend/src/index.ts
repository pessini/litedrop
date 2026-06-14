import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { logger } from "hono/logger";
import { requireOwner, resolveSingleUser } from "./auth/identity.ts";
import { authRoutes } from "./auth/routes.ts";
import { closeDb, pingDb } from "./db/client.ts";
import { autoMigrate } from "./db/migrate.ts";
import { SqliteShareStore } from "./db/sqlite-share-store.ts";
import { env } from "./env.ts";
import { startCleanupScheduler } from "./jobs/cleanup.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { createContentRouter } from "./public/content-origin.ts";
import { createPublicRouter } from "./public/view.ts";
import { createShareRouter } from "./shares/routes.ts";
import { mountSpa, resolveSpaDir } from "./spa.ts";
import { storage } from "./storage/index.ts";
import type { AppEnv } from "./types.ts";

const app = new Hono<AppEnv>();

// The single share store + identity resolver, wired into every router.
const store = new SqliteShareStore();
const resolveOwner = resolveSingleUser;

app.use("*", logger());

// Compress the public serving path (markdown/HTML compresses 3–5×, cutting
// origin egress proportionally). Only touches compressible content types and
// skips responses already carrying a Content-Encoding.
app.use("/s/*", compress());
app.use("/c/*", compress());

// With a built SPA available, "/" falls through to its index.html (mounted at
// the bottom); without one (API-only / dev behind the Vite proxy), keep the
// plain-text banner.
const spaDir = resolveSpaDir();
if (!spaDir) app.get("/", (c) => c.text("litedrop"));

// Single-user login (password → signed cookie) + logout.
app.route("/auth", authRoutes);

// Confirms the caller is authenticated (used by the dashboard).
app.get("/api/me", requireOwner(resolveOwner), (c) =>
  c.json({ authenticated: true }),
);

// Authenticated share API (the owner's own shares).
app.route("/api/shares", createShareRouter({ store, resolveOwner }));

// OpenAPI spec.
app.get("/openapi.json", (c) => c.json(buildOpenApiDocument()));

// Public share serving (no auth; capability = slug).
app.route("/", createPublicRouter({ store, storage }));

// Isolated content origin: /c/:slug serves raw user HTML for the sandboxed
// iframe.
app.route("/", createContentRouter({ store, storage }));

// Liveness + DB readiness probe. Returns 503 if the database is unreachable.
app.get("/healthz", async (c) => {
  try {
    await pingDb();
    return c.json({ status: "ok", db: "up" });
  } catch (err) {
    console.error("healthz: db check failed", err);
    return c.json({ status: "degraded", db: "down" }, 503);
  }
});

// Dashboard SPA — static assets + index.html fallback. MUST stay last so
// every real route above wins first.
if (spaDir) {
  console.log(`serving dashboard SPA from ${spaDir}`);
  mountSpa(app, spaDir);
}

// SQLite migrates itself at boot.
await autoMigrate();

// Storage cleanup: delete the objects of long-revoked/expired/consumed shares
// (once at boot, then periodically).
startCleanupScheduler();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`litedrop backend listening on http://localhost:${info.port}`);
});

// Graceful shutdown so the DB file handle closes cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}

export { app };
