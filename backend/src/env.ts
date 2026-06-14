import { existsSync } from "node:fs";
import { z } from "zod";

// Load local environment overrides if present (no-op in containers where vars
// are injected). process.loadEnvFile is available in Node >=22.7; never
// overrides real env vars.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const EnvBool = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === true || value === false) return value;
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return value;
}, z.boolean().default(false));

// 12-factor config. Validated once at startup; import `env` everywhere else.
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  // SQLite database location: a file: URL (default) or :memory: for throwaway
  // runs. The file is migrated automatically at boot — zero external services.
  DATABASE_URL: z.string().min(1).default("file:./.data/litedrop.db"),
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  TRUST_PROXY_HEADERS: EnvBool,

  // Public base URL of the ISOLATED user-content origin that serves raw user
  // HTML into the sandboxed iframe. MUST be a separate registrable domain from
  // APP_BASE_URL in production so an iframe escape can't reach app
  // cookies/sessions. Optional: if unset it falls back to APP_BASE_URL
  // (single-origin — fine for local dev, NOT isolated; a warning is logged at
  // boot).
  CONTENT_BASE_URL: z.string().url().optional(),

  // Explicit opt-out of the production CONTENT_BASE_URL requirement, for
  // single-user self-hosting where running a second hostname is more friction
  // than the defense-in-depth is worth. The iframe stays sandboxed
  // (opaque-origin, no allow-same-origin) either way; this only drops the
  // separate-domain layer that contains a hypothetical sandbox escape.
  ALLOW_SAME_ORIGIN_CONTENT: EnvBool,

  // Directory of the built dashboard SPA (dashboard/dist). If the directory
  // exists the backend serves it (production: one process serves everything).
  // Unset = auto-detect the monorepo path backend/../dashboard/dist; absent =
  // API-only, as in dev where the Vite server proxies instead.
  DASHBOARD_DIST_DIR: z.string().optional(),

  // Storage provider selection (an operator/deploy setting — never user-facing).
  // Each provider's *_ env is required only when it's selected, so the app still
  // boots on local disk with none set.
  //   local → filesystem (default)
  //   s3    → AWS S3 or any S3-compatible service (MinIO, B2, Spaces, Wasabi, R2)
  //   r2    → Cloudflare R2 (S3 API)
  //   azure → Azure Blob Storage
  STORAGE_DIR: z.string().default("./.storage"),
  STORAGE_PROVIDER: z.enum(["local", "r2", "s3", "azure"]).optional(),
  // Deprecated alias for STORAGE_PROVIDER (logs a warning at boot if used).
  STORAGE_BACKEND: z.enum(["local", "r2", "s3", "azure"]).optional(),

  // Cloudflare R2 (S3 API). Endpoint defaults to the account's R2 endpoint;
  // R2_ENDPOINT overrides it (S3-compatible test doubles, non-default regions).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),

  // AWS S3 / any S3-compatible service. For AWS, S3_REGION + S3_BUCKET (+ keys)
  // are enough — the endpoint and virtual-host addressing are derived. For
  // others (MinIO/B2/Spaces/…) set S3_ENDPOINT (path-style is used). Keys fall
  // back to the standard AWS_* names if S3_* are unset.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: EnvBool,
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // Azure Blob Storage (Shared Key auth). AZURE_BLOB_ENDPOINT overrides the
  // default <account>.blob.core.windows.net (e.g. for the Azurite emulator).
  AZURE_STORAGE_ACCOUNT: z.string().optional(),
  AZURE_STORAGE_KEY: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().optional(),
  AZURE_BLOB_ENDPOINT: z.string().url().optional(),

  // Dashboard login lifetime (the signed session cookie's max-age, in days).
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Secret used to sign the dashboard session cookie, the short-lived
  // slug-scoped unlock cookie, and the cross-origin content token. Optional:
  // if unset, a secret is generated once and persisted to DATA_DIR/unlock-secret
  // so it survives restarts with zero config. Set an explicit value (≥16 chars)
  // for read-only filesystems.
  UNLOCK_COOKIE_SECRET: z.string().min(16).optional(),

  // Directory for small server-managed state (the generated signing secret; the
  // default SQLite database also lives here). Must be writable unless the
  // secret is provided via env.
  DATA_DIR: z.string().default("./.data"),

  // --- Storage cleanup sweep ---------------------------------------------------

  // Grace period before the sweep deletes the storage object of a share that's
  // revoked/expired/consumed, so a just-revoked share stays inspectable briefly.
  CLEANUP_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
  // How often the in-process sweep runs (it also runs once at boot).
  // 0 disables the periodic job (and the boot run).
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),

  // --- Single-user auth --------------------------------------------------------

  // Dashboard password (≥8 chars). When set, the dashboard signs in with it and
  // gets a signed session cookie — no accounts, no signup. Leave unset to run
  // headless (CLI/API only).
  ADMIN_PASSWORD: z.string().min(8).optional(),

  // Bearer token the CLI/agents send to the write API
  // (Authorization: Bearer <LITEDROP_TOKEN>). Any sufficiently long secret;
  // rotate by changing it. Unset = the write API has no token auth (dashboard
  // cookie only).
  LITEDROP_TOKEN: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  // A variable set to the empty string means "unset": .env files and compose
  // interpolation commonly produce blank placeholders, and every optional here
  // treats absence — not emptiness — as the off switch.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== ""),
  );
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
