import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OnboardingWizard } from '../../src/components/Onboarding';
import { useAiConfigStore } from '../../src/stores/useAiConfigStore';
import { useProfileStore } from '../../src/stores/useProfileStore';
import type { AiConfigSettings, AiConfigStatus } from '../../src/types/electron';

const loadedAiSettings: AiConfigSettings = {
  youtubeApiKey: 'youtube-loaded',
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'loaded-access-key',
  awsSecretAccessKey: 'loaded-secret-key',
  awsSessionToken: 'loaded-session-token',
  bedrockInferenceProfileId: 'us.amazon.nova-lite-v1:0',
  bedrockModelId: 'amazon.nova-lite-v1:0',
  geminiApiKey: '',
  geminiModelId: 'gemini-2.5-flash-lite',
  youtubeOAuthClientId: '',
  youtubeOAuthClientSecret: '',
  youtubeOAuthRedirectUri: '',
};

const loadedAiStatus: AiConfigStatus = {
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
};

describe('OnboardingWizard', () => {
  const renderWizard = async () => {
    render(<OnboardingWizard onComplete={vi.fn()} />);
    await waitFor(() => {
      expect(window.electronAPI.aiConfig.get).toHaveBeenCalled();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window !== 'undefined' && typeof window.localStorage?.clear === 'function') {
      window.localStorage.clear();
    }

    useProfileStore.setState({
      profile: null,
      isAnalyzing: false,
      analysisError: null,
    });
    useAiConfigStore.setState({
      settings: {
        youtubeApiKey: '',
        awsRegion: 'us-east-1',
        awsAccessKeyId: '',
        awsSecretAccessKey: '',
        awsSessionToken: '',
        bedrockInferenceProfileId: '',
        bedrockModelId: 'amazon.nova-lite-v1:0',
        geminiApiKey: '',
        geminiModelId: 'gemini-2.5-flash-lite',
        youtubeOAuthClientId: '',
        youtubeOAuthClientSecret: '',
        youtubeOAuthRedirectUri: '',
      },
      status: null,
      isLoading: false,
      isSaving: false,
    });

    vi.mocked(window.electronAPI.aiConfig.get).mockResolvedValue(loadedAiSettings);
    vi.mocked(window.electronAPI.aiConfig.getStatus).mockResolvedValue(loadedAiStatus);
    vi.mocked(window.electronAPI.aiConfig.save).mockResolvedValue({ success: true });
    vi.mocked(window.electronAPI.analyzeChannel).mockResolvedValue({ success: false });
  });

  it('starts with the profile screen and marks YouTube as optional', async () => {
    await renderWizard();

    expect(screen.getByText('Fill your profile first')).toBeInTheDocument();
    expect(screen.getByText('Save Profile')).toBeInTheDocument();
    expect(screen.getByText(/YouTube Channel URL/i)).toBeInTheDocument();
    expect(screen.getAllByText('(optional)').length).toBeGreaterThan(0);
  });

  it('persists the YouTube URL when the first profile step is saved', async () => {
    await renderWizard();

    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Priyanshu' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://www.youtube.com/@channel'), {
      target: { value: 'https://www.youtube.com/@quickcut' },
    });
    fireEvent.click(screen.getByText('Save Profile'));

    expect(useProfileStore.getState().profile?.youtubeChannelUrl).toBe(
      'https://www.youtube.com/@quickcut',
    );
  });

  it('loads saved AI settings into the second step', async () => {
    await renderWizard();

    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Priyanshu' },
    });
    fireEvent.click(screen.getByText('Save Profile'));

    expect(await screen.findByText('Save the AI credentials your workflow uses')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue('loaded-access-key')).toBeInTheDocument();
      expect(screen.getByDisplayValue('loaded-secret-key')).toBeInTheDocument();
      expect(screen.getByDisplayValue('loaded-session-token')).toBeInTheDocument();
    });
  });
});
