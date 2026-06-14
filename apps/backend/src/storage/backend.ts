import type { Env } from "../env.ts";

// Storage abstraction. Each concrete provider (local disk, Cloudflare R2, AWS
// S3 / any S3-compatible service, Azure Blob) satisfies StorageBackend, so the
// rest of the app never imports a concrete one — it only ever touches the
// exported `storage` singleton.

export interface PutObject {
  /** Object key (we use the share slug). */
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
  size: number;
}

export interface StorageBackend {
  put(obj: PutObject): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

// A provider is a named factory. Each provider module owns everything about one
// storage target: its env requirements, how to validate them, and how to build
// the backend. The provider registry picks one at boot by STORAGE_PROVIDER. To
// add a provider: implement StorageBackend, export a StorageProvider, and
// register it — nothing else in the app changes.
//
// Note the S3 family (r2, s3) shares ONE S3 client implementation; those
// provider modules are thin config presets over it, not separate clients.
export interface StorageProvider {
  /** Value of STORAGE_PROVIDER that selects this one (e.g. "r2", "s3"). */
  readonly name: string;
  /** Build the backend from validated env, or throw StorageConfigError. */
  create(env: Env): StorageBackend;
}

// Thrown by a provider's create() when its required env is missing/invalid.
// Boot turns this into a clear error + exit, so a misconfigured provider fails
// fast and loud instead of erroring on the first upload.
export class StorageConfigError extends Error {
  readonly provider: string;

  constructor(provider: string, detail: string) {
    super(`STORAGE_PROVIDER=${provider} ${detail}`);
    this.provider = provider;
    this.name = "StorageConfigError";
  }
}
