// Response shapes for the backend's JSON responses — the single source of truth
// for both consumers (dashboard SPA + CLI). Held to the generated OpenAPI
// contract by contract-check.ts. Each consumer imports only the types it needs.

// GET /api/me — confirms the caller is authenticated (single-user core).
export interface Me {
  authenticated: boolean;
}

// GET /auth/providers — which sign-in methods this server is configured for.
// `password_login` is the single-user dashboard login (ADMIN_PASSWORD set).
export interface AuthMethods {
  password_login: boolean;
}

export type ShareKind = "markdown" | "html";
export type ShareStatus = "active" | "revoked" | "expired" | "consumed";

export interface Share {
  id: string;
  slug: string;
  url: string;
  raw_url: string;
  filename: string;
  kind: ShareKind;
  size_bytes: number;
  view_count: number;
  report_count: number;
  expires_at: string | null;
  max_views: number | null;
  has_password: boolean;
  status: ShareStatus;
  created_at: string;
}

// Controls accepted at POST /api/shares (passed as query params on a raw body).
export interface UploadControls {
  expires?: string;
  password?: string;
  max_views?: number;
}
