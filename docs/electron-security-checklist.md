# Electron Security Checklist

This checklist captures QuickCut's enforced Electron security posture.

## BrowserWindow Hardening

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- renderer APIs exposed only through preload bridge

## Navigation and Window Controls

- All `window.open` attempts are intercepted via `setWindowOpenHandler`.
- New windows are denied by default.
- External links are opened only when URL matches allowlist and uses `https`.
- Main window navigation is blocked when target origin differs from current app origin.

## External URL Allowlist

Current allowlist (HTTPS only):

- `youtube.com`
- `youtu.be`
- `github.com`

Any non-allowlisted URL is blocked and logged.

## Permission Handling

- Runtime permission requests are denied by default using `session.defaultSession.setPermissionRequestHandler`.
- Features requiring a permission must be explicitly reviewed and allowlisted in code.

## CSP Strategy

- Packaged app injects CSP header in main process (`onHeadersReceived`).
- Renderer `index.html` includes CSP `<meta>` for `file://` contexts.

## Validation Notes

Security-sensitive logic lives in:

- `electron/security/policy.ts`
- `electron/main.ts`

Regression tests should validate:

- allowlist URL matching
- navigation block logic
- permission default-deny behavior
