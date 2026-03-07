import { describe, expect, it } from 'vitest';
import { classifyIntent, classifyIntentWithContext } from '../../src/lib/intentClassifier';

describe('intentClassifier', () => {
  it('routes explicit execution confirmations to edit intent', () => {
    expect(classifyIntent('ok do it')).toBe('edit');
    expect(classifyIntent('go ahead and execute')).toBe('edit');
    expect(classifyIntent('apply that now')).toBe('edit');
  });

  it('routes video-creation and step-flow requests to edit intent', () => {
    expect(classifyIntent('How can I make a YouTube video from this script')).toBe('edit');
    expect(classifyIntent('whatever feels best to you do step by step')).toBe('edit');
    expect(classifyIntent('move next')).toBe('edit');
    expect(
      classifyIntent(
        'create a vlog youtube short video which should be attractive and make this yt short the best',
      ),
    ).toBe('edit');
  });

  it('keeps simple acknowledgements as chat', () => {
    expect(classifyIntent('ok')).toBe('chat');
    expect(classifyIntent('thanks')).toBe('chat');
  });

  it('routes short confirmations based on execution context', () => {
    expect(classifyIntentWithContext('yes do it', {})).toBe('edit');
    expect(
      classifyIntentWithContext('yes', {
        hasPendingPlan: true,
      }),
    ).toBe('edit');
    expect(classifyIntentWithContext('yes', {})).toBe('chat');
  });
});
