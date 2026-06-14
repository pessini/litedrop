import type { Context, MiddlewareHandler } from "hono";
import type { Share } from "../ports/share-store.ts";
import { isServable, type ShareStore } from "../ports/share-store.ts";

// Extension points on the public serving path. Core mounts the serving routers
// with no hooks; a downstream injects its extra dimensions here — without
// touching the shared servability predicate or the atomic view consume, so the
// serving semantics can't drift.
export interface ServingHooks {
  // Extra gate after the pure predicate passes. Return false → 404. (E.g. an
  // owner-ban check in a multi-tenant deployment.)
  isServable?: (share: Share) => Promise<boolean> | boolean;
  // Decorate the outgoing response (e.g. set Cache-Control for a CDN).
  decorateResponse?: (c: Context, share: Share) => void;
  // Middleware to run before serving (e.g. view-path rate limits).
  middleware?: MiddlewareHandler[];
}

// Load a share and decide whether it's servable right now: the shared pure
// predicate, then any hook gate. Does NOT consume a view.
export async function loadServable(
  store: ShareStore,
  slug: string,
  hooks?: ServingHooks,
): Promise<Share | null> {
  const share = await store.bySlug(slug);
  if (!share || !isServable(share)) return null;
  if (hooks?.isServable && !(await hooks.isServable(share))) return null;
  return share;
}
