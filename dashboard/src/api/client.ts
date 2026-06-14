import type {
  AuthMethods,
  Me,
  Share,
  UploadControls,
} from "@litedrop/api-types";
import { requestUrlForFetch } from "./request-url";

// Hand-written REST client for the litedrop backend.
//
// Auth is a single-user session cookie set by the password login. Every request
// sends `credentials: "include"` so that cookie rides along. Requests are
// same-origin in dev (Vite proxy) and in production (SPA served on the app
// origin), so no CORS is involved.
//
// API base is configurable via VITE_API_BASE for deployments that host the SPA
// off-origin; default "" = same-origin.

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
  /** 401/403 — the session was missing or rejected. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

interface RequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers = new Headers(opts.headers);

  let res: Response;
  try {
    res = await fetch(
      requestUrlForFetch(API_BASE, path, window.location.origin, opts.query),
      {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
        credentials: "include",
      },
    );
  } catch (err) {
    throw new ApiError(
      0,
      `could not reach the server: ${(err as Error).message}`,
    );
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : typeof data === "string" && data) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  /** GET /api/me — whether the current session is authenticated. */
  me(): Promise<Me> {
    return request<Me>("/api/me");
  },

  /** GET /api/shares — every share, newest first. */
  async listShares(): Promise<Share[]> {
    const { shares } = await request<{ shares: Share[] }>("/api/shares");
    return shares;
  },

  /**
   * POST /api/shares — create an immutable share from raw text bytes + query
   * controls. `name` is required for raw bodies.
   */
  createShare(
    name: string,
    content: string,
    controls: UploadControls = {},
  ): Promise<Share> {
    if (controls.password) {
      return request<Share>("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          content,
          expires: controls.expires,
          password: controls.password,
          max_views: controls.max_views,
        }),
      });
    }

    return request<Share>("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: content,
      query: {
        name,
        expires: controls.expires,
        max_views: controls.max_views,
      },
    });
  },

  /** GET /api/shares/:id — a single share. */
  getShare(id: string): Promise<Share> {
    return request<Share>(`/api/shares/${id}`);
  },

  /** DELETE /api/shares/:id — revoke (shares are immutable: revoke, never edit). */
  deleteShare(id: string): Promise<{ id: string; status: string }> {
    return request(`/api/shares/${id}`, { method: "DELETE" });
  },

  /** POST /auth/logout — destroys the session cookie. */
  async logout(): Promise<void> {
    await request("/auth/logout", { method: "POST" }).catch(() => {});
  },

  /** GET /auth/providers — whether password login is enabled server-side. */
  authMethods(): Promise<AuthMethods> {
    return request<AuthMethods>("/auth/providers");
  },

  /** POST /auth/password/login — single-user mode; sets a session cookie. */
  passwordLogin(password: string): Promise<void> {
    return request<void>("/auth/password/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  },
};
