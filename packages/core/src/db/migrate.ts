import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./client.ts";

// The server brings the SQLite file up to date itself at boot — zero setup.
// Works from src/ (native TS) and dist/ (build) alike: both are one level
// below the package root, and the Docker image ships src/db/migrations
// alongside dist/ for exactly this lookup.
const backendRoot = fileURLToPath(new URL("../..", import.meta.url));

export async function autoMigrate(): Promise<void> {
  await migrate(db, {
    migrationsFolder: join(backendRoot, "src", "db", "migrations"),
  });
}
