import { env } from "./env.ts";

// OpenAPI 3.1 description of the litedrop core API. Hand-authored to match the
// live responses; keep it in sync with the route handlers it documents.
//
// Served at GET /openapi.json.

const errorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const shareSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    slug: { type: "string" },
    url: { type: "string", format: "uri" },
    raw_url: { type: "string", format: "uri" },
    filename: { type: "string" },
    kind: { type: "string", enum: ["markdown", "html"] },
    size_bytes: { type: "integer" },
    view_count: { type: "integer" },
    report_count: { type: "integer" },
    expires_at: { type: "string", format: "date-time", nullable: true },
    max_views: { type: "integer", nullable: true },
    has_password: { type: "boolean" },
    status: {
      type: "string",
      enum: ["active", "revoked", "expired", "consumed"],
    },
    created_at: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "slug",
    "url",
    "raw_url",
    "filename",
    "kind",
    "size_bytes",
    "view_count",
    "report_count",
    "expires_at",
    "max_views",
    "has_password",
    "status",
    "created_at",
  ],
} as const;

const unauthorized = {
  description: "Missing or invalid credentials",
  content: { "application/json": { schema: errorSchema } },
};

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
} as const;

const slugParam = {
  name: "slug",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

// `baseUrl` overrides the advertised server URL. The live /openapi.json
// endpoint omits it (uses the deployment's APP_BASE_URL); the emit script
// passes a canonical value so the committed artifact is deterministic.
export function buildOpenApiDocument(baseUrl?: string) {
  const base = (baseUrl ?? env.APP_BASE_URL).replace(/\/$/, "");
  const shareBase = (env.PUBLIC_SHARE_BASE_URL ?? base).replace(/\/$/, "");
  const publicServers = shareBase === base ? undefined : [{ url: shareBase }];
  return {
    openapi: "3.1.0",
    info: {
      title: "litedrop API",
      version: "1.0.0",
      description:
        "Share markdown/HTML files via a link with optional expiration, " +
        "password, and view limits. Single-user, CLI-first.",
    },
    servers: [{ url: base }],
    tags: [
      { name: "account" },
      { name: "shares" },
      { name: "public" },
      { name: "ops" },
    ],
    components: {
      securitySchemes: {
        // CLI/agents: Authorization: Bearer <LITEDROP_TOKEN>.
        token: {
          type: "http",
          scheme: "bearer",
          description: "CLI token (LITEDROP_TOKEN)",
        },
        // Dashboard: signed session cookie set by password login.
        session: { type: "apiKey", in: "cookie", name: "ld_session" },
      },
      schemas: { Error: errorSchema, Share: shareSchema },
    },
    paths: {
      "/auth/providers": {
        get: {
          tags: ["account"],
          summary: "Which sign-in methods are enabled",
          responses: { 200: { description: "Methods" } },
        },
      },
      "/auth/password/login": {
        post: {
          tags: ["account"],
          summary: "Log in with the dashboard password; sets a session cookie",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { password: { type: "string" } },
                  required: ["password"],
                },
              },
            },
          },
          responses: {
            204: { description: "Logged in" },
            401: { description: "Wrong password" },
            503: { description: "Password login not enabled" },
          },
        },
      },
      "/auth/logout": {
        post: {
          tags: ["account"],
          summary: "Clear the session cookie",
          responses: { 204: { description: "Logged out" } },
        },
      },
      "/api/me": {
        get: {
          tags: ["account"],
          summary: "Confirm the caller is authenticated",
          security: [{ token: [] }, { session: [] }],
          responses: {
            200: {
              description: "Authenticated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { authenticated: { type: "boolean" } },
                  },
                },
              },
            },
            401: unauthorized,
          },
        },
      },
      "/api/shares": {
        get: {
          tags: ["shares"],
          summary: "List shares, newest first",
          security: [{ token: [] }, { session: [] }],
          responses: {
            200: {
              description: "Shares",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      shares: { type: "array", items: shareSchema },
                    },
                  },
                },
              },
            },
            401: unauthorized,
          },
        },
        post: {
          tags: ["shares"],
          summary: "Create an immutable share",
          description:
            "Send raw file bytes with a `name` query param, or a JSON body " +
            "`{content,name}`. Raw uploads pass `expires|max_views` as query " +
            "params and `password` as `X-Litedrop-Share-Password`; JSON uploads " +
            "put controls in JSON fields.",
          security: [{ token: [] }, { session: [] }],
          parameters: [
            {
              name: "name",
              in: "query",
              schema: { type: "string" },
              description: "Filename (required for raw bodies)",
            },
            {
              name: "expires",
              in: "query",
              schema: { type: "string" },
              description:
                "1h|24h|7d|30d|never|<n>h|<n>d|ISO-8601 (default 7d)",
            },
            {
              name: "X-Litedrop-Share-Password",
              in: "header",
              schema: { type: "string" },
              description: "Optional password for raw uploads",
            },
            { name: "max_views", in: "query", schema: { type: "integer" } },
          ],
          requestBody: {
            content: {
              "text/plain": { schema: { type: "string" } },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    content: { type: "string" },
                    name: { type: "string" },
                    expires: { type: "string" },
                    password: { type: "string" },
                    max_views: { type: "integer" },
                  },
                  required: ["content"],
                },
              },
            },
          },
          responses: {
            201: {
              description: "Created",
              content: { "application/json": { schema: shareSchema } },
            },
            400: {
              description: "Bad request",
              content: { "application/json": { schema: errorSchema } },
            },
            401: unauthorized,
            413: {
              description: "Too large",
              content: { "application/json": { schema: errorSchema } },
            },
            415: {
              description: "Unsupported type",
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
      },
      "/api/shares/{id}": {
        get: {
          tags: ["shares"],
          summary: "Get one share",
          security: [{ token: [] }, { session: [] }],
          parameters: [idParam],
          responses: {
            200: {
              description: "Share",
              content: { "application/json": { schema: shareSchema } },
            },
            401: unauthorized,
            404: {
              description: "Not found",
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
        delete: {
          tags: ["shares"],
          summary: "Revoke a share",
          security: [{ token: [] }, { session: [] }],
          parameters: [idParam],
          responses: {
            200: { description: "Revoked" },
            401: unauthorized,
            404: {
              description: "Not found",
              content: { "application/json": { schema: errorSchema } },
            },
          },
        },
      },
      "/{slug}": {
        get: {
          tags: ["public"],
          servers: publicServers,
          summary:
            "View a share (rendered HTML, or raw via Accept: text/plain)",
          parameters: [slugParam],
          responses: {
            200: {
              description: "Rendered page (or raw bytes when negotiated)",
            },
            404: { description: "Invalid, expired, revoked, or consumed" },
          },
        },
      },
      "/{slug}/raw": {
        get: {
          tags: ["public"],
          servers: publicServers,
          summary: "Raw bytes (text/plain) — agents/CLI; password via header",
          parameters: [
            slugParam,
            {
              name: "X-Litedrop-Password",
              in: "header",
              schema: { type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Raw bytes",
              content: { "text/plain": { schema: { type: "string" } } },
            },
            401: { description: "Password required" },
            404: { description: "Not servable" },
          },
        },
      },
      "/{slug}/unlock": {
        post: {
          tags: ["public"],
          servers: publicServers,
          summary: "Submit a share password; sets a scoped unlock cookie",
          parameters: [slugParam],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { password: { type: "string" } },
                },
              },
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  properties: { password: { type: "string" } },
                },
              },
            },
          },
          responses: {
            200: { description: "Unlocked (JSON)" },
            303: { description: "Unlocked (form → redirect)" },
            401: { description: "Incorrect password" },
            429: { description: "Rate limited" },
          },
        },
      },
      "/{slug}/report": {
        post: {
          tags: ["public"],
          servers: publicServers,
          summary:
            "Report a share for abuse — one click, no body (rate limited)",
          parameters: [slugParam],
          responses: {
            200: { description: "Report recorded (idempotent per reporter)" },
            404: { description: "Unknown share" },
            429: { description: "Rate limited" },
          },
        },
      },
      "/healthz": {
        get: {
          tags: ["ops"],
          summary: "Liveness + DB readiness",
          responses: {
            200: { description: "ok" },
            503: { description: "degraded" },
          },
        },
      },
    },
  };
}
