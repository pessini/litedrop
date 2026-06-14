import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Emit (or, with --check, verify) the committed openapi.json from the
// hand-authored spec, giving client-gen and the CI drift check a stable
// artifact.
//
//   npm run openapi:emit     # regenerate the committed openapi.json
//   npm run openapi:check    # fail if it's out of date (CI guard)
//
// Building the document can pull in the db client transitively. Pin an
// in-memory DATABASE_URL before the dynamic import so the sqlite default
// doesn't create a real .data/ file as a side effect. A fixed base URL keeps
// the output deterministic regardless of local env.
process.env.DATABASE_URL = ":memory:";

const CANONICAL_BASE = "http://localhost:8080";
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "openapi.json",
);

const { buildOpenApiDocument } = await import("../src/openapi.ts");
const json = `${JSON.stringify(buildOpenApiDocument(CANONICAL_BASE), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let existing = "";
  try {
    existing = readFileSync(OUT, "utf8");
  } catch {
    /* missing → treated as drift below */
  }
  if (existing !== json) {
    console.error(
      "openapi.json is out of date. Run `npm run openapi:emit` and commit the result.",
    );
    process.exit(1);
  }
  console.log("openapi.json is in sync.");
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
}
