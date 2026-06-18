import assert from "node:assert/strict";
import { test } from "node:test";
import type { Share, ShareStore } from "../src/ports/share-store.ts";
import type { StorageBackend } from "../src/storage/backend.ts";

process.env.APP_BASE_URL = "https://app.example.com";
process.env.PUBLIC_SHARE_BASE_URL = "https://s.example.com";
process.env.CONTENT_BASE_URL = "https://content.example.com";
process.env.UNLOCK_COOKIE_SECRET = "public-router-canonical-test-secret";

const { createPublicRouter } = await import("../src/public/view.ts");
const { hashPassword } = await import("../src/shares/password.ts");

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

function fakeStore(activeShare: Share = share): ShareStore {
  const unused = () =>
    Promise.reject(new Error("public route must not call this"));
  return {
    create: unused,
    listByOwner: unused,
    byIdForOwner: unused,
    revokeForOwner: unused,
    bySlug: async (slug) => (slug === activeShare.slug ? activeShare : null),
    consumeView: async (slug) =>
      slug === activeShare.slug ? activeShare : null,
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

function appWith(activeShare: Share = share) {
  return createPublicRouter({
    store: fakeStore(activeShare),
    storage: fakeStorage(),
  });
}

const app = appWith();

test("redirects app-host root share paths to the configured share host", async () => {
  const res = await app.request(`/${SLUG}`, {
    headers: { host: "app.example.com" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `https://s.example.com/${SLUG}`);
});

test("redirects legacy share page links to canonical root share paths", async () => {
  const page = await app.request(`/s/${SLUG}`, {
    headers: { host: "app.example.com" },
  });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), `https://s.example.com/${SLUG}`);
});

test("serves legacy raw aliases on the original host", async () => {
  const raw = await app.request(`/s/${SLUG}/raw`, {
    headers: { host: "app.example.com" },
  });

  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), MARKDOWN_BODY);
});

test("serves protected legacy raw aliases with password headers", async () => {
  const protectedApp = appWith({
    ...share,
    passwordHash: hashPassword("secret"),
  });

  const locked = await protectedApp.request(`/s/${SLUG}/raw`, {
    headers: { host: "app.example.com" },
  });
  assert.equal(locked.status, 401);

  const raw = await protectedApp.request(`/s/${SLUG}/raw`, {
    headers: {
      host: "app.example.com",
      "X-Litedrop-Password": "secret",
    },
  });

  assert.equal(raw.status, 200);
  assert.equal(await raw.text(), MARKDOWN_BODY);
});

test("serves canonical root share paths on the configured share host", async () => {
  const res = await app.request(`/${SLUG}`, {
    headers: { host: "s.example.com" },
  });

  assert.equal(res.status, 200);
  assert.match(await res.text(), /<h1>Hello<\/h1>/);
});
