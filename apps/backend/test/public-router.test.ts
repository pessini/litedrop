import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Share, ShareStore } from "../src/ports/share-store.ts";
import type { StorageBackend } from "../src/storage/backend.ts";

process.env.APP_BASE_URL = "https://app.example.com";
process.env.CONTENT_BASE_URL = "https://content.example.com";
process.env.UNLOCK_COOKIE_SECRET = "public-router-test-secret";

const { createPublicRouter } = await import("../src/public/view.ts");
const { hashPassword } = await import("../src/shares/password.ts");

const SLUG = "Abc123_-XyZ9";
const MARKDOWN_BODY = "# Hello\n\nRoot route body.\n";

function shareFixture(overrides: Partial<Share> = {}): Share {
  return {
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
    ...overrides,
  };
}

function fakeStorage(body: string): StorageBackend {
  const bytes = new TextEncoder().encode(body);
  return {
    put: async () => {},
    get: async (key) =>
      key === SLUG
        ? { body: bytes, contentType: "text/markdown", size: bytes.length }
        : null,
    delete: async () => {},
  };
}

function fakeStore(share: Share | null): ShareStore & { reports: string[] } {
  const unused = () =>
    Promise.reject(new Error("public route must not call this"));
  const reports: string[] = [];
  return {
    reports,
    create: unused,
    listByOwner: unused,
    byIdForOwner: unused,
    revokeForOwner: unused,
    bySlug: async (slug) => (share && slug === share.slug ? share : null),
    consumeView: async (slug) =>
      share && slug === share.slug && !share.revokedAt ? share : null,
    recordReport: async (slug) => {
      if (!share || slug !== share.slug) return null;
      reports.push(slug);
      return "created";
    },
    reportCountsForOwner: unused,
    listForCleanup: unused,
    markStorageDeleted: unused,
  };
}

function appWith(share: Share | null) {
  const store = fakeStore(share);
  const app = createPublicRouter({
    store,
    storage: fakeStorage(MARKDOWN_BODY),
  });
  return { app, store };
}

test("serves rendered share pages at root slug paths", async () => {
  const { app } = appWith(shareFixture());

  const res = await app.request(`/${SLUG}`);

  assert.equal(res.status, 200);
  assert.match(await res.text(), /<h1>Hello<\/h1>/);
});

test("serves raw share bytes at root slug raw paths", async () => {
  const { app } = appWith(shareFixture());

  const res = await app.request(`/${SLUG}/raw`);

  assert.equal(res.status, 200);
  assert.equal(await res.text(), MARKDOWN_BODY);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
});

test("password unlock forms post and redirect on root slug paths", async () => {
  const { app } = appWith(
    shareFixture({ passwordHash: hashPassword("secret") }),
  );

  const locked = await app.request(`/${SLUG}`);
  assert.equal(locked.status, 200);
  assert.match(await locked.text(), new RegExp(`action="/${SLUG}/unlock"`));

  const res = await app.request(`/${SLUG}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "secret" }),
  });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), `/${SLUG}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`ld_unlock_${SLUG}`));
  assert.match(cookie, new RegExp(`Path=/${SLUG}`));
});

test("report prompts and posts use root slug paths", async () => {
  const { app, store } = appWith(shareFixture());

  const prompt = await app.request(`/${SLUG}/report`);
  assert.equal(prompt.status, 200);
  assert.match(await prompt.text(), new RegExp(`action="/${SLUG}/report"`));

  const res = await app.request(`/${SLUG}/report`, { method: "POST" });

  assert.equal(res.status, 200);
  assert.match(await res.text(), /Reported/);
  assert.deepEqual(store.reports, [SLUG]);
});

test("root share routes do not catch unrelated app paths", async () => {
  const { app } = appWith(shareFixture());

  for (const path of [
    "/api/me",
    "/healthz",
    "/assets/app.js",
    "/shares",
    `/s/${SLUG}`,
    `/s/${SLUG}/raw`,
  ]) {
    assert.equal((await app.request(path)).status, 404, path);
  }
});

function buildShareUrlsWithEnv(env: NodeJS.ProcessEnv): {
  url: string;
  rawUrl: string;
} {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const code = `
    const { buildShareUrls } = await import("./src/shares/service.ts");
    process.stdout.write(JSON.stringify(buildShareUrls("Abc123_-XyZ9")));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: ":memory:",
        UNLOCK_COOKIE_SECRET: "public-router-test-secret",
        ...env,
      },
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { url: string; rawUrl: string };
}

test("share URLs use PUBLIC_SHARE_BASE_URL when configured", () => {
  assert.deepEqual(
    buildShareUrlsWithEnv({
      APP_BASE_URL: "https://app.example.com",
      PUBLIC_SHARE_BASE_URL: "https://s.example.com",
    }),
    {
      url: `https://s.example.com/${SLUG}`,
      rawUrl: `https://s.example.com/${SLUG}/raw`,
    },
  );
});

test("share URLs fall back to APP_BASE_URL when public share base is unset", () => {
  assert.deepEqual(
    buildShareUrlsWithEnv({
      APP_BASE_URL: "https://app.example.com",
      PUBLIC_SHARE_BASE_URL: "",
    }),
    {
      url: `https://app.example.com/${SLUG}`,
      rawUrl: `https://app.example.com/${SLUG}/raw`,
    },
  );
});
