// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCloudBackendService,
  resetCloudBackendService,
} from '../../electron/services/cloudBackendService.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloudBackendService', () => {
  it('defaults to direct mode and delegates to the provided storage adapter', async () => {
    const storage = {
      getUserProfile: vi.fn().mockResolvedValue({ userId: 'user-1', createdAt: 1, updatedAt: 2 }),
      setUserProfile: vi.fn().mockResolvedValue(undefined),
      getChannelAnalysis: vi.fn().mockResolvedValue({ ok: true }),
      setChannelAnalysis: vi.fn().mockResolvedValue(undefined),
      getUserLink: vi.fn().mockResolvedValue('channel-1'),
      setUserLink: vi.fn().mockResolvedValue(undefined),
      uploadExportedVideo: vi.fn().mockResolvedValue(null),
      listExportedVideos: vi.fn().mockResolvedValue([]),
      uploadAiContext: vi.fn().mockResolvedValue(undefined),
      downloadAiContext: vi.fn().mockResolvedValue('context'),
      uploadMemoryFile: vi.fn().mockResolvedValue(undefined),
      downloadMemoryFile: vi.fn().mockResolvedValue('memory'),
      deleteMemoryFile: vi.fn().mockResolvedValue(undefined),
    };

    const service = createCloudBackendService({
      env: {},
      storage,
    });

    expect(service.mode).toBe('direct');
    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({ userId: 'user-1' });
    expect(storage.getUserProfile).toHaveBeenCalledWith('user-1');
  });

  it('uses apigw mode for supported metadata routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { userId: 'user-1', createdAt: 1, updatedAt: 2 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = createCloudBackendService({
      env: {
        AWS_BACKEND_MODE: 'apigw',
        AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      } as NodeJS.ProcessEnv,
    });

    expect(service.mode).toBe('apigw');
    await expect(service.getUserProfile('user-1')).resolves.toMatchObject({ userId: 'user-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://example.execute-api.eu-central-1.amazonaws.com/profiles/user-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
    });
  });

  it('sends the configured bearer auth token in apigw mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { userId: 'user-1', createdAt: 1, updatedAt: 2 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = createCloudBackendService({
      env: {
        AWS_BACKEND_MODE: 'apigw',
        AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
        AWS_BACKEND_AUTH_TOKEN: 'test-token',
      } as NodeJS.ProcessEnv,
    });

    await service.getUserProfile('user-1');

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: 'Bearer test-token',
      },
    });
  });

  it('still rejects export routes in apigw mode until Phase C', async () => {
    const service = createCloudBackendService({
      env: {
        AWS_BACKEND_MODE: 'apigw',
        AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      } as NodeJS.ProcessEnv,
    });

    await expect(service.uploadExportedVideo('/tmp/video.mp4', 'user-1')).rejects.toThrow(
      /uploadExportedVideo/,
    );
  });

  it('resets the singleton without throwing', () => {
    expect(() => resetCloudBackendService()).not.toThrow();
  });
});
