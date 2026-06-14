import type { OwnerKey } from "../types.ts";

// Persistence port for shares. Core ships the SQLite adapter; a downstream
// (e.g. a multi-tenant Postgres deployment) can provide its own adapter with
// the same surface plus its own extra methods. The database never leaks past
// this interface — callers depend on Share and ShareStore, never on a concrete
// schema or driver.

export type ShareKind = "markdown" | "html";

// Canonical share row. Note there is no owner column: ownership is the
// adapter's concern (the single-user adapter keeps everything under one
// implicit owner). A multi-tenant adapter returns rows that additionally
// carry an owner id; those rows stay assignable to Share.
export interface Share {
  id: string;
  slug: string;
  filename: string;
  contentType: string;
  kind: ShareKind;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: Date | null;
  revokedAt: Date | null;
  storageDeletedAt: Date | null;
  createdAt: Date;
}

// Fields supplied at creation; the store fills in id/slug-derived columns and
// the timestamps.
export interface NewShare {
  slug: string;
  filename: string;
  contentType: string;
  kind: ShareKind;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  maxViews: number | null;
}

export interface ShareStore {
  // --- Authed API (owner-scoped) ---
  create(input: NewShare, owner: OwnerKey): Promise<Share>;
  listByOwner(owner: OwnerKey): Promise<Share[]>;
  byIdForOwner(id: string, owner: OwnerKey): Promise<Share | null>;
  /** Revoke a share the owner holds. Returns the row, or null if not theirs. */
  revokeForOwner(id: string, owner: OwnerKey): Promise<Share | null>;

  // --- Public serving (slug is the capability; not owner-scoped) ---
  bySlug(slug: string): Promise<Share | null>;
  /**
   * Atomic burn-after-read: increment viewCount under the same
   * active/expiry/cap predicates, in one statement. Returns the post-increment
   * row, or null if the share was already gone.
   */
  consumeView(slug: string): Promise<Share | null>;

  // --- Abuse reports (public, one-click) ---
  /**
   * Record an abuse report from a viewer against a slug. Works for any
   * existing slug (a since-revoked/expired link can still be reported);
   * idempotent per (share, reporter hash). Returns "created", "duplicate"
   * when this reporter already flagged the share, or null when the slug does
   * not exist.
   */
  recordReport(
    slug: string,
    reporterIpHash: string,
  ): Promise<"created" | "duplicate" | null>;
  /** Report counts for the owner's shares, keyed by share id. Shares with no
   * reports are absent. */
  reportCountsForOwner(owner: OwnerKey): Promise<Map<string, number>>;

  // --- Cleanup sweep ---
  /** Shares whose object is deletable: revoked/expired/consumed before cutoff,
   * storageDeletedAt still null. */
  listForCleanup(cutoff: Date, limit: number): Promise<Share[]>;
  markStorageDeleted(id: string): Promise<void>;
}

// Read-only servability predicate, shared by every serving path so they can't
// drift. A share is servable when it is not revoked, its object has not been
// swept, it has not expired, and it is still under its view cap. The
// owner-level dimension (e.g. a banned owner in a multi-tenant deployment) is
// layered on top via a serving hook, not here.
export function isServable(share: Share, now = Date.now()): boolean {
  if (share.revokedAt) return false;
  if (share.storageDeletedAt) return false;
  if (share.expiresAt && share.expiresAt.getTime() <= now) return false;
  if (share.maxViews !== null && share.viewCount >= share.maxViews)
    return false;
  return true;
}

// Effective status for owner-facing list/get responses — the full state, not
// just the revoked flag.
export type ShareStatus = "active" | "revoked" | "expired" | "consumed";
export function statusOf(s: Share, now = Date.now()): ShareStatus {
  if (s.revokedAt) return "revoked";
  if (s.expiresAt && s.expiresAt.getTime() <= now) return "expired";
  if (s.maxViews !== null && s.viewCount >= s.maxViews) return "consumed";
  return "active";
}
