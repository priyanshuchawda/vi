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
      aiReady: true,
      bedrockReady: true,
      geminiReady: false,
      preferredProvider: 'bedrock',
      youtubeReady: true,
      usingSavedSettings: true,
      usingEnvFallback: false,
      missingBedrockFields: [],
      missingGeminiFields: ['Gemini API Key'],
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

  it('falls back to the installation id when local onboarding state has no user id', async () => {
    useOnboardingStore.setState({
      hasCompletedOnboarding: true,
      userId: null,
      analysisData: null,
    });
    vi.mocked(window.electronAPI.identity.getInstallationId).mockResolvedValue('install-user-2');
    vi.mocked(window.electronAPI.storage.loadProfile).mockResolvedValue({
      success: true,
      data: {
        userId: 'install-user-2',
        userName: 'Installed User',
        createdAt: 1,
        updatedAt: 2,
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(window.electronAPI.identity.getInstallationId).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(window.electronAPI.storage.loadProfile).toHaveBeenCalledWith('install-user-2');
    });
  });
});
