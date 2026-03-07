import { useProjectStore } from '../stores/useProjectStore';
import { useAiMemoryStore } from '../stores/useAiMemoryStore';
import { buildClipAliasMap, type AliasMap } from './clipAliasMapper';
import { getContextBudgetProfile } from './contextBudgetPolicy';

export type SnapshotScope = 'full' | 'planning' | 'timeline_only' | 'media_only';

export interface AIProjectSnapshot {
  schemaVersion: '1.0';
  generatedAt: string;
  timeline: {
    totalDuration: number;
    clipCount: number;
    currentTime: number;
    isPlaying: boolean;
    selectedClipIds: string[];
    clips: Array<{
      id: string;
      name: string;
      mediaType: string;
      trackIndex: number;
      selected: boolean;
      locked: boolean;
      timelineStart: number;
      timelineEnd: number;
      duration: number;
      sourceStart: number;
      sourceEnd: number;
      sourceDuration: number;
      volume: number;
      muted: boolean;
      speed: number;
    }>;
  };
  mediaLibrary: {
    totalAnalyzed: number;
    byType: Record<string, number>;
    entries: Array<{
      clipId?: string;
      fileName: string;
      mediaType: string;
      duration?: number;
      summary: string;
      tags: string[];
    }>;
  };
  subtitles: {
    count: number;
    style: {
      fontSize: number;
      fontFamily: string;
      color: string;
      backgroundColor: string;
      position: string;
      displayMode: string;
    };
    entries: Array<{
      index: number;
      startTime: number;
      endTime: number;
      text: string;
    }>;
  };
  transcript: {
    available: boolean;
    isTranscribing: boolean;
    segmentCount: number;
    wordCount: number;
  };
  exportSettings: {
    format: string;
    resolution: string;
    projectPath: string | null;
    projectId: string | null;
    hasUnsavedChanges: boolean;
    lastSaved: number | null;
  };
  constraints: {
    approvalPolicy: {
      readOnlyNoApproval: boolean;
      mutatingRequiresApproval: boolean;
    };
    executionPolicy: {
      defaultMode: 'strict_sequential';
      maxReadOnlyBatchSize: number;
      stopOnFailure: boolean;
    };
    timelineBounds: {
      minTime: number;
      maxTime: number;
      maxClipEndById: Record<string, number>;
    };
    supportedToolNames: string[];
  };
  neverAssume: string[];
}

const NEVER_ASSUME_RULES = [
  'Never assume a clip name is unique; always use clip IDs for edits.',
  'Never assume source bounds can exceed sourceDuration.',
  'Never assume transcript/subtitles exist unless snapshot confirms availability.',
  'Never assume media analysis exists for every clip.',
  'Never assume a separate approval step is required before running a supported tool.',
  'Never assume mutating operations succeeded without explicit tool success=true.',
];

export function buildAIProjectSnapshot(supportedToolNames: string[] = []): AIProjectSnapshot {
  const project = useProjectStore.getState();
  const memory = useAiMemoryStore.getState();
  const completedEntries = memory.getCompletedEntries();

  const clips = [...project.clips]
    .sort((a, b) => a.startTime - b.startTime)
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      mediaType: clip.mediaType || 'video',
      trackIndex: clip.trackIndex ?? 0,
      selected: project.selectedClipIds.includes(clip.id),
      locked: Boolean(clip.locked),
      timelineStart: clip.startTime,
      timelineEnd: clip.startTime + clip.duration,
      duration: clip.duration,
      sourceStart: clip.start,
      sourceEnd: clip.end,
      sourceDuration: clip.sourceDuration,
      volume: clip.volume ?? 1,
      muted: Boolean(clip.muted),
      speed: clip.speed ?? 1,
    }));

  const byType: Record<string, number> = {};
  for (const entry of completedEntries) {
    byType[entry.mediaType] = (byType[entry.mediaType] || 0) + 1;
  }

  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    timeline: {
      totalDuration: project.getTotalDuration(),
      clipCount: clips.length,
      currentTime: project.currentTime,
      isPlaying: project.isPlaying,
      selectedClipIds: [...project.selectedClipIds],
      clips,
    },
    mediaLibrary: {
      totalAnalyzed: completedEntries.length,
      byType,
      entries: completedEntries.map((entry) => ({
        clipId: entry.clipId,
        fileName: entry.fileName,
        mediaType: entry.mediaType,
        duration: entry.duration,
        summary: entry.summary,
        tags: entry.tags,
      })),
    },
    subtitles: {
      count: project.subtitles.length,
      style: {
        fontSize: project.subtitleStyle.fontSize,
        fontFamily: project.subtitleStyle.fontFamily,
        color: project.subtitleStyle.color,
        backgroundColor: project.subtitleStyle.backgroundColor,
        position: project.subtitleStyle.position,
        displayMode: project.subtitleStyle.displayMode,
      },
      entries: project.subtitles.map((sub) => ({
        index: sub.index,
        startTime: sub.startTime,
        endTime: sub.endTime,
        text: sub.text,
      })),
    },
    transcript: {
      available: Boolean(project.transcription),
      isTranscribing: project.isTranscribing,
      segmentCount: project.transcription?.segments?.length || 0,
      wordCount: project.transcription?.words?.length || 0,
    },
    exportSettings: {
      format: project.exportFormat,
      resolution: project.exportResolution,
      projectPath: project.projectPath,
      projectId: project.projectId,
      hasUnsavedChanges: project.hasUnsavedChanges,
      lastSaved: project.lastSaved,
    },
    constraints: {
      approvalPolicy: {
        readOnlyNoApproval: true,
        mutatingRequiresApproval: false,
      },
      executionPolicy: {
        defaultMode: 'strict_sequential',
        maxReadOnlyBatchSize: 3,
        stopOnFailure: true,
      },
      timelineBounds: {
        minTime: 0,
        maxTime: project.getTotalDuration(),
        maxClipEndById: Object.fromEntries(
          project.clips.map((clip) => [clip.id, clip.sourceDuration]),
        ),
      },
      supportedToolNames,
    },
    neverAssume: NEVER_ASSUME_RULES,
  };
}

