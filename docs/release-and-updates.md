# Release and Auto-Update Guide

This document defines the production packaging and update contract for QuickCut.

## Auto-Update Behavior

QuickCut uses `electron-updater` in packaged builds.

- Updates are disabled in development mode.
- Updates can be force-disabled in packaged builds with:

```bash
QUICKCUT_DISABLE_AUTO_UPDATE=1
```

- Main process emits renderer-safe update status events over `update:status`.
- Preload exposes a narrow API:
  - `window.electronAPI.updates.check()`
  - `window.electronAPI.updates.download()`
  - `window.electronAPI.updates.install()`
  - `window.electronAPI.updates.onStatus(cb)`

## Publish Pipeline

`electron-builder` is configured to publish to GitHub Releases for
`priyanshuchawda/vi`.

Release commands:

```bash
npm run dist:linux
npm run dist:publish
```

The GitHub Actions `Release Desktop` workflow is tag-driven (`v*`) and builds
Linux desktop artifacts.

## Required Secrets and Environment

### Release upload

- `GH_TOKEN`: token with repo release write access

### macOS signing/notarization placeholders

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

### Windows signing placeholders

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

These are intentionally documented as placeholders for production release
infrastructure; values must come from CI secret storage, never from committed
files.

## Staging Update Test Plan

1. Cut a prerelease tag like `v1.2.3-rc.1`.
2. Build and publish artifacts/metadata to GitHub Releases.
3. Install previous packaged app version.
4. Start app and run `window.electronAPI.updates.check()` via renderer flow.
5. Verify `update:status` transition sequence (`checking` -> `available` ->
   `downloading` -> `downloaded`).
6. Trigger install and verify app relaunches into the newer version.
