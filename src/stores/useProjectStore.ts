import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useAiMemoryStore } from './useAiMemoryStore';
import {
  splitClipAtTime,
  validateSplitPosition,
} from '../lib/clipOperations';
import type { ClipSegment } from '../lib/clipOperations';
import type { SubtitleEntry } from '../lib/srtParser';
import type { TranscriptionResult } from '../types/electron';
import { srtTimeToSeconds } from '../lib/captioningService';

export interface TextProperties {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor?: string;
  position: 'top' | 'center' | 'bottom' | 'custom';
  x?: number; // Custom X position (percentage)
  y?: number; // Custom Y position (percentage)
  align: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  outline?: boolean;
  outlineColor?: string;
}

export interface Clip {
  id: string;
  path: string;
  name: string;
  duration: number;
  sourceDuration: number;
  start: number;
  end: number;
  startTime: number; // Position in timeline where clip starts (in seconds)
  thumbnail?: string;
  waveform?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'text';
  trackIndex?: number; // 0-9 = video tracks, 10+ = audio tracks (auto-assigned if not provided)
  segments?: Array<{
    sourcePath: string;
    sourceStart: number;
    sourceEnd: number;
    duration: number;
  }>;
  isMerged?: boolean;
  trackId?: string;
  locked?: boolean;
  volume?: number; // 0-1, default 1
  muted?: boolean;
  textProperties?: TextProperties;
  fadeIn?: number; // Audio fade in duration in seconds
  fadeOut?: number; // Audio fade out duration in seconds
  speed?: number; // Playback speed multiplier (default 1.0, range 0.25–8.0)
  effects?: {
    brightness?: number; // -1 to 1 (0 = no change)
    contrast?: number;   // 0 to 3  (1 = no change)
    saturation?: number; // 0 to 3  (1 = no change)
    gamma?: number;      // 0.1 to 10 (1 = no change)
  };
}

