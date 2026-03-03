import { describe, expect, it } from 'vitest';
import {
  assertSecureWebPreferences,
  isValidMediaProtocolPath,
  isAllowedExternalUrl,
  packagedCspPolicy,
  shouldAllowPermissionRequest,
  shouldBlockNavigation,
} from '../../electron/security/policy';

describe('electron security policy', () => {
  it('allows only https links from allowlisted hosts', () => {
    expect(isAllowedExternalUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isAllowedExternalUrl('https://github.com/priyanshuchawda/vi')).toBe(true);
    expect(isAllowedExternalUrl('http://youtube.com/watch?v=abc')).toBe(false);
    expect(isAllowedExternalUrl('https://evil.example.com')).toBe(false);
  });

  it('blocks navigation across origins', () => {
    expect(
      shouldBlockNavigation('http://localhost:7377/editor', 'http://localhost:7377/settings'),
    ).toBe(false);
    expect(shouldBlockNavigation('http://localhost:7377/editor', 'https://github.com')).toBe(true);
  });

  it('denies permissions by default', () => {
    const fakeWebContents = {} as never;
    expect(shouldAllowPermissionRequest(fakeWebContents, 'media')).toBe(false);
  });

  it('builds strict CSP baseline', () => {
    const csp = packagedCspPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('connect-src');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("media-src 'self' data: blob: app-media:");
  });

  it('asserts secure BrowserWindow web preferences', () => {
    expect(() =>
      assertSecureWebPreferences(
        {
          preload: '/abs/path/preload.js',
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          sandbox: true,
        },
        { packaged: true },
      ),
    ).not.toThrow();

    expect(() =>
      assertSecureWebPreferences(
        {
          preload: '/abs/path/preload.js',
          nodeIntegration: true,
          contextIsolation: true,
          webSecurity: true,
          sandbox: true,
        },
        { packaged: false },
      ),
    ).toThrow('nodeIntegration');
  });

  it('validates media protocol paths', () => {
    expect(isValidMediaProtocolPath('/tmp/video.mp4')).toBe(true);
    expect(isValidMediaProtocolPath('relative/path.mp4')).toBe(false);
    expect(isValidMediaProtocolPath('/tmp/\0evil.mp4')).toBe(false);
  });
});
