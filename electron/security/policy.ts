import path from 'path';
import type { WebContents } from 'electron';

const ALLOWED_EXTERNAL_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'github.com',
  'www.github.com',
];

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') {
      return false;
    }

    const host = url.hostname.toLowerCase();
    return ALLOWED_EXTERNAL_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

export function shouldBlockNavigation(currentUrl: string, targetUrl: string): boolean {
  if (!targetUrl) return true;

  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    return current.origin !== target.origin;
  } catch {
    return true;
  }
}

export function shouldAllowPermissionRequest(
  webContents: WebContents,
  permission: string,
): boolean {
  // Desktop editor does not require runtime browser permissions.
  // Deny by default and explicitly opt-in if a feature requires it.
  void webContents;
  void permission;
  return false;
}

export interface SecurityWebPreferences {
  preload: string;
  nodeIntegration: boolean;
  contextIsolation: boolean;
  webSecurity: boolean;
  sandbox: boolean;
}

export function assertSecureWebPreferences(
  prefs: SecurityWebPreferences,
  options: { packaged: boolean },
): void {
  if (prefs.nodeIntegration) {
    throw new Error('Security violation: nodeIntegration must be false');
  }
  if (!prefs.contextIsolation) {
    throw new Error('Security violation: contextIsolation must be true');
  }
  if (!prefs.webSecurity) {
    throw new Error('Security violation: webSecurity must be true');
  }
  if (!prefs.sandbox) {
    throw new Error('Security violation: sandbox must be true');
  }
  if (!prefs.preload || !path.isAbsolute(prefs.preload)) {
    throw new Error('Security violation: preload path must be an absolute path');
  }

  // In packaged builds, preload must point to compiled JS.
  if (options.packaged && !prefs.preload.endsWith('.js')) {
    throw new Error('Security violation: packaged preload must reference a .js file');
  }
}

export function isValidMediaProtocolPath(rawPath: string): boolean {
  if (!rawPath || rawPath.includes('\0')) {
    return false;
  }
  return path.isAbsolute(rawPath);
}

export function packagedCspPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: app-media:",
    "media-src 'self' data: blob: app-media:",
    "font-src 'self' data:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https://*.amazonaws.com https://*.googleapis.com https://*.sentry.io",
  ].join('; ');
}
