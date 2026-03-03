import { describe, expect, it } from 'vitest';
import { recommendExecutionPolicy } from '../../src/lib/executionConfidencePolicy';

describe('executionConfidencePolicy', () => {
  it('auto-executes high-confidence mutating plans', () => {
    const decision = recommendExecutionPolicy({
      confidenceScore: 0.92,
      mode: 'modify',
      mutating: true,
      hasAmbiguities: false,
    });

    expect(decision.recommendation).toBe('auto_execute');
  });

  it('requires preview for medium-confidence mutating plans', () => {
    const decision = recommendExecutionPolicy({
      confidenceScore: 0.72,
      mode: 'delete',
      mutating: true,
      hasAmbiguities: false,
    });

    expect(decision.recommendation).toBe('preview_required');
  });

  it('requires clarification for low confidence', () => {
    const decision = recommendExecutionPolicy({
      confidenceScore: 0.45,
      mode: 'modify',
      mutating: true,
      hasAmbiguities: false,
    });

    expect(decision.recommendation).toBe('clarify_required');
  });

  it('requires clarification when ambiguous despite high confidence', () => {
    const decision = recommendExecutionPolicy({
      confidenceScore: 0.9,
      mode: 'create',
      mutating: true,
      hasAmbiguities: true,
    });

    expect(decision.recommendation).toBe('clarify_required');
  });

  it('auto-executes read-only plans at medium confidence', () => {
    const decision = recommendExecutionPolicy({
      confidenceScore: 0.68,
      mode: 'modify',
      mutating: false,
      hasAmbiguities: false,
    });

    expect(decision.recommendation).toBe('auto_execute');
  });
});
