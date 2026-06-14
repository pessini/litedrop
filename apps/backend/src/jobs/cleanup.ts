import { SqliteShareStore } from "../db/sqlite-share-store.ts";
import { env } from "../env.ts";
import type { ShareStore } from "../ports/share-store.ts";
import type { StorageBackend } from "../storage/backend.ts";
import { storage } from "../storage/index.ts";

// Storage cleanup sweep. Expired/revoked/consumed shares would otherwise keep
// their storage objects forever, so a periodic in-process job deletes them
// (once at boot, then on an interval).
//
// A share's object is deletable once it has been revoked, expired, or consumed
// for longer than a grace period. The grace period exists for safety: a share
// revoked moments ago stays inspectable briefly. The row itself is never
// deleted — only `storage_deleted_at` records that the object is gone (and the
// servability predicate treats that as a hard 404).

const BATCH_SIZE = 100;

export interface SweepResult {
  deleted: number;
  bytesFreed: number;
  failed: number;
}

export interface SweepOptions {
  store?: ShareStore;
  storage?: StorageBackend;
  graceMs?: number;
  now?: Date;
}

export async function sweepDeletedShareObjects(
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const store = opts.store ?? new SqliteShareStore();
  const objects = opts.storage ?? storage;
  const graceMs = opts.graceMs ?? env.CLEANUP_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - graceMs);

  const result: SweepResult = { deleted: 0, bytesFreed: 0, failed: 0 };

  // Batched: swept rows get storage_deleted_at set and drop out of the
  // predicate, so each iteration selects the next batch. If a whole batch makes
  // no progress (every delete failed), stop and let the next run retry instead
  // of spinning.
  for (;;) {
    const batch = await store.listForCleanup(cutoff, BATCH_SIZE);
    if (batch.length === 0) break;

    let progressed = 0;
    for (const row of batch) {
      try {
        // Delete the object FIRST, then record it. A delete that succeeds but
        // crashes before the mark is safe to repeat — every provider's
        // delete() is idempotent (missing object = success).
        await objects.delete(row.storageKey);
        await store.markStorageDeleted(row.id);
        progressed++;
        result.deleted++;
        result.bytesFreed += row.sizeBytes;
      } catch (err) {
        result.failed++;
        console.error(
          `cleanup sweep: failed to delete object for share ${row.id}`,
          err,
        );
      }
    }
    if (progressed === 0) break;
  }

  return result;
}

let sweepInFlight = false;

async function runSweep(): Promise<void> {
  if (sweepInFlight) return; // skip overlapping runs (slow provider, tiny interval)
  sweepInFlight = true;
  try {
    const { deleted, bytesFreed, failed } = await sweepDeletedShareObjects();
    console.log(
      `cleanup sweep: ${deleted} object(s) deleted, ${bytesFreed} bytes freed` +
        (failed > 0 ? `, ${failed} failed (will retry)` : ""),
    );
  } catch (err) {
    console.error("cleanup sweep: run failed", err);
  } finally {
    sweepInFlight = false;
  }
}

// Once at boot, then every CLEANUP_INTERVAL_MINUTES. The timer is unref'd so it
// never holds the process open during shutdown. 0 disables the job entirely.
export function startCleanupScheduler(): void {
  if (env.CLEANUP_INTERVAL_MINUTES <= 0) return;
  void runSweep();
  setInterval(
    () => void runSweep(),
    env.CLEANUP_INTERVAL_MINUTES * 60 * 1000,
  ).unref();
}
