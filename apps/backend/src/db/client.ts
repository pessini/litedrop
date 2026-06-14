import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

// One process-wide SQLite handle. Single-user core is SQLite-only (a single
// local file, zero external services); use a file: URL or :memory: for
// throwaway runs.

export type Db = ReturnType<typeof makeDb>;

let client: Client | undefined;

function makeDb() {
  // file: URL → make sure the parent directory exists (first boot).
  if (env.DATABASE_URL.startsWith("file:")) {
    const path = env.DATABASE_URL.slice("file:".length).replace(/[?#].*$/, "");
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  client = createClient({ url: env.DATABASE_URL });
  // WAL + busy_timeout make concurrent writers queue instead of failing;
  // SQLite leaves foreign keys OFF unless asked.
  client
    .executeMultiple(
      "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
    )
    .catch((err) => {
      console.error("sqlite: failed to apply connection pragmas", err);
    });
  return drizzle(client, { schema });
}

export const db: Db = makeDb();

// Readiness probe (used by /healthz).
export async function pingDb(): Promise<void> {
  if (client) await client.execute("select 1");
  else await db.run(sql`select 1`);
}

// Graceful shutdown: close the file handle.
export async function closeDb(): Promise<void> {
  client?.close();
}
