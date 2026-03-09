/**
 * Profile Component
 * Allows users to manage their profile and YouTube channel
 */

import { useState, useEffect } from 'react';
import { useProfileStore } from '../../stores/useProfileStore';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal = ({ isOpen, onClose }: ProfileModalProps) => {
  const {
    profile,
    isAnalyzing,
    analysisError,
    createProfile,
    updateProfile,
    analyzeYouTubeChannel,
  } = useProfileStore();

  const [userName, setUserName] = useState(profile?.userName || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [youtubeUrl, setYoutubeUrl] = useState(profile?.youtubeChannelUrl || '');
  const [isAnalyzingChannel, setIsAnalyzingChannel] = useState(false);

  useEffect(() => {
    if (profile) {
      setUserName(profile.userName || '');
      setEmail(profile.email || '');
      setYoutubeUrl(profile.youtubeChannelUrl || '');
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    const trimmedName = userName.trim();
    const trimmedEmail = email.trim();
    const trimmedYouTubeUrl = youtubeUrl.trim();

    if (!profile) {
      // Create new profile
      const userId = await window.electronAPI.identity.getInstallationId();
      createProfile(userId, trimmedName || undefined, trimmedEmail || undefined);
    }

    updateProfile({
      userName: trimmedName || undefined,
      email: trimmedEmail || undefined,
      youtubeChannelUrl: trimmedYouTubeUrl || undefined,
    });
  };

  const handleAnalyzeChannel = async () => {
    if (!youtubeUrl.trim()) {
      return;
    }

    setIsAnalyzingChannel(true);
    const success = await analyzeYouTubeChannel(youtubeUrl);
    setIsAnalyzingChannel(false);

    if (success) {
      // Profile updated successfully
      console.log('[Profile] Channel analyzed and saved');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="bg-bg-elevated border border-border-primary rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl animate-scale-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-primary bg-bg-secondary">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-accent"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <div>
              <h2 id="profile-modal-title" className="text-xl font-semibold text-text-primary">
                User Profile
              </h2>
              <p className="text-sm text-text-muted">Manage your profile and channel</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary hover:bg-bg-primary p-2 rounded-lg transition-all duration-200 hover:scale-110 active:scale-95 relative z-10"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-text-primary flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              Basic Information
            </h3>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="profile-name"
                  className="block text-sm font-medium text-text-secondary mb-2"
                >
                  Name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-email"
                  className="block text-sm font-medium text-text-secondary mb-2 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  Email
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
              </div>
            </div>
          </div>

          {/* YouTube Channel Section */}
          <div className="space-y-4 pt-4 border-t border-border-primary">
            <h3 className="text-lg font-medium text-text-primary flex items-center gap-2">
              <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              YouTube Channel
            </h3>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="profile-youtube-url"
                  className="block text-sm font-medium text-text-secondary mb-2"
                >
                  Channel URL <span className="text-text-muted">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="profile-youtube-url"
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/@channel"
                    className="flex-1 px-3 py-2 bg-bg-primary border border-border-primary rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                  />
                  <button
                    onClick={handleAnalyzeChannel}
                    disabled={!youtubeUrl.trim() || isAnalyzingChannel || isAnalyzing}
                    className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                  >
                    {isAnalyzingChannel || isAnalyzing ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-muted mt-2">
                  Enter your YouTube channel URL to get AI-powered insights and recommendations
                </p>
              </div>

              {/* Analysis Status */}
              {analysisError && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <svg
                    className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm text-red-500 font-medium">Analysis Failed</p>
                    <p className="text-xs text-red-400 mt-1">{analysisError}</p>
                  </div>
                </div>
              )}

              {/* Channel Analysis Display */}
              {profile?.channelAnalysis && (
                <div className="space-y-3 p-4 bg-bg-primary border border-border-primary rounded-lg">
                  <div className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary">Channel Analyzed</p>
                      <p className="text-xs text-text-muted mt-1">
                        {new Date(profile.channelAnalysis.meta.analyzed_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {/* Channel Info */}
                  <div className="flex items-start gap-3 pt-3 border-t border-border-primary">
                    {profile.channelAnalysis.channel.thumbnail_url && (
                      <img
                        src={profile.channelAnalysis.channel.thumbnail_url}
                        alt={profile.channelAnalysis.channel.title}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-text-primary">
                        {profile.channelAnalysis.channel.title}
                      </h4>
                      <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                        <span>
                          {profile.channelAnalysis.channel.subscriber_count.toLocaleString()}{' '}
                          subscribers
                        </span>
                        <span>
                          {profile.channelAnalysis.channel.video_count.toLocaleString()} videos
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Analysis Summary */}
                  {profile.channelAnalysis.analysis.channel_summary && (
                    <div className="pt-3 border-t border-border-primary">
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {profile.channelAnalysis.analysis.channel_summary.substring(0, 200)}...
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border-primary bg-bg-secondary">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary hover:text-text-primary hover:bg-bg-primary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              handleSaveProfile();
              onClose();
            }}
            className="px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium transition-all"
          >
            Save Profile
          </button>
        </div>
      </div>
    </div>
  );
};
