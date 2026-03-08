import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import App from '../../src/App';
import { useOnboardingStore } from '../../src/stores/useOnboardingStore';
import { useProfileStore } from '../../src/stores/useProfileStore';

describe('App AWS bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProfileStore.setState({
      profile: null,
      isAnalyzing: false,
      analysisError: null,
    });
    useOnboardingStore.setState({
      hasCompletedOnboarding: true,
      userId: 'remote-user-1',
      analysisData: null,
    });

    vi.mocked(window.electronAPI.aiConfig.getStatus).mockResolvedValue({
      bedrockReady: true,
      youtubeReady: true,
      usingSavedSettings: true,
      usingEnvFallback: false,
      missingBedrockFields: [],
      missingYouTubeFields: [],
    });
    vi.mocked(window.electronAPI.storage.loadProfile).mockResolvedValue({
      success: true,
      data: {
        userId: 'remote-user-1',
        userName: 'Remote User',
        email: 'remote@example.com',
        createdAt: 1,
        updatedAt: 2,
      },
    });
  });

  it('hydrates the profile from cloud storage before deciding onboarding is required', async () => {
    render(<App />);

    await waitFor(() => {
      expect(window.electronAPI.storage.loadProfile).toHaveBeenCalledWith('remote-user-1');
    });

    await waitFor(() => {
      expect(useProfileStore.getState().profile).toMatchObject({
        userId: 'remote-user-1',
        userName: 'Remote User',
      });
    });
  });
});
