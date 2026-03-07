import { describe, expect, it } from 'vitest';
import type { CompilationError } from '../../src/lib/planCompiler';
import {
  buildDurationTargetRecoveryOperations,
  shouldEscalatePlanningRounds,
  shouldRetryCompilation,
} from '../../src/lib/aiPlanningService';
import { useAiMemoryStore } from '../../src/stores/useAiMemoryStore';

describe('aiPlanningService round and retry policies', () => {
  it('builds story-aware reorder and trim operations for shorts duration recovery', () => {
    useAiMemoryStore.setState({
      entries: [
        {
          id: 'm1',
          filePath: '/tmp/build.mp4',
          fileName: 'build.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSize: 1,
          duration: 8,
          status: 'completed',
          analysis: 'team build candid',
          tags: ['hackathon', 'team', 'workspace'],
          summary: 'Team at desk building the prototype.',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          clipId: 'build',
        },
        {
          id: 'm2',
          filePath: '/tmp/demo.mp4',
          fileName: 'demo.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSize: 1,
          duration: 7,
          status: 'completed',
          analysis: 'demo to judges',
          tags: ['demo', 'judges'],
          summary: 'Team presenting demo to judges.',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          clipId: 'proof',
        },
        {
          id: 'm3',
          filePath: '/tmp/win.jpg',
          fileName: 'win.jpg',
          mediaType: 'image',
          mimeType: 'image/jpeg',
          fileSize: 1,
          duration: 5,
          status: 'completed',
          analysis: 'winner announcement',
          tags: ['winner', 'award', 'second place'],
          summary: 'Announcement shows second place award result.',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          clipId: 'payoff',
        },
      ],
    } as never);

    const operations = buildDurationTargetRecoveryOperations({
      userMessage: 'make a 30 second youtube short about how we won the hackathon',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: ['platform_optimized_output', 'script_generation'],
        requestedOutputs: ['edit_plan', 'short_script_outline'],
        constraints: {
          target_duration: 18,
          target_duration_unit: 'sec',
          platform: 'youtube_shorts',
        },
        ambiguities: [],
        operationHint: 'script_outline',
        confidence: 0.92,
        requiresPlanning: true,
      },
      snapshot: {
        timeline: {
          totalDuration: 24,
          clips: [
            {
              id: 'build',
              name: 'Team Candid',
              path: '/tmp/build.mp4',
              mediaType: 'video',
              duration: 8,
              startTime: 0,
              trackIndex: 0,
              sourceStart: 0,
              sourceEnd: 8,
              sourceDuration: 8,
            },
            {
              id: 'payoff',
              name: 'Winner Screenshot',
              path: '/tmp/win.jpg',
              mediaType: 'image',
              duration: 9,
              startTime: 8,
              trackIndex: 0,
              sourceStart: 0,
              sourceEnd: 9,
              sourceDuration: 12,
            },
            {
              id: 'proof',
              name: 'Demo Clip',
              path: '/tmp/demo.mp4',
              mediaType: 'video',
              duration: 7,
              startTime: 17,
              trackIndex: 0,
              sourceStart: 0,
              sourceEnd: 7,
              sourceDuration: 7,
            },
          ],
        },
      },
    });

    expect(operations.length).toBeGreaterThanOrEqual(4);
    expect(operations.some((op) => op.functionCall.name === 'move_clip')).toBe(true);
    expect(operations.filter((op) => op.functionCall.name === 'update_clip_bounds')).toHaveLength(3);

    const moveOps = operations.filter((op) => op.functionCall.name === 'move_clip');
    const payoffMove = moveOps.find((op) => op.functionCall.args.clip_id === 'payoff');
    expect(payoffMove).toBeTruthy();
    expect(Number(payoffMove?.functionCall.args.start_time || 0)).toBeGreaterThan(0);
    expect(moveOps.some((op) => op.functionCall.args.clip_id === 'proof')).toBe(true);

    const trimOps = operations.filter((op) => op.functionCall.name === 'update_clip_bounds');
    const totalTrimmed = trimOps.reduce((sum, op) => {
      const args = op.functionCall.args as { new_start: number; new_end: number };
      return sum + (args.new_end - args.new_start);
    }, 0);
    expect(totalTrimmed).toBeCloseTo(18, 1);
  });

  it('escalates from round 2 to round 3 only when unresolved operations remain', () => {
    expect(
      shouldEscalatePlanningRounds({
        currentRound: 2,
        allowedRounds: 2,
        operationsAddedThisRound: 2,
        toolCallsInRound: 2,
      }),
    ).toBe(true);
  });

  it('does not escalate when no operations were added in the capped round', () => {
    expect(
      shouldEscalatePlanningRounds({
        currentRound: 2,
        allowedRounds: 2,
        operationsAddedThisRound: 0,
        toolCallsInRound: 2,
      }),
    ).toBe(false);
  });

  it('does not escalate when already below allowed round or already at hard cap', () => {
    expect(
      shouldEscalatePlanningRounds({
        currentRound: 1,
        allowedRounds: 2,
        operationsAddedThisRound: 1,
        toolCallsInRound: 1,
      }),
    ).toBe(false);

    expect(
      shouldEscalatePlanningRounds({
        currentRound: 3,
        allowedRounds: 3,
        operationsAddedThisRound: 1,
        toolCallsInRound: 1,
      }),
    ).toBe(false);
  });

  it('retries compilation only for recoverable error categories', () => {
    const recoverable: CompilationError[] = [
      {
        operationIndex: 0,
        toolName: 'split_clip',
        category: 'invalid_bounds',
        message: 'Out of range',
      },
      {
        operationIndex: 1,
        toolName: 'move_clip',
        category: 'invalid_alias',
        message: 'Unknown alias',
      },
    ];
    const nonRecoverable: CompilationError[] = [
      {
        operationIndex: 0,
        toolName: 'imaginary_tool',
        category: 'unknown_tool',
        message: 'Unknown tool',
      },
    ];

    expect(shouldRetryCompilation(recoverable)).toBe(true);
    expect(shouldRetryCompilation(nonRecoverable)).toBe(false);
    expect(shouldRetryCompilation([])).toBe(false);
  });

  it('builds executable trim operations for explicit target duration requests', () => {
    const operations = buildDurationTargetRecoveryOperations({
      userMessage: 'i want duration to be 20 secs only',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: [],
        requestedOutputs: ['edit_plan'],
        constraints: {
          target_duration: 20,
          target_duration_unit: 'sec',
        },
        ambiguities: [],
        operationHint: 'trim',
        confidence: 0.9,
        requiresPlanning: true,
      },
      snapshot: {
        timeline: {
          totalDuration: 25,
          clips: [
            {
              id: 'c1',
              duration: 6,
              sourceStart: 0,
              sourceEnd: 6,
              sourceDuration: 30,
            },
            {
              id: 'c2',
              duration: 7,
              sourceStart: 0,
              sourceEnd: 7,
              sourceDuration: 30,
            },
            {
              id: 'c3',
              duration: 5,
              sourceStart: 0,
              sourceEnd: 5,
              sourceDuration: 30,
            },
            {
              id: 'c4',
              duration: 7,
              sourceStart: 0,
              sourceEnd: 7,
              sourceDuration: 30,
            },
          ],
        },
      },
    });

    expect(operations).toHaveLength(4);
    expect(operations.every((op) => op.functionCall.name === 'update_clip_bounds')).toBe(true);
    expect(operations.every((op) => op.isReadOnly === false)).toBe(true);
  });

  it('returns no recovery operations when target duration is missing', () => {
    const operations = buildDurationTargetRecoveryOperations({
      userMessage: 'make this better',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: [],
        requestedOutputs: ['edit_plan'],
        constraints: {},
        ambiguities: [],
        operationHint: null,
        confidence: 0.6,
        requiresPlanning: true,
      },
      snapshot: {
        timeline: {
          totalDuration: 25,
          clips: [
            {
              id: 'c1',
              duration: 12,
              sourceStart: 0,
              sourceEnd: 12,
              sourceDuration: 30,
            },
            {
              id: 'c2',
              duration: 13,
              sourceStart: 0,
              sourceEnd: 13,
              sourceDuration: 30,
            },
          ],
        },
      },
    });

    expect(operations).toHaveLength(0);
  });

  it('builds executable expansion operations when target duration is above current total', () => {
    const operations = buildDurationTargetRecoveryOperations({
      userMessage: 'make this exactly 30 seconds',
      normalizedIntent: {
        intent_type: 'multi_video_edit',
        mode: 'modify',
        goals: [],
        requestedOutputs: ['edit_plan'],
        constraints: {
          target_duration: 30,
          target_duration_unit: 'seconds',
        },
        ambiguities: [],
        operationHint: 'trim',
        confidence: 0.9,
        requiresPlanning: true,
      },
      snapshot: {
        timeline: {
          totalDuration: 15,
          clips: [
            {
              id: 'c1',
              mediaType: 'video',
              duration: 10,
              sourceStart: 0,
              sourceEnd: 10,
              sourceDuration: 10,
              speed: 1,
            },
            {
              id: 'c2',
              mediaType: 'video',
              duration: 5,
              sourceStart: 0,
              sourceEnd: 5,
              sourceDuration: 5,
              speed: 1,
            },
          ],
        },
      },
    });

    expect(operations).toHaveLength(1);
    expect(operations[0].functionCall.name).toBe('set_clip_speed');
    expect(operations[0].isReadOnly).toBe(false);
  });
});
