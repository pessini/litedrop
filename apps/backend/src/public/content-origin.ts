import { Hono } from "hono";
import { env } from "../env.ts";
import { userContentCsp } from "../middleware/csp.ts";
import type { ShareStore } from "../ports/share-store.ts";
import type { StorageBackend } from "../storage/backend.ts";
import { loadServable, type ServingHooks } from "./serving-hooks.ts";
import {
  isContentOriginRequestHost,
  originOf,
  verifyContentToken,
} from "./tokens.ts";

// Isolated content origin — serves raw user HTML for the sandboxed iframe ONLY.
// In production this is mounted on a separate registrable domain
// (CONTENT_BASE_URL) where app cookies aren't valid, so an iframe escape can't
// reach the app. The single Hono app answers both origins; the browser-enforced
// isolation comes from the distinct domain + the iframe sandbox + the CSP.

export interface ContentRouterDeps {
  store: ShareStore;
  storage: StorageBackend;
  hooks?: ServingHooks;
}

export function createContentRouter(deps: ContentRouterDeps): Hono {
  const { store, storage, hooks } = deps;
  const contentRoutes = new Hono();
  const APP_ORIGIN = originOf(env.APP_BASE_URL);

  for (const mw of hooks?.middleware ?? []) contentRoutes.use("/c/:slug", mw);

  contentRoutes.get("/c/:slug", async (c) => {
    const slug = c.req.param("slug");

    if (
      !isContentOriginRequestHost(
        c.req.header("host"),
        c.req.header("x-forwarded-host"),
      )
    ) {
      return c.notFound();
    }

    // Gate: a valid, unexpired token minted by the app origin's host page after
    // it passed the password/expiry/revocation checks. No token → no content.
    if (!verifyContentToken(slug, c.req.query("t"))) {
      return c.text("forbidden\n", 403);
    }

    // Re-check servability (revocation/expiry are immediate) but do NOT consume
    // a view — the host page already did, on /:slug. Only HTML shares are
    // framed; markdown is rendered on the app origin.
    const share = await loadServable(store, slug, hooks);
    if (share?.kind !== "html") return c.notFound();

    const obj = await storage.get(share.storageKey);
    if (!obj) return c.notFound();

    const body = obj.body.buffer.slice(
      obj.body.byteOffset,
      obj.body.byteOffset + obj.body.byteLength,
    ) as ArrayBuffer;
    hooks?.decorateResponse?.(c, share);
    return new Response(body, {
      status: 200,
      headers: {
        // frame-ancestors restricts embedding to the app origin (a DIFFERENT
        // domain in prod). Not X-Frame-Options: it can't name a cross-origin
        // allowance, so SAMEORIGIN there would block the iframe.
        "Content-Security-Policy": userContentCsp(APP_ORIGIN),
        // Explicit type is required: nosniff disables inference, and without
        // it browsers won't render the body as HTML.
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-store",
      },
    });
  });

  return contentRoutes;
}
