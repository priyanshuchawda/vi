import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import type { TranscriptionWord } from '../../types/electron';
import TranscriptEditSettings from './TranscriptEditSettings';

interface EditableWord extends TranscriptionWord {
  id: string;
  deleted: boolean;
}

const TranscriptEditor = () => {
  const { transcription, currentTime, setCurrentTime, applyTranscriptEdits, setNotification } =
    useProjectStore();

  const [words, setWords] = useState<EditableWord[]>([]);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize words from transcription
  useEffect(() => {
    if (transcription?.words) {
      const editableWords: EditableWord[] = transcription.words.map((w, i) => ({
        ...w,
        id: `word-${i}-${w.start}`,
        deleted: false,
      }));
      setWords(editableWords);
      setSelectedWords(new Set());
    }
  }, [transcription]);

  // Auto-scroll to current word during playback
  useEffect(() => {
    const activeWord = words.find(
      (w) => !w.deleted && currentTime >= w.start && currentTime <= w.end,
    );

    if (activeWord && containerRef.current) {
      const wordElement = document.getElementById(activeWord.id);
      if (wordElement) {
        wordElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime, words]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentDeletedCount = words.filter((w) => w.deleted).length;

      // Backspace/Delete - Delete selected words
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedWords.size > 0) {
        e.preventDefault();
        const updatedWords = words.map((w) =>
          selectedWords.has(w.id) ? { ...w, deleted: true } : w,
        );
        setWords(updatedWords);
        setSelectedWords(new Set());
        setNotification({
          type: 'success',
          message: `Marked ${selectedWords.size} word(s) for deletion`,
        });
      }
      // Ctrl+Z - Undo all deletions
      else if (e.ctrlKey && e.key === 'z' && currentDeletedCount > 0) {
        e.preventDefault();
        setWords(words.map((w) => ({ ...w, deleted: false })));
        setSelectedWords(new Set());
        setNotification({ type: 'success', message: 'Undone all deletions' });
      }
      // Ctrl+A - Select all non-deleted words
      else if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        const allNonDeleted = words.filter((w) => !w.deleted).map((w) => w.id);
        setSelectedWords(new Set(allNonDeleted));
      }
      // Escape - Clear selection
      else if (e.key === 'Escape') {
        setSelectedWords(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWords, words, setNotification]);

  const handleWordClick = (wordId: string, event: React.MouseEvent) => {
    const word = words.find((w) => w.id === wordId);
    if (!word) return;

    // Jump to word time
    if (!event.ctrlKey && !event.shiftKey) {
      setCurrentTime(word.start);
    }

    // Multi-select with Ctrl/Shift
    if (event.ctrlKey) {
      setSelectedWords((prev) => {
        const next = new Set(prev);
        if (next.has(wordId)) {
          next.delete(wordId);
        } else {
          next.add(wordId);
        }
        return next;
      });
    } else if (event.shiftKey && selectedWords.size > 0) {
      // Range select
      const lastSelected = Array.from(selectedWords).pop();
      const lastIndex = words.findIndex((w) => w.id === lastSelected);
      const currentIndex = words.findIndex((w) => w.id === wordId);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const range = words.slice(start, end + 1).map((w) => w.id);
        setSelectedWords((prev) => new Set([...prev, ...range]));
      }
    } else {
      setSelectedWords(new Set([wordId]));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedWords.size === 0) {
      setNotification({ type: 'error', message: 'No words selected' });
      return;
    }

    const updatedWords = words.map((w) => (selectedWords.has(w.id) ? { ...w, deleted: true } : w));

    setWords(updatedWords);
    setSelectedWords(new Set());
    setNotification({
      type: 'success',
      message: `Marked ${selectedWords.size} word(s) for deletion`,
    });
  };

  const handleUndo = () => {
    setWords(words.map((w) => ({ ...w, deleted: false })));
    setSelectedWords(new Set());
    setNotification({ type: 'success', message: 'Undone all deletions' });
  };

  const handleApplyEdits = async () => {
    // Find deletion ranges
    const deletionRanges: Array<{ start: number; end: number }> = [];
    let rangeStart: number | null = null;
    let rangeEnd: number | null = null;

    for (const word of words) {
      if (word.deleted) {
        if (rangeStart === null) {
          rangeStart = word.start;
          rangeEnd = word.end;
        } else {
          rangeEnd = word.end;
        }
      } else {
        if (rangeStart !== null && rangeEnd !== null) {
          // Add padding (50ms on each side)
          deletionRanges.push({
            start: Math.max(0, rangeStart - 0.05),
            end: rangeEnd + 0.05,
          });
          rangeStart = null;
          rangeEnd = null;
        }
      }
    }

    // Push final range
    if (rangeStart !== null && rangeEnd !== null) {
      deletionRanges.push({
        start: Math.max(0, rangeStart - 0.05),
        end: rangeEnd + 0.05,
      });
    }

    if (deletionRanges.length === 0) {
      setNotification({ type: 'error', message: 'No words marked for deletion' });
      return;
    }

    // Apply edits to timeline
    await applyTranscriptEdits(deletionRanges);

    // Update words to reflect applied changes
    setWords(words.filter((w) => !w.deleted));
    setNotification({
      type: 'success',
      message: `Applied ${deletionRanges.length} cut(s) to timeline`,
    });
  };

  const handleExportTranscript = () => {
    const activeWords = words.filter((w) => !w.deleted);
    const transcript = activeWords.map((w) => w.word).join(' ');

    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'edited-transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
    setNotification({ type: 'success', message: 'Transcript exported!' });
  };

  if (!transcription?.words || words.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm">Transcribe a video to edit via transcript</p>
        </div>
      </div>
    );
  }

  const deletedCount = words.filter((w) => w.deleted).length;
  const activeWord = words.find(
    (w) => !w.deleted && currentTime >= w.start && currentTime <= w.end,
  );

  // Calculate statistics
  const deletedDuration = words
    .filter((w) => w.deleted)
    .reduce((acc, w) => acc + (w.end - w.start), 0);
  const cutsCount = (() => {
    let count = 0;
    let inDeletedRange = false;
    for (const word of words) {
      if (word.deleted && !inDeletedRange) {
        count++;
        inDeletedRange = true;
      } else if (!word.deleted) {
        inDeletedRange = false;
      }
    }
    return count;
  })();

  return (
    <div className="flex-1 flex flex-col bg-bg-elevated h-full">
      {/* Settings Modal */}
      <TranscriptEditSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {/* Header */}
      <div className="px-4 py-3 border-b border-border-primary">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
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
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <h3 className="text-sm font-semibold text-text-primary">Text Editor</h3>
          </div>
          <div className="text-xs text-text-muted flex items-center gap-3">
            {selectedWords.size > 0 && (
              <span className="text-blue-400">{selectedWords.size} selected</span>
            )}
            {deletedCount > 0 && <span className="text-red-400">{deletedCount} deleted</span>}
            <span>
              {words.length - deletedCount} / {words.length} words
            </span>
          </div>
        </div>
      </div>

      {/* Statistics Bar */}
      {deletedCount > 0 && (
        <div className="px-4 py-2.5 bg-accent/5 border-b border-accent/20 flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <span className="text-text-primary font-medium">{deletedCount} words marked</span>
          </div>
          <div className="w-px h-4 bg-border-primary"></div>
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-orange-400"
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
            <span className="text-text-primary font-medium">
              ~{deletedDuration.toFixed(1)}s removed
            </span>
          </div>
          <div className="w-px h-4 bg-border-primary"></div>
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
              />
            </svg>
            <span className="text-text-primary font-medium">
              {cutsCount} cut{cutsCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex-1"></div>
          <span className="text-text-muted">Ready to apply</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="px-4 py-2.5 bg-bg-surface border-b border-border-primary flex items-center gap-2 flex-wrap">
        <button
          onClick={handleDeleteSelected}
          disabled={selectedWords.size === 0}
          className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded border border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium flex items-center gap-1.5"
          title="Delete selected words (Backspace)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          Delete {selectedWords.size > 0 ? `(${selectedWords.size})` : ''}
        </button>

        <button
          onClick={handleUndo}
          disabled={deletedCount === 0}
          className="px-3 py-1.5 text-xs bg-bg-elevated hover:bg-bg-primary text-text-primary rounded border border-border-primary disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5"
          title="Undo all deletions (Ctrl+Z)"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
          Undo All
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setShowSettings(true)}
          className="px-3 py-1.5 text-xs bg-bg-elevated hover:bg-accent/10 hover:text-accent hover:border-accent/30 text-text-primary rounded border border-border-primary transition flex items-center gap-1.5"
          title="Configure professional editing settings"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        </button>

        <button
          onClick={handleExportTranscript}
          className="px-3 py-1.5 text-xs bg-bg-elevated hover:bg-accent/10 hover:text-accent hover:border-accent/30 text-text-primary rounded border border-border-primary transition flex items-center gap-1.5"
          title="Export transcript as text file"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Export
        </button>

        <button
          onClick={handleApplyEdits}
          disabled={deletedCount === 0}
          className="px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-accent/20 flex items-center gap-1.5"
          title="Cut video at deleted words"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Apply to Timeline
        </button>
      </div>

      {/* Legend */}
      <div className="px-4 py-2.5 bg-bg-primary/50 border-b border-border-primary text-[11px] text-text-muted flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-accent/20 border border-accent/50"></div>
          <span>Playing</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500/20 border border-blue-500/50"></div>
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500/20 line-through"></div>
          <span>Deleted</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span>Click: Jump</span>
          <span>•</span>
          <kbd>Ctrl</kbd>+Click: Select
          <span>•</span>
          <kbd>Shift</kbd>+Click: Range
        </div>
      </div>

      {/* Transcript Content */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
        <div className="max-w-4xl mx-auto leading-relaxed text-base">
          {words.map((word) => {
            const isActive = activeWord?.id === word.id;
            const isSelected = selectedWords.has(word.id);
            const isDeleted = word.deleted;

            return (
              <span
                key={word.id}
                id={word.id}
                onClick={(e) => !isDeleted && handleWordClick(word.id, e)}
                className={`
                  inline-block px-1.5 py-1 mx-0.5 my-0.5 rounded cursor-pointer transition-all font-medium
                  ${
                    isDeleted
                      ? 'bg-red-500/20 text-red-400 line-through opacity-50 cursor-not-allowed'
                      : isActive
                        ? 'bg-accent/30 text-accent font-bold ring-2 ring-accent scale-105 shadow-lg shadow-accent/20'
                        : isSelected
                          ? 'bg-blue-500/30 text-blue-300 ring-2 ring-blue-500'
                          : 'bg-bg-surface hover:bg-bg-primary text-text-primary hover:ring-1 hover:ring-border-primary'
                  }
                `}
                title={`${word.start.toFixed(2)}s - ${word.end.toFixed(2)}s${word.conf ? ` (${(word.conf * 100).toFixed(0)}% confidence)` : ''}`}
              >
                {word.word}
              </span>
            );
          })}
        </div>
      </div>

      {/* Info Footer */}
      {deletedCount > 0 && (
        <div className="px-4 py-2.5 bg-orange-500/10 border-t border-orange-500/30 text-xs text-orange-300 flex items-center gap-2">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            <strong>
              {deletedCount} word{deletedCount !== 1 ? 's' : ''}
            </strong>{' '}
            marked for deletion. Click <strong>"Apply to Timeline"</strong> to cut the video at
            these points.
          </span>
        </div>
      )}
    </div>
  );
};

export default TranscriptEditor;
