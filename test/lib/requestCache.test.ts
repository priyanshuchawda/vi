import { describe, expect, it } from 'vitest';
import {
  buildCacheKey,
  clearRequestCache,
  getCached,
  normalizeMessage,
  setCached,
} from '../../src/lib/requestCache';

describe('requestCache', () => {
  it('stores and retrieves values by key', () => {
    clearRequestCache();
    const key = buildCacheKey(['chat', 'model', 'hello']);
    setCached(key, { text: 'world' }, 5_000);
    expect(getCached<{ text: string }>(key)).toEqual({ text: 'world' });
  });

  it('expires entries after TTL', async () => {
    clearRequestCache();
    const key = buildCacheKey(['plan', 'model', 'trim clip']);
    setCached(key, { ok: true }, 10);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCached<{ ok: boolean }>(key)).toBeNull();
  });

  it('normalizes message text consistently', () => {
    expect(normalizeMessage('  Trim   THIS clip  ')).toBe('trim this clip');
  });
});
