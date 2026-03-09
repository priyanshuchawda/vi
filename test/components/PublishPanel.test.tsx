import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublishPanel from '../../src/components/ui/PublishPanel';
import { useAiConfigStore } from '../../src/stores/useAiConfigStore';
import { usePublishStore } from '../../src/stores/usePublishStore';

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={client}>
      <PublishPanel />
    </QueryClientProvider>,
  );
}

describe('PublishPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    usePublishStore.setState({
      pendingMeta: null,
      isGeneratingMeta: false,
      isPublishPanelRequested: false,
    });

    useAiConfigStore.setState({
      settings: {
        youtubeApiKey: '',
        awsRegion: 'us-east-1',
        awsAccessKeyId: 'test-key',
        awsSecretAccessKey: 'test-secret',
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

    vi.mocked(window.electronAPI.youtube.isAuthenticated).mockResolvedValue(false);
    vi.mocked(window.electronAPI.youtube.authenticate).mockResolvedValue(true);
    vi.mocked(window.electronAPI.aiConfig.get).mockResolvedValue({
      youtubeApiKey: '',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'test-key',
      awsSecretAccessKey: 'test-secret',
      awsSessionToken: '',
      bedrockInferenceProfileId: '',
      bedrockModelId: 'amazon.nova-lite-v1:0',
      geminiApiKey: '',
      geminiModelId: 'gemini-2.5-flash-lite',
      youtubeOAuthClientId: '',
      youtubeOAuthClientSecret: '',
      youtubeOAuthRedirectUri: '',
    });
    vi.mocked(window.electronAPI.aiConfig.getStatus).mockResolvedValue({
      aiReady: true,
      bedrockReady: true,
      geminiReady: false,
      preferredProvider: 'bedrock',
      youtubeReady: false,
      usingSavedSettings: false,
      usingEnvFallback: true,
      missingBedrockFields: [],
      missingGeminiFields: ['Gemini API Key'],
      missingYouTubeFields: ['YouTube API Key'],
    });
    vi.mocked(window.electronAPI.aiConfig.save).mockResolvedValue({ success: true });
  });

  it('opens the creator/upload modal before authenticating when upload credentials are missing', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Connect YouTube' }));
    });

    expect(await screen.findByText('Fill your YouTube credentials before connecting')).toBeInTheDocument();
    expect(screen.getByLabelText(/YOUTUBE_OAUTH_CLIENT_ID/i)).toBeInTheDocument();
    expect(window.electronAPI.youtube.authenticate).not.toHaveBeenCalled();
  });

  it('saves credentials and connects using the default redirect URI when none is provided', async () => {
    renderPanel();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Connect YouTube' }));
    });

    const clientIdField = await screen.findByLabelText(/YOUTUBE_OAUTH_CLIENT_ID/i);
    const clientSecretField = screen.getByLabelText(/YOUTUBE_OAUTH_CLIENT_SECRET/i);

    fireEvent.change(clientIdField, {
      target: { value: 'client-id.apps.googleusercontent.com' },
    });
    fireEvent.change(clientSecretField, {
      target: { value: 'client-secret' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and Connect YouTube' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.aiConfig.save).toHaveBeenCalledWith(
        expect.objectContaining({
          youtubeOAuthClientId: 'client-id.apps.googleusercontent.com',
          youtubeOAuthClientSecret: 'client-secret',
          youtubeOAuthRedirectUri: 'http://localhost',
        }),
      );
    });

    await waitFor(() => {
      expect(window.electronAPI.youtube.authenticate).toHaveBeenCalledTimes(1);
    });
  });
});
