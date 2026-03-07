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
    executionPolicy: {
      defaultMode: 'strict_sequential',
      maxReadOnlyBatchSize: 3,
      stopOnFailure: true,
    },
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

  it('enforces non-destructive-default by dropping delete operations without explicit delete intent', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'delete_clips',
          args: {
            clip_ids: ['clip_1'],
          },
        },
        description: 'delete',
        isReadOnly: false,
      },
    ];

    const result = compilePlan(operations, aliasMap, realSnapshot, {
      userMessage: 'make the flow smoother',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: ['smooth_transitions'],
        requestedOutputs: ['edit_plan'],
        constraints: {},
        ambiguities: [],
        operationHint: null,
        confidence: 0.7,
        requiresPlanning: true,
      },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.operations).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('non-destructive-default policy'))).toBe(true);
  });

  it('allows delete operations when user intent is explicitly destructive', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'delete_clips',
          args: {
            clip_ids: ['clip_1'],
          },
        },
        description: 'delete',
        isReadOnly: false,
      },
    ];

    const result = compilePlan(operations, aliasMap, realSnapshot, {
      userMessage: 'delete first clip',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.operations).toHaveLength(1);
  });

  it('preserves clip order by default by dropping move_clip unless reorder is explicit', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'move_clip',
          args: {
            clip_id: 'clip_1',
            start_time: 4,
          },
        },
        description: 'move',
        isReadOnly: false,
      },
    ];

    const implicit = compilePlan(operations, aliasMap, realSnapshot, {
      userMessage: 'make this better',
    });
    expect(implicit.errors).toHaveLength(0);
    expect(implicit.operations).toHaveLength(0);
    expect(implicit.warnings.some((w) => w.includes('preserve clip order'))).toBe(true);

    const explicit = compilePlan(operations, aliasMap, realSnapshot, {
      userMessage: 'reorder clips and move clip 1 after intro',
    });
    expect(explicit.errors).toHaveLength(0);
    expect(explicit.operations).toHaveLength(1);
  });

  it('keeps real timeline edit tools for Shorts requests that also ask for script and duration', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'update_clip_bounds',
          args: {
            clip_id: 'clip_1',
            new_start: 0,
            new_end: 8,
          },
        },
        description: 'trim for hook',
        isReadOnly: false,
      },
      {
        round: 1,
        functionCall: {
          name: 'generate_intro_script_from_timeline',
          args: {
            target_duration: 30,
            objective: 'how i won the hackathon',
          },
        },
        description: 'generate script',
        isReadOnly: false,
      },
    ];

    const result = compilePlan(operations, aliasMap, realSnapshot, {
      userMessage: 'make a 30 second youtube short with script and full editing',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: ['script_generation', 'platform_optimized_output'],
        requestedOutputs: ['edit_plan', 'short_script_outline'],
        constraints: {
          target_duration: 30,
          target_duration_unit: 'seconds',
          platform: 'youtube_shorts',
        },
        ambiguities: [],
        operationHint: 'script_outline',
        confidence: 0.9,
        requiresPlanning: true,
      },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].functionCall.name).toBe('update_clip_bounds');
  });

  it('auto-repairs out-of-range split bounds by clamping time_in_clip', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'split_clip',
          args: {
            clip_id: 'clip_1',
            time_in_clip: 100,
          },
        },
        description: 'split',
        isReadOnly: false,
      },
    ];

    const result = compilePlan(operations, aliasMap, realSnapshot);

    expect(result.errors).toHaveLength(0);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].functionCall.args.time_in_clip).toBeCloseTo(9.95, 2);
    expect(result.warnings.some((w) => w.includes('time_in_clip'))).toBe(true);
  });

  it('blocks non-caption timeline mutations for direct caption-apply intents', () => {
    const operations: PlannedOperation[] = [
      {
        round: 1,
        functionCall: {
          name: 'update_clip_bounds',
          args: {
            clip_id: 'clip_1',
            new_start: 2,
            new_end: 6,
          },
        },
        description: 'trim clip',
        isReadOnly: false,
      },
      {
        round: 1,
        functionCall: {
          name: 'apply_script_as_captions',
          args: {
            script_blocks: [{ start_time: 0, end_time: 2, text: 'Hackathon Victory' }],
          },
        },
        description: 'apply script',
        isReadOnly: false,
      },
    ];

    const result = compilePlan(operations, aliasMap, realSnapshot, {
      userMessage: 'apply these captions on timeline',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: ['script_generation'],
        requestedOutputs: ['subtitle_plan'],
        constraints: {},
        ambiguities: [],
        operationHint: 'subtitle',
        confidence: 0.72,
        requiresPlanning: true,
      },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].functionCall.name).toBe('apply_script_as_captions');
    expect(result.warnings.some((w) => w.includes('caption-apply intent'))).toBe(true);
  });
});
