import { describe, expect, it } from 'vitest';
import {
  buildFallbackExecutionPlan,
  generateFallbackPlan,
} from '../../src/lib/fallbackPlanGenerator';
import type { AIProjectSnapshot } from '../../src/lib/aiProjectSnapshot';
import type { AliasMap } from '../../src/lib/clipAliasMapper';

const emptyAliasMap: AliasMap = {
  byAlias: new Map(),
  byUuid: new Map(),
  metadata: new Map(),
};

function makeSnapshot(clipCount: number): AIProjectSnapshot {
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    timeline: {
      totalDuration: clipCount * 5,
      clipCount,
      currentTime: 0,
      isPlaying: false,
      selectedClipIds: [],
      clips: Array.from({ length: clipCount }).map((_, i) => ({
        id: `clip-${i + 1}`,
        name: `Clip ${i + 1}`,
        mediaType: 'video',
        trackIndex: 0,
        selected: false,
        locked: false,
        timelineStart: i * 5,
        timelineEnd: i * 5 + 5,
        duration: 5,
        sourceStart: 0,
        sourceEnd: 5,
        sourceDuration: 5,
        volume: 1,
        muted: false,
        speed: 1,
      })),
    },
    mediaLibrary: {
      totalAnalyzed: 0,
      byType: {},
      entries: [],
    },
    subtitles: {
      count: 0,
      style: {
        fontSize: 24,
        fontFamily: 'Arial',
        color: '#fff',
        backgroundColor: '#000',
        position: 'bottom',
        displayMode: 'progressive',
      },
      entries: [],
    },
    transcript: {
      available: false,
      isTranscribing: false,
      segmentCount: 0,
      wordCount: 0,
    },
    exportSettings: {
      format: 'mp4',
      resolution: 'original',
      projectPath: null,
      projectId: null,
      hasUnsavedChanges: false,
      lastSaved: null,
    },
    constraints: {
      approvalPolicy: {
        readOnlyNoApproval: true,
        mutatingRequiresApproval: true,
      },
      executionPolicy: {
        defaultMode: 'strict_sequential',
        maxReadOnlyBatchSize: 3,
        stopOnFailure: true,
      },
      timelineBounds: {
        minTime: 0,
        maxTime: clipCount * 5,
        maxClipEndById: {},
      },
      supportedToolNames: [],
    },
    neverAssume: [],
  };
}

describe('fallbackPlanGenerator', () => {
  it('creates only read-only fallback operations', () => {
    const plan = buildFallbackExecutionPlan(makeSnapshot(3), emptyAliasMap, 'yes do it');

    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0].functionCall.name).toBe('get_timeline_info');
    expect(plan.operations[0].isReadOnly).toBe(true);
    expect(plan.requiresApproval).toBe(false);
    expect(plan.planReady).toBe(false);
    expect(plan.planReadyReason).toContain('Fallback');
  });

  it('includes timeline and alias context in fallback operation description', () => {
    const aliasMap: AliasMap = {
      byAlias: new Map([
        ['clip_1', 'clip-1'],
        ['clip_2', 'clip-2'],
      ]),
      byUuid: new Map([
        ['clip-1', 'clip_1'],
        ['clip-2', 'clip_2'],
      ]),
      metadata: new Map(),
    };

    const operations = generateFallbackPlan(
      makeSnapshot(2),
      aliasMap,
      'trim first clip and align second clip immediately after it',
    );

    expect(operations).toHaveLength(1);
    expect(operations[0].description).toContain('Timeline clips: 2');
    expect(operations[0].description).toContain('Resolvable aliases: 2');
    expect(operations[0].description).toContain('User intent: "trim first clip');
  });
});
