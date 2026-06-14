import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Store + serving-predicate + cleanup-sweep checks against an in-memory SQLite
// database that the real migration brings up. Env must be pinned before any src
// module loads (env/db are import-time singletons), so src imports are dynamic.

const storageDir = mkdtempSync(join(tmpdir(), "litedrop-core-"));
process.env.DATABASE_URL = ":memory:";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_DIR = storageDir;

const { autoMigrate } = await import("../src/db/migrate.ts");
const { closeDb } = await import("../src/db/client.ts");
const { SqliteShareStore } = await import("../src/db/sqlite-share-store.ts");
const { isServable } = await import("../src/ports/share-store.ts");
const { loadServable } = await import("../src/public/serving-hooks.ts");
const { sweepDeletedShareObjects } = await import("../src/jobs/cleanup.ts");
const { LocalStorage } = await import("../src/storage/providers/local.ts");
const { SINGLE_USER } = await import("../src/auth/identity.ts");

const store = new SqliteShareStore();
const objects = new LocalStorage(storageDir);
const owner = SINGLE_USER.owner;

before(async () => {
  await autoMigrate();
});
after(async () => {
  await closeDb();
  rmSync(storageDir, { recursive: true, force: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;
let seq = 0;

async function makeShare(overrides: Record<string, unknown> = {}) {
  const slug = `slug-${seq++}`;
  await objects.put({
    key: slug,
    body: new TextEncoder().encode("# content"),
    contentType: "text/markdown; charset=utf-8",
  });
  const share = await store.create(
    {
      slug,
      filename: "report.md",
      contentType: "text/markdown; charset=utf-8",
      kind: "markdown",
      sizeBytes: 9,
      storageKey: slug,
      sha256: `hash-${slug}`,
      passwordHash: null,
      expiresAt: null,
      maxViews: null,
    },
    owner,
  );
  // Apply non-create-able fields (revoked/expired/consumed/viewed) directly.
  if (Object.keys(overrides).length > 0) {
    const { db } = await import("../src/db/client.ts");
    const { shares } = await import("../src/db/schema.ts");
    const { eq } = await import("drizzle-orm");
    await db.update(shares).set(overrides).where(eq(shares.id, share.id));
    return (await store.byIdForOwner(share.id, owner))!;
  }
  return share;
}

test("create + list + revoke round-trip via the port", async () => {
  const a = await makeShare();
  const listed = await store.listByOwner(owner);
  assert.ok(listed.some((s) => s.id === a.id));

  const revoked = await store.revokeForOwner(a.id, owner);
  assert.ok(revoked?.revokedAt);
  assert.equal(isServable(revoked!), false);
});

test("servability + atomic consume honor revoked/expired/consumed", async () => {
  const active = await makeShare();
  assert.ok(await loadServable(store, active.slug));

  const expired = await makeShare({ expiresAt: new Date(Date.now() - 1000) });
  assert.equal(await loadServable(store, expired.slug), null);

  const burn = await makeShare({ maxViews: 1 });
  assert.ok(await store.consumeView(burn.slug), "first view succeeds");
  assert.equal(await store.consumeView(burn.slug), null, "second is burned");
  assert.equal(await loadServable(store, burn.slug), null);
});

test("cleanup sweep deletes only long-dead objects, idempotently", async () => {
  const old = new Date(Date.now() - 10 * DAY_MS);
  const recent = new Date(Date.now() - 1 * DAY_MS);

  const revokedOld = await makeShare({ revokedAt: old });
  const revokedRecent = await makeShare({ revokedAt: recent });
  const active = await makeShare();

  const first = await sweepDeletedShareObjects({
    store,
    storage: objects,
    graceMs: 7 * DAY_MS,
  });
  assert.ok(first.deleted >= 1);
  assert.equal(first.failed, 0);

  assert.equal(await objects.get(revokedOld.storageKey), null);
  assert.ok(await objects.get(revokedRecent.storageKey));
  assert.ok(await objects.get(active.storageKey));

  // The swept row is marked, and a re-run is a no-op for it.
  const reloaded = await store.byIdForOwner(revokedOld.id, owner);
  assert.ok(reloaded?.storageDeletedAt);
  assert.equal(isServable(reloaded!), false);
});

test("abuse reports: one-click, idempotent per reporter, counted for the owner", async () => {
  const share = await makeShare();
  const other = await makeShare();

  assert.equal(await store.recordReport("no-such-slug", "hash-a"), null);

  assert.equal(await store.recordReport(share.slug, "hash-a"), "created");
  assert.equal(
    await store.recordReport(share.slug, "hash-a"),
    "duplicate",
    "same reporter clicking again must not add a row",
  );
  assert.equal(await store.recordReport(share.slug, "hash-b"), "created");

  const counts = await store.reportCountsForOwner(owner);
  assert.equal(counts.get(share.id), 2);
  assert.equal(counts.get(other.id), undefined, "unreported share is absent");

  // A revoked share can still be reported (moderation outlives serving).
  const revoked = await makeShare({ revokedAt: new Date() });
  assert.equal(await store.recordReport(revoked.slug, "hash-a"), "created");
});
