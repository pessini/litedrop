import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Share passwords are user-chosen and low-entropy, so they get a
// deliberately-slow KDF (scrypt) to blunt offline brute force. Stored as a
// self-describing string so parameters can evolve without a migration:
//   scrypt:<N>:<r>:<p>:<saltHex>:<hashHex>

// CPU/memory cost. 128 * N * r ≈ 16 MiB of working memory — comfortably under
// Node's 32 MiB scrypt maxmem default while still being expensive to attack.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_LEN = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

// Constant-time verify. Returns false on any malformed stored value rather than
// throwing, so a corrupt row can't 500 a public page.
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, ns, rs, ps, saltHex, hashHex] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(ns);
  const r = Number(rs);
  const p = Number(ps);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(
      password,
      Buffer.from(saltHex, "hex"),
      expected.length,
      {
        N: n,
        r,
        p,
      },
    );
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
