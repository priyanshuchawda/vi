import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { parseSRT } from '../../lib/srtParser';

interface SubtitleManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SubtitleManager = ({ isOpen, onClose }: SubtitleManagerProps) => {
  const {
    subtitles,
    subtitleStyle,
    setSubtitles,
    clearSubtitles,
    updateSubtitleStyle,
    setNotification,
  } = useProjectStore();
  const [fontSize, setFontSize] = useState(subtitleStyle.fontSize);
  const [fontFamily, setFontFamily] = useState(subtitleStyle.fontFamily);
  const [color, setColor] = useState(subtitleStyle.color);
  const [backgroundColor, setBackgroundColor] = useState(subtitleStyle.backgroundColor);
  const [position, setPosition] = useState<'top' | 'bottom'>(subtitleStyle.position);

  if (!isOpen) return null;

  const handleFileImport = async () => {
    if (!window.electronAPI) {
      alert('File import not available in browser');
      return;
    }

    try {
      const filePaths = await window.electronAPI.openFile();
      if (filePaths && filePaths.length > 0) {
        const filePath = filePaths[0];

        // Check if it's an SRT file
        if (!filePath.toLowerCase().endsWith('.srt')) {
          setNotification({ type: 'error', message: 'Please select an SRT file' });
          return;
        }

        // Read file content
        const result = await window.electronAPI.readTextFile(filePath);
        if (result.success && result.data) {
          const parsedSubtitles = parseSRT(result.data);

          if (parsedSubtitles.length === 0) {
            setNotification({ type: 'error', message: 'No valid subtitles found in file' });
            return;
          }

          setSubtitles(parsedSubtitles);
          setNotification({
            type: 'success',
            message: `Loaded ${parsedSubtitles.length} subtitles`,
          });
        }
      }
    } catch (error) {
      console.error('Error importing subtitles:', error);
      setNotification({ type: 'error', message: 'Failed to import subtitle file' });
    }
  };

  const handleSaveStyle = () => {
    updateSubtitleStyle({
      fontSize,
      fontFamily,
      color,
      backgroundColor,
      position,
    });
    setNotification({ type: 'success', message: 'Subtitle style updated' });
    onClose();
  };

  const handleClear = () => {
    clearSubtitles();
    setNotification({ type: 'success', message: 'Subtitles cleared' });
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border-primary rounded-lg shadow-2xl w-[90%] max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
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
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            Subtitle Manager
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Import Section */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Import Subtitles</h3>
            <div className="flex gap-3">
              <button
                onClick={handleFileImport}
                className="flex-1 px-4 py-3 bg-accent hover:bg-accent-hover text-bg-primary rounded font-medium transition flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Import SRT File
              </button>
              {subtitles.length > 0 && (
                <button
                  onClick={handleClear}
                  className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded font-medium transition"
                >
                  Clear
                </button>
              )}
            </div>
            {subtitles.length > 0 && (
              <div className="mt-3 p-3 bg-bg-surface rounded border border-border-primary">
                <div className="text-sm text-text-secondary">
                  <span className="font-semibold text-accent">{subtitles.length}</span> subtitles
                  loaded
                </div>
              </div>
            )}
          </div>

          {/* Style Section */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Subtitle Style</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Font Size
                  </label>
                  <input
                    type="number"
                    value={fontSize}
                    onChange={(e) => setFontSize(Math.max(12, parseInt(e.target.value) || 24))}
                    min="12"
                    max="72"
                    className="w-full px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Font Family
                  </label>
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Verdana">Verdana</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Text Color
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-12 h-10 rounded border border-border-primary cursor-pointer"
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="flex-1 px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Background
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={backgroundColor.replace(/rgba?\([^)]+\)/, '#000000')}
                      onChange={(e) => setBackgroundColor(`${e.target.value}b3`)}
                      className="w-12 h-10 rounded border border-border-primary cursor-pointer"
                    />
                    <input
                      type="text"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      placeholder="rgba(0,0,0,0.7)"
                      className="flex-1 px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Position
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['top', 'bottom'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setPosition(pos)}
                      className={`px-3 py-2 rounded border text-sm font-medium capitalize transition ${
                        position === pos
                          ? 'bg-accent text-bg-primary border-accent'
                          : 'bg-bg-surface text-text-secondary border-border-primary hover:border-accent'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Preview
                </label>
                <div className="relative w-full aspect-video bg-bg-primary rounded border border-border-primary overflow-hidden">
                  <div
                    className="absolute left-1/2 -translate-x-1/2 px-3 py-1.5 rounded"
                    style={{
                      [position]: '20px',
                      fontSize: `${fontSize}px`,
                      fontFamily,
                      color,
                      backgroundColor,
                      maxWidth: '80%',
                      textAlign: 'center',
                    }}
                  >
                    Sample Subtitle Text
                  </div>
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
            onClick={handleSaveStyle}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary rounded font-bold transition"
          >
            Save Style
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubtitleManager;
