import { describe, expect, it } from 'vitest';
import { compilePlan, validatePlannerOutputContract } from '../../src/lib/planCompiler';
import { buildClipAliasMap } from '../../src/lib/clipAliasMapper';
import type { AIProjectSnapshot } from '../../src/lib/aiProjectSnapshot';
import type { PlannedOperation } from '../../src/lib/aiPlanningService';

const clips = [
  {
    id: 'uuid-1',
    path: '/tmp/one.mp4',
    name: 'One',
    duration: 10,
    sourceDuration: 10,
    start: 0,
    end: 10,
    startTime: 0,
    mediaType: 'video' as const,
    trackIndex: 0,
  },
];

const aliasMap = buildClipAliasMap(clips as any);

const realSnapshot: AIProjectSnapshot = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  timeline: {
    totalDuration: 10,
    clipCount: 1,
    currentTime: 0,
    isPlaying: false,
    selectedClipIds: [],
    clips: [
      {
        id: 'uuid-1',
        name: 'One',
        mediaType: 'video',
        trackIndex: 0,
        selected: false,
        locked: false,
        timelineStart: 0,
        timelineEnd: 10,
        duration: 10,
        sourceStart: 0,
        sourceEnd: 10,
        sourceDuration: 10,
        volume: 1,
        muted: false,
        speed: 1,
      },
    ],
  },
  mediaLibrary: { totalAnalyzed: 0, byType: {}, entries: [] },
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
  transcript: { available: false, isTranscribing: false, segmentCount: 0, wordCount: 0 },
  exportSettings: {
    format: 'mp4',
    resolution: 'original',
    projectPath: null,
    projectId: null,
    hasUnsavedChanges: false,
    lastSaved: null,
  },
  constraints: {
    approvalPolicy: { readOnlyNoApproval: true, mutatingRequiresApproval: true },
    executionPolicy: { defaultMode: 'strict_sequential', maxReadOnlyBatchSize: 3, stopOnFailure: true },
    timelineBounds: { minTime: 0, maxTime: 10, maxClipEndById: { 'uuid-1': 10 } },
    supportedToolNames: [],
  },
  neverAssume: [],
};

describe('planCompiler', () => {
  it('resolves alias clip IDs to UUID and validates bounds against real snapshot', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'split_clip',
          args: {
            clip_id: 'clip_1',
            time_in_clip: 2,
          },
        },
        description: 'split',
        isReadOnly: false,
      },
    ];

    const result = compilePlan(operations, aliasMap, realSnapshot);

    expect(result.errors).toHaveLength(0);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].functionCall.args.clip_id).toBe('uuid-1');
  });

  it('validates required planner output contract fields', () => {
    const valid = validatePlannerOutputContract({
      understanding: {
        goal: 'Split intro clip',
        constraints: ['Keep total duration'],
      },
      operations: [],
      riskNotes: ['No major risk'],
      planReady: true,
    });
    expect(valid.valid).toBe(true);

    const invalid = validatePlannerOutputContract({
      understanding: {
        goal: '',
        constraints: [] as string[],
      },
      operations: [] as PlannedOperation[],
      riskNotes: [] as string[],
      planReady: undefined as unknown as boolean,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.some((error) => error.includes('planReady'))).toBe(true);
  });
});
