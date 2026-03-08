import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileStore } from '../../src/stores/useProfileStore';

function resetProfileStore(): void {
  useProfileStore.setState({
    profile: null,
    isAnalyzing: false,
    analysisError: null,
  });
  localStorage.removeItem('user-profile-storage');
}

describe('useProfileStore cloud hydration', () => {
  beforeEach(() => {
    resetProfileStore();
    vi.clearAllMocks();
  });

  it('hydrates a missing local profile from cloud storage', async () => {
    const loadProfileMock = vi.mocked(window.electronAPI.storage.loadProfile).mockResolvedValue({
      success: true,
      data: {
        userId: 'user-1',
        userName: 'Remote User',
        email: 'remote@example.com',
        youtubeChannelUrl: 'https://www.youtube.com/@remote',
        createdAt: 100,
        updatedAt: 200,
      },
    });

    await expect(useProfileStore.getState().hydrateProfileFromCloud('user-1')).resolves.toBe(true);

    expect(loadProfileMock).toHaveBeenCalledWith('user-1');
    expect(useProfileStore.getState().profile).toMatchObject({
      userId: 'user-1',
      userName: 'Remote User',
      email: 'remote@example.com',
      youtubeChannelUrl: 'https://www.youtube.com/@remote',
      createdAt: 100,
      updatedAt: 200,
    });
  });

  it('preserves local channel analysis when hydrating the same user from cloud', async () => {
    useProfileStore.setState({
      profile: {
        userId: 'user-2',
        userName: '',
        channelAnalysis: {
          channel: {
            id: 'channel-1',
            title: 'Channel',
            description: '',
            subscriber_count: 1,
            video_count: 1,
            view_count: 1,
            published_at: '2024-01-01T00:00:00.000Z',
          },
          analysis: {
            channel_summary: 'summary',
            content_strengths: [],
            weaknesses: [],
            growth_suggestions: [],
            editing_style_recommendations: [],
            audience_insights: [],
          },
          meta: {
            analyzed_at: '2024-01-01T00:00:00.000Z',
            videos_analyzed: 1,
            freshness: 'fresh',
            cache_hit: false,
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
    });

    vi.mocked(window.electronAPI.storage.loadProfile).mockResolvedValue({
      success: true,
      data: {
        userId: 'user-2',
        userName: 'Hydrated User',
        createdAt: 10,
        updatedAt: 20,
      },
    });

    await useProfileStore.getState().hydrateProfileFromCloud('user-2');

    expect(useProfileStore.getState().profile?.channelAnalysis?.channel.id).toBe('channel-1');
    expect(useProfileStore.getState().profile?.userName).toBe('Hydrated User');
  });
});
