import assert from "node:assert/strict";
import { test } from "node:test";
import type { Share, ShareStore } from "../src/ports/share-store.ts";
import type { StorageBackend } from "../src/storage/backend.ts";

process.env.APP_BASE_URL = "https://app.example.com";
process.env.PUBLIC_SHARE_BASE_URL = "https://s.example.com";
process.env.CONTENT_BASE_URL = "https://content.example.com";
process.env.UNLOCK_COOKIE_SECRET = "public-router-canonical-test-secret";

const { createPublicRouter } = await import("../src/public/view.ts");

const SLUG = "Abc123_-XyZ9";
const MARKDOWN_BODY = "# Hello\n\nCanonical share host.\n";

const share: Share = {
  id: "share-1",
  slug: SLUG,
  filename: "notes.md",
  contentType: "text/markdown; charset=utf-8",
  kind: "markdown",
  sizeBytes: MARKDOWN_BODY.length,
  storageKey: SLUG,
  sha256: "0".repeat(64),
  passwordHash: null,
  expiresAt: null,
  maxViews: null,
  viewCount: 0,
  lastViewedAt: null,
  revokedAt: null,
  storageDeletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function fakeStore(): ShareStore {
  const unused = () =>
    Promise.reject(new Error("public route must not call this"));
  return {
    create: unused,
    listByOwner: unused,
    byIdForOwner: unused,
    revokeForOwner: unused,
    bySlug: async (slug) => (slug === SLUG ? share : null),
    consumeView: async (slug) => (slug === SLUG ? share : null),
    recordReport: unused,
    reportCountsForOwner: unused,
    listForCleanup: unused,
    markStorageDeleted: unused,
  };
}

function fakeStorage(): StorageBackend {
  const bytes = new TextEncoder().encode(MARKDOWN_BODY);
  return {
    put: async () => {},
    get: async (key) =>
      key === SLUG
        ? { body: bytes, contentType: "text/markdown", size: bytes.length }
        : null,
    delete: async () => {},
  };
}

const app = createPublicRouter({ store: fakeStore(), storage: fakeStorage() });

test("redirects app-host root share paths to the configured share host", async () => {
  const res = await app.request(`/${SLUG}`, {
    headers: { host: "app.example.com" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `https://s.example.com/${SLUG}`);
});

test("serves canonical root share paths on the configured share host", async () => {
  const res = await app.request(`/${SLUG}`, {
    headers: { host: "s.example.com" },
  });

  assert.equal(res.status, 200);
  assert.match(await res.text(), /<h1>Hello<\/h1>/);
});
