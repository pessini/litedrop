import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../env.ts";

// Single-user dashboard login. When ADMIN_PASSWORD is set, the dashboard signs
// in with it — no accounts, no signup. Other people can still *view* shares
// (the capability is the slug); they just can't log in to manage them.

export function passwordLoginEnabled(): boolean {
  return env.ADMIN_PASSWORD !== undefined;
}

// Constant-time comparison. Hashing both sides first normalizes length so the
// compare leaks neither the password's length nor its bytes. The reference
// lives in env (operator-provided), so a slow KDF buys nothing — there is no
// stored hash to crack.
export function verifyAdminPassword(
  candidate: string,
  expected = env.ADMIN_PASSWORD,
): boolean {
  if (!expected || !candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
