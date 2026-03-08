import { describe, expect, it } from 'vitest';
import { shouldDisableDevChromiumSandbox } from '../../scripts/dev/chrome-sandbox.mjs';

describe('dev Electron launcher', () => {
  it('keeps Chromium sandbox enabled when the Linux helper is configured correctly', () => {
    expect(
      shouldDisableDevChromiumSandbox({
        platform: 'linux',
        packaged: false,
        chromeSandboxStat: {
          uid: 0,
          mode: 0o104755,
        },
      }),
    ).toBe(false);
  });

  it('disables Chromium sandbox only for Linux source runs with a missing or misconfigured helper', () => {
    expect(
      shouldDisableDevChromiumSandbox({
        platform: 'linux',
        packaged: false,
        chromeSandboxStat: {
          uid: 1000,
          mode: 0o100755,
        },
      }),
    ).toBe(true);
    expect(
      shouldDisableDevChromiumSandbox({
        platform: 'linux',
        packaged: false,
        chromeSandboxStat: null,
      }),
    ).toBe(true);
    expect(
      shouldDisableDevChromiumSandbox({
        platform: 'darwin',
        packaged: false,
        chromeSandboxStat: null,
      }),
    ).toBe(false);
    expect(
      shouldDisableDevChromiumSandbox({
        platform: 'linux',
        packaged: true,
        chromeSandboxStat: null,
      }),
    ).toBe(false);
  });
});
