// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveLinuxReleaseFeedUrl } from '../../electron/services/linuxReleaseFeed.js';

describe('linuxReleaseFeed', () => {
  it('returns a normalized AWS feed URL on Linux', () => {
    expect(
      resolveLinuxReleaseFeedUrl(
        {
          AWS_LINUX_RELEASE_BASE_URL:
            ' https://quickcut-landing-279158981022.s3.eu-central-1.amazonaws.com/releases/linux/ ',
        },
        'linux',
      ),
    ).toBe('https://quickcut-landing-279158981022.s3.eu-central-1.amazonaws.com/releases/linux');
  });

  it('ignores the AWS feed override on non-Linux platforms', () => {
    expect(
      resolveLinuxReleaseFeedUrl(
        {
          AWS_LINUX_RELEASE_BASE_URL:
            'https://quickcut-landing-279158981022.s3.eu-central-1.amazonaws.com/releases/linux',
        },
        'win32',
      ),
    ).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(resolveLinuxReleaseFeedUrl({ AWS_LINUX_RELEASE_BASE_URL: 'not-a-url' }, 'linux')).toBe(
      null,
    );
  });
});
