import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useAiMemoryStore } from './useAiMemoryStore';
import { useChatStore } from './useChatStore';
import { splitClipAtTime, validateSplitPosition } from '../lib/clipOperations';
import type { ClipSegment } from '../lib/clipOperations';
import type { SubtitleEntry } from '../lib/srtParser';
import type { TranscriptionResult } from '../types/electron';
import type { ChatMessage } from '../types/chat';
import type { MediaAnalysisEntry } from '../types/aiMemory';
import { srtTimeToSeconds } from '../lib/timecode';
import { getStoredString, setStoredString, storageKeys } from '../lib/storage';

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
  assetDuration?: number;
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
    contrast?: number; // 0 to 3  (1 = no change)
    saturation?: number; // 0 to 3  (1 = no change)
    gamma?: number; // 0.1 to 10 (1 = no change)
  };
}

export interface MediaAsset {
  id: string;
  path: string;
  name: string;
  duration: number;
  assetDuration?: number;
  sourceDuration: number;
  thumbnail?: string;
  waveform?: string;
  mediaType?: Clip['mediaType'];
}

export interface Notification {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

export type ExportFormat = 'mp4' | 'mov' | 'avi' | 'webm';
export type ExportResolution = '1920x1080' | '1280x720' | '854x480' | 'original';
export type SidebarTab = 'project' | 'media' | 'settings' | 'memory';

export interface TurnAuditRecord {
  id: string;
  turnId: string;
  mode: 'edit' | 'plan' | 'ask';
  preSnapshotHash: string;
  postSnapshotHash: string;
  diffSummary: string[];
  toolInputs: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ name: string; success: boolean; message?: string; error?: string }>;
  failures: string[];
  retries: number;
  createdAt: number;
}

export interface TimelineStateArtifact {
  timeline_version: number;
  clip_count: number;
  total_duration: number;
  clips: Array<{
    id: string;
    name: string;
    start: number;
    end: number;
    startTime: number;
    duration: number;
    trackIndex: number;
    mediaType: Clip['mediaType'];
  }>;
  style_profile: string;
}

interface HistoryState {
  clips: Clip[];
  activeClipId: string | null;
  selectedClipIds: string[];
  currentTime: number;
  timelineVersion: number;
}

type NewClipInput = Omit<Clip, 'id' | 'duration' | 'start' | 'end' | 'startTime'> & {
  duration: number;
};

type LoadedProjectData = {
  projectId?: string;
  clips?: Clip[];
  mediaAssets?: MediaAsset[];
  activeClipId?: string | null;
  selectedClipIds?: string[];
  currentTime?: number;
  turnAudits?: TurnAuditRecord[];
  timelineVersion?: number;
  subtitles?: SubtitleEntry[];
  subtitleStyle?: ProjectState['subtitleStyle'];
  memory?: MediaAnalysisEntry[];
  chat?: {
    messages?: ChatMessage[];
    sessionTokens?: {
      totalPromptTokens: number;
      totalResponseTokens: number;
      totalTokens: number;
      totalCachedTokens: number;
    };
  };
};

interface ProjectState {
  clips: Clip[];
  mediaAssets: MediaAsset[];
  activeClipId: string | null;
  selectedClipIds: string[];
  currentTime: number;
  isPlaying: boolean;
  notification: Notification | null;
  copiedClips: Clip[];
  projectPath: string | null;
  projectId: string | null; // Unique ID for project-specific memory storage
  turnAudits: TurnAuditRecord[];
  timelineVersion: number;
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
  captionsEnabled: boolean;
  defaultImageDuration: number; // Default duration for imported images in seconds
  exportedVideoPath: string | null; // Path to the last exported video
  addClip: (clip: NewClipInput) => void;
  removeClip: (id: string) => boolean;
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
  setTranscriptionProgress: (
    progress: { status: string; progress?: number; clip?: number } | null,
  ) => void;
  transcribeCurrentClip: () => Promise<void>;
  transcribeFile: (path: string) => Promise<void>;
  transcribeTimeline: () => Promise<void>;
  clearTranscription: () => void;
  getActiveClips: (time: number) => Clip[];
  applyTranscriptEdits: (deletionRanges: Array<{ start: number; end: number }>) => Promise<void>;
  updateTranscriptEditSettings: (settings: Partial<ProjectState['transcriptEditSettings']>) => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setCaptionsEnabled: (enabled: boolean) => void;
  setDefaultImageDuration: (duration: number) => void;
  setExportedVideoPath: (path: string | null) => void;
  addTurnAudit: (audit: Omit<TurnAuditRecord, 'id' | 'createdAt'>) => void;
  getTurnAudit: (turnId: string) => TurnAuditRecord | undefined;
  getTimelineStateArtifact: () => TimelineStateArtifact;
}

