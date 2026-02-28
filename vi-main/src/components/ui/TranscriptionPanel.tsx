import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

const TranscriptionPanel = () => {
  const { 
    transcription, 
    isTranscribing, 
    transcriptionProgress,
    clearTranscription,
    setCurrentTime,
    setNotification,
  } = useProjectStore();

  const [showSegments, setShowSegments] = useState(true);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopyText = () => {
    if (transcription?.text) {
      navigator.clipboard.writeText(transcription.text);
      setNotification({ type: 'success', message: 'Transcription copied to clipboard!' });
    }
  };

  const handleExportText = () => {
    if (!transcription?.text) return;

    const blob = new Blob([transcription.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.txt';
    a.click();
    URL.revokeObjectURL(url);
    setNotification({ type: 'success', message: 'Transcription exported!' });
  };

  const handleExportSRT = () => {
    if (!transcription?.segments || transcription.segments.length === 0) {
      setNotification({ type: 'error', message: 'No timestamped segments available' });
      return;
    }

    // Generate SRT content
    const srtContent = transcription.segments
      .map((segment, index) => {
        const formatSRTTime = (seconds: number): string => {
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor((seconds % 3600) / 60);
          const secs = Math.floor(seconds % 60);
          const millis = Math.floor((seconds % 1) * 1000);
          return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
        };
        
        return `${index + 1}\n${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}\n${segment.text}\n`;
      })
      .join('\n');

    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.srt';
    a.click();
    URL.revokeObjectURL(url);
    setNotification({ type: 'success', message: 'SRT file exported!' });
  };

  const handleJumpToTime = (time: number) => {
    setCurrentTime(time);
    setNotification({ type: 'success', message: `Jumped to ${formatTime(time)}` });
  };

  // Auto-scroll to show progress when transcribing
  useEffect(() => {
    if (isTranscribing && textAreaRef.current) {
      textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
    }
  }, [transcriptionProgress, isTranscribing]);

  if (!transcription && !isTranscribing) {
    return null;
  }

  return (
    <div className="bg-bg-elevated border-l border-border-primary w-80 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border-primary">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-text-primary">Transcription</h3>
        </div>
        <button
          onClick={clearTranscription}
          disabled={isTranscribing}
          className="text-text-muted hover:text-text-primary p-1 transition disabled:opacity-50"
          title="Close transcription"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress indicator */}
      {isTranscribing && (
        <div className="p-3 bg-bg-surface border-b border-border-primary">
          <div className="flex items-center gap-2 mb-2">
            <div className="animate-spin h-4 w-4 border-2 border-accent border-t-transparent rounded-full"></div>
            <span className="text-xs text-text-primary font-medium">
              {transcriptionProgress?.status || 'Processing...'}
            </span>
          </div>
          {transcriptionProgress?.progress !== undefined && (
            <div className="w-full bg-bg-elevated rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${transcriptionProgress.progress}%` }}
              />
            </div>
          )}
          {transcriptionProgress?.clip && (
            <div className="text-xs text-text-muted mt-1">
              Clip {transcriptionProgress.clip}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {transcription && (
        <>
          {/* Actions */}
          <div className="p-3 border-b border-border-primary flex items-center gap-2">
            <button
              onClick={() => setShowSegments(!showSegments)}
              className="text-xs px-2 py-1 rounded bg-bg-surface hover:bg-bg-primary text-text-primary transition flex items-center gap-1"
              title="Toggle view"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {showSegments ? 'Segments' : 'Full Text'}
            </button>
            <button
              onClick={handleCopyText}
              className="text-xs px-2 py-1 rounded bg-bg-surface hover:bg-bg-primary text-text-primary transition flex items-center gap-1"
              title="Copy to clipboard"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </button>
            <button
              onClick={handleExportText}
              className="text-xs px-2 py-1 rounded bg-bg-surface hover:bg-bg-primary text-text-primary transition flex items-center gap-1"
              title="Export as text file"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              TXT
            </button>
            {transcription.segments.length > 0 && (
              <button
                onClick={handleExportSRT}
                className="text-xs px-2 py-1 rounded bg-bg-surface hover:bg-bg-primary text-text-primary transition flex items-center gap-1"
                title="Export as SRT subtitle file"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                SRT
              </button>
            )}
          </div>

          {/* Transcription content */}
          <div className="flex-1 overflow-y-auto p-3">
            {showSegments && transcription.segments.length > 0 ? (
              <div className="space-y-2">
                {transcription.segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="p-2 bg-bg-surface rounded hover:bg-bg-primary transition cursor-pointer group"
                    onClick={() => handleJumpToTime(segment.start)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-accent">
                        {formatTime(segment.start)}
                      </span>
                      <svg className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-sm text-text-primary leading-relaxed">
                      {segment.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                ref={textAreaRef}
                value={transcription.text}
                readOnly
                className="w-full h-full bg-bg-surface text-text-primary text-sm p-3 rounded border border-border-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="Transcription will appear here..."
              />
            )}
          </div>

          {/* Stats */}
          <div className="p-3 border-t border-border-primary bg-bg-surface">
            <div className="text-xs text-text-muted space-y-1">
              <div className="flex justify-between">
                <span>Words:</span>
                <span className="font-medium text-text-primary">
                  {transcription.text.split(/\s+/).filter(Boolean).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Characters:</span>
                <span className="font-medium text-text-primary">
                  {transcription.text.length}
                </span>
              </div>
              {transcription.segments.length > 0 && (
                <div className="flex justify-between">
                  <span>Segments:</span>
                  <span className="font-medium text-text-primary">
                    {transcription.segments.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TranscriptionPanel;
