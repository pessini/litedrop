import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type {
  NewShare,
  Share,
  ShareKind,
  ShareStore,
} from "../ports/share-store.ts";
import type { OwnerKey } from "../types.ts";
import { type Db, db } from "./client.ts";
import { abuseReports, shares } from "./schema.ts";

// SQLite adapter for the share store. Single-user: there is no owner column, so
// the OwnerKey argument is accepted (to satisfy the port) and ignored — every
// share belongs to the one account.

type Row = typeof shares.$inferSelect;

// `kind` is a free text column at the DB level; narrow it to the port's union
// on the way out (only validated values are ever written).
function toShare(row: Row): Share {
  return { ...row, kind: row.kind as ShareKind };
}

export class SqliteShareStore implements ShareStore {
  private readonly db: Db;

  constructor(database: Db = db) {
    this.db = database;
  }

  async create(input: NewShare, _owner: OwnerKey): Promise<Share> {
    const [row] = await this.db.insert(shares).values(input).returning();
    return toShare(row!);
  }

  async listByOwner(_owner: OwnerKey): Promise<Share[]> {
    const rows = await this.db
      .select()
      .from(shares)
      .orderBy(desc(shares.createdAt));
    return rows.map(toShare);
  }

  async byIdForOwner(id: string, _owner: OwnerKey): Promise<Share | null> {
    const [row] = await this.db
      .select()
      .from(shares)
      .where(eq(shares.id, id))
      .limit(1);
    return row ? toShare(row) : null;
  }

  async revokeForOwner(id: string, _owner: OwnerKey): Promise<Share | null> {
    const [row] = await this.db
      .update(shares)
      .set({ revokedAt: new Date() })
      .where(eq(shares.id, id))
      .returning();
    return row ? toShare(row) : null;
  }

  async bySlug(slug: string): Promise<Share | null> {
    const [row] = await this.db
      .select()
      .from(shares)
      .where(eq(shares.slug, slug))
      .limit(1);
    return row ? toShare(row) : null;
  }

  async consumeView(slug: string): Promise<Share | null> {
    // App-side timestamp so the predicate is plain; the active/expiry/cap
    // checks run inside the UPDATE, so concurrent requests for the last view
    // can't both win.
    const now = new Date();
    const [row] = await this.db
      .update(shares)
      .set({ viewCount: sql`${shares.viewCount} + 1`, lastViewedAt: now })
      .where(
        and(
          eq(shares.slug, slug),
          isNull(shares.revokedAt),
          isNull(shares.storageDeletedAt),
          or(isNull(shares.expiresAt), sql`${shares.expiresAt} > ${now}`),
          or(isNull(shares.maxViews), lt(shares.viewCount, shares.maxViews)),
        ),
      )
      .returning();
    return row ? toShare(row) : null;
  }

  async recordReport(
    slug: string,
    reporterIpHash: string,
  ): Promise<"created" | "duplicate" | null> {
    const share = await this.bySlug(slug);
    if (!share) return null;
    const inserted = await this.db
      .insert(abuseReports)
      .values({ shareId: share.id, reporterIp: reporterIpHash })
      .onConflictDoNothing()
      .returning();
    return inserted.length > 0 ? "created" : "duplicate";
  }

  async reportCountsForOwner(_owner: OwnerKey): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        shareId: abuseReports.shareId,
        count: sql<number>`count(*)`,
      })
      .from(abuseReports)
      .groupBy(abuseReports.shareId);
    return new Map(rows.map((r) => [r.shareId, r.count]));
  }

  async listForCleanup(cutoff: Date, limit: number): Promise<Share[]> {
    const rows = await this.db
      .select()
      .from(shares)
      .where(
        and(
          isNull(shares.storageDeletedAt),
          or(
            lt(shares.revokedAt, cutoff),
            lt(shares.expiresAt, cutoff),
            and(
              isNotNull(shares.maxViews),
              gte(shares.viewCount, shares.maxViews),
              lt(shares.lastViewedAt, cutoff),
            ),
          ),
        ),
      )
      .limit(limit);
    return rows.map(toShare);
  }

  async markStorageDeleted(id: string): Promise<void> {
    await this.db
      .update(shares)
      .set({ storageDeletedAt: new Date() })
      .where(eq(shares.id, id));
  }
}
