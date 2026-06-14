import { createHash } from "node:crypto";
import { env } from "../env.ts";
import { storage } from "../storage/index.ts";
import { hashPassword } from "./password.ts";

// Validation/limits enforced at upload. Link controls
// (expiry/password/max-views) are parsed here and enforced on every public view.

export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // ~5 MB cap
export const MAX_UPLOAD_BODY_BYTES = MAX_SIZE_BYTES + 64 * 1024; // JSON overhead

export type ShareKind = "markdown" | "html";

interface KindSpec {
  kind: ShareKind;
  contentType: string;
}

// Extension allowlist (the authoritative gate); content is also sniffed below.
const EXT_TO_KIND: Record<string, KindSpec> = {
  md: { kind: "markdown", contentType: "text/markdown; charset=utf-8" },
  markdown: { kind: "markdown", contentType: "text/markdown; charset=utf-8" },
  html: { kind: "html", contentType: "text/html; charset=utf-8" },
  htm: { kind: "html", contentType: "text/html; charset=utf-8" },
};

export class UploadError extends Error {
  readonly status: 400 | 403 | 413 | 415;

  constructor(status: 400 | 403 | 413 | 415, message: string) {
    super(message);
    this.status = status;
    this.name = "UploadError";
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

// .md/.html are UTF-8 text. Reject anything that isn't valid UTF-8 (catches
// real binaries — PNG/PDF/zip — and random bytes), plus any NUL byte (catches
// UTF-16 and other text-ish-but-not-our-format payloads). This blocks someone
// uploading e.g. an image renamed to foo.md.
function looksBinary(bytes: Uint8Array): boolean {
  for (const b of bytes.subarray(0, 8192)) {
    if (b === 0) return true;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

export interface ValidatedUpload {
  filename: string;
  kind: ShareKind;
  contentType: string;
  bytes: Uint8Array;
  sizeBytes: number;
  sha256: string;
}

// Pure validation: type allowlist (ext + sniff) and size cap. Throws UploadError.
export function validateUpload(
  filename: string,
  bytes: Uint8Array,
): ValidatedUpload {
  if (bytes.byteLength === 0) {
    throw new UploadError(400, "empty file");
  }
  if (bytes.byteLength > MAX_SIZE_BYTES) {
    throw new UploadError(
      413,
      `file exceeds ${MAX_SIZE_BYTES} byte limit (${bytes.byteLength})`,
    );
  }

  const ext = extensionOf(filename);
  const spec = EXT_TO_KIND[ext];
  if (!spec) {
    throw new UploadError(
      415,
      `unsupported file type ".${ext}" (allowed: .md, .markdown, .html, .htm)`,
    );
  }

  if (looksBinary(bytes)) {
    throw new UploadError(415, "file content does not look like text");
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    filename,
    kind: spec.kind,
    contentType: spec.contentType,
    bytes,
    sizeBytes: bytes.byteLength,
    sha256,
  };
}

// Persist the bytes under the slug key. (DB row written by the route layer.)
export async function storeObject(
  slug: string,
  upload: ValidatedUpload,
): Promise<void> {
  await storage.put({
    key: slug,
    body: upload.bytes,
    contentType: upload.contentType,
  });
}

export async function deleteObject(slug: string): Promise<void> {
  await storage.delete(slug);
}

// --- Link controls -----------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_TTL_MS = 7 * DAY_MS; // default: 7 days.

// Parse the `expires` control into an absolute Date (or null = never).
// Accepts the documented tokens (1h|24h|7d|30d), any `<n>h`/`<n>d` duration,
// the literal "never", or an absolute ISO-8601 timestamp. Unset → default 7d.
export function parseExpires(
  spec: string | null | undefined,
  now = Date.now(),
): Date | null {
  const s = (spec ?? "").trim();
  if (s === "") return new Date(now + DEFAULT_TTL_MS);
  if (s.toLowerCase() === "never") return null;

  const duration = /^(\d+)([hd])$/.exec(s);
  if (duration) {
    const n = Number(duration[1]);
    if (n <= 0) throw new UploadError(400, "expires duration must be positive");
    return new Date(now + n * (duration[2] === "h" ? HOUR_MS : DAY_MS));
  }

  const at = new Date(s);
  if (Number.isNaN(at.getTime())) {
    throw new UploadError(
      400,
      `invalid expires "${s}" (use 1h|24h|7d|30d|never or an ISO-8601 timestamp)`,
    );
  }
  if (at.getTime() <= now) {
    throw new UploadError(400, "expires must be in the future");
  }
  return at;
}

// Parse the `max_views` control. Unset → null (unlimited).
export function parseMaxViews(
  spec: string | number | null | undefined,
): number | null {
  if (spec === null || spec === undefined || spec === "") return null;
  const n = Number(spec);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UploadError(400, "max_views must be a positive integer");
  }
  return n;
}

export interface RawControls {
  expires?: string | null;
  password?: string | null;
  max_views?: string | number | null;
}

export interface ParsedControls {
  expiresAt: Date | null;
  passwordHash: string | null;
  maxViews: number | null;
}

// Validate + normalize the three link controls. Password (if any) is hashed
// here with the slow KDF; the plaintext never leaves this call.
export function parseControls(raw: RawControls): ParsedControls {
  const password = typeof raw.password === "string" ? raw.password : "";
  return {
    expiresAt: parseExpires(raw.expires),
    maxViews: parseMaxViews(raw.max_views ?? null),
    passwordHash: password ? hashPassword(password) : null,
  };
}

export function buildShareUrls(slug: string): { url: string; rawUrl: string } {
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return { url: `${base}/s/${slug}`, rawUrl: `${base}/s/${slug}/raw` };
}
