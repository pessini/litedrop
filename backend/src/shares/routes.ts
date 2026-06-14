import { type Context, Hono } from "hono";
import { type ResolveOwner, requireOwner } from "../auth/identity.ts";
import { uuidParam } from "../lib/params.ts";
import { type Share, type ShareStore, statusOf } from "../ports/share-store.ts";
import type { AppEnv } from "../types.ts";
import {
  buildShareUrls,
  deleteObject,
  MAX_SIZE_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  parseControls,
  type RawControls,
  storeObject,
  UploadError,
  validateUpload,
} from "./service.ts";
import { generateSlug } from "./slug.ts";

// Authenticated share API for the single-user owner. Built as a factory so the
// store and the identity resolver are injected. Link controls
// (expiry/password/max-views) are parsed and stored here; they're enforced on
// every public view.

function publicShare(s: Share, reportCount = 0) {
  const { url, rawUrl } = buildShareUrls(s.slug);
  return {
    id: s.id,
    slug: s.slug,
    url,
    raw_url: rawUrl,
    filename: s.filename,
    kind: s.kind,
    size_bytes: s.sizeBytes,
    view_count: s.viewCount,
    report_count: reportCount,
    expires_at: s.expiresAt,
    max_views: s.maxViews,
    has_password: s.passwordHash !== null,
    status: statusOf(s),
    created_at: s.createdAt,
  };
}

// Link controls from the query string (how the CLI/raw uploads pass them).
function queryControls(c: Context<AppEnv>): RawControls {
  return rawUploadControls({
    expiresQuery: c.req.query("expires"),
    passwordQuery: c.req.query("password"),
    passwordHeader: undefined,
    maxViewsQuery: c.req.query("max_views"),
  });
}

export interface RawUploadControlParts {
  expiresQuery: string | undefined;
  passwordQuery: string | undefined;
  passwordHeader: string | undefined;
  maxViewsQuery: string | undefined;
}

export function rawUploadControls(parts: RawUploadControlParts): RawControls {
  if (parts.passwordQuery !== undefined) {
    throw new UploadError(
      400,
      "password must not be sent in the query string; use JSON or X-Litedrop-Share-Password",
    );
  }
  return {
    expires: parts.expiresQuery ?? null,
    password: parts.passwordHeader ?? null,
    max_views: parts.maxViewsQuery ?? null,
  };
}

function contentLengthExceedsLimit(
  value: string | undefined,
  limit: number,
): boolean {
  if (!value) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > limit;
}

