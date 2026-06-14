import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// First-boot secret persistence. When UNLOCK_COOKIE_SECRET isn't provided, the
// server generates one and keeps it in DATA_DIR (next to the default SQLite
// db, a mounted volume in the container) so signatures survive restarts with
// zero configuration. A failure to read or write (read-only fs, serverless)
// returns null and the caller falls back to an ephemeral secret.

/** Returned alongside the secret so boot logging/guards can tell how stable it is. */
export type SecretSource = "env" | "persisted" | "ephemeral";

const SECRET_BYTES = 32;
// Persisted values shorter than this are treated as corrupt, not honored.
const MIN_SECRET_CHARS = 16;

export function loadOrCreatePersistedSecret(filePath: string): string | null {
  try {
    const existing = readFileSync(filePath, "utf8").trim();
    if (existing.length >= MIN_SECRET_CHARS) return existing;
  } catch {
    // fall through to create
  }

  const secret = randomBytes(SECRET_BYTES).toString("hex");
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${secret}\n`, { mode: 0o600, flag: "w" });
  } catch {
    return null;
  }
  return secret;
}
