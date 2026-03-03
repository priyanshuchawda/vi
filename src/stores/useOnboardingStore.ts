/**
 * Zustand Store for Onboarding State
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChannelAnalysisData } from '../types/electron';

interface OnboardingState {
  // State
  hasCompletedOnboarding: boolean;
  userId: string | null;
  analysisData: ChannelAnalysisData | null;

  // Actions
  completeOnboarding: (userId: string, analysisData?: ChannelAnalysisData) => void;
  setAnalysisData: (data: ChannelAnalysisData) => void;
  resetOnboarding: () => void;
  skipOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      // Initial State
      hasCompletedOnboarding: false,
      userId: null,
      analysisData: null,

      // Actions
      completeOnboarding: (userId, analysisData) => {
        console.log('[Onboarding] Completing onboarding with analysis:', !!analysisData);
        console.log('[Onboarding] Analysis data:', analysisData ? 'Available' : 'Not available');
        set({
          hasCompletedOnboarding: true,
          userId,
          analysisData: analysisData || null,
        });
      },

      setAnalysisData: (data) => {
        set({ analysisData: data });
      },

      skipOnboarding: () => {
        set({ hasCompletedOnboarding: true });
      },

      resetOnboarding: () => {
        set({
          hasCompletedOnboarding: false,
          userId: null,
          analysisData: null,
        });
      },
    }),
    {
      name: 'onboarding-storage',
    },
  ),
);