export async function readStreamUpToLimit(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new UploadError(413, `file exceeds ${limit} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readLimitedRequestBody(
  c: Context<AppEnv>,
  limit: number,
): Promise<Uint8Array> {
  if (contentLengthExceedsLimit(c.req.header("content-length"), limit)) {
    throw new UploadError(413, `file exceeds ${limit} byte limit`);
  }
  return readStreamUpToLimit(c.req.raw.body, limit);
}

interface ParsedUpload {
  filename: string;
  bytes: Uint8Array;
  controls: RawControls;
}

// Read the request body + filename + link controls. Supports JSON
// {content, name, expires?, password?, max_views?} and raw bytes with query
// params (what the CLI sends).
async function readUpload(c: Context<AppEnv>): Promise<ParsedUpload> {
  const queryName = c.req.query("name");
  const contentType = c.req.header("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    let body: {
      content?: unknown;
      name?: unknown;
      expires?: unknown;
      password?: unknown;
      max_views?: unknown;
    };
    try {
      const bytes = await readLimitedRequestBody(c, MAX_UPLOAD_BODY_BYTES);
      body = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as typeof body;
    } catch (err) {
      if (err instanceof UploadError) throw err;
      throw new UploadError(400, "could not parse json body");
    }
    if (typeof body.content !== "string") {
      throw new UploadError(400, "json body requires a string 'content' field");
    }
    const filename =
      (typeof body.name === "string" && body.name) || queryName || "";
    if (!filename) throw new UploadError(400, "missing 'name'");
    // Body fields win; fall back to query params for anything omitted.
    const q = queryControls(c);
    const controls: RawControls = {
      expires: typeof body.expires === "string" ? body.expires : q.expires,
      password: typeof body.password === "string" ? body.password : q.password,
      max_views:
        typeof body.max_views === "number" || typeof body.max_views === "string"
          ? body.max_views
          : q.max_views,
    };
    return {
      filename,
      bytes: new TextEncoder().encode(body.content),
      controls,
    };
  }

  // Raw body.
  if (!queryName) {
    throw new UploadError(400, "missing 'name' query parameter for raw upload");
  }
  return {
    filename: queryName,
    bytes: await readLimitedRequestBody(c, MAX_SIZE_BYTES),
    controls: rawUploadControls({
      expiresQuery: c.req.query("expires"),
      passwordQuery: c.req.query("password"),
      passwordHeader: c.req.header("X-Litedrop-Share-Password"),
      maxViewsQuery: c.req.query("max_views"),
    }),
  };
}

export interface ShareRouterDeps {
  store: ShareStore;
  resolveOwner: ResolveOwner;
}

export function createShareRouter(deps: ShareRouterDeps): Hono<AppEnv> {
  const { store, resolveOwner } = deps;
  const shareRoutes = new Hono<AppEnv>();

  // Every share route requires the authenticated owner.
  shareRoutes.use("*", requireOwner(resolveOwner));

  // POST /api/shares — create an immutable share.
  shareRoutes.post("/", async (c) => {
    let filename: string;
    let bytes: Uint8Array;
    let rawControls: RawControls;
    try {
      ({ filename, bytes, controls: rawControls } = await readUpload(c));
    } catch (err) {
      if (err instanceof UploadError)
        return c.json({ error: err.message }, err.status);
      return c.json({ error: "could not read request body" }, 400);
    }

    let validated: ReturnType<typeof validateUpload>;
    let controls: ReturnType<typeof parseControls>;
    try {
      validated = validateUpload(filename, bytes);
      controls = parseControls(rawControls);
    } catch (err) {
      if (err instanceof UploadError)
        return c.json({ error: err.message }, err.status);
      throw err;
    }

    const owner = c.get("identity").owner;
    const slug = generateSlug();
    let stored = false;

    let row: Share;
    try {
      await storeObject(slug, validated);
      stored = true;
      row = await store.create(
        {
          slug,
          filename: validated.filename,
          contentType: validated.contentType,
          kind: validated.kind,
          sizeBytes: validated.sizeBytes,
          storageKey: slug,
          sha256: validated.sha256,
          expiresAt: controls.expiresAt,
          passwordHash: controls.passwordHash,
          maxViews: controls.maxViews,
        },
        owner,
      );
    } catch (err) {
      if (stored) {
        await deleteObject(slug).catch((cleanupErr) => {
          console.error(
            "failed to clean up stored object after upload error",
            cleanupErr,
          );
        });
      }
      if (err instanceof UploadError)
        return c.json({ error: err.message }, err.status);
      throw err;
    }

    return c.json(publicShare(row), 201);
  });

  // GET /api/shares — list the owner's shares, newest first.
  shareRoutes.get("/", async (c) => {
    const owner = c.get("identity").owner;
    const rows = await store.listByOwner(owner);
    const reports = await store.reportCountsForOwner(owner);
    return c.json({
      shares: rows.map((s) => publicShare(s, reports.get(s.id) ?? 0)),
    });
  });

  // GET /api/shares/:id — a single share.
  shareRoutes.get("/:id", uuidParam("id"), async (c) => {
    const owner = c.get("identity").owner;
    const row = await store.byIdForOwner(c.req.param("id"), owner);
    if (!row) return c.json({ error: "not found" }, 404);
    const reports = await store.reportCountsForOwner(owner);
    return c.json(publicShare(row, reports.get(row.id) ?? 0));
  });

  // DELETE /api/shares/:id — revoke (shares are immutable: revoke, never edit).
  shareRoutes.delete("/:id", uuidParam("id"), async (c) => {
    const row = await store.revokeForOwner(
      c.req.param("id"),
      c.get("identity").owner,
    );
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ id: row.id, status: statusOf(row) });
  });

  return shareRoutes;
}
