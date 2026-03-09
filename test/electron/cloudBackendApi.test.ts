// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { handleCloudBackendApiRequest } from '../../electron/services/cloudBackendApi.js';

describe('handleCloudBackendApiRequest', () => {
  it('round-trips profile and link routes through the storage adapter', async () => {
    const storage = {
      getUserProfile: vi.fn().mockResolvedValue({ userId: 'user-1', createdAt: 1, updatedAt: 2 }),
      setUserProfile: vi.fn().mockResolvedValue(undefined),
      getChannelAnalysis: vi.fn().mockResolvedValue({ summary: 'cached' }),
      setChannelAnalysis: vi.fn().mockResolvedValue(undefined),
      getUserLink: vi.fn().mockResolvedValue('channel-1'),
      setUserLink: vi.fn().mockResolvedValue(undefined),
      createPresignedVideoUploadPlan: vi.fn(),
      listExportedVideos: vi.fn().mockResolvedValue([]),
      uploadAiContext: vi.fn().mockResolvedValue(undefined),
      downloadAiContext: vi.fn().mockResolvedValue('{"hello":"world"}'),
      uploadMemoryFile: vi.fn().mockResolvedValue(undefined),
      downloadMemoryFile: vi.fn().mockResolvedValue('memory-body'),
      deleteMemoryFile: vi.fn().mockResolvedValue(undefined),
    };

    const getProfile = await handleCloudBackendApiRequest(
      {
        method: 'GET',
        path: '/profiles/user-1',
      },
      storage,
    );

    expect(getProfile.statusCode).toBe(200);
    expect(JSON.parse(getProfile.body)).toEqual({
      data: { userId: 'user-1', createdAt: 1, updatedAt: 2 },
    });

    const putProfile = await handleCloudBackendApiRequest(
      {
        method: 'PUT',
        path: '/profiles/user-1',
        body: JSON.stringify({ userId: 'user-1', createdAt: 1, updatedAt: 2 }),
      },
      storage,
    );

    expect(putProfile.statusCode).toBe(204);
    expect(storage.setUserProfile).toHaveBeenCalledWith({
      userId: 'user-1',
      createdAt: 1,
      updatedAt: 2,
    });

    const getLink = await handleCloudBackendApiRequest(
      {
        method: 'GET',
        path: '/analysis/users/user-1/link',
      },
      storage,
    );

    expect(getLink.statusCode).toBe(200);
    expect(JSON.parse(getLink.body)).toEqual({ channelId: 'channel-1' });
  });

  it('supports ai-context and memory object routes', async () => {
    const storage = {
      getUserProfile: vi.fn(),
      setUserProfile: vi.fn(),
      getChannelAnalysis: vi.fn(),
      setChannelAnalysis: vi.fn(),
      getUserLink: vi.fn(),
      setUserLink: vi.fn(),
      createPresignedVideoUploadPlan: vi.fn(),
      listExportedVideos: vi.fn().mockResolvedValue([]),
      uploadAiContext: vi.fn().mockResolvedValue(undefined),
      downloadAiContext: vi.fn().mockResolvedValue('context-body'),
      uploadMemoryFile: vi.fn().mockResolvedValue(undefined),
      downloadMemoryFile: vi.fn().mockResolvedValue('memory-body'),
      deleteMemoryFile: vi.fn().mockResolvedValue(undefined),
    };

    const putContext = await handleCloudBackendApiRequest(
      {
        method: 'PUT',
        path: '/ai-context/live-tests%2Frun-1%2Fchat.json',
        body: JSON.stringify({ content: 'context-body' }),
      },
      storage,
    );
    expect(putContext.statusCode).toBe(204);
    expect(storage.uploadAiContext).toHaveBeenCalledWith(
      'live-tests/run-1/chat.json',
      'context-body',
      'ai-context',
    );

    const getMemory = await handleCloudBackendApiRequest(
      {
        method: 'GET',
        path: '/memory/projects%2Falpha%2Fmemory.json',
      },
      storage,
    );
    expect(getMemory.statusCode).toBe(200);
    expect(JSON.parse(getMemory.body)).toEqual({ data: 'memory-body' });

    const deleteMemory = await handleCloudBackendApiRequest(
      {
        method: 'DELETE',
        path: '/memory/projects%2Falpha%2Fmemory.json',
      },
      storage,
    );
    expect(deleteMemory.statusCode).toBe(204);
    expect(storage.deleteMemoryFile).toHaveBeenCalledWith('projects/alpha/memory.json');
  });

  it('supports presigned video upload planning and listing routes', async () => {
    const storage = {
      getUserProfile: vi.fn(),
      setUserProfile: vi.fn(),
      getChannelAnalysis: vi.fn(),
      setChannelAnalysis: vi.fn(),
      getUserLink: vi.fn(),
      setUserLink: vi.fn(),
      createPresignedVideoUploadPlan: vi.fn().mockResolvedValue({
        uploadUrl: 'https://example-bucket.s3.eu-central-1.amazonaws.com/upload',
        record: {
          s3Key: 'videos/user-1/demo.mp4',
          s3Url: 'https://example-bucket.s3.eu-central-1.amazonaws.com/videos/user-1/demo.mp4',
          fileName: 'demo.mp4',
          fileSizeBytes: 1024,
          exportedAt: '2026-03-09T10:00:00.000Z',
          format: 'mp4',
        },
        requiredHeaders: {
          'content-type': 'video/mp4',
        },
        expiresAt: '2026-03-09T10:15:00.000Z',
      }),
      listExportedVideos: vi.fn().mockResolvedValue([
        {
          s3Key: 'videos/user-1/demo.mp4',
          s3Url: 'https://example-bucket.s3.eu-central-1.amazonaws.com/videos/user-1/demo.mp4',
          fileName: 'demo.mp4',
          fileSizeBytes: 1024,
          exportedAt: '2026-03-09T10:00:00.000Z',
          format: 'mp4',
        },
      ]),
      uploadAiContext: vi.fn(),
      downloadAiContext: vi.fn(),
      uploadMemoryFile: vi.fn(),
      downloadMemoryFile: vi.fn(),
      deleteMemoryFile: vi.fn(),
    };

    const presignResponse = await handleCloudBackendApiRequest(
      {
        method: 'POST',
        path: '/videos/uploads/presign',
        body: JSON.stringify({
          userId: 'user-1',
          fileName: 'demo.mp4',
          fileSizeBytes: 1024,
          contentType: 'video/mp4',
        }),
      },
      storage,
    );

    expect(presignResponse.statusCode).toBe(200);
    expect(storage.createPresignedVideoUploadPlan).toHaveBeenCalledWith(
      'user-1',
      'demo.mp4',
      1024,
      'video/mp4',
    );

    const listResponse = await handleCloudBackendApiRequest(
      {
        method: 'GET',
        path: '/videos/users/user-1',
      },
      storage,
    );

    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body)).toEqual({
      items: [
        {
          s3Key: 'videos/user-1/demo.mp4',
          s3Url: 'https://example-bucket.s3.eu-central-1.amazonaws.com/videos/user-1/demo.mp4',
          fileName: 'demo.mp4',
          fileSizeBytes: 1024,
          exportedAt: '2026-03-09T10:00:00.000Z',
          format: 'mp4',
        },
      ],
    });
  });

  it('returns 400 for malformed bodies', async () => {
    const storage = {
      getUserProfile: vi.fn(),
      setUserProfile: vi.fn(),
      getChannelAnalysis: vi.fn(),
      setChannelAnalysis: vi.fn(),
      getUserLink: vi.fn(),
      setUserLink: vi.fn(),
      createPresignedVideoUploadPlan: vi.fn(),
      listExportedVideos: vi.fn(),
      uploadAiContext: vi.fn(),
      downloadAiContext: vi.fn(),
      uploadMemoryFile: vi.fn(),
      downloadMemoryFile: vi.fn(),
      deleteMemoryFile: vi.fn(),
    };

    const response = await handleCloudBackendApiRequest(
      {
        method: 'PUT',
        path: '/profiles/user-1',
        body: '{"userId":123}',
      },
      storage,
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: expect.stringContaining('Invalid input'),
    });
  });

  it('rejects unauthorized requests when an API auth token is configured', async () => {
    const storage = {
      getUserProfile: vi.fn(),
      setUserProfile: vi.fn(),
      getChannelAnalysis: vi.fn(),
      setChannelAnalysis: vi.fn(),
      getUserLink: vi.fn(),
      setUserLink: vi.fn(),
      createPresignedVideoUploadPlan: vi.fn(),
      listExportedVideos: vi.fn(),
      uploadAiContext: vi.fn(),
      downloadAiContext: vi.fn(),
      uploadMemoryFile: vi.fn(),
      downloadMemoryFile: vi.fn(),
      deleteMemoryFile: vi.fn(),
    };

    const response = await handleCloudBackendApiRequest(
      {
        method: 'GET',
        path: '/profiles/user-1',
      },
      storage,
      { AWS_BACKEND_AUTH_TOKEN: 'test-token' } as NodeJS.ProcessEnv,
    );

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: 'Unauthorized' });
  });

  it('accepts authorized requests when the bearer token matches', async () => {
    const storage = {
      getUserProfile: vi.fn().mockResolvedValue({ userId: 'user-1', createdAt: 1, updatedAt: 2 }),
      setUserProfile: vi.fn(),
      getChannelAnalysis: vi.fn(),
      setChannelAnalysis: vi.fn(),
      getUserLink: vi.fn(),
      setUserLink: vi.fn(),
      createPresignedVideoUploadPlan: vi.fn(),
      listExportedVideos: vi.fn(),
      uploadAiContext: vi.fn(),
      downloadAiContext: vi.fn(),
      uploadMemoryFile: vi.fn(),
      downloadMemoryFile: vi.fn(),
      deleteMemoryFile: vi.fn(),
    };

    const response = await handleCloudBackendApiRequest(
      {
        method: 'GET',
        path: '/profiles/user-1',
        headers: {
          authorization: 'Bearer test-token',
        },
      },
      storage,
      { AWS_BACKEND_AUTH_TOKEN: 'test-token' } as NodeJS.ProcessEnv,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      data: { userId: 'user-1', createdAt: 1, updatedAt: 2 },
    });
  });
});
