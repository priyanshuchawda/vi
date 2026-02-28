import { describe, expect, it, vi } from 'vitest';
import {
  buildSemanticCacheKey,
  clearRequestCache,
  getCached,
  normalizeMessage,
  setCached,
} from '../../src/lib/requestCache';

describe('requestCache', () => {
  it('stores and retrieves values by key', () => {
    clearRequestCache();
    const key = buildSemanticCacheKey({
      intent: 'chat',
      modelId: 'model',
      message: 'hello',
      mode: 'stream',
    });
    setCached(key, { text: 'world' }, 5_000);
    expect(getCached<{ text: string }>(key)).toEqual({ text: 'world' });
  });

  it('expires entries after TTL', async () => {
    clearRequestCache();
    const key = buildSemanticCacheKey({
      intent: 'plan',
      modelId: 'model',
      message: 'trim clip',
    });
    setCached(key, { ok: true }, 10);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCached<{ ok: boolean }>(key)).toBeNull();
  });

  it('normalizes message text consistently', () => {
    expect(normalizeMessage('  Trim   THIS clip  ')).toBe('trim this clip');
  });

  it('hydrates persisted entries across module reload', async () => {
    clearRequestCache();
    const key = buildSemanticCacheKey({
      intent: 'chat',
      modelId: 'model',
      message: 'persist me',
    });
    setCached(key, { text: 'cached' }, 5_000);

    vi.resetModules();
    const reloaded = await import('../../src/lib/requestCache');
    expect(reloaded.getCached<{ text: string }>(key)).toEqual({ text: 'cached' });
    reloaded.clearRequestCache();
  });
});
