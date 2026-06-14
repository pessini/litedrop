# Self-hosting litedrop

litedrop runs as one process. The backend serves the API, the public share
pages, and the dashboard. It needs no external services: an embedded SQLite
database and files on local disk. You provide a domain, a dashboard password,
and a CLI token.

This guide covers the supported setups, the configuration that matters, and the
known limitations.

## What you get

- One container (or one Node process) on port 8080.
- A SQLite database, created and migrated automatically at boot.
- Uploaded files stored on local disk (or S3/R2/Azure if you prefer).
- Single-user auth: a dashboard password and a CLI token, both from env. No
  accounts, no signup, no auth database tables.
- A signing secret generated on first boot and saved to the data directory.
  Nothing to configure.

## Requirements

- A server that can run Docker (or Node 22.18+).
- A domain name pointed at the server.
- Optional but recommended: a second hostname for content isolation (see
  [Content isolation](#content-isolation)).

### Minimum versions

| Component | Minimum | Notes |
|---|---|---|
| Node.js | 22.18 | Only when running without Docker. 24 LTS recommended. 22.18 is the floor because the dev/test scripts rely on Node running TypeScript directly (type stripping, on by default since 22.18). |
| npm | 10 | Bundled with Node 22+. One `npm install` at the repo root covers every package. |
| Docker + Compose | Compose v2 | Only for the container setups. |

## Option 1: VPS with Docker Compose and Caddy

Use this when the server runs nothing else on ports 80/443. If your VPS already
has a reverse proxy or deploy panel, skip to
[Option 3](#option-3-behind-an-existing-proxy-or-platform).

The [deploy/](../deploy/) folder contains a ready Compose file that runs
litedrop behind [Caddy](https://caddyserver.com), which gets and renews TLS
certificates automatically.

1. Create two DNS records pointing at your server:
   `drop.example.com` and `content.drop.example.com`.
2. On the server:

```bash
git clone https://github.com/<you>/litedrop && cd litedrop/deploy
cp .env.example .env
# edit .env: set DOMAIN, ADMIN_PASSWORD, and LITEDROP_TOKEN
docker compose up -d --build
```

Open `https://drop.example.com` and sign in with your admin password. Data lives
in named Docker volumes (`litedrop-db`, `litedrop-blobs`), so `docker compose
down` and upgrades keep your data.

## Option 2: single container, bring your own TLS

If you already have a reverse proxy (nginx, Traefik, a platform load balancer),
run just the app container:

```bash
docker build -f backend/Dockerfile -t litedrop .
docker run -d -p 8080:8080 \
  -e ADMIN_PASSWORD=change-me-please \
  -e LITEDROP_TOKEN=$(openssl rand -hex 32) \
  -e APP_BASE_URL=https://drop.example.com \
  -e CONTENT_BASE_URL=https://content.drop.example.com \
  -e TRUST_PROXY_HEADERS=true \
  -v litedrop-db:/app/backend/.data \
  -v litedrop-blobs:/app/backend/.storage \
  litedrop
```

Only one hostname available? Replace the `CONTENT_BASE_URL` line with
`-e ALLOW_SAME_ORIGIN_CONTENT=true` (see [Content isolation](#content-isolation)).

## Option 3: behind an existing proxy or platform

Covers self-hosted deploy panels (Dokploy, Coolify, CapRover, nginx/Traefik) and
cloud container platforms (Railway, Render, Fly.io, Cloud Run). Something else
terminates TLS and forwards to the app; litedrop doesn't care what. Don't also
run the deploy/ Caddy bundle — you only need the app container.

1. Deploy the image built from `backend/Dockerfile` with the repo root as build
   context.
2. Set the environment: `ADMIN_PASSWORD`, `LITEDROP_TOKEN`,
   `TRUST_PROXY_HEADERS=true`, and `APP_BASE_URL=https://<your-domain>`.
3. Route your domain to the container's port 8080.
4. Mount a persistent volume at `/app/backend/.data` and `/app/backend/.storage`
   to keep the SQLite + local-disk defaults. No volume available (e.g. Cloud
   Run)? Use a cloud storage provider (`STORAGE_PROVIDER=r2|s3|azure` plus its
   credentials) and set `UNLOCK_COOKIE_SECRET` explicitly, since there's no disk
   to persist the generated one. (SQLite still wants a real disk — see
   limitations.)
5. Content isolation: attach a second domain to the same service (same port) and
   set `CONTENT_BASE_URL=https://<second-domain>`, or set
   `ALLOW_SAME_ORIGIN_CONTENT=true` for a single domain.

One requirement on the proxy: it must forward the original `Host` header
(Traefik and the platforms do by default; for hand-written nginx set
`proxy_set_header Host $host;`). Share links are built from `APP_BASE_URL`.

## Option 4: Node, no Docker

```bash
npm install
npm run build
ADMIN_PASSWORD=change-me-please LITEDROP_TOKEN=$(openssl rand -hex 32) \
  APP_BASE_URL=https://drop.example.com node backend/dist/index.js
```

Everything is served on port 8080 (override with `PORT`). Put a TLS proxy in
front.

## Configuration reference

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_PASSWORD` | unset | Dashboard login password (min 8 chars). Unset = headless (CLI/API only). |
| `LITEDROP_TOKEN` | unset | Bearer token the CLI/agents send (min 16 chars). Rotate by changing it. Unset = no token auth (dashboard cookie only). |
| `APP_BASE_URL` | `http://localhost:8080` | Public URL of the app. Used to build share links. Must match the URL users hit. |
| `CONTENT_BASE_URL` | unset | Second hostname (routed to the same app) that serves user HTML from an isolated origin. Required in production unless you opt out. |
| `ALLOW_SAME_ORIGIN_CONTENT` | `false` | Opt out of the second-hostname requirement. |
| `TRUST_PROXY_HEADERS` | `false` | Set `true` behind a proxy so rate limits see real client IPs. |
| `PORT` | `8080` | Listen port. |
| `DATABASE_URL` | `file:./.data/litedrop.db` | SQLite file URL (or `:memory:`). Migrates itself at boot. |
| `STORAGE_PROVIDER` | `local` | `local`, `s3`, `r2`, or `azure`. Each cloud provider needs its credential variables (see `.env.example`). |
| `STORAGE_DIR` | `./.storage` | Where files go with the `local` provider. |
| `DATA_DIR` | `./.data` | Small server state: the generated signing secret and the default SQLite file. |
| `UNLOCK_COOKIE_SECRET` | generated | Signs the session cookie, share-password cookies, and content tokens. Auto-generated and persisted to `DATA_DIR/unlock-secret` on first boot. Set explicitly only on read-only filesystems. |
| `SESSION_TTL_DAYS` | `30` | Dashboard login cookie lifetime. |
| `CLEANUP_GRACE_DAYS` | `7` | How long after a share is revoked/expired/consumed its stored file is kept before the cleanup sweep deletes it (the row stays). |
| `CLEANUP_INTERVAL_MINUTES` | `60` | How often the cleanup sweep runs (also once at boot). `0` disables it. |

The full list with comments is in [.env.example](../.env.example).

## Auth

Two ENV secrets, no database:

- **`ADMIN_PASSWORD`** → the dashboard login form posts it and receives a signed
  session cookie. There is no signup; visitors can open share links (the link is
  the capability) but cannot log in or create shares.
- **`LITEDROP_TOKEN`** → the CLI and agents send it as
  `Authorization: Bearer …`. Rotate by changing the env var and restarting.

There is no user-management, password-change, or reset UI: change a secret by
changing the env var and restarting. Existing sessions stay valid until they
expire or you log out.

## Content isolation

Shares can contain arbitrary HTML. litedrop renders it inside a sandboxed iframe
(`sandbox="allow-scripts"`, opaque origin) with a strict CSP. As an extra layer,
production deployments serve that HTML from a second hostname
(`CONTENT_BASE_URL`) where the session cookie is not valid, so even a browser
sandbox escape could not reach your session.

- **Two hostnames** (recommended): add a DNS record like
  `content.drop.example.com`, route it to the same app, set `CONTENT_BASE_URL`.
  The deploy/ Compose file does this by default.
- **One hostname**: set `ALLOW_SAME_ORIGIN_CONTENT=true`. The iframe sandbox and
  CSP still apply; you lose only the extra origin layer. Reasonable for a
  single-user instance hosting your own files.

## Backups

- The database: `DATA_DIR/litedrop.db`.
- The files: `STORAGE_DIR` (or your bucket).
- The signing secret: `DATA_DIR/unlock-secret`. Losing it only invalidates
  active session/share cookies.

With the deploy/ Compose file the first two are the `litedrop-db` and
`litedrop-blobs` volumes.

## Upgrading

```bash
git pull
docker compose up -d --build    # in deploy/
```

SQLite schema migrations run automatically at boot.

## Known limitations

- **Single instance.** Rate limiting is in process memory and SQLite has a
  single writer. Run one replica.
- **5 MB per share.** Uploads are capped at 5 MB and buffered in memory.
- **TLS is not built in.** The app speaks plain HTTP; use Caddy (provided), your
  own proxy, or a platform that terminates TLS. With `NODE_ENV=production` (the
  Docker image sets it) the session cookie is marked `Secure`, so login over
  plain `http://` only works on `localhost`.
- **SQLite wants a real disk.** Don't put the SQLite file on NFS/SMB.
- **Self-hosted means self-moderated.** Shares are public to anyone with the
  link; there is no scanning. Viewers can one-click "report abuse" on any share
  page; reported shares are flagged in your dashboard (and carry a
  `report_count` in the API). Revoke a bad share with `DELETE /api/shares/:id`
  (or the dashboard).
