/**
 * Zustand Store for User Profile
 * Stores user profile information including YouTube channel analysis
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChannelAnalysisData } from '../types/electron';

export interface UserProfile {
  userId: string;
  userName?: string;
  email?: string;
  youtubeChannelUrl?: string;
  channelAnalysis?: ChannelAnalysisData;
  createdAt: number;
  updatedAt: number;
}

interface ProfileState {
  // State
  profile: UserProfile | null;
  isAnalyzing: boolean;
  analysisError: string | null;

  // Actions
  createProfile: (userId: string, userName?: string, email?: string) => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
  setYouTubeChannel: (channelUrl: string, analysisData?: ChannelAnalysisData) => void;
  analyzeYouTubeChannel: (channelUrl: string) => Promise<boolean>;
  clearProfile: () => void;
  setAnalyzing: (isAnalyzing: boolean) => void;
  setAnalysisError: (error: string | null) => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      // Initial State
      profile: null,
      isAnalyzing: false,
      analysisError: null,

      // Actions
      createProfile: (userId, userName, email) => {
        const now = Date.now();
        set({
          profile: {
            userId,
            userName,
            email,
            createdAt: now,
            updatedAt: now,
          },
        });
      },

      updateProfile: (updates) => {
        const current = get().profile;
        if (!current) return;

        set({
          profile: {
            ...current,
            ...updates,
            updatedAt: Date.now(),
          },
        });
      },

      setYouTubeChannel: (channelUrl, analysisData) => {
        const current = get().profile;
        if (!current) return;

        set({
          profile: {
            ...current,
            youtubeChannelUrl: channelUrl,
            channelAnalysis: analysisData,
            updatedAt: Date.now(),
          },
        });
      },

      analyzeYouTubeChannel: async (channelUrl) => {
        if (!window.electronAPI) {
          console.error('[Profile] Electron API not available');
          set({ analysisError: 'Electron API not available' });
          return false;
        }

        set({ isAnalyzing: true, analysisError: null });

        try {
          console.log('[Profile] Analyzing YouTube channel:', channelUrl);
          const response = await window.electronAPI.analyzeChannel(channelUrl);

          if (response.success && response.data) {
            console.log('[Profile] Analysis successful');
            get().setYouTubeChannel(channelUrl, response.data);

            // Link analysis to user
            const profile = get().profile;
            if (profile && window.electronAPI.linkAnalysisToUser) {
              await window.electronAPI.linkAnalysisToUser(profile.userId, response.data.channel.id);
            }

            set({ isAnalyzing: false });
            return true;
          } else {
            console.error('[Profile] Analysis failed:', response.error);
            set({
              isAnalyzing: false,
              analysisError: response.error || 'Analysis failed',
            });
            return false;
          }
        } catch (error) {
          console.error('[Profile] Error analyzing channel:', error);
          set({
            isAnalyzing: false,
            analysisError: error instanceof Error ? error.message : 'Unknown error',
          });
          return false;
        }
      },

      clearProfile: () => {
        set({
          profile: null,
          isAnalyzing: false,
          analysisError: null,
        });
      },

      setAnalyzing: (isAnalyzing) => {
        set({ isAnalyzing });
      },

      setAnalysisError: (error) => {
        set({ analysisError: error });
      },
    }),
    {
      name: 'user-profile-storage',
    },
  ),
);
