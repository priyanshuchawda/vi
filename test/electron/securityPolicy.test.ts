import { describe, expect, it } from 'vitest';
import {
  AuthorizedPathRegistry,
  assertSecureWebPreferences,
  isValidMediaProtocolPath,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
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

  it('accepts only trusted renderer URLs for the current app mode', () => {
    expect(
      isTrustedRendererUrl('http://localhost:7377/editor', {
        packaged: false,
        devServerUrl: 'http://localhost:7377',
      }),
    ).toBe(true);
    expect(
      isTrustedRendererUrl('https://evil.example.com', {
        packaged: false,
        devServerUrl: 'http://localhost:7377',
      }),
    ).toBe(false);
    expect(isTrustedRendererUrl('file:///app/dist/index.html', { packaged: true })).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:7377', { packaged: true })).toBe(false);
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

  it('allows only explicitly authorized file paths', () => {
    const registry = new AuthorizedPathRegistry();
    registry.allowFile('/tmp/video.mp4');

    expect(registry.isAllowed('/tmp/video.mp4')).toBe(true);
    expect(registry.isAllowed('/tmp/other.mp4')).toBe(false);
  });

  it('allows files inside explicitly authorized roots', () => {
    const registry = new AuthorizedPathRegistry();
    registry.allowRoot('/tmp/project');

    expect(registry.isAllowed('/tmp/project/media/clip.mp4')).toBe(true);
    expect(registry.isAllowed('/tmp/other/clip.mp4')).toBe(false);
  });
});
