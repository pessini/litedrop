// Library entry for downstreams that build on the core (e.g. a multi-tenant
// deployment). Re-exports the seam: the share-store port + types, the identity
// seam, the serving hooks, the composable routers, and the reusable DB-free
// domain logic + storage providers. A downstream depends on this package,
// supplies its own store/resolver/hooks, and composes its own app.

// --- Identity seam ---
export {
  clearSessionCookie,
  type ResolveOwner,
  requireOwner,
  SESSION_COOKIE,
  setSessionCookie,
} from "./auth/identity.ts";
export { clientIp, clientIpFromHeaders } from "./lib/request.ts";
export {
  appPageCsp,
  htmlHostCsp,
  spaCsp,
  userContentCsp,
} from "./middleware/csp.ts";
export {
  byIp,
  type RateLimitOptions,
  rateLimit,
} from "./middleware/ratelimit.ts";
// --- Ports & domain types ---
export {
  isServable,
  type NewShare,
  type Share,
  type ShareKind,
  type ShareStatus,
  type ShareStore,
  statusOf,
} from "./ports/share-store.ts";
export {
  type ContentRouterDeps,
  createContentRouter,
} from "./public/content-origin.ts";
export { escapeHtml, htmlHostPage, pageShell } from "./public/layout.ts";
export {
  sharePath,
  shareRawPath,
  shareReportPath,
  shareRoute,
  shareUnlockPath,
} from "./public/paths.ts";
export { renderMarkdown } from "./public/render.ts";
// --- Serving hooks ---
export {
  loadServable,
  type ServingHooks,
} from "./public/serving-hooks.ts";
// --- Content tokens + origin config ---
export {
  buildContentUrl,
  contentBaseUrl,
  isContentOriginRequestHost,
  mintContentToken,
  originOf,
  type PublicOriginConfig,
  publicOriginConfigErrors,
  SIGNING_SECRET,
  verifyContentToken,
} from "./public/tokens.ts";
// --- Composable routers ---
export {
  createPublicRouter,
  type PublicRouterDeps,
} from "./public/view.ts";
export { hashPassword, verifyPassword } from "./shares/password.ts";
export {
  createShareRouter,
  type ShareRouterDeps,
} from "./shares/routes.ts";
// --- Reusable domain logic (DB-free) ---
export {
  MAX_SIZE_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  type ParsedControls,
  parseControls,
  parseExpires,
  parseMaxViews,
  type RawControls,
  UploadError,
  type ValidatedUpload,
  validateUpload,
} from "./shares/service.ts";
export { generateSlug } from "./shares/slug.ts";
// --- Storage ---
export type {
  PutObject,
  StorageBackend,
  StorageProvider,
  StoredObject,
} from "./storage/backend.ts";
export { StorageConfigError } from "./storage/backend.ts";
export { storage } from "./storage/index.ts";
export type { AppEnv, Identity, OwnerKey } from "./types.ts";
