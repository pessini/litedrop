<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/brand/logo-dark.svg">
    <img src="apps/dashboard/public/brand/logo.svg" alt="litedrop" width="240">
  </picture>
</p>

# litedrop

Share markdown and HTML files through links with optional expiration, passwords,
and view limits. litedrop is CLI-first, single-user, and self-hosted.

It runs as one Node process: the API, public share pages, and dashboard are
served together on port 8080. By default it uses embedded SQLite and local disk
storage, with optional S3, R2, or Azure blob storage.

## Quick Start

Run locally with no Docker and no external services:

```bash
npm install
LITEDROP_TOKEN=dev-token-change-me-please \
  ADMIN_PASSWORD=change-me-please \
  npm run -w @litedrop/backend dev
```

Open `http://localhost:8080`, then use the CLI with the same token:

```bash
npm install -g @litedrop/cli
litedrop login --url http://localhost:8080
litedrop push README.md
```

For production, build one container and put a TLS proxy in front:

```bash
docker build -f apps/backend/Dockerfile -t litedrop .
docker run -p 8080:8080 \
  -e ADMIN_PASSWORD=change-me-please \
  -e LITEDROP_TOKEN=$(openssl rand -hex 32) \
  -e APP_BASE_URL=https://app.example.com \
  -e PUBLIC_SHARE_BASE_URL=https://s.example.com \
  -e CONTENT_BASE_URL=https://content.example.com \
  -v litedrop-db:/app/apps/backend/.data \
  -v litedrop-blobs:/app/apps/backend/.storage \
  litedrop
```

See [SELF_HOSTING.md](SELF_HOSTING.md) for DNS, TLS, volumes, backups, and all
environment variables.

## How It Works

- **Auth:** `ADMIN_PASSWORD` logs into the dashboard. `LITEDROP_TOKEN` is the
  bearer token used by the CLI and API clients. There are no accounts, signup
  flows, or auth database tables.
- **Shares:** anyone with a share link can view it. Only an authenticated user
  can create, list, or revoke shares.
- **Link controls:** each share can expire, require a password, or stop after a
  maximum number of views. Expired, revoked, and fully consumed links all return
  the same 404.
- **HTML safety:** markdown is sanitized on the app origin. Uploaded HTML is
  served from an isolated content origin into a sandboxed iframe under a strict
  CSP. Single-host deployments can opt out with `ALLOW_SAME_ORIGIN_CONTENT=true`.
- **Storage:** local disk is the default. Set `STORAGE_PROVIDER` to `s3`, `r2`,
  or `azure` when you want object storage instead.

## CLI

```bash
npm install -g @litedrop/cli

litedrop login --url http://localhost:8080
litedrop push report.html
cat NOTES.md | litedrop push - --name NOTES.md
litedrop push secret.md --expires 24h --max-views 3
litedrop ls            # table; --json for machine output
litedrop open <id|slug>
litedrop revoke <id|slug>
litedrop logout
```

If the machine running the CLI does not have Node.js, install the standalone
binary from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/pessini/litedrop/main/cli/scripts/install.sh | sh
```

Config is stored at `~/.config/litedrop/config.json` with `0600` permissions.
`litedrop push` prints only the share URL on stdout, so scripts can capture it:
`URL=$(litedrop push report.html)`.

## API

```bash
TOKEN=... # your LITEDROP_TOKEN

# Upload markdown or HTML.
curl -s -X POST "localhost:8080/api/shares?name=NOTES.md" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @NOTES.md

# View rendered content or raw bytes.
curl localhost:8080/<slug>
curl localhost:8080/<slug>/raw
curl -H "Accept: text/plain" localhost:8080/<slug>

# Manage shares.
curl localhost:8080/api/shares -H "Authorization: Bearer $TOKEN"
curl -X DELETE localhost:8080/api/shares/<id> -H "Authorization: Bearer $TOKEN"
```

JSON uploads are also supported:

```bash
curl -s -X POST localhost:8080/api/shares \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"hi.md","content":"# Hello"}'
```

Optional controls:

| Control | Raw upload | JSON upload | Notes |
|---|---|---|---|
| Expiration | `?expires=24h` | `{"expires":"24h"}` | Supports `1h`, `24h`, `7d`, `30d`, `never`, `<n>h`, `<n>d`, or ISO-8601. Default is `7d`; past timestamps are rejected. |
| Password | `X-Litedrop-Share-Password` | `{"password":"..."}` | Stored as a scrypt hash; never echoed. Browsers unlock with a signed slug cookie. Agents can send `X-Litedrop-Password`. Wrong passwords do not cost a view. |
| Max views | `?max_views=3` | `{"max_views":3}` | Burn-after-read; increments are atomic. |

Uploads are limited to markdown and HTML extensions (`.md`, `.markdown`,
`.html`, `.htm`), UTF-8 text, and 5 MB.

## Development

```
litedrop/
|-- apps/
|   |-- backend/         # Hono + Drizzle API and SSR public pages
|   `-- dashboard/       # Vue 3 dashboard SPA
|-- packages/
|   |-- core/            # @pessini/litedrop-core
|   `-- api-types/       # @litedrop/api-types
`-- cli/                 # Node/TypeScript CLI
```

Stack:

- **Backend:** Hono, Drizzle ORM, embedded SQLite, Zod, markdown-it,
  sanitize-html, dependency-free S3/R2 SigV4 signing, and standalone Azure
  Shared-Key signing.
- **Dashboard:** Vue 3 and Vite.
- **CLI:** TypeScript and commander.
- **Tooling:** TypeScript 6, Biome, native Node.js TypeScript stripping,
  `node:test`, and npm workspaces.

Common scripts:

| Script | Purpose |
|---|---|
| `npm run -w @litedrop/backend dev` | Run the backend dev server with `node --watch`. |
| `npm run build` | Build all workspaces. |
| `npm run typecheck` | Type-check without emitting. |
| `npm run -w @litedrop/backend db:migrate` | Apply committed SQLite migrations. |
| `npm run -w @litedrop/cli build` | Build the CLI. |
| `npm run -w @litedrop/cli compile:local` | Build a local standalone CLI binary. |

SQLite migrations run automatically at backend boot, so production does not need
a separate migration command.
