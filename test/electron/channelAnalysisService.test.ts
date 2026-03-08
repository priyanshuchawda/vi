// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelAnalysisService } from '../../electron/services/channelAnalysisService.js';
import { analysisCacheService } from '../../electron/services/cacheService.js';

describe('ChannelAnalysisService.linkAnalysisToUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('links direct channel ids without trying to re-resolve them as URLs', async () => {
    const service = new ChannelAnalysisService('youtube-api-key');
    const linkSpy = vi
      .spyOn(analysisCacheService, 'linkUserToChannelWithCloud')
      .mockResolvedValue(true);
    const extractSpy = vi.spyOn(
      (service as unknown as { youtubeService: { extractChannelId: (value: string) => string } })
        .youtubeService,
      'extractChannelId',
    );
    const channelId = 'UC1234567890ABCDEFGHIJ';

    const linked = await service.linkAnalysisToUser('user-123', channelId);

    expect(linked).toBe(true);
    expect(extractSpy).not.toHaveBeenCalled();
    expect(linkSpy).toHaveBeenCalledWith('user-123', channelId);
  });

  it('still resolves youtube urls before linking them to a user', async () => {
    const service = new ChannelAnalysisService('youtube-api-key');
    const linkSpy = vi
      .spyOn(analysisCacheService, 'linkUserToChannelWithCloud')
      .mockResolvedValue(true);
    const extractSpy = vi
      .spyOn(
        (service as unknown as {
          youtubeService: { extractChannelId: (value: string) => Promise<string | null> };
        }).youtubeService,
        'extractChannelId',
      )
      .mockResolvedValue('UCresolvedChannel12345');

    const linked = await service.linkAnalysisToUser(
      'user-456',
      'https://www.youtube.com/@quickcut',
    );

    expect(linked).toBe(true);
    expect(extractSpy).toHaveBeenCalledWith('https://www.youtube.com/@quickcut');
    expect(linkSpy).toHaveBeenCalledWith('user-456', 'UCresolvedChannel12345');
  });
});
