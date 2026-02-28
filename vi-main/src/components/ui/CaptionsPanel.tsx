import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

interface Caption {
    id: number;
    start: number;
    end: number;
    text: string;
}

// Format time as mm:ss
const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const CaptionsPanel = () => {
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

    const [isOpen, setIsOpen] = useState(false);
    const [captionsEnabled, setCaptionsEnabled] = useState(true);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');
    const editRef = useRef<HTMLInputElement>(null);

    // Convert transcription segments to captions format
    const captions: Caption[] = transcription?.segments?.map((seg) => ({
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

    const hasMedia = clips.length > 0;
    const hasCaptions = captions.length > 0;

    // Find active caption based on current time
    const activeCaption = captions.find(
        (cap) => currentTime >= cap.start && currentTime <= cap.end
    );

    const handleAutoCaption = async () => {
        if (!hasMedia) {
            setNotification({ type: 'error', message: 'Import a video first' });
            return;
        }

        // Trigger transcription for the first video clip
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

    const handleEditStart = (caption: Caption) => {
        setEditingId(caption.id);
        setEditText(caption.text);
    };

    const handleEditSave = () => {
        if (editingId === null) return;

        // Update the caption text
        const updatedCaptions = captions.map((cap) =>
            cap.id === editingId ? { ...cap, text: editText } : cap
        );

        // Convert back to subtitles format and save
        setSubtitles(
            updatedCaptions.map((cap, idx) => ({
                index: idx + 1,
                startTime: cap.start,
                endTime: cap.end,
                text: cap.text,
            }))
        );

        setEditingId(null);
        setEditText('');
    };

    const handleEditCancel = () => {
        setEditingId(null);
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

    // Focus edit input when editing starts
    useEffect(() => {
        if (editingId !== null && editRef.current) {
            editRef.current.focus();
            editRef.current.select();
        }
    }, [editingId]);

    // Toggle button for the sidebar
    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed right-4 top-1/2 -translate-y-1/2 bg-accent hover:bg-accent-hover text-bg-primary px-3 py-4 rounded-l-lg shadow-lg transition-all flex flex-col items-center gap-1 z-50"
                title="Open Captions Panel"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <span className="text-[10px] font-bold tracking-wide" style={{ writingMode: 'vertical-rl' }}>
                    CC
                </span>
            </button>
        );
    }

    return (
        <div className="w-80 bg-bg-elevated border-l border-border-primary flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-border-primary">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                        <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                        Captions
                    </h2>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-1 text-text-muted hover:text-text-primary transition"
                        title="Close"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Auto Caption Button */}
                {!hasCaptions && !isTranscribing && (
                    <button
                        onClick={handleAutoCaption}
                        disabled={!hasMedia}
                        className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition flex items-center justify-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        Generate Auto Captions
                    </button>
                )}

                {/* Transcribing Progress */}
                {isTranscribing && (
                    <div className="bg-bg-surface rounded-lg p-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full" />
                            <span className="text-sm font-medium text-text-primary">
                                {transcriptionProgress?.status || 'Generating captions...'}
                            </span>
                        </div>
                        {transcriptionProgress?.progress !== undefined && (
                            <div className="w-full bg-bg-primary rounded-full h-2 overflow-hidden">
                                <div
                                    className="h-full bg-purple-500 transition-all duration-300"
                                    style={{ width: `${transcriptionProgress.progress}%` }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Caption Controls */}
                {hasCaptions && !isTranscribing && (
                    <div className="space-y-3">
                        {/* Toggle Captions */}
                        <div className="flex items-center justify-between p-3 bg-bg-surface rounded-lg">
                            <span className="text-sm font-medium text-text-primary">Show captions in video</span>
                            <button
                                onClick={() => setCaptionsEnabled(!captionsEnabled)}
                                className={`relative w-12 h-6 rounded-full transition ${captionsEnabled ? 'bg-purple-600' : 'bg-gray-600'
                                    }`}
                            >
                                <span
                                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${captionsEnabled ? 'translate-x-7' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2">
                            <button
                                onClick={handleExportSRT}
                                className="flex-1 py-2 bg-bg-surface hover:bg-bg-primary text-text-primary text-sm font-medium rounded-lg border border-border-primary hover:border-accent transition flex items-center justify-center gap-1"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download SRT
                            </button>
                            <button
                                onClick={handleClearCaptions}
                                className="py-2 px-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium rounded-lg border border-red-500/30 transition"
                                title="Clear all captions"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Captions List */}
            <div className="flex-1 overflow-y-auto">
                {hasCaptions ? (
                    <div className="p-2 space-y-1">
                        {captions.map((caption) => (
                            <div
                                key={caption.id}
                                className={`p-3 rounded-lg cursor-pointer transition group ${activeCaption?.id === caption.id
                                    ? 'bg-purple-600/20 border border-purple-500/50'
                                    : 'bg-bg-surface hover:bg-bg-primary border border-transparent'
                                    }`}
                                onClick={() => handleCaptionClick(caption.start)}
                            >
                                {editingId === caption.id ? (
                                    <div className="space-y-2">
                                        <input
                                            ref={editRef}
                                            type="text"
                                            value={editText}
                                            onChange={(e) => setEditText(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleEditSave();
                                                if (e.key === 'Escape') handleEditCancel();
                                            }}
                                            className="w-full px-2 py-1 bg-bg-primary text-text-primary text-sm rounded border border-accent focus:outline-none"
                                        />
                                        <div className="flex gap-1">
                                            <button
                                                onClick={handleEditSave}
                                                className="text-xs px-2 py-1 bg-accent text-bg-primary rounded font-medium"
                                            >
                                                Save
                                            </button>
                                            <button
                                                onClick={handleEditCancel}
                                                className="text-xs px-2 py-1 bg-bg-primary text-text-muted rounded"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-mono text-purple-400">
                                                {formatTime(caption.start)}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleEditStart(caption);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-accent transition"
                                                title="Edit caption"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                        </div>
                                        <p className="text-sm text-text-primary leading-relaxed">
                                            {caption.text}
                                        </p>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                ) : !isTranscribing ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6">
                        <svg className="w-16 h-16 text-text-muted/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                        <p className="text-sm text-text-muted mb-2">No captions yet</p>
                        <p className="text-xs text-text-muted/70">
                            Click "Generate Auto Captions" to automatically transcribe your video
                        </p>
                    </div>
                ) : null}
            </div>

            {/* Stats Footer */}
            {hasCaptions && (
                <div className="p-3 border-t border-border-primary bg-bg-surface">
                    <div className="flex justify-between text-xs text-text-muted">
                        <span>{captions.length} captions</span>
                        <span>
                            {formatTime(captions[captions.length - 1]?.end || 0)} total
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CaptionsPanel;
