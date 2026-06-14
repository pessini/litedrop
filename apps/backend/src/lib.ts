// Library entry for downstreams that build on the core (e.g. a multi-tenant
// deployment). Re-exports the seam: the share-store port + types, the identity
// seam, the serving hooks, the composable routers, and the reusable DB-free
// domain logic + storage providers. A downstream depends on this package,
// supplies its own store/resolver/hooks, and composes its own app.

// --- Ports & domain types ---
export {
  type NewShare,
  type Share,
  type ShareKind,
  type ShareStatus,
  type ShareStore,
  isServable,
  statusOf,
} from "./ports/share-store.ts";
export type { AppEnv, Identity, OwnerKey } from "./types.ts";

// --- Identity seam ---
export {
  type ResolveOwner,
  requireOwner,
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
} from "./auth/identity.ts";

// --- Serving hooks ---
export {
  type ServingHooks,
  loadServable,
} from "./public/serving-hooks.ts";

// --- Composable routers ---
export {
  type PublicRouterDeps,
  createPublicRouter,
} from "./public/view.ts";
export {
  type ContentRouterDeps,
  createContentRouter,
} from "./public/content-origin.ts";
export {
  type ShareRouterDeps,
  createShareRouter,
} from "./shares/routes.ts";

// --- Reusable domain logic (DB-free) ---
export {
  MAX_SIZE_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  type ParsedControls,
  type RawControls,
  type ValidatedUpload,
  parseControls,
  parseExpires,
  parseMaxViews,
  UploadError,
  validateUpload,
} from "./shares/service.ts";
export { generateSlug } from "./shares/slug.ts";
export { hashPassword, verifyPassword } from "./shares/password.ts";
export { renderMarkdown } from "./public/render.ts";
export { htmlHostPage, pageShell, escapeHtml } from "./public/layout.ts";
export {
  appPageCsp,
  htmlHostCsp,
  spaCsp,
  userContentCsp,
} from "./middleware/csp.ts";
export { byIp, rateLimit, type RateLimitOptions } from "./middleware/ratelimit.ts";
export { clientIp, clientIpFromHeaders } from "./lib/request.ts";

// --- Content tokens + origin config ---
export {
  buildContentUrl,
  contentBaseUrl,
  mintContentToken,
  originOf,
  isContentOriginRequestHost,
  publicOriginConfigErrors,
  type PublicOriginConfig,
  SIGNING_SECRET,
  verifyContentToken,
} from "./public/tokens.ts";

// --- Storage ---
export type {
  PutObject,
  StorageBackend,
  StorageProvider,
  StoredObject,
} from "./storage/backend.ts";
export { StorageConfigError } from "./storage/backend.ts";
export { storage } from "./storage/index.ts";
