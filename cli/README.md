# @litedrop/cli

Share Markdown or HTML files through a litedrop server and print the public URL.

## Install With Homebrew

```bash
brew tap pessini/tap
brew install litedrop
litedrop --help
```

Or install directly from the tap without adding it first:

```bash
brew install pessini/tap/litedrop
litedrop --help
```

## Install With npm

Use this path when Node.js 22.19 or newer is available:

```bash
npm install -g @litedrop/cli
litedrop --help
```

## Install a Standalone Binary

Use this path when you do not want Node.js installed on the machine running the
CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/pessini/litedrop/main/cli/scripts/install.sh | sh
litedrop --help
```

The installer downloads the latest matching binary from GitHub Releases and
checks it against the release `SHA256SUMS` file when a local SHA-256 tool is
available. Windows users can download `litedrop-windows-x64.exe` from the
Releases page.

## Log In

Managed litedrop:

```bash
litedrop login --url https://app.litedrop.dev
```

Self-hosted litedrop:

```bash
litedrop login --url https://app.example.com
```

`login` validates the key before saving it. The config file is stored at
`~/.config/litedrop/config.json` with owner-only permissions.

You can also skip the config file and use environment variables:

```bash
LITEDROP_API_URL=https://app.example.com \
  LITEDROP_API_KEY=ld_live_... \
  litedrop ls
```

For self-hosted servers, `LITEDROP_API_KEY` should be the server-side
`LITEDROP_TOKEN` value.

## Usage

```bash
# Share a file and print only the share URL.
litedrop push report.html

# Read from stdin. --name is required so litedrop can validate the file type.
cat NOTES.md | litedrop push - --name NOTES.md

# Emit the full share object for scripts.
litedrop push report.html --json

# Add link controls.
litedrop push secret.md --expires 24h --max-views 3

# Password-protect a link without putting the password in shell history.
read -rs LITEDROP_PASSWORD
export LITEDROP_PASSWORD
litedrop push secret.md --expires 24h --max-views 3
unset LITEDROP_PASSWORD

# Manage shares.
litedrop ls
litedrop ls --json
litedrop open <id-or-slug>
litedrop revoke <id-or-slug>
litedrop logout
```

`push` prints only the URL on stdout by default, so it composes cleanly:

```bash
URL=$(litedrop push report.html)
```

## Environment

| Variable | Purpose |
| --- | --- |
| `LITEDROP_API_URL` | Server base URL. Overrides the saved URL. |
| `LITEDROP_API_KEY` | API key. Overrides the saved key. |
| `LITEDROP_PASSWORD` | Password for `litedrop push` link protection. |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | Proxy settings used by Node/undici. |

Avoid `litedrop login --key ...` and `litedrop push --password ...` on shared
machines because flag values can land in shell history.
