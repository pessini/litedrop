import type { Env } from "../../env.ts";
import type { StorageBackend, StorageProvider } from "../backend.ts";
import { StorageConfigError } from "../backend.ts";
import { S3Client } from "./s3-core.ts";

// Generic S3-compatible provider. Covers AWS S3 AND any service that speaks the
// S3 API — MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, etc. — purely
// through config:
//   - AWS:   set S3_REGION + S3_BUCKET (+ keys). Endpoint and virtual-host
//            addressing are derived automatically.
//   - Other: set S3_ENDPOINT to the service's URL (path-style is used, which is
//            what MinIO/B2/Spaces expect). S3_REGION is still required for the
//            SigV4 scope (use the value the service documents, often us-east-1).
// Credentials fall back to the standard AWS_* env names if S3_* are unset.
export const s3Provider: StorageProvider = {
  name: "s3",
  create(env: Env): StorageBackend {
    const accessKeyId = env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
    const { S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_FORCE_PATH_STYLE } = env;

    if (!accessKeyId || !secretAccessKey || !S3_BUCKET || !S3_REGION) {
      throw new StorageConfigError(
        "s3",
        "requires S3_BUCKET, S3_REGION, and S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY " +
          "(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are also accepted).",
      );
    }

    // A custom endpoint (MinIO/B2/Spaces/…) implies path-style; so does an
    // explicit override. Plain AWS uses virtual-host addressing by default.
    const pathStyle = S3_FORCE_PATH_STYLE || Boolean(S3_ENDPOINT);
    const endpoint =
      S3_ENDPOINT ??
      (pathStyle
        ? `https://s3.${S3_REGION}.amazonaws.com`
        : `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`);

    return new S3Client({
      label: "S3",
      endpoint,
      region: S3_REGION,
      accessKeyId,
      secretAccessKey,
      bucket: S3_BUCKET,
      pathStyle,
    });
  },
};
