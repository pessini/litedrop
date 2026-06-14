import type { Env } from "../../env.ts";
import type { StorageBackend, StorageProvider } from "../backend.ts";
import { StorageConfigError } from "../backend.ts";
import { S3Client } from "./s3-core.ts";

// Cloudflare R2. R2 speaks the S3 API, so this
// is just an ergonomic preset over the shared S3 client: derive the endpoint
// from the account id, pin region "auto", use path-style addressing. The
// operator only sets keys + bucket (+ account id) rather than a full endpoint.
export const r2Provider: StorageProvider = {
  name: "r2",
  create(env: Env): StorageBackend {
    const {
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_BUCKET,
      R2_ENDPOINT,
    } = env;
    if (
      !R2_ACCESS_KEY_ID ||
      !R2_SECRET_ACCESS_KEY ||
      !R2_BUCKET ||
      (!R2_ACCOUNT_ID && !R2_ENDPOINT)
    ) {
      throw new StorageConfigError(
        "r2",
        "requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_ACCOUNT_ID (or R2_ENDPOINT).",
      );
    }
    const endpoint =
      R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    return new S3Client({
      label: "R2",
      endpoint,
      region: "auto", // R2 ignores region but SigV4 requires one in scope.
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
      pathStyle: true,
    });
  },
};
