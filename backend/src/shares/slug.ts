import { randomBytes } from "node:crypto";

// URL-safe alphabet, no look-alikes removed (entropy over readability here).
// 64 chars => 6 bits/char. 12 chars = 72 bits. The slug IS the capability, so
// randomness is what matters — collisions are astronomically unlikely and
// guarded by a UNIQUE col.
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SLUG_LEN = 12;

export function generateSlug(): string {
  const bytes = randomBytes(SLUG_LEN);
  let out = "";
  for (let i = 0; i < SLUG_LEN; i++) {
    // 256 % 64 === 0, so masking the low 6 bits is unbiased.
    out += ALPHABET[bytes[i]! & 63];
  }
  return out;
}
