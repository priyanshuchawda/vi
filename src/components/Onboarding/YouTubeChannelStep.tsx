/**
 * YouTube Channel Step
 * Allows user to optionally enter their YouTube channel URL
 */

import { useState } from 'react';

interface YouTubeChannelStepProps {
  onSubmit: (url: string) => void;
  onSkip: () => void;
  error?: string | null;
}

export function YouTubeChannelStep({ onSubmit, onSkip, error }: YouTubeChannelStepProps) {
  const [url, setUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);

  const isValidYouTubeUrl = (url: string): boolean => {
    if (!url) return false;
    const patterns = [
      /youtube\.com\/@[\w-]+/,
      /youtube\.com\/channel\/[\w-]+/,
      /youtube\.com\/c\/[\w-]+/,
      /youtube\.com\/user\/[\w-]+/,
    ];
    return patterns.some(pattern => pattern.test(url));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url.trim()) {
      return;
    }

    if (!isValidYouTubeUrl(url)) {
      return;
    }

    setIsValidating(true);
    onSubmit(url);
  };

  const isValid = url ? isValidYouTubeUrl(url) : true;

  return (
    <div className="youtube-step">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">
          Do you have a YouTube channel?
        </h2>
        <p className="text-gray-400">
          We'll analyze your content and provide personalized editing tips and insights to help you grow.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* URL Input */}
        <div>
          <label htmlFor="youtube-url" className="block text-sm font-medium text-gray-300 mb-2">
            YouTube Channel URL (Optional)
          </label>
          <input
            id="youtube-url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/@yourchannel"
            className={`w-full px-4 py-3 bg-gray-700 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 ${
              !isValid 
                ? 'border-red-500 focus:ring-red-500' 
                : 'border-gray-600 focus:ring-blue-500'
            }`}
            disabled={isValidating}
          />
          {!isValid && (
            <p className="mt-2 text-sm text-red-400">
              Please enter a valid YouTube channel URL
            </p>
          )}
          {error && (
            <p className="mt-2 text-sm text-red-400">
              ⚠️ {error}
            </p>
          )}
        </div>

        {/* Example formats */}
        <div className="text-sm text-gray-500">
          <p className="font-medium mb-1">Supported formats:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>https://youtube.com/@username</li>
            <li>https://youtube.com/channel/UC...</li>
            <li>https://youtube.com/c/channelname</li>
          </ul>
        </div>

        {/* Benefits */}
        <div className="bg-gray-700/50 rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-gray-300">✨ What you'll get:</p>
          <ul className="text-sm text-gray-400 space-y-1">
            <li>• AI-powered content analysis</li>
            <li>• Personalized editing style recommendations</li>
            <li>• Growth suggestions based on your niche</li>
            <li>• Audience insights and trends</li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 mt-4">
          <button
            type="submit"
            disabled={!url || !isValid || isValidating}
            className={`flex-1 py-3 px-6 rounded-lg font-medium transition-colors ${
              url && isValid && !isValidating
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isValidating ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Analyzing...
              </span>
            ) : (
              'Analyze My Channel'
            )}
          </button>

          <button
            type="button"
            onClick={onSkip}
            disabled={isValidating}
            className="px-6 py-3 rounded-lg font-medium border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Skip for Now
          </button>
        </div>
      </form>
    </div>
  );
}
