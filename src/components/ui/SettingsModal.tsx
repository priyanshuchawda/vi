import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal = ({ isOpen, onClose }: SettingsModalProps) => {
  const {
    autoSaveEnabled,
    autoSaveInterval,
    setAutoSaveEnabled,
    setAutoSaveInterval,
    subtitleStyle,
    updateSubtitleStyle,
    setNotification,
  } = useProjectStore();
  const [tempEnabled, setTempEnabled] = useState(autoSaveEnabled);
  const [tempInterval, setTempInterval] = useState(autoSaveInterval);
  const [tempSubtitleMode, setTempSubtitleMode] = useState<'instant' | 'progressive'>(
    subtitleStyle.displayMode,
  );

  if (!isOpen) return null;

  const handleSave = () => {
    setAutoSaveEnabled(tempEnabled);
    setAutoSaveInterval(tempInterval);
    updateSubtitleStyle({ displayMode: tempSubtitleMode });
    setNotification({ type: 'success', message: 'Settings saved' });
    onClose();
  };

  const formatInterval = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds} seconds`;
    }
    const minutes = Math.floor(seconds / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border-primary rounded-lg shadow-2xl w-[90%] max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <svg
              className="w-6 h-6 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Settings
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="p-6 space-y-6">
          {/* Auto-save Section */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-4">Auto-Save</h3>

            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-text-primary">Enable Auto-Save</div>
                  <div className="text-xs text-text-muted mt-1">
                    Automatically save your project at regular intervals
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tempEnabled}
                    onChange={(e) => setTempEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-bg-surface rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>

              {/* Interval Slider */}
              <div className={`transition-opacity ${tempEnabled ? 'opacity-100' : 'opacity-50'}`}>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Auto-Save Interval:{' '}
                  <span className="text-accent">{formatInterval(tempInterval)}</span>
                </label>
                <input
                  type="range"
                  min="30"
                  max="600"
                  step="30"
                  value={tempInterval}
                  onChange={(e) => setTempInterval(parseInt(e.target.value))}
                  disabled={!tempEnabled}
                  className="w-full h-2 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex justify-between text-xs text-text-muted mt-1">
                  <span>30s</span>
                  <span>5 min</span>
                  <span>10 min</span>
                </div>
              </div>

              {/* Info Box */}
              <div className="p-3 bg-bg-surface rounded border border-border-primary">
                <div className="flex gap-2">
                  <svg
                    className="w-5 h-5 text-accent flex-shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="text-xs text-text-secondary">
                    {tempEnabled
                      ? `Your project will be automatically saved every ${formatInterval(tempInterval)} if there are unsaved changes.`
                      : 'Auto-save is disabled. You will need to manually save your project using Ctrl+S or the Save button.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Subtitle Display Section */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-4">Subtitle Display</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Display Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setTempSubtitleMode('progressive')}
                      className={`px-3 py-2 rounded border transition ${
                        tempSubtitleMode === 'progressive'
                          ? 'bg-accent text-bg-primary border-accent font-semibold'
                          : 'bg-bg-surface text-text-primary border-border-primary hover:bg-bg-primary'
                      }`}
                    >
                      Progressive
                    </button>
                    <button
                      onClick={() => setTempSubtitleMode('instant')}
                      className={`px-3 py-2 rounded border transition ${
                        tempSubtitleMode === 'instant'
                          ? 'bg-accent text-bg-primary border-accent font-semibold'
                          : 'bg-bg-surface text-text-primary border-border-primary hover:bg-bg-primary'
                      }`}
                    >
                      Instant
                    </button>
                  </div>
                  <p className="text-xs text-text-muted mt-2">
                    {tempSubtitleMode === 'progressive'
                      ? 'Words appear gradually during subtitle display (like YouTube/TikTok)'
                      : 'All subtitle text appears at once (traditional style)'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-primary flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-surface hover:bg-bg-primary text-text-primary border border-border-primary rounded font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary rounded font-bold transition"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
