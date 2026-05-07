# setra — Deployment & Distribution Guide

## Contents

1. [Local Development](#1-local-development)
2. [Running All Services Together](#2-running-all-services-together)
3. [Mac Install (Homebrew / curl)](#3-mac-install)
4. [Windows Install (PowerShell / npm)](#4-windows-install)
5. [Linux Install (curl / npm)](#5-linux-install)
6. [npm Publish (@setra/cli)](#6-npm-publish)
7. [Homebrew Tap Publish](#7-homebrew-tap-publish)
8. [Desktop App (DMG / zip)](#8-desktop-app-dmg--zip)
9. [Cloud / API Deploy](#9-cloud--api-deploy)
10. [GitHub Actions CI/CD](#10-github-actions-cicd)
11. [Environment Variables Reference](#11-environment-variables-reference)

---

## 1. Local Development

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 20 | https://nodejs.org |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Go | ≥ 1.22 | https://golang.org (for cloud-runner only) |

### Bootstrap

```bash
git clone https://github.com/nitikeshq/setra
cd setra
pnpm install
pnpm run build          # builds all 21 packages
pnpm test               # runs 177 tests
```

---

## 2. Running All Services Together

Start **all** apps in parallel with colour-coded output:

```bash
pnpm run dev:all
```

This starts:

| App | Command | Port / Process |
|-----|---------|----------------|
| 🖥  Electron Desktop | `electron-vite dev` | Native window |
| 🌐  Web (Vite) | `vite --port 3000` | http://localhost:3000 |
| ⚡  API (Hono) | `tsx watch src/index.ts` | http://localhost:4000 |
| 🖊  CLI / TUI (Ink) | `tsx watch src/index.tsx` | Terminal |

### Run individually

```bash
pnpm run dev:desktop    # Electron only
pnpm run dev:web        # Web only
pnpm run dev:api        # API / daemon only
pnpm run dev:cli        # CLI watch mode
pnpm run dev:tui        # Launch Ink TUI directly
```

### API daemon

The API server acts as the local daemon — it handles tRPC, auth, and Electric SQL proxying.
It starts automatically when you run `dev:all`. To run it standalone:

```bash
cd apps/api
cp .env.example .env    # fill in values
pnpm dev                # starts on port 4000
```

---

## 3. Mac Install

### Option A — Homebrew (recommended)

```bash
brew tap nitikeshq/setra
brew install setra
```

### Option B — One-liner curl

```bash
curl -fsSL https://setra.sh/install.sh | bash
```

Or with a specific version:

```bash
SETRA_VERSION=0.1.0 curl -fsSL https://setra.sh/install.sh | bash
```

### Option C — npm global

```bash
npm install -g @setra/cli
```

### Desktop App (DMG)

Download `setra-0.1.0-arm64.dmg` (Apple Silicon) or `setra-0.1.0-x64.dmg` (Intel) from
[GitHub Releases](https://github.com/nitikeshq/setra/releases).

> **Note:** The app is currently unsigned (code-signing cert required).
> macOS will show a Gatekeeper warning. To bypass:
> ```
> xattr -dr com.apple.quarantine /Applications/setra.app
> ```

---

## 4. Windows Install

### Option A — PowerShell one-liner

```powershell
iwr https://setra.sh/install.ps1 | iex
```

Or download and run locally:

```powershell
.\setra-setup.ps1
.\setra-setup.ps1 -Version 0.1.0 -InstallDir "C:\setra\bin"
```

### Option B — npm global

```powershell
npm install -g @setra/cli
```

### Option C — Winget (once published)

```powershell
winget install setra
```

### Option D — Scoop (once published)

```powershell
scoop bucket add setra https://github.com/nitikeshq/scoop-setra
scoop install setra
```

---

## 5. Linux Install

### Option A — curl one-liner

```bash
curl -fsSL https://setra.sh/install.sh | bash
```

### Option B — npm global

```bash
npm install -g @setra/cli
```

### Option C — Manual binary

```bash
VERSION=0.1.0
ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
curl -fsSL "https://github.com/nitikeshq/setra/releases/download/v${VERSION}/setra-${VERSION}-linux-${ARCH}.tar.gz" | tar -xz
sudo mv setra /usr/local/bin/setra
```

---

## 6. npm Publish

### First-time setup

```bash
npm login                           # login to npmjs.com
npm whoami                          # verify login
```

### Publish @setra/cli

```bash
cd apps/cli
pnpm run release                    # builds then publishes
```

Or manually:

```bash
cd apps/cli
pnpm run build
npm publish --access public
```

### Publish all public packages

From the repo root:

```bash
# Current GA npm surface:
# 1) @setra/cli (primary end-user package)
# 2) @setra/company (optional SDK module)
pnpm --filter @setra/cli publish --access public
pnpm --filter @setra/company publish --access public
```

### Version bump

```bash
# Bump all workspace packages together:
pnpm -r exec -- npm version patch --no-git-tag-version
git add -A && git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

---

## 7. Homebrew Tap Publish

### Create the tap repo

```bash
# Create https://github.com/nitikeshq/homebrew-setra
gh repo create nitikeshq/homebrew-setra --public
```

### Update the formula

Preferred path is automated:

1. Publish GitHub release tag `vX.Y.Z`
2. Run workflow `.github/workflows/homebrew-tap-update.yml`
3. Workflow downloads release tarballs, computes SHA256, updates `Formula/setra.rb`, and pushes to tap repo.

Manual fallback:

```bash
./scripts/update-homebrew-formula.sh 0.1.0 /path/to/release-assets
```

### Test locally before publishing

```bash
brew install --build-from-source ./Formula/setra.rb
brew test setra
brew audit --strict setra
```

---

## 8. Desktop App (DMG / zip)

### Build locally

```bash
pnpm --filter @setra/desktop run build
# Output:
#   apps/desktop/dist/setra-0.1.0-arm64.dmg
#   apps/desktop/dist/setra-0.1.0-arm64-mac.zip
```

### Code signing (required for distribution)

1. Enrol in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
2. Create a **Developer ID Application** certificate in Xcode → Settings → Accounts
3. Export and install the certificate in your Keychain
4. Set environment variables before building:
   ```bash
   export CSC_LINK="path/to/certificate.p12"
   export CSC_KEY_PASSWORD="your-cert-password"
   export APPLE_ID="your@apple.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="YOURTEAMID"
   ```
5. Rebuild — electron-builder will sign and notarise automatically

### Windows NSIS installer

```bash
# On Windows or via a Windows runner in CI:
pnpm --filter @setra/desktop run build -- --win
# Output: apps/desktop/dist/setra-Setup-0.1.0.exe
```

Production note: enable Windows code-signing secrets (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) so published `.exe` is signed.

---

## 9. Cloud / API Deploy

### Cloudflare Workers (recommended for API)

```bash
cd apps/api
cp wrangler.example.toml wrangler.toml   # fill in account_id, routes
pnpm dlx wrangler deploy
```

### Docker (self-hosted)

```bash
# Build
docker build -t setra-api:0.1.0 -f apps/api/Dockerfile .

# Run
docker run -d \
  --name setra-api \
  -p 4000:4000 \
  --env-file apps/api/.env \
  setra-api:0.1.0
```

### Fly.io

```bash
cd apps/api
fly launch --name setra-api
fly secrets set $(cat .env | xargs)
fly deploy
```

### cloud-runner (Go daemon)

```bash
cd apps/cloud-runner
go build -o setra-runner ./main.go
# Deploy as a systemd service or in a Kubernetes DaemonSet
```

---

## 10. GitHub Actions CI/CD

The recommended release workflow (`.github/workflows/release.yml`):

```yaml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  build-cli:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, registry-url: 'https://registry.npmjs.org' }
      - run: pnpm install
      - run: pnpm --filter @setra/cli build
      - run: npm publish --access public
        working-directory: apps/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  build-desktop:
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install
      - run: pnpm --filter @setra/desktop run build
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      - uses: actions/upload-artifact@v4
        with:
          name: desktop-${{ matrix.os }}
          path: apps/desktop/dist/

  release:
    needs: [build-cli, build-desktop]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            desktop-macos-latest/*.dmg
            desktop-macos-latest/*.zip
            desktop-windows-latest/*.exe
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 11. Environment Variables Reference

### apps/api/.env

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/setra

# Auth (better-auth)
BETTER_AUTH_SECRET=change-me-32-char-secret
BETTER_AUTH_URL=https://api.setra.sh

# GitHub OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_ENTERPRISE_PRICE_ID=price_...

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@setra.sh

# Electric SQL
ELECTRIC_URL=https://api.electric-sql.com

# Feature flags
SETRA_PRIVATE_PORTAL=0
SETRA_PORTAL_ACCESS_KEY=
```

### apps/desktop .env (optional)

```env
SETRA_API_URL=https://api.setra.sh   # default; override for self-hosted
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm run dev:all` | Start all apps in parallel |
| `pnpm run build` | Build all 21 packages |
| `pnpm test` | Run all 177 tests |
| `pnpm run dev:desktop` | Electron app only |
| `pnpm run dev:web` | Web app on :3000 |
| `pnpm run dev:api` | API daemon on :4000 |
| `pnpm run dev:tui` | Ink TUI in terminal |
| `pnpm --filter @setra/cli run release` | Publish CLI to npm |
| `brew install setra` | Install on Mac (after tap is live) |
| `iwr https://setra.sh/install.ps1 \| iex` | Install on Windows |
| `curl -fsSL https://setra.sh/install.sh \| bash` | Install on Mac/Linux |
