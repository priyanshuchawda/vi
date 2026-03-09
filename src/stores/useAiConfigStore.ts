import { create } from 'zustand';
import type { AiConfigSettings, AiConfigStatus } from '../types/electron';

const DEFAULT_SETTINGS: AiConfigSettings = {
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
};

interface AiConfigStore {
  settings: AiConfigSettings;
  status: AiConfigStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  load: () => Promise<void>;
  save: (settings: AiConfigSettings) => Promise<{ success: boolean; error?: string }>;
  refreshStatus: () => Promise<AiConfigStatus | null>;
}

export const useAiConfigStore = create<AiConfigStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  status: null,
  isLoading: false,
  isSaving: false,

  load: async () => {
    set({ isLoading: true });
    try {
      const [settings, status] = await Promise.all([
        window.electronAPI.aiConfig.get(),
        window.electronAPI.aiConfig.getStatus(),
      ]);
      set({ settings, status, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  save: async (settings) => {
    set({ isSaving: true });
    try {
      const result = await window.electronAPI.aiConfig.save(settings);
      const status = await window.electronAPI.aiConfig.getStatus();
      const nextSettings = await window.electronAPI.aiConfig.get();
      set({ settings: nextSettings, status, isSaving: false });
      return result;
    } catch (error) {
      set({ isSaving: false });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save AI settings',
      };
    }
  },

  refreshStatus: async () => {
    try {
      const status = await window.electronAPI.aiConfig.getStatus();
      set({ status });
      return status;
    } catch {
      return null;
    }
  },
}));
