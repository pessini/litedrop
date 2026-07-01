# Self-hosting litedrop

litedrop is one Node process on port 8080. It serves the API, public share
pages, and dashboard. By default it uses embedded SQLite plus local disk
storage, so a small server only needs a domain, a dashboard password, and a CLI
token.

## Pick a Path

- **VPS with bundled Caddy:** use [deploy/](deploy/) when the server owns ports
  80/443 and you want automatic TLS.
- **Existing proxy or platform:** use a single app container behind nginx,
  Traefik, Dokploy, Coolify, CapRover, Railway, Render, Fly.io, Cloud Run, or a
  similar TLS-terminating platform.
- **Node directly:** use this for no-Docker hosts or custom deployments.

Requirements:

- Docker for container setups, or Node.js 22.18+ and npm 10+ outside Docker.
  Node 24 LTS is recommended. The Node 22.18 floor is for native TypeScript
  stripping used by dev/test scripts. Docker Compose v2 is needed only for
  `deploy/`.
- No domain is needed for local Docker testing.
- For production: a domain pointed at the server.
- Recommended for production: separate app, share, and content hostnames.
- The published `@litedrop/cli` package requires Node.js 22.19+ on the client
  machine. The standalone CLI binary does not require Node.js.

## Try Locally With Docker

Pull the published image and run it on localhost:

```bash
docker run --rm -p 8080:8080 \
  -e ADMIN_PASSWORD=change-me-please \
  -e LITEDROP_TOKEN=dev-token-change-me-please \
  -e ALLOW_SAME_ORIGIN_CONTENT=true \
  -v litedrop-db:/app/apps/backend/.data \
  -v litedrop-blobs:/app/apps/backend/.storage \
  pessini/litedrop:latest
```

Open `http://localhost:8080`. `APP_BASE_URL` defaults to that URL, so share
links work locally with no domain. If you map another host port, set the public
URL explicitly:

```bash
docker run --rm -p 3000:8080 \
  -e ADMIN_PASSWORD=change-me-please \
  -e LITEDROP_TOKEN=dev-token-change-me-please \
  -e ALLOW_SAME_ORIGIN_CONTENT=true \
  -e APP_BASE_URL=http://localhost:3000 \
  -v litedrop-db:/app/apps/backend/.data \
  -v litedrop-blobs:/app/apps/backend/.storage \
  pessini/litedrop:latest
```

## VPS With Caddy

Create DNS records for the app, share, and content origins:
`app.example.com`, `s.app.example.com`, and `content.app.example.com`. The
defaults are `s.$DOMAIN` and `content.$DOMAIN`; if you set `SHARE_DOMAIN` or
`CONTENT_DOMAIN`, point those hostnames instead.

```bash
git clone https://github.com/pessini/litedrop
cd litedrop/deploy
cp .env.example .env
# edit .env: set DOMAIN, ADMIN_PASSWORD, and LITEDROP_TOKEN
docker compose up -d
```

Open `https://app.example.com` and sign in with `ADMIN_PASSWORD`. Caddy handles
TLS renewal. Data lives in the `litedrop-db` and `litedrop-blobs` Docker
volumes, so `docker compose down` and upgrades keep your data.

## Existing Proxy or Platform

Pull the published app image and route your proxy or platform to container port
8080:

```bash
docker run -d -p 8080:8080 \
  -e ADMIN_PASSWORD=change-me-please \
  -e LITEDROP_TOKEN=$(openssl rand -hex 32) \
  -e APP_BASE_URL=https://app.example.com \
  -e PUBLIC_SHARE_BASE_URL=https://s.example.com \
  -e CONTENT_BASE_URL=https://content.example.com \
  -e TRUST_PROXY_HEADERS=true \
  -v litedrop-db:/app/apps/backend/.data \
  -v litedrop-blobs:/app/apps/backend/.storage \
  pessini/litedrop:latest
```

Proxy checklist:

- Do not also run the bundled Caddy stack.
- Route the app, share, and content hostnames to port 8080.
- Forward the original `Host` header. Traefik and most platforms do this by
  default; for nginx use `proxy_set_header Host $host;`.
- Set `TRUST_PROXY_HEADERS=true` so rate limits see real client IPs.
- Mount persistent storage at `/app/apps/backend/.data` and
  `/app/apps/backend/.storage` for SQLite and local files.

No persistent disk? Use object storage (`STORAGE_PROVIDER=r2|s3|azure` plus
credentials) and set `UNLOCK_COOKIE_SECRET` explicitly, because the generated
signing secret cannot be persisted. SQLite still needs a real local disk; do
not put it on NFS or SMB.

Only one hostname available? Omit `PUBLIC_SHARE_BASE_URL` and replace
`CONTENT_BASE_URL` with `ALLOW_SAME_ORIGIN_CONTENT=true`. You keep the iframe
sandbox and CSP, but lose the extra browser-origin layer.

## Node Directly

```bash
npm install
npm run build
ADMIN_PASSWORD=change-me-please LITEDROP_TOKEN=$(openssl rand -hex 32) \
  APP_BASE_URL=https://app.example.com \
  PUBLIC_SHARE_BASE_URL=https://s.example.com \
  CONTENT_BASE_URL=https://content.example.com \
  node apps/backend/dist/index.js
```

Everything listens on port 8080 unless you set `PORT`. Put a TLS proxy in
front. The backend auto-detects `apps/dashboard/dist` and serves the dashboard
from the same process.

