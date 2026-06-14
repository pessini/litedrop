import { defineConfig } from "drizzle-kit";
import { env } from "./src/env.js";

// SQLite-only. `drizzle-kit generate|push|studio` target the same database the
// app uses (DATABASE_URL, a file: URL by default).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: env.DATABASE_URL },
  strict: true,
  verbose: true,
});
