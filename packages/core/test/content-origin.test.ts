import assert from "node:assert/strict";
import { test } from "node:test";
import type { Share, ShareStore } from "../src/ports/share-store.ts";
import type { StorageBackend } from "../src/storage/backend.ts";

process.env.APP_BASE_URL = "https://app.example.com";
process.env.PUBLIC_SHARE_BASE_URL = "https://share.example.com";
process.env.CONTENT_BASE_URL = "https://content.example.com";
process.env.UNLOCK_COOKIE_SECRET = "content-origin-test-secret";

const { createContentRouter } = await import("../src/public/content-origin.ts");
const { mintContentToken } = await import("../src/public/tokens.ts");

const HTML_BODY = "<!doctype html><h1>hi</h1><script>1</script>\n";
const SLUG = "abc123";

function shareFixture(overrides: Partial<Share> = {}): Share {
  return {
    id: "share-1",
    slug: SLUG,
    filename: "page.html",
    contentType: "text/html",
    kind: "html",
    sizeBytes: HTML_BODY.length,
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
    ...overrides,
  };
}

function fakeStore(share: Share | null): ShareStore {
  const unused = () =>
    Promise.reject(new Error("content route must not call this"));
  return {
    create: unused,
    listByOwner: unused,
    byIdForOwner: unused,
    revokeForOwner: unused,
    bySlug: async (slug) => (share && slug === share.slug ? share : null),
    consumeView: unused,
    recordReport: unused,
    reportCountsForOwner: unused,
    listForCleanup: unused,
    markStorageDeleted: unused,
  };
}

function fakeStorage(body: string): StorageBackend {
  const bytes = new TextEncoder().encode(body);
  return {
    put: async () => {},
    get: async (key) =>
      key === SLUG
        ? { body: bytes, contentType: "text/html", size: bytes.length }
        : null,
    delete: async () => {},
  };
}

function appWith(share: Share | null) {
  return createContentRouter({
    store: fakeStore(share),
    storage: fakeStorage(HTML_BODY),
  });
}

test("allows the public share origin to frame HTML content", async () => {
  const app = appWith(shareFixture());
  const res = await app.request(`/c/${SLUG}?t=${mintContentToken(SLUG)}`, {
    headers: { host: "content.example.com" },
  });

  assert.equal(res.status, 200);
  const policy = res.headers.get("content-security-policy") ?? "";
  assert.match(policy, /frame-ancestors https:\/\/share\.example\.com/);
  assert.doesNotMatch(policy, /frame-ancestors https:\/\/app\.example\.com/);
});
