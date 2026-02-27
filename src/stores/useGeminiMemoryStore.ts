import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
    MediaAnalysisEntry,
    MediaAnalysisStatus,
    GeminiMemoryContext,
} from '../types/geminiMemory';

/**
 * Gemini Memory Store
 * 
 * Memory is now project-specific and temporary:
 * - Exists in-memory while working on a project
 * - Saved ONLY when the user saves the project (embedded in project file)
 * - Cleared when creating new project or closing without saving
 * - No automatic persistence to disk
 */

interface GeminiMemoryStore {
    /** All media analysis entries */
    entries: MediaAnalysisEntry[];
    /** Whether background analysis is currently running */
    isAnalyzing: boolean;
    /** Number of files currently being analyzed */
    analyzingCount: number;
    /** Whether memory has been loaded from disk */
    isLoaded: boolean;
    /** Path to the memory directory on disk */
    memoryDir: string;
    /** Current project ID for project-specific memory */
    currentProjectId: string | null;

    // Actions
    addEntry: (entry: Omit<MediaAnalysisEntry, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'analysis' | 'tags' | 'summary'>) => string;
    updateEntry: (id: string, updates: Partial<MediaAnalysisEntry>) => void;
    updateStatus: (id: string, status: MediaAnalysisStatus, error?: string) => void;
    updateAnalysis: (id: string, analysis: string, tags: string[], summary: string, extras?: Partial<MediaAnalysisEntry>) => void;
    removeEntry: (id: string) => void;
    getEntryByFilePath: (filePath: string) => MediaAnalysisEntry | undefined;
    getEntryByClipId: (clipId: string) => MediaAnalysisEntry | undefined;
    getCompletedEntries: () => MediaAnalysisEntry[];
    getPendingEntries: () => MediaAnalysisEntry[];
    getMemoryContext: () => GeminiMemoryContext;
    getMemoryContextString: () => string;
    setAnalyzing: (isAnalyzing: boolean) => void;
    setAnalyzingCount: (count: number) => void;
    clearMemory: () => void;
    linkClipId: (entryId: string, clipId: string) => void;
    // Memory management
    syncWithProject: (clipIds: string[]) => void;
    removeEntriesNotInProject: (clipIds: string[]) => void;
    // Export/import for project save/load
    exportMemory: () => MediaAnalysisEntry[];
    importMemory: (entries: MediaAnalysisEntry[]) => void;
}

// Memory is no longer auto-saved - it's saved with the project file

