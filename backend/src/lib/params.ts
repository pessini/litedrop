import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.ts";

// Route-param validation. All `:id` path params in the API are Postgres UUIDs;
// passing a non-UUID straight to a `where id = $1` makes Postgres raise (→ 500).
// This guard rejects a malformed id with a 400 *before* it reaches the DB, so
// every `:id` route behaves consistently: 400 malformed · 404 well-formed but
// absent · 200 found.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(name: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const value = c.req.param(name);
    if (!value || !UUID_RE.test(value)) {
      return c.json({ error: `invalid ${name}: expected a UUID` }, 400);
    }
    return next();
  };
}
