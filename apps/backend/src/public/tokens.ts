import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { env } from "../env.ts";
import {
  loadOrCreatePersistedSecret,
  type SecretSource,
} from "../lib/secret.ts";

// Shared HMAC secret for the two short-lived signing jobs on the public path:
//   1. the slug-scoped unlock cookie (hono's signed cookie), and
//   2. the cross-origin content token (below).
// Resolution: UNLOCK_COOKIE_SECRET env var, else a secret generated once and
// persisted to DATA_DIR/unlock-secret (zero-config, survives restarts), else —
// when that file can't be written — an ephemeral per-boot secret. Ephemeral is
// fine for dev but rejected in production (signatures must survive restarts).
function resolveSigningSecret(): { secret: string; source: SecretSource } {
  if (env.UNLOCK_COOKIE_SECRET) {
    return { secret: env.UNLOCK_COOKIE_SECRET, source: "env" };
  }
  const persisted = loadOrCreatePersistedSecret(
    join(env.DATA_DIR, "unlock-secret"),
  );
  if (persisted) return { secret: persisted, source: "persisted" };
  return { secret: randomBytes(32).toString("hex"), source: "ephemeral" };
}

const resolvedSecret = resolveSigningSecret();
export const SIGNING_SECRET = resolvedSecret.secret;
if (resolvedSecret.source === "ephemeral") {
  console.warn(
    `[litedrop] UNLOCK_COOKIE_SECRET is unset and ${env.DATA_DIR} is not ` +
      "writable — using an ephemeral secret; password unlock cookies and " +
      "content tokens won't survive a restart.",
  );
}

// --- Isolated content origin -------------------------------------------------

// Resolved base URL of the content origin. In production this is a separate
// registrable domain (cookie/origin isolation); in dev it falls back to the
// app origin (single-origin — not isolated).
export const contentBaseUrl = (
  env.CONTENT_BASE_URL ?? env.APP_BASE_URL
).replace(/\/$/, "");

export interface PublicOriginConfig {
  nodeEnv: string;
  appBaseUrl: string;
  contentBaseUrl: string | undefined;
  allowSameOriginContent: boolean;
  unlockSecretSource: SecretSource;
}

export function publicOriginConfigErrors(cfg: PublicOriginConfig): string[] {
  if (cfg.nodeEnv !== "production") return [];

  const errors: string[] = [];
  if (cfg.unlockSecretSource === "ephemeral") {
    errors.push(
      "no stable signing secret: set UNLOCK_COOKIE_SECRET or make DATA_DIR writable",
    );
  }

  const app = new URL(cfg.appBaseUrl);

  if (!cfg.contentBaseUrl) {
    if (!cfg.allowSameOriginContent) {
      errors.push(
        "CONTENT_BASE_URL is required in production (or opt out of content-origin " +
          "isolation with ALLOW_SAME_ORIGIN_CONTENT=true for single-user self-hosting)",
      );
    }
    return errors;
  }

  const content = new URL(cfg.contentBaseUrl);
  if (app.origin === content.origin) {
    errors.push(
      "CONTENT_BASE_URL must use a different origin from APP_BASE_URL",
    );
  } else if (app.hostname === content.hostname) {
    errors.push(
      "CONTENT_BASE_URL must use a different hostname from APP_BASE_URL",
    );
  }
  return errors;
}

const publicOriginErrors = publicOriginConfigErrors({
  nodeEnv: env.NODE_ENV,
  appBaseUrl: env.APP_BASE_URL,
  contentBaseUrl: env.CONTENT_BASE_URL,
  allowSameOriginContent: env.ALLOW_SAME_ORIGIN_CONTENT,
  unlockSecretSource: resolvedSecret.source,
});
if (publicOriginErrors.length > 0) {
  console.error(
    `Invalid public origin configuration:\n${publicOriginErrors
      .map((e) => `  - ${e}`)
      .join("\n")}`,
  );
  process.exit(1);
}

if (!env.CONTENT_BASE_URL) {
  console.warn(
    "[litedrop] CONTENT_BASE_URL is unset — serving user HTML from the app " +
      "origin. The iframe is still sandboxed, but NOT origin-isolated; set a " +
      "separate hostname to add that layer back.",
  );
}

/** Origin (scheme://host[:port]) form of a base URL, for CSP directives. */
export function originOf(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function firstHeaderValue(value: string | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

export function isContentOriginRequestHost(
  host: string | undefined,
  _forwardedHost: string | undefined,
  baseUrl = contentBaseUrl,
): boolean {
  const requestHost = firstHeaderValue(host)?.toLowerCase();
  if (!requestHost) return false;
  return requestHost === new URL(baseUrl).host.toLowerCase();
}

// --- Content token -----------------------------------------------------------
// The unlock cookie is scoped to /<slug> on the APP origin, so it never
// reaches /c/<slug> on the CONTENT origin. Instead the app origin — which has
// already passed the password/expiry/revocation gate before rendering the host
// page — mints a short-lived signed token bound to the slug and embeds it in
// the iframe `src`. /c/:slug serves content only for a valid, unexpired token,
// which both bridges the password gate across origins and stops /c being hit
// directly to bypass it.

const CONTENT_TOKEN_TTL_SEC = 300; // enough for the host page's iframe to load

function sign(payload: string): string {
  return createHmac("sha256", SIGNING_SECRET)
    .update(payload)
    .digest("base64url");
}

export function mintContentToken(slug: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + CONTENT_TOKEN_TTL_SEC;
  return `${exp}.${sign(`${slug}.${exp}`)}`;
}

export function verifyContentToken(
  slug: string,
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;

  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isInteger(exp) || exp <= Math.floor(now / 1000)) return false;

  const expected = sign(`${slug}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** URL the host-page iframe loads: the content origin's /c/:slug + token. */
export function buildContentUrl(slug: string, token: string): string {
  return `${contentBaseUrl}/c/${encodeURIComponent(slug)}?t=${token}`;
}
