import { createHash } from "node:crypto";
import { type Context, Hono } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { env } from "../env.ts";
import { clientIp } from "../lib/request.ts";
import { appPageCsp, htmlHostCsp } from "../middleware/csp.ts";
import { byIp, rateLimit } from "../middleware/ratelimit.ts";
import type { Share, ShareStore } from "../ports/share-store.ts";
import { verifyPassword } from "../shares/password.ts";
import type { StorageBackend } from "../storage/backend.ts";
import { escapeHtml, htmlHostPage, pageShell } from "./layout.ts";
import {
  legacyShareRoute,
  sharePath,
  shareReportPath,
  shareRoute,
  shareUnlockPath,
} from "./paths.ts";
import { renderMarkdown } from "./render.ts";
import { loadServable, type ServingHooks } from "./serving-hooks.ts";
import {
  buildContentUrl,
  contentBaseUrl,
  mintContentToken,
  originOf,
  SIGNING_SECRET,
} from "./tokens.ts";

// Public share serving. Covers markdown render + raw; link controls (expiry,
// password via prompt + unlock + header, and max-views / burn-after-read with
// atomic view counting); and HTML rendered in a sandboxed iframe on the
// isolated content origin. Built as a factory so the store, storage backend,
// and serving hooks can be injected.

const UNLOCK_TTL_SEC = 60 * 60; // unlock cookie lives 1 hour
const unlockCookieName = (slug: string) => `ld_unlock_${slug}`;

// Throttle password attempts per IP — blunts online brute force against share
// passwords. A wrong password already costs no view; this caps the guess rate.
const unlockRateLimit = rateLimit({
  name: "unlock",
  limit: 20,
  windowMs: 60 * 1000,
  key: byIp,
});

// Throttle abuse reports per IP so the endpoint can't be used to flood.
const reportRateLimit = rateLimit({
  name: "report",
  limit: 5,
  windowMs: 10 * 60 * 1000,
  key: byIp,
});

const publicShareBaseUrl = env.PUBLIC_SHARE_BASE_URL?.replace(/\/$/, "");
const publicShareHost = publicShareBaseUrl
  ? new URL(publicShareBaseUrl).host.toLowerCase()
  : null;

