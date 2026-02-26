import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

interface TranscriptEditSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

const TranscriptEditSettings = ({ isOpen, onClose }: TranscriptEditSettingsProps) => {
  const { transcriptEditSettings, updateTranscriptEditSettings, setNotification } = useProjectStore();
  
  const [settings, setSettings] = useState(transcriptEditSettings);

  if (!isOpen) return null;

  const handleSave = () => {
    updateTranscriptEditSettings(settings);
    setNotification({ type: 'success', message: 'Transcript editing settings saved' });
    onClose();
  };

  const handleReset = () => {
    const defaultSettings = {
      cutPadding: 0.05,
      mergeTolerance: 0.3,
      crossfadeDuration: 0.01,
      snapToSilence: true,
      silenceThreshold: -40,
      snapToFrames: true,
      frameRate: 30,
    };
    setSettings(defaultSettings);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div className="bg-bg-elevated border border-[#262626] rounded-xl shadow-2xl w-[90%] max-w-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Transcript Edit Settings
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Info Banner */}
          <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-text-primary">
                <p className="font-semibold mb-1">Professional Cut Quality</p>
                <p className="text-text-secondary">These settings ensure transcript-based edits sound natural and professional, avoiding audio clicks and abrupt transitions.</p>
              </div>
            </div>
          </div>

          {/* Cut Padding */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <label className="block text-sm font-semibold text-text-primary">
                Cut Padding: <span className="text-accent">{(settings.cutPadding * 1000).toFixed(0)}ms</span>
              </label>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              step="10"
              value={settings.cutPadding * 1000}
              onChange={(e) => setSettings({ ...settings, cutPadding: parseInt(e.target.value) / 1000 })}
              className="w-full h-2 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <p className="text-xs text-text-muted mt-1">
              Extra time added before/after each cut to avoid cutting mid-phoneme. Higher values are safer but remove more content.
            </p>
          </div>

          {/* Merge Tolerance */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <label className="block text-sm font-semibold text-text-primary">
                Merge Tolerance: <span className="text-accent">{(settings.mergeTolerance * 1000).toFixed(0)}ms</span>
              </label>
            </div>
            <input
              type="range"
              min="0"
              max="1000"
              step="50"
              value={settings.mergeTolerance * 1000}
              onChange={(e) => setSettings({ ...settings, mergeTolerance: parseInt(e.target.value) / 1000 })}
              className="w-full h-2 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <p className="text-xs text-text-muted mt-1">
              Maximum gap between deleted words to merge into a single cut. Reduces the number of cuts for smoother flow.
            </p>
          </div>

          {/* Crossfade Duration */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <label className="block text-sm font-semibold text-text-primary">
                Audio Crossfade: <span className="text-accent">{(settings.crossfadeDuration * 1000).toFixed(0)}ms</span>
              </label>
            </div>
            <input
              type="range"
              min="0"
              max="50"
              step="5"
              value={settings.crossfadeDuration * 1000}
              onChange={(e) => setSettings({ ...settings, crossfadeDuration: parseInt(e.target.value) / 1000 })}
              className="w-full h-2 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <p className="text-xs text-text-muted mt-1">
              Fade duration at cut points to eliminate clicks and pops. Longer fades are smoother but may sound unnatural.
            </p>
          </div>

          {/* Snap to Silence */}
          <div className="border border-border-primary rounded-lg p-4 bg-bg-surface">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">Snap Cuts to Silence</div>
                <div className="text-xs text-text-muted mt-1">Automatically align cuts to nearby silence regions</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.snapToSilence}
                  onChange={(e) => setSettings({ ...settings, snapToSilence: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-bg-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>
            
            {settings.snapToSilence && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">
                  Silence Threshold: <span className="text-accent">{settings.silenceThreshold}dB</span>
                </label>
                <input
                  type="range"
                  min="-60"
                  max="-20"
                  step="5"
                  value={settings.silenceThreshold}
                  onChange={(e) => setSettings({ ...settings, silenceThreshold: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-bg-primary rounded-lg appearance-none cursor-pointer accent-accent"
                />
                <div className="flex justify-between text-[10px] text-text-muted mt-1">
                  <span>More silence</span>
                  <span>Less silence</span>
                </div>
              </div>
            )}
          </div>

          {/* Snap to Frames */}
          <div className="border border-border-primary rounded-lg p-4 bg-bg-surface">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">Snap to Frame Boundaries</div>
                <div className="text-xs text-text-muted mt-1">Align cuts to video frames to avoid visual artifacts</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.snapToFrames}
                  onChange={(e) => setSettings({ ...settings, snapToFrames: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-bg-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>
            
            {settings.snapToFrames && (
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-2">
                  Frame Rate: <span className="text-accent">{settings.frameRate}fps</span>
                </label>
                <select
                  value={settings.frameRate}
                  onChange={(e) => setSettings({ ...settings, frameRate: parseInt(e.target.value) })}
                  className="w-full px-3 py-1.5 bg-bg-primary border border-border-primary rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="24">24 fps (Cinema)</option>
                  <option value="25">25 fps (PAL)</option>
                  <option value="30">30 fps (Standard)</option>
                  <option value="60">60 fps (High quality)</option>
                  <option value="120">120 fps (Slow motion)</option>
                </select>
              </div>
            )}
          </div>

          {/* Quality Preset Buttons */}
          <div>
            <div className="text-sm font-semibold text-text-primary mb-3">Quick Presets</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setSettings({
                  cutPadding: 0.02,
                  mergeTolerance: 0.15,
                  crossfadeDuration: 0.005,
                  snapToSilence: false,
                  silenceThreshold: -40,
                  snapToFrames: false,
                  frameRate: 30,
                })}
                className="px-3 py-2 bg-bg-surface hover:bg-bg-primary border border-border-primary rounded text-xs text-text-primary transition"
              >
                 Fast (Less processing)
              </button>
              <button
                onClick={() => setSettings({
                  cutPadding: 0.05,
                  mergeTolerance: 0.3,
                  crossfadeDuration: 0.01,
                  snapToSilence: true,
                  silenceThreshold: -40,
                  snapToFrames: true,
                  frameRate: 30,
                })}
                className="px-3 py-2 bg-accent/20 hover:bg-accent/30 border border-accent/50 rounded text-xs text-accent font-semibold transition"
              >
                 Balanced (Recommended)
              </button>
              <button
                onClick={() => setSettings({
                  cutPadding: 0.1,
                  mergeTolerance: 0.5,
                  crossfadeDuration: 0.02,
                  snapToSilence: true,
                  silenceThreshold: -35,
                  snapToFrames: true,
                  frameRate: 60,
                })}
                className="px-3 py-2 bg-bg-surface hover:bg-bg-primary border border-border-primary rounded text-xs text-text-primary transition"
              >
                 Premium (Best quality)
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-primary bg-bg-surface/50 flex justify-between">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-bg-elevated hover:bg-bg-primary text-text-secondary hover:text-accent border border-border-primary hover:border-accent rounded font-medium transition"
          >
            Reset to Defaults
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-bg-elevated hover:bg-bg-primary text-text-primary border border-border-primary rounded font-medium transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded font-bold transition shadow-lg shadow-accent/20"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TranscriptEditSettings;
