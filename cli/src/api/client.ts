import type { Me, Share } from "@litedrop/api-types";
import { type Config, requireKey } from "../config.ts";
import {
  apiError,
  authError,
  type CliError,
  notFoundError,
} from "../errors.ts";

// Hand-written REST client for the litedrop API, typed against the generated
// OpenAPI schema. HTTP via Node's global `fetch` — no dependency, no async
// runtime to bundle. Auth is the API key as a Bearer token.

export interface UploadControls {
  expires?: string | undefined;
  password?: string | undefined;
  maxViews?: number | undefined;
}

interface RequestOptions {
  method?: string;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
}

// Cap how long a request may take end-to-end, so a stalled server fails the
// command instead of hanging it (scripts and agents depend on termination).
const REQUEST_TIMEOUT_MS = 30_000;

export class Client {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    warnIfPlainHttp(baseUrl);
  }

  /** Build from resolved config; requires a stored/env key. */
  static fromConfig(cfg: Config): Client {
    return new Client(cfg.baseUrl, requireKey(cfg));
  }

  /** Build with an explicit key — used by `login` to validate a candidate key
   *  before it's persisted. */
  static withKey(baseUrl: string, apiKey: string): Client {
    return new Client(baseUrl, apiKey);
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "")
          url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const headers = new Headers(opts.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);

    let res: Response;
    try {
      res = await fetch(this.buildUrl(path, opts.query), {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw apiError(
          `no response from the server after ${REQUEST_TIMEOUT_MS / 1000}s`,
        );
      }
      throw apiError(`could not reach the server: ${(err as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) throw mapStatus(res.status, text);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw apiError(`unexpected response: ${(err as Error).message}`);
    }
  }

  /** GET /api/me — resolve the caller; doubles as a key-validity check. */
  me(): Promise<Me> {
    return this.request<Me>("/api/me");
  }

  /** POST /api/shares — raw body + query params (the path the CLI uses). The
   *  password rides as a header; the server rejects it in the query string. */
  createShare(
    name: string,
    bytes: Uint8Array,
    controls: UploadControls = {},
  ): Promise<Share> {
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
    };
    if (controls.password)
      headers["X-Litedrop-Share-Password"] = controls.password;
    return this.request<Share>("/api/shares", {
      method: "POST",
      headers,
      body: bytes,
      query: { name, expires: controls.expires, max_views: controls.maxViews },
    });
  }

  /** GET /api/shares — the caller's shares, newest first. */
  async listShares(): Promise<Share[]> {
    const { shares } = await this.request<{ shares: Share[] }>("/api/shares");
    return shares;
  }

  /** DELETE /api/shares/:id — revoke. */
  async deleteShare(id: string): Promise<void> {
    await this.request(`/api/shares/${id}`, { method: "DELETE" });
  }

  /** Look up a share by id OR slug. The API keys off id, so a slug is resolved
   *  client-side by scanning the caller's shares. */
  async resolve(idOrSlug: string): Promise<Share> {
    const shares = await this.listShares();
    const found = shares.find((s) => s.id === idOrSlug || s.slug === idOrSlug);
    if (!found) throw notFoundError(`no share matching '${idOrSlug}'`);
    return found;
  }
}

// The API key rides as a Bearer header, so a plain-http base URL sends it in
// cleartext. Warn unless the host is loopback (the self-hosted dev default).
function warnIfPlainHttp(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return;
  }
  if (url.protocol !== "http:") return;
  const host = url.hostname;
  const loopback =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.") ||
    host === "[::1]";
  if (loopback) return;
  process.stderr.write(
    `warning: sending the API key over plain http to ${host} — use an https:// base URL\n`,
  );
}

// Map an HTTP error response to a typed CliError:
// pull `{ "error": ... }` out of the body when present, else use the raw body.
function mapStatus(status: number, body: string): CliError {
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (parsed && typeof parsed.error === "string") detail = parsed.error;
  } catch {
    // Body isn't JSON — keep the raw text as the detail.
  }
  if (!detail) detail = `HTTP ${status}`;
  if (status === 401 || status === 403) return authError(detail);
  if (status === 404) return notFoundError(detail);
  return apiError(`server returned ${status}: ${detail}`);
}
