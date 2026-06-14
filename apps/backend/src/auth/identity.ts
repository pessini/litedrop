import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { env } from "../env.ts";
import { SIGNING_SECRET } from "../public/tokens.ts";
import type { AppEnv, Identity, OwnerKey } from "../types.ts";

// Single-user identity. There is exactly one account; everything is owned by
// it. Authentication is two ENV secrets:
//   - the dashboard logs in with ADMIN_PASSWORD and gets a signed cookie;
//   - the CLI/agents send LITEDROP_TOKEN as a bearer token.
// No users/sessions/api_keys tables — rotating a secret is changing the env var.

const SINGLE_OWNER = "self" as OwnerKey;
export const SINGLE_USER: Identity = { owner: SINGLE_OWNER };

export const SESSION_COOKIE = "ld_session";
const SESSION_TTL_SEC = () => env.SESSION_TTL_DAYS * 24 * 60 * 60;

// Constant-time comparison. Hashing both sides first normalizes length so the
// compare leaks neither the secret's length nor its bytes.
function secretEquals(
  candidate: string,
  expected: string | undefined,
): boolean {
  if (!expected || !candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True when the CLI bearer token matches the configured LITEDROP_TOKEN. */
export function cliTokenValid(token: string): boolean {
  return secretEquals(token, env.LITEDROP_TOKEN);
}

// A resolver maps a request to the caller's identity (or null). Authed routers
// receive one so they don't hard-code how authentication works; a downstream
// can inject a different resolver (e.g. OAuth + real users).
export type ResolveOwner = (c: Context<AppEnv>) => Promise<Identity | null>;

// Core resolver: a valid CLI bearer token, or a valid signed login cookie.
export const resolveSingleUser: ResolveOwner = async (c) => {
  const header = c.req.header("Authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    return cliTokenValid(header.slice(7)) ? SINGLE_USER : null;
  }
  const cookie = await getSignedCookie(c, SIGNING_SECRET, SESSION_COOKIE);
  return cookie === "1" ? SINGLE_USER : null;
};

// Build an auth gate from a resolver. 401 if unauthenticated; otherwise sets
// the identity on the context.
export function requireOwner(resolve: ResolveOwner): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const identity = await resolve(c);
    if (!identity) return c.json({ error: "unauthorized" }, 401);
    c.set("identity", identity);
    return next();
  };
}

// --- Login cookie plumbing ---------------------------------------------------

export async function setSessionCookie(c: Context): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, "1", SIGNING_SECRET, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC(),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