const saveToHistory = (state: ProjectState) => {
  const historyState: HistoryState = {
    clips: JSON.parse(JSON.stringify(state.clips)),
    activeClipId: state.activeClipId,
    selectedClipIds: [...state.selectedClipIds],
    currentTime: state.currentTime,
    timelineVersion: state.timelineVersion + 1,
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
    timelineVersion: historyState.timelineVersion,
    hasUnsavedChanges: true, // Mark unsaved whenever history changes
  };
};

const DEFAULT_SUBTITLE_STYLE: ProjectState['subtitleStyle'] = {
  fontSize: 24,
  fontFamily: 'Arial',
  color: '#ffffff',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  position: 'bottom',
  displayMode: 'instant',
};

const getElectronApi = () => {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI;
};

const buildMediaAssetFromClip = (
  clip: Pick<
    Clip,
    'path' | 'name' | 'thumbnail' | 'waveform' | 'mediaType' | 'assetDuration' | 'sourceDuration'
  > & { duration: number },
): MediaAsset => ({
  id: uuidv4(),
  path: clip.path,
  name: clip.name,
  duration: clip.duration,
  assetDuration: clip.assetDuration ?? clip.duration,
  sourceDuration: clip.sourceDuration,
  thumbnail: clip.thumbnail,
  waveform: clip.waveform,
  mediaType: clip.mediaType,
});

const deriveMediaAssetsFromClips = (clips: Clip[]): MediaAsset[] =>
  Array.from(
    clips.reduce((map, clip) => {
      if (!clip.path || clip.mediaType === 'text' || map.has(clip.path)) {
        return map;
      }

      map.set(
        clip.path,
        buildMediaAssetFromClip({
          path: clip.path,
          name: clip.name,
          duration: clip.assetDuration ?? clip.sourceDuration ?? clip.duration,
          assetDuration: clip.assetDuration ?? clip.duration,
          sourceDuration: clip.sourceDuration,
          thumbnail: clip.thumbnail,
          waveform: clip.waveform,
          mediaType: clip.mediaType,
        }),
      );
      return map;
    }, new Map<string, MediaAsset>()),
  ).map(([, asset]) => asset);

const buildProjectDataForPersistence = (state: ProjectState) => {
  const projectId = state.projectId || uuidv4();
  const memoryStore = useAiMemoryStore.getState();
  const memoryEntries = memoryStore.exportMemory();
  const chatStore = useChatStore.getState();
  const chatData = chatStore.exportChatForProject();

  return {
    projectId,
    payload: {
      version: '1.0',
      projectId,
      timelineVersion: state.timelineVersion,
      clips: state.clips,
      mediaAssets: state.mediaAssets,
      activeClipId: state.activeClipId,
      selectedClipIds: state.selectedClipIds,
      currentTime: state.currentTime,
      turnAudits: state.turnAudits,
      memory: memoryEntries,
      chat: chatData,
    },
  };
};

