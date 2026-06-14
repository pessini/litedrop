import { randomUUID } from "node:crypto";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Core data model. Single-user and SQLite-only: `shares`, plus the
// `abuse_reports` that viewers file against them. There is no
// users/sessions/api_keys/oauth table — auth is two ENV secrets (a dashboard
// password and a CLI token), and ownership is implicit (the one account owns
// everything), so shares carry no owner column.

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

// shares — one per uploaded file (immutable once created).
export const shares = sqliteTable("shares", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  slug: text("slug").notNull().unique(), // high-entropy public capability
  filename: text("filename").notNull(), // original name, e.g. "report.html"
  contentType: text("content_type").notNull(), // 'text/markdown' | 'text/html'
  kind: text("kind").notNull(), // 'markdown' | 'html'
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(), // storage object key
  sha256: text("sha256").notNull(), // content hash (integrity)
  passwordHash: text("password_hash"), // null = no password
  expiresAt: timestamp("expires_at"), // null = never
  maxViews: integer("max_views"), // null = unlimited
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at"),
  revokedAt: timestamp("revoked_at"), // null = active
  // When the cleanup sweep deleted the storage object. The row stays forever;
  // only the object's lifecycle is tracked. null = object (still) exists.
  storageDeletedAt: timestamp("storage_deleted_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// abuse_reports — one row per (share, reporter): a viewer clicked "report
// abuse" on the public page. One-click and reason-free; the reporter address is
// stored hashed, never raw. The unique index makes a repeat click idempotent.
export const abuseReports = sqliteTable(
  "abuse_reports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    shareId: text("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    reporterIp: text("reporter_ip").notNull(), // hashed
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("abuse_reports_share_reporter_uq").on(t.shareId, t.reporterIp),
  ],
);
