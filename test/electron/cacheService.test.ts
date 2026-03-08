import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCloudBackendServiceMock } = vi.hoisted(() => ({
  getCloudBackendServiceMock: vi.fn(),
}));

vi.mock('../../electron/services/cloudBackendService.js', () => ({
  getCloudBackendService: getCloudBackendServiceMock,
}));

import { AnalysisCacheService } from '../../electron/services/cacheService.js';

describe('AnalysisCacheService.linkUserToChannelWithCloud', () => {
  beforeEach(() => {
    getCloudBackendServiceMock.mockReset();
  });

  it('waits for the cloud link write before resolving', async () => {
    let resolveCloudWrite: (() => void) | null = null;
    let cloudWriteFinished = false;
    const setUserLink = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCloudWrite = () => {
            cloudWriteFinished = true;
            resolve();
          };
        }),
    );
    getCloudBackendServiceMock.mockReturnValue({ setUserLink });

    const cache = {
      set: vi.fn().mockReturnValue(true),
    } as unknown as ConstructorParameters<typeof AnalysisCacheService>[0];
    const service = new AnalysisCacheService(cache);

    const pending = service.linkUserToChannelWithCloud('user-1', 'channel-1');
    await Promise.resolve();

    expect(cloudWriteFinished).toBe(false);
    expect(setUserLink).toHaveBeenCalledWith('user-1', 'channel-1');
    expect(cache.set).toHaveBeenCalledWith('user:channel:user-1', 'channel-1', 2592000);

    if (!resolveCloudWrite) {
      throw new Error('Expected cloud write promise to be pending');
    }
    const releaseCloudWrite = resolveCloudWrite as () => void;
    releaseCloudWrite();
    await expect(pending).resolves.toBe(true);
    expect(cloudWriteFinished).toBe(true);
  });
});
