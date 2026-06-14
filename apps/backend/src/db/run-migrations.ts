import { closeDb } from "./client.ts";
import { autoMigrate } from "./migrate.ts";

try {
  await autoMigrate();
  console.log("SQLite migrations applied.");
} finally {
  await closeDb();
}
