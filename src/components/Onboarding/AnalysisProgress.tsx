/**
 * Analysis Progress
 * Shows progress while analyzing YouTube channel
 */

import { useEffect, useState } from 'react';

interface AnalysisProgressProps {
  channelUrl: string;
}

const PROGRESS_STEPS = [
  { progress: 10, message: 'Connecting to YouTube...' },
  { progress: 30, message: 'Fetching channel data...' },
  { progress: 50, message: 'Analyzing top videos...' },
  { progress: 70, message: 'Analyzing recent content...' },
  { progress: 90, message: 'Generating insights with AI...' },
];

export function AnalysisProgress({ channelUrl }: AnalysisProgressProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simulate progress through steps
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= PROGRESS_STEPS.length) {
          clearInterval(interval);
          return prev;
        }
        setProgress(PROGRESS_STEPS[next].progress);
        return next;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  const currentMessage = PROGRESS_STEPS[currentStep]?.message || PROGRESS_STEPS[0].message;

  return (
    <div className="analysis-progress text-center py-8">
      {/* Icon */}
      <div className="mb-6 flex justify-center">
        <div className="relative">
          <div className="w-24 h-24 border-4 border-blue-500/30 rounded-full"></div>
          <div className="absolute inset-0 w-24 h-24 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-12 h-12 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Progress Text */}
      <h2 className="text-2xl font-bold text-white mb-2">Analyzing Your Channel</h2>
      <p className="text-gray-400 mb-6">{currentMessage}</p>

      {/* Progress Bar */}
      <div className="max-w-md mx-auto">
        <div className="bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-sm text-gray-500 mt-2">{progress}% complete</p>
      </div>

      {/* Channel URL */}
      <div className="mt-8 p-4 bg-gray-700/50 rounded-lg max-w-md mx-auto">
        <p className="text-xs text-gray-500 mb-1">Analyzing</p>
        <p className="text-sm text-gray-300 truncate">{channelUrl}</p>
      </div>

      {/* Info */}
      <p className="text-xs text-gray-600 mt-6">
        This may take 10-30 seconds depending on channel size
      </p>
    </div>
  );
}
