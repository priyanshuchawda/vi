import { useProjectStore } from '../../stores/useProjectStore';
import type { ExportFormat, ExportResolution } from '../../stores/useProjectStore';
import CollapsibleSection from './CollapsibleSection';

const ExportSettingsPanel = () => {
  const {
    exportFormat,
    exportResolution,
    setExportFormat,
    setExportResolution,
    setNotification,
    clips,
  } = useProjectStore();

  const formatOptions: { value: ExportFormat; label: string; description: string }[] = [
    { value: 'mp4', label: 'MP4', description: 'Universal format, best compatibility' },
    { value: 'mov', label: 'MOV', description: 'High quality, Apple devices' },
    { value: 'avi', label: 'AVI', description: 'Legacy format, large file size' },
    { value: 'webm', label: 'WebM', description: 'Web optimized, modern browsers' },
  ];

  const resolutionOptions: { value: ExportResolution; label: string; description: string }[] = [
    { value: 'original', label: 'Original', description: 'Keep source resolution' },
    { value: '1920x1080', label: '1080p (Full HD)', description: '1920x1080 pixels' },
    { value: '1280x720', label: '720p (HD)', description: '1280x720 pixels' },
    { value: '854x480', label: '480p (SD)', description: '854x480 pixels' },
  ];

  const handleFormatChange = (format: ExportFormat) => {
    setExportFormat(format);
    setNotification({ type: 'success', message: `Export format: ${format.toUpperCase()}` });
  };

  const handleResolutionChange = (resolution: ExportResolution) => {
    setExportResolution(resolution);
    const label = resolutionOptions.find((r) => r.value === resolution)?.label || resolution;
    setNotification({ type: 'success', message: `Resolution: ${label}` });
  };

  const totalClips = clips.length;
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border-primary sticky top-0 bg-bg-elevated z-10">
        <div className="flex items-center gap-2 mb-1">
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
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3 3m0 0l-3-3m3 3V10"
            />
          </svg>
          <h3 className="text-sm font-bold text-text-primary">Export Settings</h3>
        </div>
        <p className="text-xs text-text-muted">Configure output format and quality</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Project Info */}
        <div className="bg-bg-secondary rounded-lg p-3 border border-border-primary">
          <h4 className="text-xs font-bold text-text-primary mb-2">Project Info</h4>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Total Clips</span>
              <span className="text-text-primary font-medium">{totalClips}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Duration</span>
              <span className="text-text-primary font-medium">
                {Math.floor(totalDuration / 60)}:{(totalDuration % 60).toFixed(0).padStart(2, '0')}
              </span>
            </div>
          </div>
        </div>

        {/* Export Format */}
        <CollapsibleSection title="Export Format" defaultOpen={true}>
          <div className="space-y-2">
            {formatOptions.map((option) => {
              const isSelected = exportFormat === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleFormatChange(option.value)}
                  className={`w-full text-left p-3 rounded-lg border transition ${
                    isSelected
                      ? 'bg-accent/10 border-accent text-text-primary'
                      : 'bg-bg-secondary border-border-primary hover:border-accent/50 text-text-muted hover:text-text-primary'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold">{option.label}</span>
                        {isSelected && (
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
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-text-muted">{option.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* Resolution */}
        <CollapsibleSection title="Resolution" defaultOpen={true}>
          <div className="space-y-2">
            {resolutionOptions.map((option) => {
              const isSelected = exportResolution === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleResolutionChange(option.value)}
                  className={`w-full text-left p-3 rounded-lg border transition ${
                    isSelected
                      ? 'bg-accent/10 border-accent text-text-primary'
                      : 'bg-bg-secondary border-border-primary hover:border-accent/50 text-text-muted hover:text-text-primary'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold">{option.label}</span>
                        {isSelected && (
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
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-text-muted">{option.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>

        {/* Export Tips */}
        <div className="bg-bg-secondary rounded-lg p-3 border border-border-primary">
          <h4 className="text-xs font-bold text-text-primary mb-2 flex items-center gap-2">
            <span></span>
            <span>Export Tips</span>
          </h4>
          <ul className="space-y-1.5 text-xs text-text-muted">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>MP4 offers best compatibility across devices</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Original resolution preserves source quality</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Lower resolutions create smaller file sizes</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Use toolbar Export button when ready</span>
            </li>
          </ul>
        </div>

        {/* Current Selection Summary */}
        <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
          <h4 className="text-xs font-bold text-accent mb-2">Current Export Settings</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Format:</span>
              <span className="text-text-primary font-bold">{exportFormat.toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Resolution:</span>
              <span className="text-text-primary font-bold">
                {resolutionOptions.find((r) => r.value === exportResolution)?.label ||
                  exportResolution}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportSettingsPanel;
