# Observability and Telemetry Boundaries

This document defines production-safe observability for QuickCut.

## Goals

- Capture actionable errors for production debugging.
- Keep logs structured and environment-gated.
- Avoid collecting sensitive user content by default.

## Error Tracking

Error tracking is disabled by default and requires explicit env opt-in.

### Renderer

- Env switch: `VITE_ENABLE_ERROR_TRACKING=1`
- DSN: `VITE_SENTRY_DSN`
- SDK: `@sentry/browser`

### Electron Main Process

- Env switch: `ENABLE_ERROR_TRACKING=1`
- DSN: `SENTRY_DSN`
- Optional environment tag: `SENTRY_ENVIRONMENT`
- SDK: `@sentry/node`

## Structured Logging

- Renderer logger: `src/lib/logger.ts`
- Main logger: `electron/utils/logger.ts`
- Log level configurable with:
  - `VITE_LOG_LEVEL` (renderer)
  - `LOG_LEVEL` (main)

### Redaction Policy

Log payload keys matching these patterns are redacted:

- `password`
- `token`
- `secret`
- `authorization`
- `apiKey`
- `accessKey`

## Privacy-Safe Defaults

- No full media payloads are emitted as telemetry by default.
- Secrets are redacted before logs are emitted.
- Error tracking requires explicit environment enablement.

## Recommended Production Settings

```bash
ENABLE_ERROR_TRACKING=1
SENTRY_DSN=...
SENTRY_ENVIRONMENT=production
LOG_LEVEL=info

VITE_ENABLE_ERROR_TRACKING=1
VITE_SENTRY_DSN=...
VITE_LOG_LEVEL=info
```