export interface Notification {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export type ExportFormat = 'mp4' | 'mov' | 'avi' | 'webm';
export type ExportResolution = '1920x1080' | '1280x720' | '854x480' | 'original';
export type SidebarTab = 'project' | 'media' | 'text' | 'settings' | 'memory';

interface HistoryState {
  clips: Clip[];
  activeClipId: string | null;
  selectedClipIds: string[];
  currentTime: number;
}

interface ProjectState {
  clips: Clip[];
  activeClipId: string | null;
  selectedClipIds: string[];
  currentTime: number;
  isPlaying: boolean;
  notification: Notification | null;
  copiedClips: Clip[];
  projectPath: string | null;
  projectId: string | null; // Unique ID for project-specific memory storage
  history: HistoryState[];
  historyIndex: number;
  exportFormat: ExportFormat;
  exportResolution: ExportResolution;
  snapToGrid: boolean;
  gridSize: number; // in seconds
  subtitles: SubtitleEntry[];
  subtitleStyle: {
    fontSize: number;
    fontFamily: string;
    color: string;
    backgroundColor: string;
    position: 'top' | 'bottom';
    displayMode: 'instant' | 'progressive'; // New: control how subtitles appear
  };
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // in seconds
  lastSaved: number | null; // timestamp
  hasUnsavedChanges: boolean;
  transcription: TranscriptionResult | null;
  isTranscribing: boolean;
  transcriptionProgress: { status: string; progress?: number; clip?: number } | null;
  transcriptEditSettings: {
    cutPadding: number; // Padding in seconds before/after cuts (default: 0.05)
    mergeTolerance: number; // Max gap to merge cuts in seconds (default: 0.3)
    crossfadeDuration: number; // Audio crossfade duration in seconds (default: 0.01)
    snapToSilence: boolean; // Align cuts to nearby silence (default: true)
    silenceThreshold: number; // dB threshold for silence detection (default: -40)
    snapToFrames: boolean; // Snap cuts to frame boundaries (default: true)
    frameRate: number; // Assumed frame rate for snapping (default: 30)
  };
  activeSidebarTab: SidebarTab;
  defaultImageDuration: number; // Default duration for imported images in seconds
  addClip: (clip: Omit<Clip, 'id' | 'duration' | 'start' | 'end' | 'startTime'> & { duration: number }) => void;
  removeClip: (id: string) => void;
  setActiveClip: (id: string | null) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setNotification: (notification: Notification | null) => void;
  splitClip: (id: string, time: number) => void;
  reorderClips: (startIndex: number, endIndex: number) => void;
  moveClipToTime: (id: string, startTime: number, trackIndex?: number) => void;
  updateClip: (id: string, updates: Partial<Clip>) => void;
  toggleClipSelection: (id: string, multiSelect: boolean) => void;
  selectClips: (ids: string[]) => void;
  mergeSelectedClips: () => void;
  copyClips: () => void;
  pasteClips: () => void;
  saveProject: () => Promise<void>;
  loadProject: () => Promise<void>;
  newProject: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setExportFormat: (format: ExportFormat) => void;
  setExportResolution: (resolution: ExportResolution) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setGridSize: (size: number) => void;
  setClipVolume: (id: string, volume: number) => void;
  toggleClipMute: (id: string) => void;
  setClipSpeed: (id: string, speed: number) => void;
  setClipEffects: (id: string, effects: Clip['effects']) => void;
  getTotalDuration: () => number;
  getClipAtTime: (time: number) => Clip | null;
  setSubtitles: (subtitles: SubtitleEntry[]) => void;
  clearSubtitles: () => void;
  updateSubtitleStyle: (style: Partial<ProjectState['subtitleStyle']>) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;
  markSaved: () => void;
  markUnsaved: () => void;
  autoSave: () => Promise<void>;
  setTranscription: (transcription: TranscriptionResult | null) => void;
  setTranscriptionProgress: (progress: { status: string; progress?: number; clip?: number } | null) => void;
  transcribeCurrentClip: () => Promise<void>;
  transcribeFile: (path: string) => Promise<void>;
  transcribeTimeline: () => Promise<void>;
  clearTranscription: () => void;
  getActiveClips: (time: number) => Clip[];
  applyTranscriptEdits: (deletionRanges: Array<{ start: number; end: number }>) => Promise<void>;
  updateTranscriptEditSettings: (settings: Partial<ProjectState['transcriptEditSettings']>) => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setDefaultImageDuration: (duration: number) => void;
}

const saveToHistory = (state: ProjectState) => {
  const historyState: HistoryState = {
    clips: JSON.parse(JSON.stringify(state.clips)),
    activeClipId: state.activeClipId,
    selectedClipIds: [...state.selectedClipIds],
    currentTime: state.currentTime,
  };

  // Keep only states up to current index
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push(historyState);

  // Limit history to 50 states
  if (newHistory.length > 50) {
    newHistory.shift();
  }

  return {
    history: newHistory,
    historyIndex: newHistory.length - 1,
    hasUnsavedChanges: true, // Mark unsaved whenever history changes
  };
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  clips: [],
  activeClipId: null,
  selectedClipIds: [],
  currentTime: 0,
  isPlaying: false,
  notification: null,
  copiedClips: [],
  projectPath: null,
  projectId: null,
  history: [],
  historyIndex: -1,
  exportFormat: 'mp4',
  exportResolution: 'original',
  snapToGrid: false,
  gridSize: 1,
  subtitles: [],
  subtitleStyle: {
    fontSize: 24,
    fontFamily: 'Arial',
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    position: 'bottom',
    displayMode: 'progressive', // Default to progressive (real-time) display
  },
  autoSaveEnabled: true,
  autoSaveInterval: 120, // 2 minutes default
  lastSaved: null,
  hasUnsavedChanges: false,
  transcription: null,
  isTranscribing: false,
  transcriptionProgress: null,
  transcriptEditSettings: {
    cutPadding: 0.05, // 50ms padding
    mergeTolerance: 0.3, // Merge cuts within 300ms
    crossfadeDuration: 0.01, // 10ms crossfade
    snapToSilence: true,
    silenceThreshold: -40, // -40 dB
    snapToFrames: true,
    frameRate: 30, // 30fps default
  },
  activeSidebarTab: (localStorage.getItem('activeSidebarTab') as SidebarTab) || 'media', // Default to media tab
  defaultImageDuration: 5, // Default 5 seconds for images
  addClip: (clip) =>
    set((state) => {
      // Auto-assign track based on media type
      let trackIndex = 0;
      if (clip.mediaType === 'audio') {
        trackIndex = 10; // Audio track
      } else {
        trackIndex = 0; // Video track
      }

      // Calculate start time - place at end of existing clips on same track
      const trackClips = state.clips.filter(c => (c.trackIndex ?? 0) === trackIndex);
      let startTime = 0;
      if (trackClips.length > 0) {
        // Find the furthest end time on this track
        startTime = Math.max(...trackClips.map(c => c.startTime + c.duration));
      }

      const newState = {
        clips: [...state.clips, {
          ...clip,
          id: uuidv4(),
          sourceDuration: clip.duration,
          start: 0,
          end: clip.duration,
          startTime,
          volume: 1,
          muted: false,
          trackIndex,
        }],
      };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  removeClip: (id) =>
    set((state) => {
      const newState = {
        clips: state.clips.filter((c) => c.id !== id),
        activeClipId: state.activeClipId === id ? null : state.activeClipId,
      };
      
      // Sync memory with updated project state
      const clipIds = newState.clips.map(c => c.id);
      // Import lazily to avoid circular dependencies
      import('./useAiMemoryStore').then(({ useAiMemoryStore }) => {
        useAiMemoryStore.getState().syncWithProject(clipIds);
      });
      
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  setActiveClip: (id) => set({ activeClipId: id, currentTime: 0, isPlaying: false }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setNotification: (notification) => set({ notification }),
  reorderClips: (startIndex, endIndex) => set((state) => {
    const newClips = Array.from(state.clips);
    const [removed] = newClips.splice(startIndex, 1);
    newClips.splice(endIndex, 0, removed);
    const newState = { clips: newClips };
    return { ...newState, ...saveToHistory({ ...state, ...newState }) };
  }),
  moveClipToTime: (id, startTime, trackIndex) => set((state) => {
    const newState = {
      clips: state.clips.map((clip) => {
        if (clip.id === id) {
          return {
            ...clip,
            startTime: Math.max(0, startTime),
            ...(trackIndex !== undefined && { trackIndex }),
          };
        }
        return clip;
      }),
    };
    return { ...newState, ...saveToHistory({ ...state, ...newState }) };
  }),
  updateClip: (id, updates) => set((state) => {
    const newState = {
      clips: state.clips.map((clip) => {
        if (clip.id === id) {
          const newClip = { ...clip, ...updates };
          // Recalculate duration if bounds changed
          if (updates.start !== undefined || updates.end !== undefined) {
            newClip.duration = newClip.end - newClip.start;
          }
          return newClip;
        }
        return clip;
      }),
    };
    return { ...newState, ...saveToHistory({ ...state, ...newState }) };
  }),
  splitClip: (id, time) => set((state) => {
    const clipIndex = state.clips.findIndex(c => c.id === id);
    if (clipIndex === -1) return state;

    const originalClip = state.clips[clipIndex];
    const splitTimeInSource = originalClip.start + time;

    if (!validateSplitPosition(
      { ...originalClip, trackId: '', trackType: 'video' } as ClipSegment,
      splitTimeInSource
    )) {
      return state;
    }

    const result = splitClipAtTime(
      { ...originalClip, trackId: '', trackType: 'video' } as ClipSegment,
      splitTimeInSource
    );

    if (!result) return state;

    const firstPart: Clip = {
      id: result.before.id,
      path: originalClip.path,
      name: originalClip.name,
      start: result.before.start,
      end: result.before.end,
      duration: result.before.duration,
      sourceDuration: originalClip.sourceDuration,
      thumbnail: originalClip.thumbnail,
      waveform: originalClip.waveform,
      trackIndex: originalClip.trackIndex || 0,
      mediaType: originalClip.mediaType,
      volume: originalClip.volume,
      muted: originalClip.muted,
      startTime: originalClip.startTime,
    };

    const secondPart: Clip = {
      id: result.after.id,
      path: originalClip.path,
      name: originalClip.name,
      start: result.after.start,
      end: result.after.end,
      duration: result.after.duration,
      sourceDuration: originalClip.sourceDuration,
      thumbnail: originalClip.thumbnail,
      waveform: originalClip.waveform,
      trackIndex: originalClip.trackIndex || 0,
      mediaType: originalClip.mediaType,
      volume: originalClip.volume,
      muted: originalClip.muted,
      startTime: originalClip.startTime + result.before.duration,
    };

    const newClips = [...state.clips];
    newClips.splice(clipIndex, 1, firstPart, secondPart);

    const newState = { clips: newClips };
    return { ...newState, ...saveToHistory({ ...state, ...newState }) };
  }),
  toggleClipSelection: (id, multiSelect) => set((state) => {
    if (!multiSelect) {
      return { selectedClipIds: [id], activeClipId: id };
    }
    const isSelected = state.selectedClipIds.includes(id);
    return {
      selectedClipIds: isSelected
        ? state.selectedClipIds.filter(cid => cid !== id)
        : [...state.selectedClipIds, id],
      activeClipId: id
    };
  }),
  selectClips: (ids) => set({ selectedClipIds: ids }),
  mergeSelectedClips: () => set((state) => {
    if (state.selectedClipIds.length < 2) {
      return { notification: { type: 'error' as const, message: 'Select at least 2 clips' } };
    }

    const selectedClips = state.clips
      .map((clip, index) => ({ clip, index }))
      .filter(({ clip }) => state.selectedClipIds.includes(clip.id))
      .sort((a, b) => a.index - b.index);

    if (selectedClips.some(({ clip }) => clip.locked)) {
      return { notification: { type: 'error' as const, message: 'Cannot merge locked clips' } };
    }

    // Allow merging clips from different sources (no consecutive check needed)

    const segments = selectedClips.flatMap(({ clip }) => {
      if (clip.segments) {
        return clip.segments;
      }
      return [{
        sourcePath: clip.path,
        sourceStart: clip.start,
        sourceEnd: clip.end,
        duration: clip.duration
      }];
    });

    const firstClip = selectedClips[0].clip;
    const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);

    // Create a compound clip that can contain segments from multiple sources
    const mergedClip: Clip = {
      id: uuidv4(),
      path: firstClip.path, // Keep for reference, but segments define actual sources
      name: `Merged (${selectedClips.length} clips)`,
      start: 0,
      end: totalDuration,
      duration: totalDuration,
      sourceDuration: totalDuration,
      thumbnail: firstClip.thumbnail,
      waveform: firstClip.waveform,
      segments: segments,
      isMerged: true,
      trackId: firstClip.trackId || 'default',
      trackIndex: firstClip.trackIndex || 0,
      mediaType: firstClip.mediaType,
      volume: firstClip.volume,
      muted: firstClip.muted,
      startTime: firstClip.startTime,
    };

    const firstIndex = selectedClips[0].index;
    const newClips = state.clips.filter(clip => !state.selectedClipIds.includes(clip.id));
    newClips.splice(firstIndex, 0, mergedClip);

    const newState = {
      clips: newClips,
      selectedClipIds: [mergedClip.id],
      activeClipId: mergedClip.id,
      notification: { type: 'success' as const, message: `Merged ${segments.length} segments` }
    };
    return { ...newState, ...saveToHistory({ ...state, ...newState }) };
  }),
  copyClips: () => set((state) => {
    const clipsToCopy = state.clips.filter(clip => state.selectedClipIds.includes(clip.id));
    return {
      copiedClips: clipsToCopy,
      notification: { type: 'success', message: `Copied ${clipsToCopy.length} clip(s)` }
    };
  }),
  pasteClips: () => set((state) => {
    if (state.copiedClips.length === 0) {
      return { notification: { type: 'error', message: 'No clips to paste' } };
    }

    // Clone copied clips with new IDs
    const pastedClips = state.copiedClips.map(clip => ({
      ...clip,
      id: uuidv4(),
      name: clip.name + ' (Copy)'
    }));

    return {
      clips: [...state.clips, ...pastedClips],
      selectedClipIds: pastedClips.map(c => c.id),
      notification: { type: 'success', message: `Pasted ${pastedClips.length} clip(s)` }
    };
  }),
  saveProject: async () => {
    const state = get();

    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Save not available in browser' } });
      return;
    }

    try {
      const filePath = await window.electronAPI.saveProject();
      if (!filePath) return; // User canceled

      // Generate projectId if this is a new project
      const projectId = state.projectId || uuidv4();

      // Get memory from memory store
      const memoryStore = useAiMemoryStore.getState();
      const memoryEntries = memoryStore.exportMemory();

      // Get chat from chat store
      const chatStore = (await import('./useChatStore')).useChatStore.getState();
      const chatData = chatStore.exportChatForProject();

      const projectData = {
        version: '1.0',
        projectId,
        clips: state.clips,
        activeClipId: state.activeClipId,
        selectedClipIds: state.selectedClipIds,
        currentTime: state.currentTime,
        memory: memoryEntries, // Include memory in project file
        chat: chatData, // Include chat history in project file
      };

      const result = await window.electronAPI.writeProjectFile({ filePath, data: projectData });

      if (result.success) {
        set({
          projectPath: filePath,
          projectId,
          hasUnsavedChanges: false,
          lastSaved: Date.now(),
          notification: { type: 'success', message: 'Project saved successfully!' }
        });

        // Update chat store with current project ID
        chatStore.loadChatForProject(projectId);
      } else {
        set({ notification: { type: 'error', message: 'Failed to save project' } });
      }
    } catch (error) {
      console.error('Save project error:', error);
      set({ notification: { type: 'error', message: 'Error saving project' } });
    }
  },
  loadProject: async () => {
    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Load not available in browser' } });
      return;
    }

    try {
      const filePath = await window.electronAPI.loadProject();
      if (!filePath) return; // User canceled

      const result = await window.electronAPI.readProjectFile(filePath);

      if (result.success && result.data) {
        const projectData = result.data;
        // If old project doesn't have projectId, generate one
        const projectId = projectData.projectId || uuidv4();
        
        set({
          clips: projectData.clips || [],
          activeClipId: projectData.activeClipId || null,
          selectedClipIds: projectData.selectedClipIds || [],
          currentTime: projectData.currentTime || 0,
          subtitles: projectData.subtitles || [],
          subtitleStyle: projectData.subtitleStyle || {
            fontSize: 24,
            fontFamily: 'Arial',
            color: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            position: 'bottom',
          },
          projectPath: filePath,
          projectId,
          hasUnsavedChanges: false,
          lastSaved: Date.now(),
          notification: { type: 'success', message: 'Project loaded successfully!' }
        });

        // Load memory from project file
        const memoryStore = useAiMemoryStore.getState();
        memoryStore.importMemory(projectData.memory || []);

        // Load chat from project file
        const { useChatStore } = await import('./useChatStore');
        const chatState = useChatStore.getState();
        
        if (projectData.chat && projectData.chat.messages) {
          // Restore chat messages and session tokens from project
          useChatStore.setState({
            messages: projectData.chat.messages,
            sessionTokens: projectData.chat.sessionTokens || {
              totalPromptTokens: 0,
              totalResponseTokens: 0,
              totalTokens: 0,
              totalCachedTokens: 0,
            },
            currentProjectId: projectId,
          });
        } else {
          // Old project without chat data - clear chat for fresh start
          chatState.clearChatForNewProject();
          useChatStore.setState({ currentProjectId: projectId });
        }
      } else {
        set({ notification: { type: 'error', message: 'Failed to load project' } });
      }
    } catch (error) {
      console.error('Load project error:', error);
      set({ notification: { type: 'error', message: 'Error loading project' } });
    }
  },
  newProject: () => {
    // Clear current project state
    set({
      clips: [],
      activeClipId: null,
      selectedClipIds: [],
      currentTime: 0,
      projectPath: null,
      projectId: null,
      subtitles: [],
      transcription: null,
      history: [],
      historyIndex: -1,
      hasUnsavedChanges: false,
      lastSaved: null,
      notification: { type: 'success', message: 'New project created' }
    });

    // Clear memory for new project
    const memoryStore = useAiMemoryStore.getState();
    memoryStore.clearMemory();

    // Clear chat for new project
    import('./useChatStore').then(({ useChatStore }) => {
      useChatStore.getState().clearChatForNewProject();
    });
  },
  undo: () => set((state) => {
    if (state.historyIndex > 0) {
      const previousState = state.history[state.historyIndex - 1];
      return {
        ...previousState,
        history: state.history,
        historyIndex: state.historyIndex - 1,
        notification: { type: 'success', message: 'Undo' },
      };
    }
    return state;
  }),
  redo: () => set((state) => {
    if (state.historyIndex < state.history.length - 1) {
      const nextState = state.history[state.historyIndex + 1];
      return {
        ...nextState,
        history: state.history,
        historyIndex: state.historyIndex + 1,
        notification: { type: 'success', message: 'Redo' },
      };
    }
    return state;
  }),
  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,
  setExportFormat: (format) => set({ exportFormat: format }),
  setExportResolution: (resolution) => set({ exportResolution: resolution }),
  setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
  setGridSize: (size) => set({ gridSize: size }),
  setClipVolume: (id, volume) => set((state) => ({
    clips: state.clips.map((clip) =>
      clip.id === id ? { ...clip, volume: Math.max(0, Math.min(1, volume)) } : clip
    ),
  })),
  toggleClipMute: (id) => set((state) => ({
    clips: state.clips.map((clip) =>
      clip.id === id ? { ...clip, muted: !clip.muted } : clip
    ),
  })),
  setClipSpeed: (id, speed) => {
    const clampedSpeed = Math.max(0.25, Math.min(8.0, speed));
    set((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return state;
      const oldSpeed = clip.speed ?? 1;
      // Adjust clip duration proportionally to the speed change
      const newDuration = clip.duration * (oldSpeed / clampedSpeed);
      const newClips = state.clips.map((c) =>
        c.id === id ? { ...c, speed: clampedSpeed, duration: newDuration } : c
      );
      const newState = { clips: newClips, hasUnsavedChanges: true };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    });
  },
  setClipEffects: (id, effects) => {
    set((state) => {
      const newClips = state.clips.map((clip) =>
        clip.id === id ? { ...clip, effects: { ...clip.effects, ...effects } } : clip
      );
      const newState = { clips: newClips, hasUnsavedChanges: true };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    });
  },
  getTotalDuration: () => {
    const state = get();
    if (state.clips.length === 0) return 0;

    // Find the furthest end time across all clips
    const endTimes = state.clips.map(clip => clip.startTime + clip.duration);
    return Math.max(...endTimes, 0);
  },
  getClipAtTime: (time) => {
    const state = get();

    // Find video clips at the given time (prioritize lower track indices)
    const videoClips = state.clips.filter(clip => {
      const trackIndex = clip.trackIndex ?? 0;
      return trackIndex < 10 && // Video tracks are 0-9
        time >= clip.startTime &&
        time < clip.startTime + clip.duration;
    });

    if (videoClips.length === 0) return null;

    // Sort by track index and return the first (lowest track = on top)
    videoClips.sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
    return videoClips[0];
  },
  getActiveClips: (time) => {
    const state = get();
    return state.clips.filter(clip =>
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    );
  },
  setSubtitles: (subtitles) => set({ subtitles, hasUnsavedChanges: true }),
  clearSubtitles: () => set({ subtitles: [], hasUnsavedChanges: true }),
  updateSubtitleStyle: (style) => set((state) => ({
    subtitleStyle: { ...state.subtitleStyle, ...style },
    hasUnsavedChanges: true
  })),
  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),
  setAutoSaveInterval: (interval) => set({ autoSaveInterval: interval }),
  markSaved: () => set({ hasUnsavedChanges: false, lastSaved: Date.now() }),
  markUnsaved: () => set({ hasUnsavedChanges: true }),
  autoSave: async () => {
    const state = get();

    // Only auto-save if there's a project path and unsaved changes
    if (!state.projectPath || !state.hasUnsavedChanges) {
      return;
    }

    if (!window.electronAPI) {
      return;
    }

    try {
      const projectData = {
        version: '1.0',
        clips: state.clips,
        activeClipId: state.activeClipId,
        selectedClipIds: state.selectedClipIds,
        currentTime: state.currentTime,
        subtitles: state.subtitles,
        subtitleStyle: state.subtitleStyle,
      };

      const result = await window.electronAPI.writeProjectFile({
        filePath: state.projectPath,
        data: projectData
      });

      if (result.success) {
        set({
          hasUnsavedChanges: false,
          lastSaved: Date.now(),
          notification: { type: 'success', message: 'Auto-saved' }
        });
      }
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  },
  setTranscription: (transcription) => set({ transcription, hasUnsavedChanges: true }),
  setTranscriptionProgress: (progress) => set({ transcriptionProgress: progress }),
  transcribeCurrentClip: async () => {
    const state = get();
    const currentClip = state.clips.find(c => c.id === state.activeClipId);

    if (!currentClip) {
      set({ notification: { type: 'error', message: 'No clip selected' } });
      return;
    }

    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Transcription not available in browser' } });
      return;
    }

    try {
      set({ isTranscribing: true, transcriptionProgress: { status: 'Starting...', progress: 0 } });

      // Set up progress listener
      window.electronAPI.onTranscriptionProgress((progress) => {
        set({ transcriptionProgress: progress });
      });

      const response = await window.electronAPI.transcribeVideo(currentClip.path);

      if (response.success && response.result) {
        set({
          transcription: response.result,
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'success', message: 'Transcription complete!' }
        });
      } else {
        // Check if error is due to missing audio track
        const errorMsg = response.error || '';
        const isNoAudioError = errorMsg.includes('does not contain an audio track') || 
                               errorMsg.includes('no audio') ||
                               errorMsg.includes('Output file does not contain any stream');
        
        if (isNoAudioError) {
          // Fall back to AI-based caption generation
          console.log('⚠️ No audio track detected, attempting AI fallback...');
          set({ transcriptionProgress: { status: 'Using AI for transcription...', progress: 50 } });
          
          try {
            const { generateCaptions } = await import('../lib/captioningService');
            const mimeType = currentClip.path.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime';
            const result = await generateCaptions(currentClip.path, mimeType);
            
            // Convert caption format to transcription format
            const transcription = {
              text: result.segments.map(s => s.text).join(' '),
              segments: result.segments.map(s => ({
                id: s.index,
                start: srtTimeToSeconds(s.startTime),
                end: srtTimeToSeconds(s.endTime),
                text: s.text,
              })),
              words: [], // AI doesn't provide word-level timestamps
            };
            
            set({
              transcription,
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'success', message: 'Captions generated with AI!' }
            });
          } catch (fallbackError) {
            console.error('AI fallback failed:', fallbackError);
            set({
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'error', message: `Transcription failed: ${errorMsg}` }
            });
          }
        } else {
          set({
            isTranscribing: false,
            transcriptionProgress: null,
            notification: { type: 'error', message: `Transcription failed: ${errorMsg}` }
          });
        }
      }
    } catch (error) {
      console.error('Transcription error:', error);
      set({
        isTranscribing: false,
        transcriptionProgress: null,
        notification: { type: 'error', message: 'Transcription error' }
      });
    }
  },
  transcribeFile: async (path: string) => {
    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Transcription not available in browser' } });
      return;
    }

    try {
      set({ isTranscribing: true, transcriptionProgress: { status: 'Starting...', progress: 0 } });

      // Set up progress listener
      window.electronAPI.onTranscriptionProgress((progress) => {
        set({ transcriptionProgress: progress });
      });

      const response = await window.electronAPI.transcribeVideo(path);

      if (response.success && response.result) {
        // Convert to subtitles format immediately for editing
        const newSubtitles = response.result.segments.map((s, i) => ({
          index: i + 1,
          startTime: s.start,
          endTime: s.end,
          text: s.text
        }));

        set({
          transcription: response.result, // Keep transcription data for word-based editing
          subtitles: newSubtitles,
          hasUnsavedChanges: true,
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'success', message: 'Transcription complete!' }
        });
      } else {
        // Check if error is due to missing audio track
        const errorMsg = response.error || '';
        const isNoAudioError = errorMsg.includes('does not contain an audio track') || 
                               errorMsg.includes('no audio') ||
                               errorMsg.includes('Output file does not contain any stream');
        
        if (isNoAudioError) {
          // Fall back to AI-based caption generation
          console.log('⚠️ No audio track detected, attempting AI fallback...');
          set({ transcriptionProgress: { status: 'Using AI for transcription...', progress: 50 } });
          
          try {
            const { generateCaptions } = await import('../lib/captioningService');
            const mimeType = path.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime';
            const result = await generateCaptions(path, mimeType);
            
            // Convert caption format to transcription format
            const transcription = {
              text: result.segments.map(s => s.text).join(' '),
              segments: result.segments.map(s => ({
                id: s.index,
                start: srtTimeToSeconds(s.startTime),
                end: srtTimeToSeconds(s.endTime),
                text: s.text,
              })),
              words: [], // AI doesn't provide word-level timestamps
            };
            
            // Convert to subtitles format
            const newSubtitles = transcription.segments.map((s, i) => ({
              index: i + 1,
              startTime: s.start,
              endTime: s.end,
              text: s.text
            }));
            
            set({
              transcription,
              subtitles: newSubtitles,
              hasUnsavedChanges: true,
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'success', message: 'Captions generated with AI!' }
            });
          } catch (fallbackError) {
            console.error('AI fallback failed:', fallbackError);
            set({
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'error', message: `Transcription failed: ${errorMsg}` }
            });
          }
        } else {
          set({
            isTranscribing: false,
            transcriptionProgress: null,
            notification: { type: 'error', message: `Transcription failed: ${errorMsg}` }
          });
        }
      }
    } catch (error) {
      console.error('Transcription error:', error);
      set({
        isTranscribing: false,
        transcriptionProgress: null,
        notification: { type: 'error', message: 'Transcription error' }
      });
    }
  },
  transcribeTimeline: async () => {
    const state = get();

    if (state.clips.length === 0) {
      set({ notification: { type: 'error', message: 'No clips in timeline' } });
      return;
    }

    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Transcription not available in browser' } });
      return;
    }

    try {
      set({ isTranscribing: true, transcriptionProgress: { status: 'Starting...', progress: 0 } });

      // Set up progress listener
      window.electronAPI.onTranscriptionProgress((progress) => {
        set({ transcriptionProgress: progress });
      });

      // Prepare clips for transcription - only include video/audio clips
      const clipsToTranscribe = state.clips
        .filter(clip => clip.mediaType === 'video' || clip.mediaType === 'audio')
        .map(clip => ({
          path: clip.path,
          startTime: clip.startTime,
          duration: clip.duration,
        }));

      if (clipsToTranscribe.length === 0) {
        set({
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'error', message: 'No video/audio clips to transcribe' }
        });
        return;
      }

      const response = await window.electronAPI.transcribeTimeline(clipsToTranscribe);

      if (response.success && response.result) {
        set({
          transcription: response.result,
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'success', message: 'Timeline transcription complete!' }
        });
      } else {
        set({
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'error', message: `Transcription failed: ${response.error}` }
        });
      }
    } catch (error) {
      console.error('Timeline transcription error:', error);
      set({
        isTranscribing: false,
        transcriptionProgress: null,
        notification: { type: 'error', message: 'Transcription error' }
      });
    }
  },
  clearTranscription: () => set({ transcription: null, hasUnsavedChanges: true }),

  applyTranscriptEdits: async (deletionRanges: Array<{ start: number; end: number }>) => {
    const state = get();

    if (deletionRanges.length === 0) {
      set({ notification: { type: 'error', message: 'No deletion ranges provided' } });
      return;
    }

    // Import helper functions
    const { prepareCutRanges, calculateCrossfadeDuration } = await import('../lib/transcriptEditHelpers');

    // Get words for silence detection
    const words = state.transcription?.words || [];

    // Prepare cut ranges with professional settings
    const processedRanges = prepareCutRanges(
      deletionRanges,
      state.transcriptEditSettings,
      words.length > 0 ? words : undefined
    );

    if (processedRanges.length === 0) {
      set({ notification: { type: 'error', message: 'No valid cut ranges after processing' } });
      return;
    }

    let clips = [...state.clips];
    let totalRemoved = 0;
    const crossfadeDuration = state.transcriptEditSettings.crossfadeDuration;

    // Process each deletion range
    for (const range of processedRanges) {
      const rangeStart = range.start - totalRemoved;
      const rangeEnd = range.end - totalRemoved;
      const rangeDuration = rangeEnd - rangeStart;

      // Find all clips that intersect with this deletion range
      const affectedClips: Array<{ clip: Clip; index: number }> = [];

      clips.forEach((clip, index) => {
        const clipEnd = clip.startTime + clip.duration;

        // Check if clip intersects with deletion range
        if (clip.startTime < rangeEnd && clipEnd > rangeStart) {
          affectedClips.push({ clip, index });
        }
      });

      // Process affected clips
      for (const { clip, index } of affectedClips.reverse()) {
        const clipEnd = clip.startTime + clip.duration;

        if (rangeStart <= clip.startTime && rangeEnd >= clipEnd) {
          // Case 1: Deletion range completely covers clip - remove entire clip
          clips.splice(index, 1);
        } else if (rangeStart > clip.startTime && rangeEnd < clipEnd) {
          // Case 2: Deletion range is within clip - split into two parts
          const beforeDuration = rangeStart - clip.startTime;
          const afterDuration = clipEnd - rangeEnd;

          const sourceTimeAtSplit = clip.start + (rangeEnd - clip.startTime);

          // Calculate crossfade for smooth transition
          const fadeTime = calculateCrossfadeDuration(crossfadeDuration, afterDuration);

          const beforeClip: Clip = {
            ...clip,
            id: uuidv4(),
            duration: beforeDuration,
            end: clip.start + beforeDuration,
            fadeOut: fadeTime, // Add fade out to clip before cut
          };

          const afterClip: Clip = {
            ...clip,
            id: uuidv4(),
            start: sourceTimeAtSplit,
            duration: afterDuration,
            startTime: clip.startTime + beforeDuration,
            fadeIn: fadeTime, // Add fade in to clip after cut
          };

          clips.splice(index, 1, beforeClip, afterClip);
        } else if (rangeStart <= clip.startTime && rangeEnd > clip.startTime) {
          // Case 3: Deletion cuts from start of clip
          const remainingDuration = clipEnd - rangeEnd;
          const sourceTimeAtCut = clip.start + (rangeEnd - clip.startTime);
          const fadeTime = calculateCrossfadeDuration(crossfadeDuration, remainingDuration);

          clips[index] = {
            ...clip,
            start: sourceTimeAtCut,
            duration: remainingDuration,
            fadeIn: fadeTime, // Add fade in at cut point
          };
        } else if (rangeStart < clipEnd && rangeEnd >= clipEnd) {
          // Case 4: Deletion cuts from end of clip
          const remainingDuration = rangeStart - clip.startTime;
          const fadeTime = calculateCrossfadeDuration(crossfadeDuration, remainingDuration);

          clips[index] = {
            ...clip,
            duration: remainingDuration,
            end: clip.start + remainingDuration,
            fadeOut: fadeTime, // Add fade out at cut point
          };
        }
      }

      // Close gap: shift all clips after the deletion range
      clips = clips.map(clip => {
        if (clip.startTime >= rangeEnd) {
          return {
            ...clip,
            startTime: clip.startTime - rangeDuration,
          };
        }
        return clip;
      });

      totalRemoved += rangeDuration;
    }

    // Update state with new clips
    const newState = { clips };
    set({
      ...newState,
      ...saveToHistory({ ...state, ...newState }),
      notification: {
        type: 'success',
        message: `Applied ${processedRanges.length} professional cut(s) (${totalRemoved.toFixed(2)}s removed)`
      }
    });
  },

  updateTranscriptEditSettings: (settings) => {
    set((state) => ({
      transcriptEditSettings: {
        ...state.transcriptEditSettings,
        ...settings,
      },
      hasUnsavedChanges: true,
    }));
  },

  setActiveSidebarTab: (tab) => {
    set({ activeSidebarTab: tab });
    // Store in localStorage for persistence
    localStorage.setItem('activeSidebarTab', tab);
  },

  setDefaultImageDuration: (duration) => {
    set({ defaultImageDuration: duration });
  },
}));
