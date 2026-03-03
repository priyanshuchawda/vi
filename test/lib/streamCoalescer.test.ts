import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStreamCoalescer } from '../../src/lib/streamCoalescer';

describe('streamCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple tiny chunks inside flush window', () => {
    const flushed: string[] = [];
    const coalescer = createStreamCoalescer({
      flushIntervalMs: 30,
      maxBufferedChars: 100,
      onFlush: (text) => flushed.push(text),
    });

    coalescer.push('He');
    coalescer.push('llo');
    coalescer.push(' ');
    coalescer.push('world');

    expect(flushed).toEqual([]);

    vi.advanceTimersByTime(31);
    expect(flushed).toEqual(['Hello world']);
  });

  it('flushes immediately when max buffer is reached', () => {
    const flushed: string[] = [];
    const coalescer = createStreamCoalescer({
      flushIntervalMs: 1000,
      maxBufferedChars: 5,
      onFlush: (text) => flushed.push(text),
    });

    coalescer.push('ab');
    coalescer.push('cd');
    expect(flushed).toEqual([]);

    coalescer.push('e');
    expect(flushed).toEqual(['abcde']);
  });

  it('flushes immediately when requested and preserves order', () => {
    const flushed: string[] = [];
    const coalescer = createStreamCoalescer({
      flushIntervalMs: 100,
      maxBufferedChars: 50,
      onFlush: (text) => flushed.push(text),
    });

    coalescer.push('first');
    coalescer.flush();
    coalescer.push('-second');
    coalescer.flush();

    expect(flushed).toEqual(['first', '-second']);
  });

  it('dispose flushes remaining text', () => {
    const flushed: string[] = [];
    const coalescer = createStreamCoalescer({
      flushIntervalMs: 100,
      maxBufferedChars: 50,
      onFlush: (text) => flushed.push(text),
    });

    coalescer.push('final text');
    coalescer.dispose();

    expect(flushed).toEqual(['final text']);
  });
});