function firstHeaderValue(value: string | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function requestHost(c: Context): string | null {
  const rawHost = env.TRUST_PROXY_HEADERS
    ? c.req.header("x-forwarded-host") || c.req.header("host")
    : c.req.header("host");
  return firstHeaderValue(rawHost)?.toLowerCase() ?? null;
}

function canonicalShareRedirect(
  c: Context,
  slug: string,
  suffix = "",
  force = false,
): Response | null {
  if (!publicShareBaseUrl) return null;
  if (!force && requestHost(c) === publicShareHost) return null;
  return c.redirect(`${publicShareBaseUrl}${sharePath(slug, suffix)}`, 302);
}

// Reporter addresses are stored hashed — SHA-256 over the signing secret plus
// the address — so the reports table never holds a raw IP.
function reporterHash(ip: string): string {
  return createHash("sha256").update(`${SIGNING_SECRET}:${ip}`).digest("hex");
}

// Is the caller allowed past the password gate? True when the share has no
// password, or a correct password arrived via the X-Litedrop-Password header
// (agents/CLI) or a valid signed unlock cookie (browser, post-prompt).
async function isUnlocked(c: Context, share: Share): Promise<boolean> {
  if (!share.passwordHash) return true;

  const header = c.req.header("X-Litedrop-Password");
  if (header && verifyPassword(header, share.passwordHash)) return true;

  const cookie = await getSignedCookie(
    c,
    SIGNING_SECRET,
    unlockCookieName(share.slug),
  );
  return cookie === "1";
}

function notFound(c: Context) {
  return c.html(
    pageShell({
      title: "Not found",
      slug: "",
      bodyHtml:
        "<h1>Not found</h1><p>This link is invalid, expired, or has been revoked.</p>",
    }),
    404,
  );
}

function slugParam(c: Context): string {
  const slug = c.req.param("slug");
  if (!slug) throw new Error("missing share slug route param");
  return slug;
}

function passwordPromptPage(slug: string, error?: string): string {
  const errorHtml = error
    ? `<p style="color:#b91c1c;margin:0 0 1rem">${escapeHtml(error)}</p>`
    : "";
  const action = shareUnlockPath(slug);
  return pageShell({
    title: "Password required",
    slug,
    bodyHtml: `<h1>Password required</h1>
<p>This link is protected. Enter its password to view it.</p>
${errorHtml}
<form method="post" action="${action}">
  <input type="password" name="password" autofocus required aria-label="Password"
    style="font:inherit;padding:.5em .6em;border:1px solid #ccc;border-radius:6px;width:100%;max-width:320px;display:block">
  <button type="submit"
    style="font:inherit;padding:.5em 1.1em;margin-top:.75rem;border:0;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer">Unlock</button>
</form>`,
  });
}

function reportPromptPage(slug: string): string {
  const action = shareReportPath(slug);
  return pageShell({
    title: "Report abuse",
    slug,
    bodyHtml: `<h1>Report this link</h1>
<p>Flag this content for the operator of this litedrop to review. One click —
no details needed.</p>
<form method="post" action="${action}">
  <button type="submit"
    style="font:inherit;padding:.5em 1.1em;border:0;border-radius:6px;background:#b91c1c;color:#fff;cursor:pointer">Report abuse</button>
</form>`,
  });
}

export interface PublicRouterDeps {
  store: ShareStore;
  storage: StorageBackend;
  hooks?: ServingHooks;
}

export function createPublicRouter(deps: PublicRouterDeps): Hono {
  const { store, storage, hooks } = deps;
  const publicRoutes = new Hono();

  // Strict CSP on every app-origin public page, and an uncacheable default
  // (the host page, prompts, 404s). Serving handlers may decorate the response
  // via the hook. Raw responses build their own headers and bypass this.
  publicRoutes.use("*", async (c, next) => {
    c.header("Content-Security-Policy", appPageCsp());
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  // Optional injected middleware (e.g. view-path rate limits).
  for (const mw of hooks?.middleware ?? []) publicRoutes.use("*", mw);

  // Raw bytes for agents/CLI: text/plain, nosniff, inline disposition. Returns
  // a 401 Response when locked, or null when not servable (→ 404).
  async function serveRaw(c: Context, slug: string): Promise<Response | null> {
    const share = await loadServable(store, slug, hooks);
    if (!share) return null;

    if (!(await isUnlocked(c, share))) {
      return new Response(
        "password required: resend with the X-Litedrop-Password header\n",
        {
          status: 401,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "private, no-store",
          },
        },
      );
    }

    const obj = await storage.get(share.storageKey);
    if (!obj) return null;

    // Atomic burn after the password gate — a wrong password never costs a view.
    const consumed = await store.consumeView(slug);
    if (!consumed) return null;

    const body = obj.body.buffer.slice(
      obj.body.byteOffset,
      obj.body.byteOffset + obj.body.byteLength,
    ) as ArrayBuffer;
    const res = new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${encodeURIComponent(share.filename)}"`,
        "Cache-Control": "private, no-store",
        Vary: "Accept",
      },
    });
    hooks?.decorateResponse?.(c, share);
    return res;
  }

  publicRoutes.get(shareRoute("/raw"), async (c) => {
    const slug = slugParam(c);
    const redirect = canonicalShareRedirect(c, slug, "/raw");
    if (redirect) return redirect;
    const res = await serveRaw(c, slug);
    return res ?? notFound(c);
  });

  publicRoutes.get(legacyShareRoute("/raw"), async (c) => {
    const slug = slugParam(c);
    const redirect = canonicalShareRedirect(c, slug, "/raw", true);
    if (redirect) return redirect;
    const res = await serveRaw(c, slug);
    return res ?? notFound(c);
  });

  // POST /:slug/unlock — verify a share password and set the signed,
  // slug-scoped unlock cookie. Accepts an HTML form or JSON {password}.
  publicRoutes.post(shareRoute("/unlock"), unlockRateLimit, async (c) => {
    const slug = slugParam(c);
    const share = await loadServable(store, slug, hooks);
    if (!share?.passwordHash) return notFound(c);

    const wantsJson = (c.req.header("Content-Type") ?? "").includes(
      "application/json",
    );
    let password = "";
    if (wantsJson) {
      const body = (await c.req.json().catch(() => ({}))) as {
        password?: unknown;
      };
      if (typeof body.password === "string") password = body.password;
    } else {
      const body = await c.req.parseBody();
      if (typeof body.password === "string") password = body.password;
    }

    if (!verifyPassword(password, share.passwordHash)) {
      if (wantsJson) return c.json({ error: "incorrect password" }, 401);
      return c.html(
        passwordPromptPage(slug, "Incorrect password — try again."),
        401,
      );
    }

    await setSignedCookie(c, unlockCookieName(slug), "1", SIGNING_SECRET, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: sharePath(slug),
      maxAge: UNLOCK_TTL_SEC,
    });

    if (wantsJson) return c.json({ unlocked: true });
    return c.redirect(sharePath(slug), 303);
  });

  // One-click abuse reporting, shared by every deployment. The share-page
  // buttons POST here directly; the GET variant exists for direct navigation
  // and shows a single confirm button — a bare GET must never record anything,
  // or link scanners and prefetchers would file reports on their own. Reports
  // work for any existing slug, servable or not (a since-revoked link can
  // still be reported); an unknown slug 404s. A repeat click by the same
  // reporter is a no-op (same confirmation, no new row).
  publicRoutes.get(shareRoute("/report"), async (c) => {
    const slug = slugParam(c);
    if ((await store.bySlug(slug)) === null) return notFound(c);
    return c.html(reportPromptPage(slug));
  });

  publicRoutes.post(shareRoute("/report"), reportRateLimit, async (c) => {
    const slug = slugParam(c);
    const result = await store.recordReport(slug, reporterHash(clientIp(c)));
    if (result === null) return notFound(c);
    return c.html(
      pageShell({
        title: "Reported",
        slug,
        bodyHtml:
          "<h1>✓ Reported</h1><p>Thanks — this link has been flagged for the operator to review. You can close this page.</p>",
      }),
    );
  });

  async function serveSharePage(c: Context, slug: string): Promise<Response> {
    // Agent-friendly negotiation: explicit text/plain (and not html) → raw.
    const accept = c.req.header("Accept") ?? "";
    if (accept.includes("text/plain") && !accept.includes("text/html")) {
      const res = await serveRaw(c, slug);
      return res ?? notFound(c);
    }

    const share = await loadServable(store, slug, hooks);
    if (!share) return notFound(c);

    if (!(await isUnlocked(c, share))) {
      return c.html(passwordPromptPage(slug));
    }

    if (share.kind === "markdown") {
      const obj = await storage.get(share.storageKey);
      if (!obj) return notFound(c);

      const consumed = await store.consumeView(slug);
      if (!consumed) return notFound(c);

      c.header("Vary", "Accept");
      hooks?.decorateResponse?.(c, share);
      return c.html(
        pageShell({
          title: share.filename,
          slug,
          bodyHtml: renderMarkdown(new TextDecoder("utf-8").decode(obj.body)),
        }),
      );
    }

    // HTML: never executed on the app origin. Consume the view here (one per
    // opened link), mint a short-lived token bound to the slug, and return a
    // host page whose sandboxed iframe loads the raw bytes from the isolated
    // content origin. The token proves this gate was passed and keeps /c from
    // being hit directly.
    const consumed = await store.consumeView(slug);
    if (!consumed) return notFound(c);

    const contentUrl = buildContentUrl(slug, mintContentToken(slug));
    c.header("Content-Security-Policy", htmlHostCsp(originOf(contentBaseUrl)));
    c.header("Vary", "Accept");
    hooks?.decorateResponse?.(c, share);
    return c.html(htmlHostPage({ slug, filename: share.filename, contentUrl }));
  }

  publicRoutes.get(legacyShareRoute(), async (c) => {
    const slug = slugParam(c);
    const redirect = canonicalShareRedirect(c, slug, "", true);
    if (redirect) return redirect;
    return serveSharePage(c, slug);
  });

  publicRoutes.get(shareRoute(), async (c) => {
    const slug = slugParam(c);
    const redirect = canonicalShareRedirect(c, slug);
    if (redirect) return redirect;
    return serveSharePage(c, slug);
  });

  return publicRoutes;
}
