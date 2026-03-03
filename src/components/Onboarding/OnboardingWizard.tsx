/**
 * Onboarding Wizard
 * Multi-step onboarding flow for new users
 */

import { useState } from 'react';
import { YouTubeChannelStep } from './YouTubeChannelStep';
import { AnalysisProgress } from './AnalysisProgress';
import { AnalysisResults } from './AnalysisResults';
import type { ChannelAnalysisData } from '../../types/electron';

type OnboardingStep = 'youtube' | 'analysis' | 'results' | 'complete';

interface OnboardingWizardProps {
  onComplete: (analysisData?: ChannelAnalysisData) => void;
  onSkip?: () => void;
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const [step, setStep] = useState<OnboardingStep>('youtube');
  const [channelUrl, setChannelUrl] = useState('');
  const [analysisData, setAnalysisData] = useState<ChannelAnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleYouTubeSubmit = async (url: string) => {
    setChannelUrl(url);
    setError(null);
    setStep('analysis');

    try {
      // Call analysis through Electron IPC
      const response = await window.electronAPI.analyzeChannel(url);

      if (response.success && response.data) {
        setAnalysisData(response.data);
        setStep('results');
      } else {
        setError(response.error || 'Analysis failed');
        setStep('youtube'); // Go back to YouTube step
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('youtube');
    }
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else {
      onComplete();
    }
  };

  const handleComplete = () => {
    onComplete(analysisData || undefined);
  };

  return (
    <div className="onboarding-wizard min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Welcome to QuickCut</h1>
          <p className="text-gray-400 text-lg">Let's personalize your editing experience</p>
        </div>

        {/* Step Content */}
        <div className="bg-gray-800 rounded-lg shadow-xl p-8 max-h-[calc(100vh-250px)] overflow-y-auto flex flex-col custom-scrollbar">
          {step === 'youtube' && (
            <YouTubeChannelStep onSubmit={handleYouTubeSubmit} onSkip={handleSkip} error={error} />
          )}

          {step === 'analysis' && <AnalysisProgress channelUrl={channelUrl} />}

          {step === 'results' && analysisData && (
            <AnalysisResults data={analysisData} onComplete={handleComplete} />
          )}
        </div>

        {/* Progress Indicator */}
        <div className="mt-6 flex justify-center gap-2">
          <div
            className={`h-2 w-16 rounded ${step === 'youtube' ? 'bg-blue-500' : 'bg-gray-600'}`}
          />
          <div
            className={`h-2 w-16 rounded ${step === 'analysis' ? 'bg-blue-500' : 'bg-gray-600'}`}
          />
          <div
            className={`h-2 w-16 rounded ${step === 'results' ? 'bg-blue-500' : 'bg-gray-600'}`}
          />
        </div>
      </div>
    </div>
  );
}
