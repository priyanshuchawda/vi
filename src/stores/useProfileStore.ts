/**
 * Zustand Store for User Profile
 * Stores user profile information including YouTube channel analysis
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AnalysisResult, ChannelAnalysisData } from '../types/electron';

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

/**
 * Build a compact rules.md markdown string from channel analysis data.
 * Stored in localStorage and on disk; used as a condensed AI context.
 */
function generateChannelRules(
  channel: ChannelAnalysisData['channel'],
  analysis: AnalysisResult,
): string {
  const strengths = analysis.content_strengths
    .slice(0, 4)
    .map((s) => `- ${s}`)
    .join('\n');
  const editingRecs = analysis.editing_style_recommendations
    .slice(0, 4)
    .map((s) => `- ${s}`)
    .join('\n');
  const growthFocus = analysis.growth_suggestions
    .slice(0, 3)
    .map((s) => `- ${s}`)
    .join('\n');
  const summary =
    analysis.channel_summary.length > 300
      ? analysis.channel_summary.slice(0, 300) + '…'
      : analysis.channel_summary;

  return `# Creator Rules: ${channel.title}

Subscribers: ${channel.subscriber_count.toLocaleString()} | Videos: ${channel.video_count}

## Summary
${summary}

## Strengths
${strengths}

## Editing Style
${editingRecs}

## Growth Focus
${growthFocus}
`;
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
        const profile = { userId, userName, email, createdAt: now, updatedAt: now };
        set({ profile });
        // Sync to DynamoDB (fire-and-forget)
        void window.electronAPI?.storage?.saveProfile?.(
          profile as unknown as Record<string, unknown>,
        );
      },

      updateProfile: (updates) => {
        const current = get().profile;
        if (!current) return;

        const updated = { ...current, ...updates, updatedAt: Date.now() };
        set({ profile: updated });
        // Sync to DynamoDB (fire-and-forget)
        void window.electronAPI?.storage?.saveProfile?.(
          updated as unknown as Record<string, unknown>,
        );
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

            // Generate compact rules.md from analysis and persist it
            try {
              const rules = generateChannelRules(response.data.channel, response.data.analysis);
              localStorage.setItem('channel-rules', rules);
              if (window.electronAPI.rulesWrite) {
                await window.electronAPI.rulesWrite(rules);
              }
              console.log('[Profile] Channel rules.md saved');
            } catch (rulesErr) {
              console.warn('[Profile] Could not save rules.md:', rulesErr);
            }

            // Link analysis to user in DynamoDB
            const profile = get().profile;
            if (profile && window.electronAPI.linkAnalysisToUser) {
              await window.electronAPI.linkAnalysisToUser(profile.userId, response.data.channel.id);
            }
            // Sync updated profile (with channelUrl) to DynamoDB
            const currentProfile = get().profile;
            if (currentProfile) {
              void window.electronAPI?.storage?.saveProfile?.(
                currentProfile as unknown as Record<string, unknown>,
              );
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