export function pickSnapshotForScope(
  snapshot: AIProjectSnapshot,
  scope: SnapshotScope,
): Record<string, unknown> {
  if (scope === 'timeline_only') {
    return {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      timeline: snapshot.timeline,
      constraints: {
        approvalPolicy: snapshot.constraints.approvalPolicy,
        executionPolicy: snapshot.constraints.executionPolicy,
        timelineBounds: snapshot.constraints.timelineBounds,
      },
      neverAssume: snapshot.neverAssume,
    };
  }

  if (scope === 'media_only') {
    return {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      mediaLibrary: snapshot.mediaLibrary,
      transcript: snapshot.transcript,
      subtitles: {
        count: snapshot.subtitles.count,
      },
      neverAssume: snapshot.neverAssume,
    };
  }

  if (scope === 'planning') {
    const planningBudget = getContextBudgetProfile('plan');
    return {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      timeline: {
        totalDuration: snapshot.timeline.totalDuration,
        clipCount: snapshot.timeline.clipCount,
        selectedClipIds: snapshot.timeline.selectedClipIds,
        clips: snapshot.timeline.clips,
      },
      mediaLibrary: {
        totalAnalyzed: snapshot.mediaLibrary.totalAnalyzed,
        byType: snapshot.mediaLibrary.byType,
        entries: snapshot.mediaLibrary.entries.slice(0, planningBudget.maxSnapshotMediaEntries),
      },
      subtitles: {
        count: snapshot.subtitles.count,
      },
      transcript: snapshot.transcript,
      exportSettings: snapshot.exportSettings,
      constraints: snapshot.constraints,
      neverAssume: snapshot.neverAssume,
    };
  }

  return snapshot as unknown as Record<string, unknown>;
}

export function formatSnapshotForPrompt(
  snapshot: AIProjectSnapshot,
  scope: SnapshotScope = 'planning',
  maxChars: number = 4200,
): string {
  const selected = pickSnapshotForScope(snapshot, scope);
  const serialized = JSON.stringify(selected, null, 2);
  if (serialized.length <= maxChars) {
    return serialized;
  }

  return `${serialized.slice(0, maxChars)}\n[Snapshot truncated for token efficiency]`;
}

/**
 * Build aliased project snapshot for planning
 * Replaces UUID clip IDs with stable aliases (clip_1, clip_2, etc.)
 * Returns both the aliased snapshot and the alias map for later resolution
 */
export function buildAliasedSnapshotForPlanning(supportedToolNames: string[] = []): {
  snapshot: AIProjectSnapshot;
  aliasMap: AliasMap;
} {
  const fullSnapshot = buildAIProjectSnapshot(supportedToolNames);
  const project = useProjectStore.getState();

  // Build alias map from real clips
  const aliasMap = buildClipAliasMap(project.clips);

  // Create aliased clips array
  const aliasedClips = fullSnapshot.timeline.clips.map((clip, index) => {
    const alias = aliasMap.byUuid.get(clip.id) || `clip_${index + 1}`;
    return {
      ...clip,
      id: alias, // Replace UUID with alias
    };
  });

  // Create aliased selected IDs
  const aliasedSelectedIds = fullSnapshot.timeline.selectedClipIds
    .map((uuid) => aliasMap.byUuid.get(uuid))
    .filter((alias): alias is string => alias !== undefined);

  // Build aliased snapshot
  const aliasedSnapshot: AIProjectSnapshot = {
    ...fullSnapshot,
    timeline: {
      ...fullSnapshot.timeline,
      clips: aliasedClips,
      selectedClipIds: aliasedSelectedIds,
    },
    constraints: {
      ...fullSnapshot.constraints,
      timelineBounds: {
        minTime: 0,
        maxTime: fullSnapshot.timeline.totalDuration,
        maxClipEndById: Object.fromEntries(
          aliasedClips.map((clip) => [clip.id, clip.sourceDuration]),
        ),
      },
    },
    neverAssume: [
      'Never generate or invent new clip IDs - use only the provided aliases (clip_1, clip_2, etc.)',
      'Never use UUIDs - only use the clip aliases provided in the snapshot',
      'Never assume source bounds can exceed sourceDuration',
      'Never return empty operations - if uncertain, call get_timeline_info first',
      'Never assume transcript/subtitles exist unless snapshot confirms availability',
      'Never assume media analysis exists for every clip',
      'Never assume mutating operations succeeded without explicit tool success=true',
    ],
  };

  return { snapshot: aliasedSnapshot, aliasMap };
}
