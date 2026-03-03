import { describe, expect, it } from 'vitest';
import { normalizeUserIntent } from '../../src/lib/intentNormalizer';

describe('intentNormalizer', () => {
  it('classifies create mode for build/combine requests without timeline', () => {
    const result = normalizeUserIntent(
      'I have these three videos, combine them nicely and make it modern',
      { hasTimeline: false, baseIntent: 'edit' },
    );

    expect(result.intent_type).toBe('multi_video_edit');
    expect(result.mode).toBe('create');
    expect(result.goals).toContain('combine_sources');
    expect(result.goals).toContain('style_enhancement');
    expect(result.requestedOutputs).toContain('edit_plan');
  });

  it('classifies delete mode for remove requests', () => {
    const result = normalizeUserIntent('remove that awkward pause from earlier', {
      hasTimeline: true,
      baseIntent: 'edit',
    });

    expect(result.mode).toBe('delete');
    expect(result.operationHint).toBe('delete');
    expect(result.requiresPlanning).toBe(true);
  });

  it('classifies modify mode for timeline adjustments', () => {
    const result = normalizeUserIntent('trim clip 2 from 5s to 15s and add a transition', {
      hasTimeline: true,
      baseIntent: 'edit',
    });

    expect(result.mode).toBe('modify');
    expect(result.operationHint).toBe('trim');
    expect(result.constraints.target_duration).toBe(5);
  });

  it('keeps guidance-style questions as chat_or_guidance', () => {
    const result = normalizeUserIntent('how do I make better cuts for my videos?', {
      hasTimeline: true,
      baseIntent: 'chat',
    });

    expect(result.intent_type).toBe('chat_or_guidance');
    expect(result.requiresPlanning).toBe(false);
  });

  it('marks ambiguity for vague style references', () => {
    const result = normalizeUserIntent('edit this properly like this and like that', {
      hasTimeline: true,
      baseIntent: 'edit',
    });

    expect(result.ambiguities).toContain('style_reference_missing');
    expect(result.ambiguities).toContain('target_reference_may_be_ambiguous');
  });

  it('parses layman short+script request into structured outputs', () => {
    const result = normalizeUserIntent(
      'i want to make a yt short video of 30 second, prepare a edit and script for me',
      { hasTimeline: false, baseIntent: 'edit' },
    );

    expect(result.intent_type).toBe('multi_video_edit');
    expect(result.mode).toBe('create');
    expect(result.goals).toContain('platform_optimized_output');
    expect(result.goals).toContain('script_generation');
    expect(result.constraints.platform).toBe('youtube_shorts');
    expect(result.constraints.target_duration).toBe(30);
    expect(result.requestedOutputs).toContain('edit_plan');
    expect(result.requestedOutputs).toContain('short_script_outline');
  });

  it('flags missing duration when user asks for shorts without length', () => {
    const result = normalizeUserIntent('make this a youtube short and script it', {
      hasTimeline: true,
      baseIntent: 'edit',
    });

    expect(result.mode).toBe('modify');
    expect(result.ambiguities).toContain('target_duration_missing');
    expect(result.ambiguities).toContain('script_format_unspecified');
  });
});
