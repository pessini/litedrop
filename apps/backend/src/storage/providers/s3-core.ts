import { createHash, createHmac } from "node:crypto";
import type { PutObject, StorageBackend, StoredObject } from "../backend.ts";

// Shared implementation for every S3-compatible service: Cloudflare R2, AWS S3,
// MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, … They all speak the same
// wire protocol, so there is ONE client here and the r2/s3 provider modules
// are thin config presets over it.
//
// Dependency-free: a small AWS Signature V4 signer plus fetch (no AWS SDK in a
// lean backend). The SigV4 flow is: canonical request → string-to-sign →
// signing key → signature.

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

export interface S3ClientConfig {
  /**
   * Full origin, e.g. https://<account>.r2.cloudflarestorage.com (R2),
   * https://s3.<region>.amazonaws.com (AWS path-style), or
   * https://<bucket>.s3.<region>.amazonaws.com (AWS virtual-host).
   */
  endpoint: string;
  /** SigV4 region scope. "auto" for R2 (it ignores region but SigV4 needs one). */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * true → path-style addressing (/bucket/key); false → virtual-host (the
   * bucket is already part of `endpoint`'s host, path is just /key).
   */
  pathStyle: boolean;
  /** Label used in error messages (e.g. "R2", "S3"). */
  label?: string;
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

// Encode a path segment per RFC 3986 (S3 canonical-URI rules): unreserved chars
// stay literal, everything else is %-encoded. '/' is handled by the caller.
function encodeSegment(seg: string): string {
  return encodeURIComponent(seg).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export class S3Client implements StorageBackend {
  private readonly host: string;
  private readonly origin: string;
  private readonly label: string;
  private readonly cfg: S3ClientConfig;

  constructor(cfg: S3ClientConfig) {
    this.cfg = cfg;
    this.origin = cfg.endpoint.replace(/\/$/, "");
    this.host = new URL(this.origin).host;
    this.label = cfg.label ?? "S3";
  }

  // Object URL path: path-style is /<bucket>/<key>; virtual-host is /<key>
  // (the bucket lives in the host).
  private objectPath(key: string): string {
    const encodedKey = encodeSegment(key);
    return this.cfg.pathStyle
      ? `/${encodeSegment(this.cfg.bucket)}/${encodedKey}`
      : `/${encodedKey}`;
  }

  // Sign and send a single S3 request. `body` is undefined for GET/DELETE.
  private async send(
    method: "PUT" | "GET" | "DELETE",
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const path = this.objectPath(key);
    const payloadHash = body ? sha256Hex(body) : sha256Hex("");

    // Canonical headers (sorted, lowercase). Content-Type is signed on PUT.
    const headers: Record<string, string> = {
      host: this.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (method === "PUT" && contentType) headers["content-type"] = contentType;

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}\n`)
      .join("");

    const canonicalRequest = [
      method,
      path,
      "", // no query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.cfg.region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      ALGORITHM,
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = hmac(
      hmac(
        hmac(
          hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp),
          this.cfg.region,
        ),
        SERVICE,
      ),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    const authorization =
      `${ALGORITHM} Credential=${this.cfg.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(`${this.origin}${path}`, {
      method,
      headers: { ...headers, Authorization: authorization },
      // Fresh ArrayBuffer slice → unambiguous BodyInit.
      body: body
        ? (body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          ) as ArrayBuffer)
        : undefined,
    });
  }

  async put(obj: PutObject): Promise<void> {
    const res = await this.send("PUT", obj.key, obj.body, obj.contentType);
    if (!res.ok) {
      throw new Error(
        `${this.label} put failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `${this.label} get failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
    const body = new Uint8Array(await res.arrayBuffer());
    return {
      body,
      contentType:
        res.headers.get("content-type") ?? "application/octet-stream",
      size: body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    // S3 DELETE is idempotent: 204 on success, 404 is fine too.
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `${this.label} delete failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  }
}
