import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useAiConfigStore } from '../../stores/useAiConfigStore';
import type { AiConfigSettings } from '../../types/electron';

const SettingsTab = () => {
  const {
    autoSaveEnabled,
    autoSaveInterval,
    setAutoSaveEnabled,
    setAutoSaveInterval,
    subtitleStyle,
    updateSubtitleStyle,
    transcriptEditSettings,
    updateTranscriptEditSettings,
    snapToGrid,
    gridSize,
    setSnapToGrid,
    setGridSize,
    setNotification,
  } = useProjectStore();
  const {
    settings: aiSettings,
    status: aiStatus,
    isLoading: isAiConfigLoading,
    isSaving: isAiConfigSaving,
    load: loadAiConfig,
    save: saveAiConfig,
  } = useAiConfigStore();
  const [draftAiSettings, setDraftAiSettings] = useState<AiConfigSettings>(aiSettings);
  const [hasAiDraftChanges, setHasAiDraftChanges] = useState(false);

  useEffect(() => {
    void loadAiConfig();
  }, [loadAiConfig]);

  const handleAiFieldChange = (field: keyof AiConfigSettings, value: string) => {
    setHasAiDraftChanges(true);
    setDraftAiSettings((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSaveAiSettings = async () => {
    const nextSettings = hasAiDraftChanges ? draftAiSettings : aiSettings;
    const result = await saveAiConfig(nextSettings);
    if (result.success) {
      setHasAiDraftChanges(false);
      setDraftAiSettings(nextSettings);
    }
    setNotification({
      type: result.success ? 'success' : 'error',
      message: result.success ? 'AI settings saved' : result.error || 'Failed to save AI settings',
    });
  };

  const displayedAiSettings = hasAiDraftChanges ? draftAiSettings : aiSettings;

  const autoSaveIntervalOptions = [
    { value: 30, label: '30 seconds' },
    { value: 60, label: '1 minute' },
    { value: 120, label: '2 minutes' },
    { value: 300, label: '5 minutes' },
    { value: 600, label: '10 minutes' },
  ];

  return (
    <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
      {/* Header */}
      <div className="p-4 border-b border-border-primary sticky top-0 bg-bg-secondary z-10">
        <h3 className="text-sm font-bold text-text-primary mb-1">Settings</h3>
        <p className="text-xs text-text-muted">Configure editor preferences</p>
      </div>

      <div className="p-4 space-y-6">
        <div>
          <h4 className="text-xs font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2V9a2 2 0 00-2-2h-1V6a5 5 0 00-10 0v1H6a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
            AI Credentials
          </h4>
          <div className="space-y-3">
            <div className="rounded border border-border-primary bg-bg-elevated/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-text-primary">
                    {aiStatus?.bedrockReady ? 'AI editor is ready' : 'AI editor setup required'}
                  </p>
                  <p className="mt-1 text-[10px] text-text-muted">
                    {aiStatus?.usingSavedSettings
                      ? 'Using credentials saved in QuickCut settings.'
                      : aiStatus?.usingEnvFallback
                        ? 'Using credentials from your .env file.'
                        : 'No Bedrock credentials detected yet.'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                    aiStatus?.bedrockReady
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {aiStatus?.bedrockReady ? 'Ready' : 'Missing'}
                </span>
              </div>
              {aiStatus && !aiStatus.bedrockReady && (
                <p className="mt-3 text-[10px] text-amber-200">
                  Fill: {aiStatus.missingBedrockFields.join(', ')}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">AWS Region</label>
              <input
                value={displayedAiSettings.awsRegion}
                onChange={(e) => handleAiFieldChange('awsRegion', e.target.value)}
                placeholder="eu-central-1"
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">AWS Access Key ID</label>
              <input
                value={displayedAiSettings.awsAccessKeyId}
                onChange={(e) => handleAiFieldChange('awsAccessKeyId', e.target.value)}
                placeholder="AKIA..."
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">AWS Secret Access Key</label>
              <input
                type="password"
                value={displayedAiSettings.awsSecretAccessKey}
                onChange={(e) => handleAiFieldChange('awsSecretAccessKey', e.target.value)}
                placeholder="Your Bedrock secret"
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">
                AWS Session Token <span className="text-text-muted">(optional)</span>
              </label>
              <input
                type="password"
                value={displayedAiSettings.awsSessionToken}
                onChange={(e) => handleAiFieldChange('awsSessionToken', e.target.value)}
                placeholder="Optional session token"
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">
                Bedrock Inference Profile <span className="text-text-muted">(optional)</span>
              </label>
              <input
                value={displayedAiSettings.bedrockInferenceProfileId}
                onChange={(e) => handleAiFieldChange('bedrockInferenceProfileId', e.target.value)}
                placeholder="eu.amazon.nova-lite-v1:0"
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">
                Bedrock Model ID <span className="text-text-muted">(optional)</span>
              </label>
              <input
                value={displayedAiSettings.bedrockModelId}
                onChange={(e) => handleAiFieldChange('bedrockModelId', e.target.value)}
                placeholder="amazon.nova-lite-v1:0"
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-text-primary">
                YouTube API Key <span className="text-text-muted">(optional)</span>
              </label>
              <input
                type="password"
                value={displayedAiSettings.youtubeApiKey}
                onChange={(e) => handleAiFieldChange('youtubeApiKey', e.target.value)}
                placeholder="Used for channel analysis features"
                className="w-full rounded border border-border-primary bg-bg-elevated px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded border border-border-primary bg-bg-elevated/50 px-3 py-2">
              <p className="text-[10px] text-text-muted">
                These saved settings override `.env` values for this desktop app.
              </p>
              <button
                onClick={() => void handleSaveAiSettings()}
                disabled={isAiConfigLoading || isAiConfigSaving}
                className="rounded bg-accent px-3 py-2 text-[11px] font-semibold text-bg-primary transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAiConfigSaving ? 'Saving...' : 'Save AI Settings'}
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-border-primary"></div>

        {/* Auto-Save Settings */}
        <div>
          <h4 className="text-xs font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            Auto-Save
          </h4>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-xs text-text-primary">Enable Auto-Save</span>
              <button
                onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  autoSaveEnabled ? 'bg-accent' : 'bg-bg-elevated border border-border-primary'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    autoSaveEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>

            {autoSaveEnabled && (
              <div>
                <label className="text-xs text-text-primary block mb-2">Save Interval</label>
                <select
                  value={autoSaveInterval}
                  onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-bg-elevated border border-border-primary rounded text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
                >
                  {autoSaveIntervalOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border-primary"></div>

        {/* Timeline Settings */}
        <div>
          <h4 className="text-xs font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Timeline
          </h4>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-xs text-text-primary">Snap to Grid</span>
              <button
                onClick={() => setSnapToGrid(!snapToGrid)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  snapToGrid ? 'bg-accent' : 'bg-bg-elevated border border-border-primary'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    snapToGrid ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>

            {snapToGrid && (
              <div>
                <label className="text-xs text-text-primary block mb-2">
                  Grid Size: {gridSize.toFixed(2)}s
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={gridSize}
                  onChange={(e) => setGridSize(Number(e.target.value))}
                  className="w-full h-1.5 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent"
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border-primary"></div>

        {/* Subtitle Settings */}
        <div>
          <h4 className="text-xs font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            Subtitles
          </h4>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-primary block mb-2">Display Mode</label>
              <select
                value={subtitleStyle.displayMode}
                onChange={(e) =>
                  updateSubtitleStyle({ displayMode: e.target.value as 'instant' | 'progressive' })
                }
                className="w-full px-3 py-2 bg-bg-elevated border border-border-primary rounded text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              >
                <option value="progressive">Progressive (word-by-word)</option>
                <option value="instant">Instant (full text)</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-text-primary block mb-2">Position</label>
              <select
                value={subtitleStyle.position}
                onChange={(e) =>
                  updateSubtitleStyle({ position: e.target.value as 'top' | 'bottom' })
                }
                className="w-full px-3 py-2 bg-bg-elevated border border-border-primary rounded text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              >
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-text-primary block mb-2">
                Font Size: {subtitleStyle.fontSize}px
              </label>
              <input
                type="range"
                min="12"
                max="72"
                value={subtitleStyle.fontSize}
                onChange={(e) => updateSubtitleStyle({ fontSize: Number(e.target.value) })}
                className="w-full h-1.5 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-border-primary"></div>

        {/* Transcript Edit Settings */}
        <div>
          <h4 className="text-xs font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg
              className="w-4 h-4 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Transcript Editing
          </h4>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-primary block mb-2">
                Cut Padding: {(transcriptEditSettings.cutPadding * 1000).toFixed(0)}ms
              </label>
              <input
                type="range"
                min="0"
                max="200"
                step="10"
                value={transcriptEditSettings.cutPadding * 1000}
                onChange={(e) =>
                  updateTranscriptEditSettings({ cutPadding: Number(e.target.value) / 1000 })
                }
                className="w-full h-1.5 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <p className="text-[10px] text-text-muted mt-1">
                Padding before/after each cut for smoother transitions
              </p>
            </div>

            <div>
              <label className="text-xs text-text-primary block mb-2">
                Merge Tolerance: {(transcriptEditSettings.mergeTolerance * 1000).toFixed(0)}ms
              </label>
              <input
                type="range"
                min="0"
                max="1000"
                step="50"
                value={transcriptEditSettings.mergeTolerance * 1000}
                onChange={(e) =>
                  updateTranscriptEditSettings({ mergeTolerance: Number(e.target.value) / 1000 })
                }
                className="w-full h-1.5 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <p className="text-[10px] text-text-muted mt-1">
                Maximum gap to automatically merge adjacent cuts
              </p>
            </div>

            <label className="flex items-center justify-between">
              <div className="flex-1 pr-2">
                <span className="text-xs text-text-primary block">Snap to Silence</span>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Align cuts to nearby silence for cleaner edits
                </p>
              </div>
              <button
                onClick={() =>
                  updateTranscriptEditSettings({
                    snapToSilence: !transcriptEditSettings.snapToSilence,
                  })
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                  transcriptEditSettings.snapToSilence
                    ? 'bg-accent'
                    : 'bg-bg-elevated border border-border-primary'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    transcriptEditSettings.snapToSilence ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>

            <label className="flex items-center justify-between">
              <div className="flex-1 pr-2">
                <span className="text-xs text-text-primary block">Snap to Frames</span>
                <p className="text-[10px] text-text-muted mt-0.5">
                  Align cuts to frame boundaries ({transcriptEditSettings.frameRate}fps)
                </p>
              </div>
              <button
                onClick={() =>
                  updateTranscriptEditSettings({
                    snapToFrames: !transcriptEditSettings.snapToFrames,
                  })
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                  transcriptEditSettings.snapToFrames
                    ? 'bg-accent'
                    : 'bg-bg-elevated border border-border-primary'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    transcriptEditSettings.snapToFrames ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>

        {/* Bottom padding for scrolling */}
        <div className="h-4"></div>
      </div>
    </div>
  );
};

export default SettingsTab;
