import { createHmac } from "node:crypto";
import type { Env } from "../../env.ts";
import type {
  PutObject,
  StorageBackend,
  StorageProvider,
  StoredObject,
} from "../backend.ts";
import { StorageConfigError } from "../backend.ts";

// Azure Blob Storage. Unlike the S3 family, Azure uses its own protocol —
// Shared Key authorization (HMAC-SHA256 over a fixed-layout string-to-sign) and
// x-ms-* headers — so this is a standalone implementation, not an S3 preset.
// Still dependency-free: node:crypto + fetch.
//
// Shared Key reference:
// https://learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key
const API_VERSION = "2021-08-06";

interface AzureConfig {
  account: string;
  /** Base64-encoded account key. */
  accountKey: string;
  container: string;
  /** Override the blob endpoint (defaults to <account>.blob.core.windows.net; useful for Azurite). */
  endpoint?: string;
}

class AzureBlobStorage implements StorageBackend {
  private readonly account: string;
  private readonly key: Buffer;
  private readonly container: string;
  private readonly hostOrigin: string; // scheme://host[:port], no path
  private readonly basePath: string; // "" for prod; "/devstoreaccount1" for Azurite

  constructor(cfg: AzureConfig) {
    this.account = cfg.account;
    this.key = Buffer.from(cfg.accountKey, "base64");
    this.container = cfg.container;
    // Production puts the account in the host (<account>.blob.core.windows.net);
    // emulators (Azurite) put it in a path prefix (host:10000/devstoreaccount1).
    // Split the endpoint so the canonicalized resource — which must mirror the
    // real request path — comes out right in both shapes.
    const url = new URL(
      cfg.endpoint ?? `https://${cfg.account}.blob.core.windows.net`,
    );
    this.hostOrigin = url.origin;
    this.basePath = url.pathname.replace(/\/+$/, "");
  }

  // Build the SharedKey Authorization header. The string-to-sign is a fixed
  // sequence of HTTP headers, then canonicalized x-ms-* headers, then the
  // canonicalized resource (/account/container/blob). Content-Length is the
  // empty string when zero (per API version 2015-02-21+).
  private authorization(
    method: string,
    decodedPath: string,
    xmsHeaders: Record<string, string>,
    contentLength: string,
    contentType: string,
  ): string {
    const canonicalizedHeaders = Object.keys(xmsHeaders)
      .sort()
      .map((h) => `${h}:${xmsHeaders[h]}`)
      .join("\n");
    const canonicalizedResource = `/${this.account}${decodedPath}`;

    const stringToSign = [
      method,
      "", // Content-Encoding
      "", // Content-Language
      contentLength, // Content-Length ("" when zero)
      "", // Content-MD5
      contentType, // Content-Type
      "", // Date (we send x-ms-date instead)
      "", // If-Modified-Since
      "", // If-Match
      "", // If-None-Match
      "", // If-Unmodified-Since
      "", // Range
      `${canonicalizedHeaders}\n${canonicalizedResource}`,
    ].join("\n");

    const signature = createHmac("sha256", this.key)
      .update(stringToSign, "utf8")
      .digest("base64");
    return `SharedKey ${this.account}:${signature}`;
  }

  private async send(
    method: "PUT" | "GET" | "DELETE",
    key: string,
    body?: Uint8Array,
    contentType?: string,
  ): Promise<Response> {
    // Canonicalized resource uses the decoded path (incl. any account prefix);
    // the request URI is percent-encoded. Both include basePath so emulators
    // that carry the account in the path sign and address consistently.
    const decodedPath = `${this.basePath}/${this.container}/${key}`;
    const urlPath = `${this.basePath}/${encodeURIComponent(this.container)}/${encodeURIComponent(key)}`;

    const xmsHeaders: Record<string, string> = {
      "x-ms-date": new Date().toUTCString(),
      "x-ms-version": API_VERSION,
    };
    const ct =
      method === "PUT" ? (contentType ?? "application/octet-stream") : "";
    const contentLength = body ? String(body.byteLength) : "";
    if (method === "PUT") xmsHeaders["x-ms-blob-type"] = "BlockBlob";

    const auth = this.authorization(
      method,
      decodedPath,
      xmsHeaders,
      contentLength,
      ct,
    );

    const headers: Record<string, string> = {
      ...xmsHeaders,
      Authorization: auth,
    };
    if (method === "PUT") headers["content-type"] = ct;

    return fetch(`${this.hostOrigin}${urlPath}`, {
      method,
      headers,
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
        `Azure put failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `Azure get failed: ${res.status} ${await res.text().catch(() => "")}`,
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
    // Idempotent: 202 on success, 404 is fine too.
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Azure delete failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  }
}

export const azureProvider: StorageProvider = {
  name: "azure",
  create(env: Env): StorageBackend {
    const {
      AZURE_STORAGE_ACCOUNT,
      AZURE_STORAGE_KEY,
      AZURE_STORAGE_CONTAINER,
      AZURE_BLOB_ENDPOINT,
    } = env;
    if (
      !AZURE_STORAGE_ACCOUNT ||
      !AZURE_STORAGE_KEY ||
      !AZURE_STORAGE_CONTAINER
    ) {
      throw new StorageConfigError(
        "azure",
        "requires AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, and AZURE_STORAGE_CONTAINER.",
      );
    }
    return new AzureBlobStorage({
      account: AZURE_STORAGE_ACCOUNT,
      accountKey: AZURE_STORAGE_KEY,
      container: AZURE_STORAGE_CONTAINER,
      endpoint: AZURE_BLOB_ENDPOINT,
    });
  },
};
