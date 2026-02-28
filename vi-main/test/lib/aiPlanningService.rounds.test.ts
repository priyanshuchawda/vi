import { describe, expect, it } from 'vitest';
import type { CompilationError } from '../../src/lib/planCompiler';
import {
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
});
