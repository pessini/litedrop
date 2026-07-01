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

## Core Package and Docker Image

Project releases are driven by `v*` tags:

```bash
git tag v0.1.2
git push origin v0.1.2
```

The existing **Packages** workflow publishes the reusable
`@pessini/litedrop-core` package to GitHub Packages and the app container to
Docker Hub.

Docker image tags for `v0.1.2`:

- `pessini/litedrop:0.1.2`
- `pessini/litedrop:0.1`
- `pessini/litedrop:latest`
- `pessini/litedrop:sha-<short>`

Before the first Docker Hub publish, configure the repository:

- GitHub Actions variable: `DOCKERHUB_USERNAME=pessini`
- GitHub Actions secret: `DOCKERHUB_TOKEN` with permission to push
  `pessini/litedrop`

The Docker job builds and smoke-tests a local image first, then pushes a
multi-platform `linux/amd64` and `linux/arm64` image with provenance and SBOM
attestations.
