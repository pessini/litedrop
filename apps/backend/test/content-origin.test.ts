import assert from "node:assert/strict";
import { test } from "node:test";
import type { Share, ShareStore } from "../src/ports/share-store.ts";
import type { StorageBackend } from "../src/storage/backend.ts";

// Environment is validated once at module load, so pin the two origins and the
// signing secret BEFORE the serving modules are (dynamically) imported.
process.env.APP_BASE_URL = "https://app.example.com";
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

// The content route only reads bySlug; everything else must stay untouched.
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

function get(
  app: ReturnType<typeof createContentRouter>,
  opts: { token?: string; host?: string } = {},
) {
  const query = opts.token === undefined ? "" : `?t=${opts.token}`;
  return app.request(`/c/${SLUG}${query}`, {
    headers: { host: opts.host ?? "content.example.com" },
  });
}

test("serves HTML with an explicit Content-Type and the isolation headers", async () => {
  const res = await get(appWith(shareFixture()), {
    token: mintContentToken(SLUG),
  });

  assert.equal(res.status, 200);
  // nosniff disables MIME inference, so the type must be declared explicitly
  // or browsers won't render the body as HTML.
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("cache-control"), "private, no-store");

  const policy = res.headers.get("content-security-policy") ?? "";
  assert.match(policy, /sandbox allow-scripts/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.match(policy, /frame-ancestors https:\/\/app\.example\.com/);

  assert.equal(await res.text(), HTML_BODY);
});

test("rejects missing, malformed, expired, and wrong-slug tokens", async () => {
  const app = appWith(shareFixture());

  assert.equal((await get(app)).status, 403);
  assert.equal((await get(app, { token: "garbage" })).status, 403);

  const expired = mintContentToken(SLUG, Date.now() - 10 * 60 * 1000);
  assert.equal((await get(app, { token: expired })).status, 403);

  const otherSlug = mintContentToken("other-slug");
  assert.equal((await get(app, { token: otherSlug })).status, 403);
});

test("answers only on the configured content host", async () => {
  const res = await get(appWith(shareFixture()), {
    token: mintContentToken(SLUG),
    host: "app.example.com",
  });
  assert.equal(res.status, 404);
});

test("serves only servable HTML shares", async () => {
  const token = mintContentToken(SLUG);

  // Markdown renders on the app origin and must never be framed raw.
  const markdown = shareFixture({ kind: "markdown", filename: "notes.md" });
  assert.equal((await get(appWith(markdown), { token })).status, 404);

  const revoked = shareFixture({ revokedAt: new Date("2026-01-02T00:00:00Z") });
  assert.equal((await get(appWith(revoked), { token })).status, 404);

  assert.equal((await get(appWith(null), { token })).status, 404);
});
