import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../src/stores/useProjectStore';
import { useAiMemoryStore } from '../../src/stores/useAiMemoryStore';
import {
  buildAIProjectSnapshot,
  buildAliasedSnapshotForPlanning,
  formatSnapshotForPrompt,
} from '../../src/lib/aiProjectSnapshot';
import { buildToolCapabilityMatrix, isReadOnlyTool } from '../../src/lib/toolCapabilityMatrix';

const BASE_SUBTITLE_STYLE = {
  fontSize: 24,
  fontFamily: 'Arial',
  color: '#ffffff',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  position: 'bottom' as const,
  displayMode: 'progressive' as const,
};

beforeEach(() => {
  useProjectStore.setState({
    clips: [
      {
        id: 'clip-1',
        path: '/tmp/clip-1.mp4',
        name: 'Intro',
        duration: 6,
        sourceDuration: 10,
        start: 0,
        end: 6,
        startTime: 0,
        mediaType: 'video',
        trackIndex: 0,
        volume: 1,
        muted: false,
      },
      {
        id: 'clip-2',
        path: '/tmp/clip-2.mp4',
        name: 'B-roll',
        duration: 4,
        sourceDuration: 4,
        start: 0,
        end: 4,
        startTime: 6,
        mediaType: 'video',
        trackIndex: 0,
        volume: 0.8,
        muted: false,
      },
    ],
    selectedClipIds: ['clip-1'],
    currentTime: 2,
    isPlaying: false,
    subtitles: [
      {
        index: 1,
        startTime: 0.5,
        endTime: 1.5,
        text: 'Hello world',
      },
    ],
    subtitleStyle: BASE_SUBTITLE_STYLE,
    transcription: {
      text: 'Hello world',
      segments: [{ id: 1, start: 0.5, end: 1.5, text: 'Hello world' }],
      words: [{ word: 'Hello', start: 0.5, end: 0.8, confidence: 0.9 }],
    } as any,
    isTranscribing: false,
    exportFormat: 'mp4',
    exportResolution: 'original',
    projectPath: '/tmp/test.quickcut',
    projectId: 'project-1',
    hasUnsavedChanges: true,
    lastSaved: 1700000000000,
  });

  useAiMemoryStore.setState({
    entries: [
      {
        id: 'mem-1',
        filePath: '/tmp/clip-1.mp4',
        fileName: 'clip-1.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
        fileSize: 1024,
        duration: 10,
        status: 'completed',
        analysis: 'intro segment',
        tags: ['intro', 'speaker'],
        summary: 'Opening scene with speaker',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        clipId: 'clip-1',
      },
    ],
  } as any);
});

describe('AI contracts', () => {
  it('builds a grounded project snapshot with required sections', () => {
    const snapshot = buildAIProjectSnapshot(['get_timeline_info', 'split_clip']);

    expect(snapshot.schemaVersion).toBe('1.0');
    expect(snapshot.timeline.clipCount).toBe(2);
    expect(snapshot.timeline.totalDuration).toBe(10);
    expect(snapshot.mediaLibrary.totalAnalyzed).toBe(1);
    expect(snapshot.subtitles.count).toBe(1);
    expect(snapshot.transcript.available).toBe(true);
    expect(snapshot.constraints.supportedToolNames).toContain('split_clip');
    expect(snapshot.neverAssume.length).toBeGreaterThan(0);
  });

  it('formats prompt snapshot with truncation guard', () => {
    const snapshot = buildAIProjectSnapshot();
    const formatted = formatSnapshotForPrompt(snapshot, 'planning', 120);

    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain('Snapshot truncated');
  });

  it('builds capability matrix with safety metadata', () => {
    const matrix = buildToolCapabilityMatrix(['get_timeline_info', 'set_clip_volume']);

    expect(matrix.tools.length).toBe(2);
    expect(matrix.tools.find((tool) => tool.name === 'get_timeline_info')?.safety).toBe(
      'read_only',
    );
    expect(
      matrix.tools.find((tool) => tool.name === 'set_clip_volume')?.constraints.volume,
    ).toContain('0.0');
    expect(isReadOnlyTool('get_timeline_info')).toBe(true);
    expect(matrix.unsupportedOperations.length).toBeGreaterThan(0);
  });

  it('builds aliased planning snapshot with stable clip_* IDs', () => {
    const { snapshot, aliasMap } = buildAliasedSnapshotForPlanning([
      'get_timeline_info',
      'delete_clips',
    ]);

    expect(snapshot.timeline.clips[0].id).toBe('clip_1');
    expect(snapshot.timeline.clips[1].id).toBe('clip_2');
    expect(aliasMap.byAlias.get('clip_1')).toBe('clip-1');
    expect(aliasMap.byAlias.get('clip_2')).toBe('clip-2');
  });
});
