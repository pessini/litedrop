import { env } from "../env.ts";
import type { StorageBackend, StorageProvider } from "./backend.ts";
import { StorageConfigError } from "./backend.ts";
import { azureProvider } from "./providers/azure.ts";
import { localProvider } from "./providers/local.ts";
import { r2Provider } from "./providers/r2.ts";
import { s3Provider } from "./providers/s3.ts";

// The provider registry. Add a provider by implementing StorageBackend +
// StorageProvider in ./providers and listing it here — nothing else changes.
const PROVIDERS: readonly StorageProvider[] = [
  localProvider,
  r2Provider, // Cloudflare R2 (S3 API)
  s3Provider, // AWS S3 and any S3-compatible service (MinIO, B2, Spaces, …)
  azureProvider,
];
const REGISTRY = new Map(PROVIDERS.map((p) => [p.name, p]));

// Single process-wide storage backend, chosen at boot by STORAGE_PROVIDER (an
// operator/deploy setting — never user-facing). Callers import `storage` and
// never a concrete impl. A missing/invalid provider config fails fast here.
function makeStorage(): StorageBackend {
  if (env.STORAGE_BACKEND && !env.STORAGE_PROVIDER) {
    console.warn(
      "STORAGE_BACKEND is deprecated; rename it to STORAGE_PROVIDER.",
    );
  }
  const name = env.STORAGE_PROVIDER ?? env.STORAGE_BACKEND ?? "local";

  const provider = REGISTRY.get(name);
  if (!provider) {
    console.error(
      `Unknown STORAGE_PROVIDER "${name}". Valid values: ${[...REGISTRY.keys()].join(", ")}.`,
    );
    process.exit(1);
  }

  try {
    return provider.create(env);
  } catch (err) {
    if (err instanceof StorageConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

export const storage: StorageBackend = makeStorage();

export type { StorageBackend } from "./backend.ts";
