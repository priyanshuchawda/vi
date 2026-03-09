// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { stat } from 'node:fs/promises';
import { uploadFileToPresignedUrl } from '../../electron/services/presignedHttpUpload.js';
import {
  createCloudBackendService,
  resetCloudBackendService,
} from '../../electron/services/cloudBackendService.js';

vi.mock('../../electron/services/presignedHttpUpload.js', () => ({
  uploadFileToPresignedUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: vi.fn(),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

  it('uploads exports through a presigned URL in apigw mode', async () => {
    const service = createCloudBackendService({
      env: {
        AWS_BACKEND_MODE: 'apigw',
        AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      } as NodeJS.ProcessEnv,
    });

    vi.mocked(stat).mockResolvedValue({ size: 2048 } as Awaited<ReturnType<typeof stat>>);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          uploadUrl: 'https://example-bucket.s3.eu-central-1.amazonaws.com/presigned',
          record: {
            s3Key: 'videos/user-1/demo.mp4',
            s3Url: 'https://example-bucket.s3.eu-central-1.amazonaws.com/videos/user-1/demo.mp4',
            fileName: 'demo.mp4',
            fileSizeBytes: 2048,
            exportedAt: '2026-03-09T10:00:00.000Z',
            format: 'mp4',
          },
          requiredHeaders: {
            'content-type': 'video/mp4',
          },
          expiresAt: '2026-03-09T10:15:00.000Z',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.uploadExportedVideo('/tmp/demo.mp4', 'user-1')).resolves.toMatchObject({
      s3Key: 'videos/user-1/demo.mp4',
      fileName: 'demo.mp4',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://example.execute-api.eu-central-1.amazonaws.com/videos/uploads/presign',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
    });
    expect(uploadFileToPresignedUrl).toHaveBeenCalledWith(
      '/tmp/demo.mp4',
      'https://example-bucket.s3.eu-central-1.amazonaws.com/presigned',
      { 'content-type': 'video/mp4' },
      undefined,
    );
  });

  it('lists exported videos through apigw mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          items: [
            {
              s3Key: 'videos/user-1/demo.mp4',
              s3Url: 'https://example-bucket.s3.eu-central-1.amazonaws.com/videos/user-1/demo.mp4',
              fileName: 'demo.mp4',
              fileSizeBytes: 2048,
              exportedAt: '2026-03-09T10:00:00.000Z',
              format: 'mp4',
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = createCloudBackendService({
      env: {
        AWS_BACKEND_MODE: 'apigw',
        AWS_BACKEND_URL: 'https://example.execute-api.eu-central-1.amazonaws.com',
      } as NodeJS.ProcessEnv,
    });

    await expect(service.listExportedVideos('user-1')).resolves.toEqual([
      {
        s3Key: 'videos/user-1/demo.mp4',
        s3Url: 'https://example-bucket.s3.eu-central-1.amazonaws.com/videos/user-1/demo.mp4',
        fileName: 'demo.mp4',
        fileSizeBytes: 2048,
        exportedAt: '2026-03-09T10:00:00.000Z',
        format: 'mp4',
      },
    ]);
  });

  it('resets the singleton without throwing', () => {
    expect(() => resetCloudBackendService()).not.toThrow();
  });
});
