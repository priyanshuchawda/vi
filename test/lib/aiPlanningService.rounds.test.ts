import { describe, expect, it } from 'vitest';
import type { CompilationError } from '../../src/lib/planCompiler';
import {
  buildDurationTargetRecoveryOperations,
  shouldEscalatePlanningRounds,
  shouldRetryCompilation,
} from '../../src/lib/aiPlanningService';

describe('aiPlanningService round and retry policies', () => {
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
});
