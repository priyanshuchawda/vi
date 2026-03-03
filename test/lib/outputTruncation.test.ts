import { describe, expect, it } from 'vitest';

import {
  getToolOutputMaxChars,
  resolveToolOutputCategory,
  truncateToolResultForModel,
} from '../../src/lib/outputTruncation';

describe('outputTruncation', () => {
  it('returns original payload when under budget', () => {
    const result = truncateToolResultForModel('move_clip', {
      success: true,
      message: 'Moved clip',
      data: { clipId: 'clip_1' },
    });

    expect(result.truncated).toBe(false);
    expect(result.payload).toEqual({
      success: true,
      message: 'Moved clip',
      data: { clipId: 'clip_1' },
    });
  });

  it('truncates oversized payload with explicit markers and bounded size', () => {
    const hugePayload = {
      success: true,
      message: 'Large output',
      data: { dump: 'x'.repeat(20_000) },
    };

    const result = truncateToolResultForModel('move_clip', hugePayload);
    const serialized = JSON.stringify(result.payload);

    expect(result.truncated).toBe(true);
    expect(result.category).toBe('mutation');
    expect(serialized.length).toBeLessThanOrEqual(result.maxChars);
    expect(result.payload).toMatchObject({
      _truncated: true,
      _truncation: {
        strategy: 'head_tail_json',
      },
    });
  });

  it('uses category budgets by tool type', () => {
    expect(resolveToolOutputCategory('get_timeline_info')).toBe('state_dump');
    expect(resolveToolOutputCategory('search_clips_by_content')).toBe('search');
    expect(resolveToolOutputCategory('move_clip')).toBe('mutation');

    expect(getToolOutputMaxChars('get_timeline_info')).toBeGreaterThan(
      getToolOutputMaxChars('move_clip'),
    );
  });

  it('honors explicit maxCharsOverride budgets', () => {
    const hugePayload = {
      success: true,
      message: 'Large output',
      data: { dump: 'x'.repeat(12_000) },
    };
    const result = truncateToolResultForModel('move_clip', hugePayload, {
      maxCharsOverride: 1200,
    });

    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.payload).length).toBeLessThanOrEqual(1200);
  });
});