export const useGeminiMemoryStore = create<GeminiMemoryStore>()(
    (set, get) => ({
        entries: [],
        isAnalyzing: false,
        analyzingCount: 0,
        isLoaded: false,
        memoryDir: '',
        currentProjectId: null,

        addEntry: (entry) => {
            const id = uuidv4();
            const now = Date.now();
            const newEntry: MediaAnalysisEntry = {
                ...entry,
                id,
                status: 'pending',
                analysis: '',
                tags: [],
                summary: '',
                createdAt: now,
                updatedAt: now,
            };
            set((state) => ({
                entries: [...state.entries, newEntry],
            }));
            return id;
        },

        updateEntry: (id, updates) => {
            set((state) => ({
                entries: state.entries.map((e) =>
                    e.id === id ? { ...e, ...updates, updatedAt: Date.now() } : e
                ),
            }));
        },

        updateStatus: (id, status, error) => {
            set((state) => ({
                entries: state.entries.map((e) =>
                    e.id === id ? { ...e, status, error, updatedAt: Date.now() } : e
                ),
            }));
        },

        updateAnalysis: (id, analysis, tags, summary, extras) => {
            set((state) => ({
                entries: state.entries.map((e) =>
                    e.id === id
                        ? {
                            ...e,
                            analysis,
                            tags,
                            summary,
                            status: 'completed' as const,
                            updatedAt: Date.now(),
                            ...extras,
                        }
                        : e
                ),
            }));

            // Note: Memory is saved only when user saves the project
            const entry = get().entries.find((e) => e.id === id);
            if (entry) {
                console.log(`[Memory Store] ✅ Analysis completed for "${entry.fileName}" (will be saved with project)`);
            }
        },

        removeEntry: (id) => {
            set((state) => ({
                entries: state.entries.filter((e) => e.id !== id),
            }));
        },

        getEntryByFilePath: (filePath) => {
            return get().entries.find((e) => e.filePath === filePath);
        },

        getEntryByClipId: (clipId) => {
            return get().entries.find((e) => e.clipId === clipId);
        },

        getCompletedEntries: () => {
            return get().entries.filter((e) => e.status === 'completed');
        },

        getPendingEntries: () => {
            return get().entries.filter(
                (e) => e.status === 'pending' || e.status === 'analyzing'
            );
        },

        getMemoryContext: () => {
            const entries = get().entries;
            const completed = entries.filter((e) => e.status === 'completed');

            const videoCount = completed.filter((e) => e.mediaType === 'video').length;
            const audioCount = completed.filter((e) => e.mediaType === 'audio').length;
            const imageCount = completed.filter((e) => e.mediaType === 'image').length;

            let projectSummary = `Project contains ${completed.length} analyzed media files`;
            if (videoCount > 0) projectSummary += `, ${videoCount} video(s)`;
            if (audioCount > 0) projectSummary += `, ${audioCount} audio file(s)`;
            if (imageCount > 0) projectSummary += `, ${imageCount} image(s)`;
            projectSummary += '.';

            return {
                totalFiles: completed.length,
                projectSummary,
                entries: completed,
            };
        },

        getMemoryContextString: () => {
            const context = get().getMemoryContext();
            if (context.totalFiles === 0) return '';

            let contextStr = `\n\n=== GEMINI MEDIA MEMORY ===\n`;
            contextStr += `${context.projectSummary}\n\n`;

            for (const entry of context.entries) {
                contextStr += `📁 File: "${entry.fileName}" (${entry.mediaType})\n`;
                if (entry.duration) contextStr += `   Duration: ${entry.duration.toFixed(1)}s\n`;
                contextStr += `   Summary: ${entry.summary}\n`;
                if (entry.tags.length > 0) contextStr += `   Tags: ${entry.tags.join(', ')}\n`;

                if (entry.visualInfo) {
                    if (entry.visualInfo.subjects && entry.visualInfo.subjects.length > 0) {
                        contextStr += `   Subjects: ${entry.visualInfo.subjects.join(', ')}\n`;
                    }
                    if (entry.visualInfo.style) {
                        contextStr += `   Visual Style: ${entry.visualInfo.style}\n`;
                    }
                }

                if (entry.audioInfo) {
                    if (entry.audioInfo.hasSpeech) {
                        contextStr += `   Has Speech: Yes`;
                        if (entry.audioInfo.languages && entry.audioInfo.languages.length > 0) {
                            contextStr += ` (${entry.audioInfo.languages.join(', ')})`;
                        }
                        contextStr += '\n';
                    }
                    if (entry.audioInfo.hasMusic) contextStr += `   Has Music: Yes\n`;
                    if (entry.audioInfo.mood) contextStr += `   Audio Mood: ${entry.audioInfo.mood}\n`;
                    if (entry.audioInfo.transcriptSummary) {
                        contextStr += `   Transcript Summary: ${entry.audioInfo.transcriptSummary}\n`;
                    }
                }

                if (entry.scenes && entry.scenes.length > 0) {
                    contextStr += `   Scenes:\n`;
                    for (const scene of entry.scenes.slice(0, 5)) {
                        contextStr += `     - [${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s] ${scene.description}\n`;
                    }
                    if (entry.scenes.length > 5) {
                        contextStr += `     - ... and ${entry.scenes.length - 5} more scenes\n`;
                    }
                }

                contextStr += '\n';
            }

            contextStr += `Use this context to provide personalized, context-aware assistance. You already know what media the user has imported.\n`;
            contextStr += `===========================`;

            return contextStr;
        },

        setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
        setAnalyzingCount: (count) => set({ analyzingCount: count }),

        clearMemory: () => {
            set({
                entries: [],
                isAnalyzing: false,
                analyzingCount: 0,
            });
            console.log('[Memory Store] 🧹 Memory cleared (project not saved)');
        },

        clearPendingEntries: () => {
            set((state) => ({
                entries: state.entries.filter((e) => e.status !== 'pending' && e.status !== 'analyzing'),
            }));
        },

        linkClipId: (entryId, clipId) => {
            set((state) => ({
                entries: state.entries.map((e) =>
                    e.id === entryId ? { ...e, clipId, updatedAt: Date.now() } : e
                ),
            }));
        },

        // Export memory for project save
        exportMemory: () => {
            return get().entries;
        },

        // Import memory from project load
        importMemory: (entries: MediaAnalysisEntry[]) => {
            set({
                entries,
                isLoaded: true,
            });
            console.log(`[Memory Store] ✅ Imported ${entries.length} entries from project file`);
        },

        // Sync memory with current project state
        syncWithProject: (clipIds: string[]) => {
            const currentEntries = get().entries;
            
            // If no clips in project, clear all memory
            if (clipIds.length === 0) {
                if (currentEntries.length > 0) {
                    console.log('[Memory Store] 🧹 No clips in project - clearing memory');
                    set({ entries: [] });
                }
                return;
            }
            
            // Remove entries that don't have corresponding clips
            const validEntries = currentEntries.filter(entry => {
                // Keep entries that either have a clipId in the project, or no clipId yet (pending analysis)
                return !entry.clipId || clipIds.includes(entry.clipId);
            });
            
            if (validEntries.length !== currentEntries.length) {
                console.log(`[Memory Store] 🧹 Removed ${currentEntries.length - validEntries.length} orphaned entries`);
                set({ entries: validEntries });
            }
        },

        // Remove entries that are not linked to current project clips
        removeEntriesNotInProject: (clipIds: string[]) => {
            set((state) => ({
                entries: state.entries.filter(entry => {
                    // Keep entries that don't have a clipId (not yet linked) or have a valid clipId
                    return !entry.clipId || clipIds.includes(entry.clipId);
                }),
            }));
        },
    })
);

// Memory is now loaded from project file, not auto-loaded on startup

