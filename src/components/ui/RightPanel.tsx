import { useState, useEffect } from 'react';
import TranscriptEditor from './TranscriptEditor';
import CollapsibleSection from './CollapsibleSection';
import AudioPanel from './AudioPanel';
import ExportSettingsPanel from './ExportSettingsPanel';
import EffectsPanel from './EffectsPanel';
import { useProjectStore } from '../../stores/useProjectStore';

type PanelTab = 'captions' | 'transcript' | 'audio' | 'export' | 'effects';

const RightPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('captions');
  const { transcription, subtitles } = useProjectStore();

  // Calculate counts for badges
  const captionsCount = transcription?.segments?.length || subtitles.length;
  const wordsCount = transcription?.words?.length || 0;

  // Keyboard shortcuts for tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      
      const tabMap: Record<string, PanelTab> = {
        '1': 'captions',
        '2': 'transcript',
        '3': 'audio',
        '4': 'export',
        '5': 'effects',
      };
      
      const newTab = tabMap[e.key];
      if (newTab) {
        e.preventDefault();
        if (newTab === 'transcript' && !transcription?.words) {
          return; // Don't switch to transcript if no transcription
        }
        setActiveTab(newTab);
        setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transcription]);

  // Toggle button when closed
  if (!isOpen) {
    const hasTranscriptReady = transcription?.words && transcription.words.length > 0;
    
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed right-4 top-1/2 -translate-y-1/2 bg-accent hover:bg-accent-hover text-white px-4 py-6 rounded-l-xl shadow-2xl transition-all flex flex-col items-center gap-2 z-50 group ${
          hasTranscriptReady ? 'animate-pulse' : ''
        }`}
        title={hasTranscriptReady ? " Transcript ready! Click to edit" : "Open Panel"}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
        {hasTranscriptReady && (
          <span className="absolute -top-1 -left-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
          </span>
        )}
        <span className="text-xs font-bold tracking-wider opacity-90" style={{ writingMode: 'vertical-rl' }}>
          {hasTranscriptReady ? 'NEW' : 'PANEL'}
        </span>
      </button>
    );
  }

  return (
    <div className="w-96 bg-bg-elevated border-l border-border-primary flex flex-col h-full">
      {/* Header with VS Code Style Tabs */}
      <div className="border-b border-border-primary">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <h2 className="text-sm font-bold text-text-primary">
              Tools & Settings
            </h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-surface rounded transition"
            title="Close Panel (Alt+0)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* VS Code Style Tabs */}
        <div className="flex overflow-x-auto" role="tablist" aria-label="Panel tabs"  style={{ scrollbarWidth: 'thin' }}>
          <TabButton 
            id="captions"
            isActive={activeTab === 'captions'}
            onClick={() => setActiveTab('captions')}
            title="Captions (Alt+1)"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            }
            label="Captions"
            badge={captionsCount}
          />
          
          <TabButton 
            id="transcript"
            isActive={activeTab === 'transcript'}
            onClick={() => setActiveTab('transcript')}
            disabled={!transcription?.words}
            title={!transcription?.words ? 'Generate captions first' : 'Text Editor (Alt+2)'}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            }
            label="Transcript"
            badge={wordsCount}
            showNotification={transcription?.words && activeTab !== 'transcript'}
          />
          
          <TabButton 
            id="audio"
            isActive={activeTab === 'audio'}
            onClick={() => setActiveTab('audio')}
            title="Audio Mixing (Alt+3)"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            }
            label="Audio"
          />
          
          <TabButton 
            id="export"
            isActive={activeTab === 'export'}
            onClick={() => setActiveTab('export')}
            title="Export Settings (Alt+4)"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3 3m0 0l-3-3m3 3V10" />
              </svg>
            }
            label="Export"
          />
          
          <TabButton 
            id="effects"
            isActive={activeTab === 'effects'}
            onClick={() => setActiveTab('effects')}
            title="Effects (Alt+5)"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            }
            label="Effects"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'captions' && (
          <div id="captions-panel" role="tabpanel" className="h-full overflow-y-auto">
            <CaptionsPanelContent />
          </div>
        )}
        {activeTab === 'transcript' && (
          <div id="transcript-panel" role="tabpanel" className="h-full">
            <TranscriptEditor />
          </div>
        )}
        {activeTab === 'audio' && (
          <div id="audio-panel" role="tabpanel" className="h-full">
            <AudioPanel />
          </div>
        )}
        {activeTab === 'export' && (
          <div id="export-panel" role="tabpanel" className="h-full">
            <ExportSettingsPanel />
          </div>
        )}
        {activeTab === 'effects' && (
          <div id="effects-panel" role="tabpanel" className="h-full">
            <EffectsPanel />
          </div>
        )}
      </div>
    </div>
  );
};

// Tab Button Component for consistency
interface TabButtonProps {
  id: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  showNotification?: boolean;
}

const TabButton = ({ id, isActive, onClick, disabled, title, icon, label, badge, showNotification }: TabButtonProps) => {
  return (
    <button
      id={`${id}-tab`}
      onClick={onClick}
      role="tab"
      aria-selected={isActive}
      aria-controls={`${id}-panel`}
      aria-disabled={disabled}
      disabled={disabled}
      className={`relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap group disabled:opacity-40 disabled:cursor-not-allowed ${
        isActive
          ? 'text-text-primary bg-bg-elevated'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-surface/50'
      }`}
      title={title}
    >
      {icon}
      <span className="text-xs">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[10px] font-bold rounded">
          {badge}
        </span>
      )}
      {showNotification && (
        <span className="flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-accent opacity-75"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent"></span>
        </span>
      )}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"></div>
      )}
    </button>
  );
};

// Extract CaptionsPanel content (reuse existing logic)
const CaptionsPanelContent = () => {
  const {
    clips,
    subtitles,
    setSubtitles,
    transcription,
    transcribeFile,
    isTranscribing,
    transcriptionProgress,
    clearTranscription,
    setCurrentTime,
    setNotification,
    currentTime,
  } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [editingCaption, setEditingCaption] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const captions = transcription?.segments?.map((seg) => ({
    id: seg.id,
    start: seg.start,
    end: seg.end,
    text: seg.text,
  })) || subtitles.map((sub, i) => ({
    id: i + 1,
    start: sub.startTime,
    end: sub.endTime,
    text: sub.text,
  }));

  const filteredCaptions = searchQuery
    ? captions.filter(cap => cap.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : captions;

  const hasMedia = clips.length > 0;
  const hasCaptions = captions.length > 0;

  const activeCaption = captions.find(
    (cap) => currentTime >= cap.start && currentTime <= cap.end
  );

  const handleAutoCaption = async () => {
    if (!hasMedia) {
      setNotification({ type: 'error', message: 'Import a video first' });
      return;
    }

    const videoClip = clips.find((c) => c.mediaType === 'video' || c.mediaType === 'audio');
    if (!videoClip) {
      setNotification({ type: 'error', message: 'No video or audio clip found' });
      return;
    }

    await transcribeFile(videoClip.path);
  };

  const handleCaptionClick = (start: number) => {
    setCurrentTime(start);
  };

  const handleEditCaption = (id: number, text: string) => {
    setEditingCaption(id);
    setEditText(text);
  };

  const handleSaveEdit = (id: number) => {
    const updatedSubtitles = subtitles.map(sub =>
      sub.index === id ? { ...sub, text: editText } : sub
    );
    setSubtitles(updatedSubtitles);
    setEditingCaption(null);
    setNotification({ type: 'success', message: 'Caption updated' });
  };

  const handleCancelEdit = () => {
    setEditingCaption(null);
    setEditText('');
  };

  const handleExportSRT = () => {
    if (!hasCaptions) {
      setNotification({ type: 'error', message: 'No captions to export' });
      return;
    }

    const formatSRTTime = (seconds: number): string => {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    };

    const srtContent = captions
      .map(
        (cap, i) =>
          `${i + 1}\n${formatSRTTime(cap.start)} --> ${formatSRTTime(cap.end)}\n${cap.text}\n`
      )
      .join('\n');

    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'captions.srt';
    a.click();
    URL.revokeObjectURL(url);
    setNotification({ type: 'success', message: 'Captions exported as SRT!' });
  };

  const handleClearCaptions = () => {
    clearTranscription();
    setSubtitles([]);
    setNotification({ type: 'success', message: 'Captions cleared' });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Generate Section */}
      {!hasCaptions && (
        <CollapsibleSection title="Generate" defaultOpen={true} storageKey="captions-generate">
          {!isTranscribing && (
            <div className="px-4">
              <button
                onClick={handleAutoCaption}
                disabled={!hasMedia}
                className="w-full py-3 bg-accent hover:bg-accent-hover disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Generate Captions
              </button>
              <p className="text-xs text-text-muted mt-2 text-center">
                {!hasMedia ? 'Import a video first' : 'AI-powered speech recognition'}
              </p>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Transcribing Progress */}
      {isTranscribing && (
        <div className="px-4 pb-4">
          <div className="bg-bg-surface rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="animate-spin h-5 w-5 border-2 border-accent border-t-transparent rounded-full" />
              <span className="text-sm font-medium text-text-primary">
                {transcriptionProgress?.status || 'Generating captions...'}
              </span>
            </div>
            {transcriptionProgress?.progress !== undefined && (
              <div className="w-full bg-bg-primary rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300 shadow-lg shadow-accent/50"
                  style={{ width: `${transcriptionProgress.progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subtitles Section */}
      {hasCaptions && !isTranscribing && (
        <CollapsibleSection title="Subtitles" defaultOpen={true} badge={captions.length} storageKey="captions-list">
          <div className="space-y-3 px-4">
            {/* Search */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search captions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-bg-surface border border-border-primary rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-bg-primary rounded"
                >
                  <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Captions List */}
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {filteredCaptions.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-xs">
                  No captions found for "{searchQuery}"
                </div>
              ) : (
                filteredCaptions.map((cap) => {
                  const isActive = activeCaption?.id === cap.id;
                  const isEditing = editingCaption === cap.id;
                  
                  return (
                    <div
                      key={cap.id}
                      className={`group rounded-lg border transition-all ${
                        isActive
                          ? 'bg-accent/10 border-accent/50 ring-1 ring-accent/30'
                          : 'bg-bg-surface border-transparent hover:border-border-primary hover:bg-bg-primary/50'
                      }`}
                    >
                      {isEditing ? (
                        <div className="p-2.5 space-y-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full px-2 py-1.5 bg-bg-elevated border border-border-primary rounded text-xs text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                            rows={3}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(cap.id)}
                              className="flex-1 px-2 py-1 bg-accent hover:bg-accent-hover text-white text-xs rounded font-medium"
                            >
                              Save
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="flex-1 px-2 py-1 bg-bg-surface hover:bg-bg-primary text-text-muted text-xs rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleCaptionClick(cap.start)}
                          className="w-full text-left p-2.5"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <span className="font-mono text-[10px] text-text-muted leading-none">
                              {Math.floor(cap.start / 60)}:{(cap.start % 60).toFixed(0).padStart(2, '0')}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditCaption(cap.id, cap.text);
                                }}
                                className="p-1 hover:bg-bg-elevated rounded"
                                title="Edit caption"
                              >
                                <svg className="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                            <span className="font-mono text-[10px] text-text-muted/60 leading-none ml-auto">
                              {Math.floor(cap.end / 60)}:{(cap.end % 60).toFixed(0).padStart(2, '0')}
                            </span>
                          </div>
                          <p className={`text-xs leading-relaxed ${
                            isActive ? 'text-accent font-medium' : 'text-text-primary'
                          }`}>
                            {cap.text}
                          </p>
                          {isActive && (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-accent font-medium">
                              <span className="flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-accent opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent"></span>
                              </span>
                              PLAYING
                            </div>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Export Section */}
      {hasCaptions && !isTranscribing && (
        <CollapsibleSection title="Export" defaultOpen={false} storageKey="captions-export">
          <div className="px-4 space-y-2">
            <button
              onClick={handleExportSRT}
              className="w-full px-3 py-2.5 bg-accent/10 hover:bg-accent/20 text-accent text-sm rounded-lg transition flex items-center justify-center gap-2 font-medium border border-accent/20"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export as SRT
            </button>
            <button
              onClick={handleClearCaptions}
              className="w-full px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-lg transition flex items-center justify-center gap-2 border border-red-500/20"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear All
            </button>
          </div>
        </CollapsibleSection>
      )}

      {!hasCaptions && !isTranscribing && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center py-8">
            <svg className="w-16 h-16 mx-auto mb-4 text-text-muted opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <p className="text-sm text-text-muted">No captions yet</p>
            <p className="text-xs text-text-muted/60 mt-2">Import a video and generate captions to get started</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default RightPanel;
