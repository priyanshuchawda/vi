import { describe, expect, it } from 'vitest';
import { classifyTransientError, getRetryDelayMs } from '../../src/lib/retryClassifier';

describe('retryClassifier', () => {
  it('classifies retryable transient errors', () => {
    expect(classifyTransientError(new Error('429 Too Many Requests')).retryable).toBe(true);
    expect(classifyTransientError(new Error('503 Service Unavailable')).retryable).toBe(true);
    expect(classifyTransientError(new Error('network timeout while fetching')).retryable).toBe(
      true,
    );
  });

  it('does not classify validation errors as retryable', () => {
    const result = classifyTransientError(new Error('Invalid clip_id provided'));
    expect(result.retryable).toBe(false);
  });

  it('uses bounded exponential backoff', () => {
    expect(getRetryDelayMs(1)).toBe(1500);
    expect(getRetryDelayMs(2)).toBe(3000);
    expect(getRetryDelayMs(3)).toBe(6000);
    expect(getRetryDelayMs(20)).toBe(15000);
  });
});