const saveProjectInBrowser = async (projectData: unknown, projectId: string): Promise<string> => {
  if (typeof document === 'undefined') {
    throw new Error('Browser save is unavailable outside the renderer process');
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `quickcut-${projectId.slice(0, 8)}-${timestamp}.quickcut`;
  const json = JSON.stringify(projectData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return fileName;
};

const loadProjectInBrowser = async (): Promise<{ filePath: string; data: unknown } | null> => {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.quickcut,application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        resolve({ filePath: file.name, data });
      } catch (error) {
        console.error('Browser project load parse error:', error);
        resolve(null);
      }
    };
    input.click();
  });
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  clips: [],
  mediaAssets: [],
  activeClipId: null,
  selectedClipIds: [],
  currentTime: 0,
  isPlaying: false,
  notification: null,
  copiedClips: [],
  projectPath: null,
  projectId: null,
  turnAudits: [],
  timelineVersion: 0,
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
  activeSidebarTab: (getStoredString(storageKeys.activeSidebarTab) as SidebarTab) || 'media', // Default to media tab
  captionsEnabled: true,
  defaultImageDuration: 5, // Default 5 seconds for images
  exportedVideoPath: null, // No exported video initially
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
      const trackClips = state.clips.filter((c) => (c.trackIndex ?? 0) === trackIndex);
      let startTime = 0;
      if (trackClips.length > 0) {
        // Find the furthest end time on this track
        startTime = Math.max(...trackClips.map((c) => c.startTime + c.duration));
      }

      const assetDuration = clip.assetDuration ?? clip.duration;
      const sourceDuration =
        clip.mediaType === 'image' || clip.mediaType === 'text'
          ? Math.max(clip.sourceDuration ?? clip.duration, clip.duration, 300)
          : (clip.sourceDuration ?? clip.duration);
      const newClip: Clip = {
        ...clip,
        id: uuidv4(),
        assetDuration,
        sourceDuration,
        start: 0,
        end: clip.duration,
        startTime,
        volume: 1,
        muted: false,
        trackIndex,
      };

      const newState = {
        mediaAssets:
          clip.path &&
          clip.mediaType !== 'text' &&
          !state.mediaAssets.some((asset) => asset.path === clip.path)
            ? [
                ...state.mediaAssets,
                buildMediaAssetFromClip({
                  path: clip.path,
                  name: clip.name,
                  duration: assetDuration,
                  assetDuration,
                  sourceDuration,
                  thumbnail: clip.thumbnail,
                  waveform: clip.waveform,
                  mediaType: clip.mediaType,
                }),
              ]
            : state.mediaAssets,
        clips: [...state.clips, newClip],
      };

      if (newClip.path) {
        const memoryStore = useAiMemoryStore.getState();
        const entry = memoryStore.getEntryByFilePath(newClip.path);
        if (entry && entry.clipId !== newClip.id) {
          memoryStore.linkClipId(entry.id, newClip.id);
        }
      }

      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  removeClip: (id) => {
    let removed = false;
    set((state) => {
      const clipToRemove = state.clips.find((c) => c.id === id);
      if (!clipToRemove) {
        return state;
      }
      removed = true;

      // Shift subsequent clips on the same track to close the gap
      const removedTrack = clipToRemove.trackIndex ?? 0;
      const removedStart = clipToRemove.startTime;
      const removedDuration = clipToRemove.duration;

      const newClips = state.clips
        .filter((c) => c.id !== id)
        .map((c) => {
          const cTrack = c.trackIndex ?? 0;
          // Shift any clip on the same track that starts at or after the removed clip
          if (cTrack === removedTrack && c.startTime >= removedStart) {
            return { ...c, startTime: Math.max(0, c.startTime - removedDuration) };
          }
          return c;
        });

      const newState = {
        clips: newClips,
        activeClipId: state.activeClipId === id ? null : state.activeClipId,
      };

      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    });
    return removed;
  },
  setActiveClip: (id) => set({ activeClipId: id, currentTime: 0, isPlaying: false }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setNotification: (notification) => set({ notification }),
  reorderClips: (startIndex, endIndex) =>
    set((state) => {
      const newClips = Array.from(state.clips);
      const [removed] = newClips.splice(startIndex, 1);
      newClips.splice(endIndex, 0, removed);
      const newState = { clips: newClips };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  moveClipToTime: (id, startTime, trackIndex) =>
    set((state) => {
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
  updateClip: (id, updates) =>
    set((state) => {
      const originalClip = state.clips.find((c) => c.id === id);

      // First pass: update the target clip
      const updatedClips = state.clips.map((clip) => {
        if (clip.id === id) {
          const newClip = { ...clip, ...updates };
          // Recalculate duration if bounds changed
          if (updates.start !== undefined || updates.end !== undefined) {
            newClip.duration = newClip.end - newClip.start;
          }
          return newClip;
        }
        return clip;
      });

      // Second pass: if the clip's duration changed, ripple-shift subsequent clips on the same track
      let finalClips = updatedClips;
      if (originalClip && (updates.start !== undefined || updates.end !== undefined)) {
        const updatedClip = updatedClips.find((c) => c.id === id);
        if (updatedClip) {
          const durationDelta = updatedClip.duration - originalClip.duration;
          if (durationDelta !== 0) {
            const clipTrack = originalClip.trackIndex ?? 0;
            const clipEndTime = originalClip.startTime + originalClip.duration;
            finalClips = updatedClips.map((c) => {
              if (c.id !== id && (c.trackIndex ?? 0) === clipTrack && c.startTime >= clipEndTime) {
                return { ...c, startTime: Math.max(0, c.startTime + durationDelta) };
              }
              return c;
            });
          }
        }
      }

      const newState = { clips: finalClips };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  splitClip: (id, time) =>
    set((state) => {
      const clipIndex = state.clips.findIndex((c) => c.id === id);
      if (clipIndex === -1) return state;

      const originalClip = state.clips[clipIndex];
      const splitTimeInSource = originalClip.start + time;

      if (
        !validateSplitPosition(
          { ...originalClip, trackId: '', trackType: 'video' } as ClipSegment,
          splitTimeInSource,
        )
      ) {
        return state;
      }

      const result = splitClipAtTime(
        { ...originalClip, trackId: '', trackType: 'video' } as ClipSegment,
        splitTimeInSource,
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
  toggleClipSelection: (id, multiSelect) =>
    set((state) => {
      if (!multiSelect) {
        return { selectedClipIds: [id], activeClipId: id };
      }
      const isSelected = state.selectedClipIds.includes(id);
      return {
        selectedClipIds: isSelected
          ? state.selectedClipIds.filter((cid) => cid !== id)
          : [...state.selectedClipIds, id],
        activeClipId: id,
      };
    }),
  selectClips: (ids) => set({ selectedClipIds: ids }),
  mergeSelectedClips: () =>
    set((state) => {
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
        return [
          {
            sourcePath: clip.path,
            sourceStart: clip.start,
            sourceEnd: clip.end,
            duration: clip.duration,
          },
        ];
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
      const newClips = state.clips.filter((clip) => !state.selectedClipIds.includes(clip.id));
      newClips.splice(firstIndex, 0, mergedClip);

      const newState = {
        clips: newClips,
        selectedClipIds: [mergedClip.id],
        activeClipId: mergedClip.id,
        notification: { type: 'success' as const, message: `Merged ${segments.length} segments` },
      };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  copyClips: () =>
    set((state) => {
      const clipsToCopy = state.clips.filter((clip) => state.selectedClipIds.includes(clip.id));
      return {
        copiedClips: clipsToCopy,
        notification: {
          type: 'success' as const,
          message: `Copied ${clipsToCopy.length} clip(s)`,
        },
      };
    }),
  pasteClips: () =>
    set((state) => {
      if (state.copiedClips.length === 0) {
        return { notification: { type: 'error' as const, message: 'No clips to paste' } };
      }

      const baseStart = Math.min(...state.copiedClips.map((clip) => clip.startTime));
      const pastedClips = state.copiedClips.map((clip) => ({
        ...clip,
        id: uuidv4(),
        name: clip.name + ' (Copy)',
        startTime: Math.max(0, state.currentTime + (clip.startTime - baseStart)),
      }));

      const newState = {
        clips: [...state.clips, ...pastedClips],
        selectedClipIds: pastedClips.map((c) => c.id),
        notification: {
          type: 'success' as const,
          message: `Pasted ${pastedClips.length} clip(s)`,
        },
      };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    }),
  saveProject: async () => {
    const state = get();
    const electronApi = getElectronApi();
    const canUseElectronSave = Boolean(
      electronApi &&
      typeof electronApi.saveProject === 'function' &&
      typeof electronApi.writeProjectFile === 'function',
    );

    try {
      const { projectId, payload } = buildProjectDataForPersistence(state);
      const chatStore = useChatStore.getState();
      let savedPath: string | null = null;

      if (canUseElectronSave) {
        const api = electronApi!;
        const filePath = await api.saveProject();
        if (!filePath) return;
        const result = await api.writeProjectFile({ filePath, data: payload });
        if (!result.success) {
          set({ notification: { type: 'error', message: 'Failed to save project' } });
          return;
        }
        savedPath = filePath;
      } else {
        savedPath = await saveProjectInBrowser(payload, projectId);
      }

      if (savedPath) {
        set({
          projectPath: savedPath,
          projectId,
          hasUnsavedChanges: false,
          lastSaved: Date.now(),
          notification: {
            type: 'success',
            message: canUseElectronSave
              ? 'Project saved successfully!'
              : 'Project downloaded successfully!',
          },
        });

        chatStore.loadChatForProject(projectId);
      }
    } catch (error) {
      console.error('Save project error:', error);
      set({ notification: { type: 'error', message: 'Error saving project' } });
    }
  },
  loadProject: async () => {
    const electronApi = getElectronApi();
    const canUseElectronLoad = Boolean(
      electronApi &&
      typeof electronApi.loadProject === 'function' &&
      typeof electronApi.readProjectFile === 'function',
    );

    try {
      let loaded: { filePath: string; data: unknown } | null = null;

      if (canUseElectronLoad) {
        const api = electronApi!;
        const filePath = await api.loadProject();
        if (!filePath) return;
        const result = await api.readProjectFile(filePath);
        if (!result.success || !result.data) {
          set({ notification: { type: 'error', message: 'Failed to load project' } });
          return;
        }
        loaded = { filePath, data: result.data };
      } else {
        loaded = await loadProjectInBrowser();
        if (!loaded) {
          set({ notification: { type: 'error', message: 'Failed to load project file' } });
          return;
        }
      }

      if (loaded?.data) {
        const projectData = loaded.data as LoadedProjectData;
        // If old project doesn't have projectId, generate one
        const projectId = projectData.projectId || uuidv4();
        const loadedClips = projectData.clips || [];

        set({
          clips: loadedClips,
          mediaAssets: projectData.mediaAssets || deriveMediaAssetsFromClips(loadedClips),
          activeClipId: projectData.activeClipId || null,
          selectedClipIds: projectData.selectedClipIds || [],
          currentTime: projectData.currentTime || 0,
          turnAudits: projectData.turnAudits || [],
          timelineVersion: Number.isFinite(projectData.timelineVersion)
            ? Number(projectData.timelineVersion)
            : 0,
          subtitles: projectData.subtitles || [],
          subtitleStyle: projectData.subtitleStyle || DEFAULT_SUBTITLE_STYLE,
          projectPath: loaded.filePath,
          projectId,
          hasUnsavedChanges: false,
          lastSaved: Date.now(),
          notification: {
            type: 'success',
            message: canUseElectronLoad
              ? 'Project loaded successfully!'
              : 'Project loaded from file!',
          },
        });

        // Load memory from project file
        const memoryStore = useAiMemoryStore.getState();
        memoryStore.importMemory(projectData.memory || []);

        // Load chat from project file
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
      mediaAssets: [],
      activeClipId: null,
      selectedClipIds: [],
      currentTime: 0,
      projectPath: null,
      projectId: null,
      turnAudits: [],
      subtitles: [],
      transcription: null,
      history: [],
      historyIndex: -1,
      timelineVersion: 0,
      hasUnsavedChanges: false,
      lastSaved: null,
      notification: { type: 'success', message: 'New project created' },
    });

    // Clear memory for new project
    const memoryStore = useAiMemoryStore.getState();
    memoryStore.clearMemory();

    // Clear chat for new project
    useChatStore.getState().clearChatForNewProject();
  },
  undo: () =>
    set((state) => {
      if (state.historyIndex > 0) {
        const previousState = state.history[state.historyIndex - 1];
        return {
          ...previousState,
          history: state.history,
          historyIndex: state.historyIndex - 1,
          timelineVersion: previousState.timelineVersion,
          notification: { type: 'success', message: 'Undo' },
        };
      }
      return state;
    }),
  redo: () =>
    set((state) => {
      if (state.historyIndex < state.history.length - 1) {
        const nextState = state.history[state.historyIndex + 1];
        return {
          ...nextState,
          history: state.history,
          historyIndex: state.historyIndex + 1,
          timelineVersion: nextState.timelineVersion,
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
  setClipVolume: (id, volume) =>
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, volume: Math.max(0, Math.min(1, volume)) } : clip,
      ),
    })),
  toggleClipMute: (id) =>
    set((state) => ({
      clips: state.clips.map((clip) => (clip.id === id ? { ...clip, muted: !clip.muted } : clip)),
    })),
  setClipSpeed: (id, speed) => {
    const clampedSpeed = Math.max(0.25, Math.min(8.0, speed));
    set((state) => {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return state;
      const oldSpeed = clip.speed ?? 1;
      const newDuration = clip.duration * (oldSpeed / clampedSpeed);
      const clipTrack = clip.trackIndex ?? 0;
      const clipEndTime = clip.startTime + clip.duration;
      const durationDelta = newDuration - clip.duration;
      const newClips = state.clips.map((c) => {
        if (c.id === id) {
          return { ...c, speed: clampedSpeed, duration: newDuration };
        }
        if ((c.trackIndex ?? 0) === clipTrack && c.startTime >= clipEndTime) {
          return { ...c, startTime: Math.max(0, c.startTime + durationDelta) };
        }
        return c;
      });
      const newState = { clips: newClips, hasUnsavedChanges: true };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    });
  },
  setClipEffects: (id, effects) => {
    set((state) => {
      const newClips = state.clips.map((clip) =>
        clip.id === id ? { ...clip, effects: { ...clip.effects, ...effects } } : clip,
      );
      const newState = { clips: newClips, hasUnsavedChanges: true };
      return { ...newState, ...saveToHistory({ ...state, ...newState }) };
    });
  },
  getTotalDuration: () => {
    const state = get();
    if (state.clips.length === 0) return 0;

    // Find the furthest end time across all clips
    const endTimes = state.clips.map((clip) => clip.startTime + clip.duration);
    return Math.max(...endTimes, 0);
  },
  getClipAtTime: (time) => {
    const state = get();

    // Find video clips at the given time (prioritize lower track indices)
    const videoClips = state.clips.filter((clip) => {
      const trackIndex = clip.trackIndex ?? 0;
      return (
        trackIndex < 10 && // Video tracks are 0-9
        time >= clip.startTime &&
        time < clip.startTime + clip.duration
      );
    });

    if (videoClips.length === 0) return null;

    // Sort by track index and return the first (lowest track = on top)
    videoClips.sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
    return videoClips[0];
  },
  getActiveClips: (time) => {
    const state = get();
    return state.clips.filter(
      (clip) => time >= clip.startTime && time < clip.startTime + clip.duration,
    );
  },
  setSubtitles: (subtitles) => set({ subtitles, hasUnsavedChanges: true }),
  clearSubtitles: () => set({ subtitles: [], hasUnsavedChanges: true }),
  updateSubtitleStyle: (style) =>
    set((state) => ({
      subtitleStyle: { ...state.subtitleStyle, ...style },
      hasUnsavedChanges: true,
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
        projectId: state.projectId,
        timelineVersion: state.timelineVersion,
        clips: state.clips,
        activeClipId: state.activeClipId,
        selectedClipIds: state.selectedClipIds,
        currentTime: state.currentTime,
        turnAudits: state.turnAudits,
        subtitles: state.subtitles,
        subtitleStyle: state.subtitleStyle,
      };

      const result = await window.electronAPI.writeProjectFile({
        filePath: state.projectPath,
        data: projectData,
      });

      if (result.success) {
        set({
          hasUnsavedChanges: false,
          lastSaved: Date.now(),
          notification: { type: 'success', message: 'Auto-saved' },
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
    const currentClip = state.clips.find((c) => c.id === state.activeClipId);

    if (!currentClip) {
      set({ notification: { type: 'error', message: 'No clip selected' } });
      return;
    }

    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Transcription not available in browser' } });
      return;
    }

    let unsubscribeProgress: (() => void) | undefined;
    try {
      set({ isTranscribing: true, transcriptionProgress: { status: 'Starting...', progress: 0 } });

      // Set up progress listener
      unsubscribeProgress = window.electronAPI.onTranscriptionProgress((progress) => {
        set({ transcriptionProgress: progress });
      });

      const response = await window.electronAPI.transcribeVideo(currentClip.path);

      if (response.success && response.result) {
        set({
          transcription: response.result,
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'success', message: 'Transcription complete!' },
        });
      } else {
        // Check if error is due to missing audio track
        const errorMsg = response.error || '';
        const isNoAudioError =
          errorMsg.includes('does not contain an audio track') ||
          errorMsg.includes('no audio') ||
          errorMsg.includes('Output file does not contain any stream');

        if (isNoAudioError) {
          // Fall back to AI-based caption generation
          console.log(' No audio track detected, attempting AI fallback...');
          set({ transcriptionProgress: { status: 'Using AI for transcription...', progress: 50 } });

          try {
            const { generateCaptions } = await import('../lib/captioningService');
            const mimeType = currentClip.path.toLowerCase().endsWith('.mp4')
              ? 'video/mp4'
              : 'video/quicktime';
            const result = await generateCaptions(currentClip.path, mimeType);

            // Convert caption format to transcription format
            const transcription = {
              text: result.segments.map((s) => s.text).join(' '),
              segments: result.segments.map((s) => ({
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
              notification: { type: 'success', message: 'Captions generated with AI!' },
            });
          } catch (fallbackError) {
            console.error('AI fallback failed:', fallbackError);
            set({
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'error', message: `Transcription failed: ${errorMsg}` },
            });
          }
        } else {
          set({
            isTranscribing: false,
            transcriptionProgress: null,
            notification: { type: 'error', message: `Transcription failed: ${errorMsg}` },
          });
        }
      }
    } catch (error) {
      console.error('Transcription error:', error);
      set({
        isTranscribing: false,
        transcriptionProgress: null,
        notification: { type: 'error', message: 'Transcription error' },
      });
    } finally {
      unsubscribeProgress?.();
    }
  },
  transcribeFile: async (path: string) => {
    if (!window.electronAPI) {
      set({ notification: { type: 'error', message: 'Transcription not available in browser' } });
      return;
    }

    let unsubscribeProgress: (() => void) | undefined;
    try {
      set({ isTranscribing: true, transcriptionProgress: { status: 'Starting...', progress: 0 } });

      // Set up progress listener
      unsubscribeProgress = window.electronAPI.onTranscriptionProgress((progress) => {
        set({ transcriptionProgress: progress });
      });

      const response = await window.electronAPI.transcribeVideo(path);

      if (response.success && response.result) {
        // Convert to subtitles format immediately for editing
        const newSubtitles = response.result.segments.map((s, i) => ({
          index: i + 1,
          startTime: s.start,
          endTime: s.end,
          text: s.text,
        }));

        set({
          transcription: response.result, // Keep transcription data for word-based editing
          subtitles: newSubtitles,
          hasUnsavedChanges: true,
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'success', message: 'Transcription complete!' },
        });
      } else {
        // Check if error is due to missing audio track
        const errorMsg = response.error || '';
        const isNoAudioError =
          errorMsg.includes('does not contain an audio track') ||
          errorMsg.includes('no audio') ||
          errorMsg.includes('Output file does not contain any stream');

        if (isNoAudioError) {
          // Fall back to AI-based caption generation
          console.log(' No audio track detected, attempting AI fallback...');
          set({ transcriptionProgress: { status: 'Using AI for transcription...', progress: 50 } });

          try {
            const { generateCaptions } = await import('../lib/captioningService');
            const mimeType = path.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime';
            const result = await generateCaptions(path, mimeType);

            // Convert caption format to transcription format
            const transcription = {
              text: result.segments.map((s) => s.text).join(' '),
              segments: result.segments.map((s) => ({
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
              text: s.text,
            }));

            set({
              transcription,
              subtitles: newSubtitles,
              hasUnsavedChanges: true,
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'success', message: 'Captions generated with AI!' },
            });
          } catch (fallbackError) {
            console.error('AI fallback failed:', fallbackError);
            set({
              isTranscribing: false,
              transcriptionProgress: null,
              notification: { type: 'error', message: `Transcription failed: ${errorMsg}` },
            });
          }
        } else {
          set({
            isTranscribing: false,
            transcriptionProgress: null,
            notification: { type: 'error', message: `Transcription failed: ${errorMsg}` },
          });
        }
      }
    } catch (error) {
      console.error('Transcription error:', error);
      set({
        isTranscribing: false,
        transcriptionProgress: null,
        notification: { type: 'error', message: 'Transcription error' },
      });
    } finally {
      unsubscribeProgress?.();
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

    let unsubscribeProgress: (() => void) | undefined;
    try {
      set({ isTranscribing: true, transcriptionProgress: { status: 'Starting...', progress: 0 } });

      // Set up progress listener
      unsubscribeProgress = window.electronAPI.onTranscriptionProgress((progress) => {
        set({ transcriptionProgress: progress });
      });

      // Prepare clips for transcription - only include video/audio clips
      const clipsToTranscribe = state.clips
        .filter((clip) => clip.mediaType === 'video' || clip.mediaType === 'audio')
        .map((clip) => ({
          path: clip.path,
          startTime: clip.startTime,
          duration: clip.duration,
        }));

      if (clipsToTranscribe.length === 0) {
        set({
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'error', message: 'No video/audio clips to transcribe' },
        });
        return;
      }

      const response = await window.electronAPI.transcribeTimeline(clipsToTranscribe);

      if (response.success && response.result) {
        set({
          transcription: response.result,
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'success', message: 'Timeline transcription complete!' },
        });
      } else {
        set({
          isTranscribing: false,
          transcriptionProgress: null,
          notification: { type: 'error', message: `Transcription failed: ${response.error}` },
        });
      }
    } catch (error) {
      console.error('Timeline transcription error:', error);
      set({
        isTranscribing: false,
        transcriptionProgress: null,
        notification: { type: 'error', message: 'Transcription error' },
      });
    } finally {
      unsubscribeProgress?.();
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
    const { prepareCutRanges, calculateCrossfadeDuration } =
      await import('../lib/transcriptEditHelpers');

    // Get words for silence detection
    const words = state.transcription?.words || [];

    // Prepare cut ranges with professional settings
    const processedRanges = prepareCutRanges(
      deletionRanges,
      state.transcriptEditSettings,
      words.length > 0 ? words : undefined,
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
      clips = clips.map((clip) => {
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
        message: `Applied ${processedRanges.length} professional cut(s) (${totalRemoved.toFixed(2)}s removed)`,
      },
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
    setStoredString(storageKeys.activeSidebarTab, tab);
  },

  setDefaultImageDuration: (duration) => {
    set({ defaultImageDuration: duration });
  },

  setCaptionsEnabled: (enabled) => {
    set({ captionsEnabled: enabled });
  },

  setExportedVideoPath: (path) => {
    set({ exportedVideoPath: path });
  },

  addTurnAudit: (audit) => {
    set((state) => ({
      turnAudits: [
        ...state.turnAudits,
        {
          ...audit,
          id: uuidv4(),
          createdAt: Date.now(),
        },
      ].slice(-200),
    }));
  },

  getTurnAudit: (turnId) => {
    return get()
      .turnAudits.slice()
      .reverse()
      .find((audit) => audit.turnId === turnId);
  },
  getTimelineStateArtifact: () => {
    const state = get();
    const clips = [...state.clips]
      .sort((a, b) => a.startTime - b.startTime)
      .map((clip) => ({
        id: clip.id,
        name: clip.name,
        start: clip.start,
        end: clip.end,
        startTime: clip.startTime,
        duration: clip.duration,
        trackIndex: clip.trackIndex ?? 0,
        mediaType: clip.mediaType,
      }));

    return {
      timeline_version: state.timelineVersion,
      clip_count: clips.length,
      total_duration: state.getTotalDuration(),
      clips,
      style_profile: 'clean_modern',
    };
  },
}));
