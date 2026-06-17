<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/brand/logo-dark.svg">
    <img src="apps/dashboard/public/brand/logo.svg" alt="litedrop" width="240">
  </picture>
</p>

# litedrop

Share markdown/HTML files via a link with optional expiration, password, and
view limits. CLI-first, single-user, self-hosted.

litedrop runs as **one process** with **zero external services**: an embedded
SQLite database (migrated automatically at boot) and local-disk storage. Log in
to the dashboard with a password you set; drive it from the CLI with a token.
Want object storage instead of disk? Point it at S3/R2/Azure. That's the whole
operational story — see the [self-hosting guide](docs/SELF_HOSTING.md).

## Layout

```
litedrop/                # npm workspaces — one root `npm install`
├── apps/
│   ├── backend/         # Hono + Drizzle API + SSR public pages (Node 22.18+, SQLite)
│   └── dashboard/       # Vue 3 dashboard SPA (own shares + password login)
├── packages/
│   ├── core/            # @pessini/litedrop-core: reusable library surface
│   └── api-types/       # @litedrop/api-types: shared response/request types
└── cli/                 # Node/TS CLI (commander)
```

## Tech stack

- **Backend** — [Hono](https://hono.dev) on Node.js, [Drizzle ORM](https://orm.drizzle.team)
  over embedded SQLite, Zod validation, markdown-it + sanitize-html rendering,
  a dependency-free S3 SigV4 signer (no AWS SDK).
- **Dashboard** — Vue 3 + Vite single-page app.
- **CLI** — Node/TS with commander.
- **Tooling** — TypeScript 6, [Biome](https://biomejs.dev), native Node TS type
  stripping (no dev build step), `node:test`, npm workspaces.

## Quick start

No Docker, no services:

```bash
npm install
ADMIN_PASSWORD=change-me-please npm run -w @litedrop/backend dev   # http://localhost:8080
```

The backend defaults to an embedded SQLite database (`apps/backend/.data/litedrop.db`)
and local-disk storage (`apps/backend/.storage`). For production, build everything
and run the one process — it serves the API, the public share pages, and the
dashboard SPA (auto-detecting `apps/dashboard/dist`):

```bash
npm run build
ADMIN_PASSWORD=… APP_BASE_URL=https://app.example.com \
  PUBLIC_SHARE_BASE_URL=https://s.example.com \
  CONTENT_BASE_URL=https://content.example.com \
  node apps/backend/dist/index.js     # everything on :8080 — put a TLS proxy in front
```

Or as a single container (SQLite + blobs on named volumes):

```bash
docker build -f apps/backend/Dockerfile -t litedrop .
docker run -p 8080:8080 \
  -e ADMIN_PASSWORD=change-me-please \
  -e LITEDROP_TOKEN=$(openssl rand -hex 32) \
  -e APP_BASE_URL=https://app.example.com \
  -e PUBLIC_SHARE_BASE_URL=https://s.example.com \
  -e CONTENT_BASE_URL=https://content.example.com \
  -v litedrop-db:/app/apps/backend/.data -v litedrop-blobs:/app/apps/backend/.storage litedrop
```

Full instructions, configuration reference, and known limitations:
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Auth

Two ENV secrets — no accounts, no signup, no database tables for auth:

- **`ADMIN_PASSWORD`** — log in to the dashboard with this password; it sets a
  signed session cookie. Leave unset to run headless (CLI/API only).
- **`LITEDROP_TOKEN`** — the CLI/agents send this as `Authorization: Bearer …`.
  Any sufficiently long secret; rotate by changing the env var.

Anyone with a share's link can view it (the slug is the capability); only you,
authenticated, can create or manage shares.

## API

```bash
TOKEN=…   # your LITEDROP_TOKEN

# Upload markdown (raw body + ?name) → share JSON
curl -s -X POST "localhost:8080/api/shares?name=NOTES.md" \
  -H "Authorization: Bearer $TOKEN" --data-binary @NOTES.md

# Or JSON body
curl -s -X POST localhost:8080/api/shares \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"hi.md","content":"# Hello"}'

# View rendered (browser) / raw (agents)
curl localhost:8080/<slug>                          # sanitized HTML render
curl localhost:8080/<slug>/raw                      # text/plain bytes
curl -H "Accept: text/plain" localhost:8080/<slug>  # negotiated → raw

# Manage
curl localhost:8080/api/shares -H "Authorization: Bearer $TOKEN"               # list
curl -X DELETE localhost:8080/api/shares/<id> -H "Authorization: Bearer $TOKEN"  # revoke
```

Guardrails at upload: extension allowlist (`.md/.markdown/.html/.htm`),
UTF-8/binary sniff, 5 MB cap.

### Link controls

Three optional controls per share. Raw uploads pass `expires`/`max_views` as
query params and `password` as a header; JSON uploads put all three in the body:

```bash
curl -s -X POST "localhost:8080/api/shares?name=secret.md&expires=24h&max_views=3" \
  -H "Authorization: Bearer $TOKEN" -H "X-Litedrop-Share-Password: hunter2" \
  --data-binary @secret.md
```

- **`expires`** — `1h｜24h｜7d｜30d｜never`, any `<n>h`/`<n>d`, or ISO-8601.
  Default `7d`; a past timestamp is rejected.
- **`password`** — scrypt-hashed; stored, never echoed (the response flags
  `has_password`). Browsers get an unlock prompt → signed slug-scoped cookie;
  agents send `X-Litedrop-Password`. A wrong password never costs a view.
- **`max_views`** — burn-after-read; the increment is atomic.

Expired, revoked, and fully-consumed links all return the same 404 (no oracle).

### Safe HTML rendering

Markdown is sanitized and rendered on the app origin. **HTML is never executed
on the app origin** — it's served raw from an isolated content origin into a
fully-sandboxed iframe, token-gated, under a strict CSP. Set `CONTENT_BASE_URL`
to a separate hostname (routed to the same app) for origin isolation, or set
`ALLOW_SAME_ORIGIN_CONTENT=true` to keep a single hostname (the iframe sandbox
still applies; you only drop the extra origin-isolation layer).

Set `PUBLIC_SHARE_BASE_URL` when public share links should use a dedicated
share hostname. For example, self-hosted split-host deployments use:

```env
APP_BASE_URL=https://app.example.com
PUBLIC_SHARE_BASE_URL=https://s.example.com
CONTENT_BASE_URL=https://content.example.com
```

## CLI

```bash
cd cli && npm install && npm run build && npm link

litedrop login --url http://localhost:8080   # paste your LITEDROP_TOKEN (or set LITEDROP_API_KEY)
litedrop push report.html                     # → https://…/<slug>   (URL only on stdout)
cat NOTES.md | litedrop push - --name NOTES.md
litedrop push secret.md --expires 24h --password hunter2 --max-views 3
litedrop ls            # table; --json for machine output
litedrop open <id|slug>
litedrop revoke <id|slug>
litedrop logout
```

Config lives at `~/.config/litedrop/config.json` (`0600`). stdout carries only
the share URL so it composes in shells/agents: `URL=$(litedrop push report.html)`.

## Backend scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Hot-reloading dev server (`node --watch`, native TS) |
| `npm run build` | Compile TS → `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:migrate` | Apply committed SQLite migrations |

SQLite migrates itself at boot — no migrate step to run in production.

## Storage

Every consumer touches only the `storage` singleton; the provider is chosen at
boot by `STORAGE_PROVIDER` (`local` default, or `s3`/`r2`/`azure`). R2 and S3
share one dependency-free SigV4 client; Azure is a standalone Shared-Key impl.
See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for the per-provider env vars.