## Environment

Required for normal self-hosting:

- `ADMIN_PASSWORD` (default: unset): dashboard login password, minimum 8
  characters. Leave unset for headless CLI/API-only mode.
- `LITEDROP_TOKEN` (default: unset): bearer token for the CLI and API clients,
  minimum 16 characters. Leave unset for dashboard-cookie-only auth. Rotate by
  changing it and restarting.
- `APP_BASE_URL` (default: `http://localhost:8080`): public URL of the app,
  API, and dashboard origin.

Recommended in production:

- `PUBLIC_SHARE_BASE_URL` (default: unset): public URL used when litedrop
  prints share links. Defaults to `APP_BASE_URL`.
- `CONTENT_BASE_URL` (default: unset): second hostname that serves uploaded
  HTML from an isolated origin. Required in production unless you opt out.
- `ALLOW_SAME_ORIGIN_CONTENT` (default: `false`): opt out of the dedicated
  content hostname requirement.
- `TRUST_PROXY_HEADERS` (default: `false`): trust forwarded IP headers from
  your proxy or platform for rate limiting.

Storage and state:

- `DATABASE_URL` (default: `file:./.data/litedrop.db`): SQLite file URL, or
  `:memory:`. Schema migrations run automatically at boot.
- `STORAGE_PROVIDER` (default: `local`): `local`, `s3`, `r2`, or `azure`.
  Cloud providers need their credential variables from `.env.example`.
- `STORAGE_DIR` (default: `./.storage`): file location for local storage.
- `DATA_DIR` (default: `./.data`): small server state, including the generated
  signing secret and the default SQLite file.
- `UNLOCK_COOKIE_SECRET` (default: generated): signs dashboard sessions,
  share-password cookies, and content tokens. It is saved to
  `DATA_DIR/unlock-secret`; set it explicitly on read-only filesystems.

Operational knobs:

- `PORT` (default: `8080`): HTTP listen port.
- `SESSION_TTL_DAYS` (default: `30`): dashboard login cookie lifetime.
- `CLEANUP_GRACE_DAYS` (default: `7`): days to keep stored files after a share
  is revoked, expired, or fully consumed. The database row remains.
- `CLEANUP_INTERVAL_MINUTES` (default: `60`): cleanup sweep interval, plus one
  sweep at boot. Set `0` to disable.

The full environment list with comments is in [.env.example](.env.example).

## Auth and CLI

There are two secrets and no auth database. `ADMIN_PASSWORD` creates a signed
dashboard session cookie. `LITEDROP_TOKEN` is sent by the CLI and API clients as
`Authorization: Bearer ...`.

There is no signup, password-change, user-management, or reset UI. Visitors can
open share links, but cannot log in or create shares. Change a secret by
changing the environment variable and restarting. Existing dashboard sessions
stay valid until they expire or the user logs out.

```bash
npm install -g @litedrop/cli
litedrop login --url https://app.example.com
```

Or use the standalone binary:

```bash
curl -fsSL https://raw.githubusercontent.com/pessini/litedrop/main/cli/scripts/install.sh | sh
litedrop login --url https://app.example.com
```

When prompted, paste `LITEDROP_TOKEN`. For non-interactive usage:

```bash
export LITEDROP_API_URL=https://app.example.com
export LITEDROP_API_KEY="$LITEDROP_TOKEN"
```

Common CLI commands are in [README.md](README.md#cli).

## Content Isolation

Uploaded HTML is token-gated and rendered inside a sandboxed iframe
(`sandbox="allow-scripts"`, opaque origin) under a strict CSP. In production,
set `CONTENT_BASE_URL` to a second hostname routed to the same app. Dashboard
session cookies are not valid on that hostname, so even a browser sandbox escape
cannot reach your app session.

`ALLOW_SAME_ORIGIN_CONTENT=true` keeps the iframe sandbox and CSP but removes
the extra origin layer. That is reasonable for a single-user instance hosting
your own files.

## Backups and Upgrades

Back up `DATA_DIR/litedrop.db`, `STORAGE_DIR` or your object-storage bucket, and
`DATA_DIR/unlock-secret`. Losing `unlock-secret` invalidates active dashboard,
share-password, and content cookies. With `deploy/`, the database and blobs are
in the `litedrop-db` and `litedrop-blobs` Docker volumes.

Upgrade the bundled Caddy stack from `deploy/`:

```bash
git pull
docker compose pull
docker compose up -d
```

SQLite schema migrations run automatically at boot.

## Limits and Caveats

- **Single instance:** rate limiting is in process memory and SQLite has a
  single writer. Run one replica.
- **5 MB per share:** uploads are capped at 5 MB and buffered in memory.
- **TLS is external:** litedrop speaks plain HTTP. Use Caddy, your own proxy, or
  a platform that terminates TLS. The Docker image sets `NODE_ENV=production`,
  so session cookies are `Secure` and plain `http://` login only works on
  `localhost`.
- **SQLite wants local disk:** do not put the SQLite file on NFS or SMB.
- **Self-hosted means self-moderated:** shares are public to anyone with the
  link. There is no scanning. Viewers can report abuse from any share page;
  reported shares are flagged in the dashboard and expose `report_count` in the
  API. Revoke a bad share from the dashboard or with
  `DELETE /api/shares/:id`.
