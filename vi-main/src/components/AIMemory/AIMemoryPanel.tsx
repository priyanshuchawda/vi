import { useState } from 'react';
import { useAiMemoryStore } from '../../stores/useAiMemoryStore';
import { retryAnalysis } from '../../lib/aiMemoryService';
import type { MediaAnalysisEntry } from '../../types/aiMemory';

const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    analyzing: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-300 border-red-500/30',
};

const statusIcons: Record<string, string> = {
    pending: '',
    analyzing: '',
    completed: '',
    failed: '',
};

const mediaIcons: Record<string, string> = {
    video: '',
    audio: '',
    image: '',
    document: '',
};

function MemoryEntryCard({ entry }: { entry: MediaAnalysisEntry }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const removeEntry = useAiMemoryStore((s) => s.removeEntry);

    return (
        <div className="bg-bg-elevated rounded-lg border border-border-primary overflow-hidden transition-all hover:border-purple-500/30">
            {/* Header */}
            <div
                className="p-3 cursor-pointer flex items-start gap-3 min-w-0"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="text-lg flex-shrink-0">{mediaIcons[entry.mediaType]}</div>
                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-semibold text-text-primary truncate max-w-[150px]" title={entry.fileName}>
                            {entry.fileName}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold whitespace-nowrap ${statusColors[entry.status]}`}>
                            {statusIcons[entry.status]} {entry.status.toUpperCase()}
                        </span>
                    </div>
                    {entry.status === 'completed' && (
                        <p className="text-[11px] text-text-secondary line-clamp-2 break-words">{entry.summary}</p>
                    )}
                    {entry.status === 'analyzing' && (
                        <p className="text-[11px] text-purple-300 animate-pulse">AI is analyzing...</p>
                    )}
                    {entry.status === 'failed' && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[11px] text-red-400 truncate max-w-[120px]" title={entry.error}>
                                {entry.error || 'Unknown error'}
                            </p>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    retryAnalysis(entry.id);
                                }}
                                className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors whitespace-nowrap"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        removeEntry(entry.id);
                    }}
                    className="text-text-muted hover:text-red-400 transition-colors text-xs p-1 flex-shrink-0"
                    title="Remove from memory"
                >
                    
                </button>
            </div>

            {/* Expanded Details */}
            {isExpanded && entry.status === 'completed' && (
                <div className="px-3 pb-3 space-y-2 border-t border-border-primary pt-2 max-w-full overflow-hidden">
                    {/* Tags */}
                    {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {entry.tags.map((tag, i) => (
                                <span
                                    key={i}
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Full Analysis */}
                    <div>
                        <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Analysis</div>
                        <p className="text-[11px] text-text-secondary leading-relaxed break-words">{entry.analysis}</p>
                    </div>

                    {/* Visual Info */}
                    {entry.visualInfo && (
                        <div>
                            <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Visual Details</div>
                            <div className="space-y-0.5">
                                {entry.visualInfo.subjects && entry.visualInfo.subjects.length > 0 && (
                                    <p className="text-[11px] text-text-secondary break-words">
                                        <span className="text-text-muted">Subjects:</span> {entry.visualInfo.subjects.join(', ')}
                                    </p>
                                )}
                                {entry.visualInfo.style && (
                                    <p className="text-[11px] text-text-secondary break-words">
                                        <span className="text-text-muted">Style:</span> {entry.visualInfo.style}
                                    </p>
                                )}
                                {entry.visualInfo.dominantColors && entry.visualInfo.dominantColors.length > 0 && (
                                    <p className="text-[11px] text-text-secondary break-words">
                                        <span className="text-text-muted">Colors:</span> {entry.visualInfo.dominantColors.join(', ')}
                                    </p>
                                )}
                                {entry.visualInfo.quality && (
                                    <p className="text-[11px] text-text-secondary break-words">
                                        <span className="text-text-muted">Quality:</span> {entry.visualInfo.quality}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Audio Info */}
                    {entry.audioInfo && (
                        <div>
                            <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">Audio Details</div>
                            <div className="space-y-0.5">
                                <p className="text-[11px] text-text-secondary break-words">
                                    <span className="text-text-muted">Speech:</span> {entry.audioInfo.hasSpeech ? 'Yes' : 'No'}
                                    {entry.audioInfo.languages && entry.audioInfo.languages.length > 0 && ` (${entry.audioInfo.languages.join(', ')})`}
                                </p>
                                <p className="text-[11px] text-text-secondary break-words">
                                    <span className="text-text-muted">Music:</span> {entry.audioInfo.hasMusic ? 'Yes' : 'No'}
                                </p>
                                {entry.audioInfo.mood && (
                                    <p className="text-[11px] text-text-secondary break-words">
                                        <span className="text-text-muted">Mood:</span> {entry.audioInfo.mood}
                                    </p>
                                )}
                                {entry.audioInfo.transcriptSummary && (
                                    <p className="text-[11px] text-text-secondary break-words">
                                        <span className="text-text-muted">Transcript:</span> {entry.audioInfo.transcriptSummary}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Scenes */}
                    {entry.scenes && entry.scenes.length > 0 && (
                        <div>
                            <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                Scenes ({entry.scenes.length})
                            </div>
                            <div className="space-y-1">
                                {entry.scenes.slice(0, 5).map((scene, i) => (
                                    <div key={i} className="text-[11px] flex gap-2">
                                        <span className="text-purple-300 font-mono whitespace-nowrap flex-shrink-0">
                                            {scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s
                                        </span>
                                        <span className="text-text-secondary break-words flex-1 min-w-0">{scene.description}</span>
                                    </div>
                                ))}
                                {entry.scenes.length > 5 && (
                                    <p className="text-[11px] text-text-muted">...and {entry.scenes.length - 5} more scenes</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Meta */}
                    <div className="text-[10px] text-text-muted pt-1 border-t border-border-primary break-words">
                        Analyzed: {new Date(entry.updatedAt).toLocaleString()}
                        {entry.duration && ` • Duration: ${entry.duration.toFixed(1)}s`}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AIMemoryPanel() {
    const { entries, isAnalyzing, analyzingCount, clearMemory } = useAiMemoryStore();
    const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');

    const filteredEntries = entries.filter((e) => {
        if (filterStatus === 'all') return true;
        if (filterStatus === 'pending') return e.status === 'pending' || e.status === 'analyzing';
        return e.status === filterStatus;
    });

    const completedCount = entries.filter((e) => e.status === 'completed').length;
    const pendingCount = entries.filter((e) => e.status === 'pending' || e.status === 'analyzing').length;
    const failedCount = entries.filter((e) => e.status === 'failed').length;

    return (
        <div className="flex-1 flex flex-col h-full bg-bg-secondary overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-border-primary flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <span className="text-lg"></span>
                        <h3 className="text-sm font-bold text-text-primary">AI Memory</h3>
                    </div>
                    {isAnalyzing && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20">
                            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                            <span className="text-[10px] font-medium text-purple-300">
                                Analyzing {analyzingCount}...
                            </span>
                        </div>
                    )}
                </div>
                <p className="text-xs text-text-muted mb-3">
                    AI analyzes your media. Memory is saved with your project.
                </p>

                {/* Stats Bar */}
                <div className="grid grid-cols-4 gap-2 text-[10px] font-bold">
                    <button
                        onClick={() => setFilterStatus('all')}
                        className={`px-2 py-1.5 rounded transition-all uppercase tracking-wide ${filterStatus === 'all'
                            ? 'bg-accent text-white'
                            : 'bg-bg-elevated text-text-muted hover:text-text-primary'
                            }`}
                    >
                        All ({entries.length})
                    </button>
                    <button
                        onClick={() => setFilterStatus('completed')}
                        className={`px-2 py-1.5 rounded transition-all uppercase tracking-wide ${filterStatus === 'completed'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-bg-elevated text-text-muted hover:text-text-primary'
                            }`}
                    >
                         {completedCount}
                    </button>
                    <button
                        onClick={() => setFilterStatus('pending')}
                        className={`px-2 py-1.5 rounded transition-all uppercase tracking-wide ${filterStatus === 'pending'
                            ? 'bg-purple-600 text-white'
                            : 'bg-bg-elevated text-text-muted hover:text-text-primary'
                            }`}
                    >
                         {pendingCount}
                    </button>
                    <button
                        onClick={() => setFilterStatus('failed')}
                        className={`px-2 py-1.5 rounded transition-all uppercase tracking-wide ${filterStatus === 'failed'
                            ? 'bg-red-600 text-white'
                            : 'bg-bg-elevated text-text-muted hover:text-text-primary'
                            }`}
                    >
                         {failedCount}
                    </button>
                </div>
            </div>

            {/* Entry List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
                {filteredEntries.length === 0 ? (
                    <div className="text-center text-text-muted text-sm mt-10">
                        <div className="text-3xl mb-2"></div>
                        <p className="mb-1">
                            {entries.length === 0
                                ? 'No media analyzed yet'
                                : `No ${filterStatus} entries`}
                        </p>
                        <p className="text-xs text-text-muted/60">
                            {entries.length === 0
                                ? 'Import media files and AI will automatically analyze them'
                                : 'Try a different filter'}
                        </p>
                    </div>
                ) : (
                    filteredEntries.map((entry) => (
                        <MemoryEntryCard key={entry.id} entry={entry} />
                    ))
                )}
            </div>

            {/* Footer */}
            {entries.length > 0 && (
                <div className="p-3 border-t border-border-primary flex-shrink-0 bg-bg-secondary">
                    <button
                        onClick={clearMemory}
                        className="w-full text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 py-2 rounded transition-colors font-medium"
                    >
                         Clear All Memory
                    </button>
                    <p className="text-[10px] text-text-muted/60 text-center mt-2">
                        Memory will be saved when you save the project
                    </p>
                </div>
            )}
        </div>
    );
}
