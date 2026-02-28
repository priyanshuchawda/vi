import { describe, expect, it } from 'vitest';
import { selectAnalysisTier } from '../../src/lib/aiMemoryService';

describe('aiMemoryService budget tiers', () => {
  it('uses low tier for large files or high queue pressure', () => {
    expect(
      selectAnalysisTier({
        mediaType: 'video',
        fileSize: 30 * 1024 * 1024,
        duration: 180,
        queueDepth: 0,
        activeAnalyses: 1,
      }),
    ).toBe('low');

    expect(
      selectAnalysisTier({
        mediaType: 'audio',
        fileSize: 2 * 1024 * 1024,
        duration: 60,
        queueDepth: 3,
        activeAnalyses: 1,
      }),
    ).toBe('low');
  });

  it('uses high tier for small images and short lightweight videos', () => {
    expect(
      selectAnalysisTier({
        mediaType: 'image',
        fileSize: 1 * 1024 * 1024,
        queueDepth: 0,
        activeAnalyses: 0,
      }),
    ).toBe('high');

    expect(
      selectAnalysisTier({
        mediaType: 'video',
        fileSize: 8 * 1024 * 1024,
        duration: 45,
        queueDepth: 1,
        activeAnalyses: 0,
      }),
    ).toBe('high');
  });

  it('uses standard tier for normal workloads', () => {
    expect(
      selectAnalysisTier({
        mediaType: 'video',
        fileSize: 10 * 1024 * 1024,
        duration: 180,
        queueDepth: 0,
        activeAnalyses: 1,
      }),
    ).toBe('standard');

    expect(
      selectAnalysisTier({
        mediaType: 'audio',
        fileSize: 4 * 1024 * 1024,
        duration: 120,
        queueDepth: 1,
        activeAnalyses: 1,
      }),
    ).toBe('standard');
  });
});
