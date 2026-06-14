import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { authError, ioError } from "./errors.ts";
import { configPath } from "./paths.ts";

// Config is persisted under the user's config directory. Two layers:
//   FileConfig — what's persisted on disk (written by `login`/`logout`).
//   Config     — the resolved view (file + env overrides) the client uses.
// Env always wins, so LITEDROP_API_KEY / LITEDROP_API_URL work without login.

export const DEFAULT_BASE_URL = "http://localhost:8080";

export interface FileConfig {
  api_key?: string;
  base_url?: string;
}

export function loadFileConfig(): FileConfig {
  const path = configPath();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw ioError(`reading ${path}: ${(err as Error).message}`);
  }
  try {
    return (JSON.parse(text) as FileConfig | null) ?? {};
  } catch (err) {
    throw ioError(`parsing ${path}: ${(err as Error).message}`);
  }
}

export function saveFileConfig(fc: FileConfig): void {
  const path = configPath();
  // The file holds a credential: write a fresh owner-only file and rename it
  // into place, so the key never lands in a file with looser permissions (a
  // pre-existing config keeps its old mode on plain writes) and a crash
  // mid-write can't leave a corrupted config behind. The modes are ignored on
  // Windows, which has no POSIX permissions.
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, `${JSON.stringify(fc, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw ioError((err as Error).message);
  }
}

export interface Config {
  apiKey: string | undefined;
  baseUrl: string;
}

export function envNonEmpty(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** File config with env overrides applied. */
export function resolveConfig(): Config {
  const fc = loadFileConfig();
  const apiKey = envNonEmpty("LITEDROP_API_KEY") ?? fc.api_key;
  const baseUrl = stripTrailingSlash(
    envNonEmpty("LITEDROP_API_URL") ?? fc.base_url ?? DEFAULT_BASE_URL,
  );
  return { apiKey, baseUrl };
}

export function requireKey(cfg: Config): string {
  if (cfg.apiKey && cfg.apiKey.length > 0) return cfg.apiKey;
  throw authError("no API key — run `litedrop login` or set LITEDROP_API_KEY");
}
