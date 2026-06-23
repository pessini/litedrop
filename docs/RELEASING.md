# Releasing litedrop

## CLI npm Package and Binaries

`@litedrop/cli` releases are driven by tags that match the package version:

```bash
git tag cli-v0.1.1
git push origin cli-v0.1.1
```

You can also run the **CLI Release** workflow manually from GitHub Actions with
an existing tag such as `cli-v0.1.1`.

The workflow:

1. Checks that the tag is exactly `cli-v<cli/package.json version>`.
2. Runs CLI tests, typecheck, and `npm pack --dry-run`.
3. Publishes `@litedrop/cli` to npm with provenance.
4. Builds standalone binaries with Bun and attaches them to a GitHub Release:
   `litedrop-linux-x64`, `litedrop-linux-arm64`, `litedrop-darwin-x64`,
   `litedrop-darwin-arm64`, `litedrop-windows-x64.exe`, and `SHA256SUMS`.

Before the first GitHub-driven npm publish, configure npm Trusted Publishing
for `@litedrop/cli`:

```text
Publisher: GitHub Actions
Organization or user: pessini
Repository: litedrop
Workflow filename: cli-release.yml
Environment name: leave blank
Allowed actions: npm publish
```

Trusted Publishing lets GitHub Actions publish through OIDC, so the workflow
does not need an `NPM_TOKEN` secret.

## Standalone Binary Installer

The installer downloads the latest GitHub Release asset for the user's platform:

```bash
curl -fsSL https://raw.githubusercontent.com/pessini/litedrop/main/cli/scripts/install.sh | sh
```

Override defaults when testing a specific release or fork:

```bash
LITEDROP_VERSION=cli-v0.1.1 \
LITEDROP_REPO=pessini/litedrop \
LITEDROP_BIN_DIR="$HOME/.local/bin" \
  sh cli/scripts/install.sh
```

Local binary smoke test:

```bash
npm run -w @litedrop/cli compile:local
cli/binaries/litedrop --help
```

## Core Package

The reusable `@pessini/litedrop-core` package still publishes to GitHub Packages
from the existing **Packages** workflow when a `v*` tag is pushed.
