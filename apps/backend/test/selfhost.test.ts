import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyAdminPassword } from "../src/auth/password.ts";
import { loadOrCreatePersistedSecret } from "../src/lib/secret.ts";

// Self-hosting plumbing: first-boot secret persistence and the single-user
// password gate.

test("persisted secret is generated once and stable across boots", () => {
  const dir = mkdtempSync(join(tmpdir(), "litedrop-secret-"));
  try {
    const path = join(dir, "nested", "unlock-secret");
    const first = loadOrCreatePersistedSecret(path);
    assert.ok(first && first.length >= 32, "generates a strong secret");
    assert.equal(readFileSync(path, "utf8").trim(), first);

    const second = loadOrCreatePersistedSecret(path);
    assert.equal(second, first, "second boot loads the same secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt (too short) persisted secret is regenerated, not honored", () => {
  const dir = mkdtempSync(join(tmpdir(), "litedrop-secret-"));
  try {
    const path = join(dir, "unlock-secret");
    writeFileSync(path, "short\n");
    const secret = loadOrCreatePersistedSecret(path);
    assert.ok(secret && secret.length >= 32);
    assert.notEqual(secret, "short");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unwritable secret path falls back to null (caller goes ephemeral)", () => {
  // A directory path can't be created as a file.
  const dir = mkdtempSync(join(tmpdir(), "litedrop-secret-"));
  try {
    assert.equal(loadOrCreatePersistedSecret(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("admin password verification is exact and rejects empty/unset", () => {
  assert.equal(
    verifyAdminPassword("hunter22hunter22", "hunter22hunter22"),
    true,
  );
  assert.equal(
    verifyAdminPassword("hunter22hunter21", "hunter22hunter22"),
    false,
  );
  assert.equal(verifyAdminPassword("", "hunter22hunter22"), false);
  assert.equal(verifyAdminPassword("anything", undefined), false);
});
