import { describe, expect, it } from 'vitest';

import { retrieveRelevantMemory } from '../../src/lib/memoryRetrieval';
import type { MediaAnalysisEntry } from '../../src/types/aiMemory';

function entry(overrides: Partial<MediaAnalysisEntry>): MediaAnalysisEntry {
  return {
    id: overrides.id || 'id',
    filePath: overrides.filePath || '/tmp/file.mp4',
    fileName: overrides.fileName || 'file.mp4',
    mediaType: overrides.mediaType || 'video',
    mimeType: overrides.mimeType || 'video/mp4',
    fileSize: overrides.fileSize || 1024,
    status: overrides.status || 'completed',
    analysis: overrides.analysis || 'highlight moment',
    tags: overrides.tags || ['highlight'],
    summary: overrides.summary || 'highlight clip',
    scenes: overrides.scenes,
    createdAt: overrides.createdAt || 1,
    updatedAt: overrides.updatedAt || 1,
    audioInfo: overrides.audioInfo,
    visualInfo: overrides.visualInfo,
    duration: overrides.duration,
    clipId: overrides.clipId,
  };
}

describe('memoryRetrieval context budgeting', () => {
  it('uses intent profile defaults and reports dropped entries/scenes', () => {
    let droppedEntries = 0;
    let droppedScenes = 0;

    const hits = retrieveRelevantMemory({
      intent: 'chat',
      query: 'highlight viral clip',
      entries: [
        entry({
          id: 'a',
          fileName: 'alpha.mp4',
          scenes: [
            { startTime: 0, endTime: 1, description: 'highlight crowd reaction' },
            { startTime: 1, endTime: 2, description: 'viral highlight jump' },
          ],
        }),
        entry({ id: 'b', fileName: 'beta.mp4' }),
        entry({ id: 'c', fileName: 'charlie.mp4' }),
        entry({ id: 'd', fileName: 'delta.mp4' }),
        entry({ id: 'e', fileName: 'echo.mp4' }),
      ],
      onLimitsApplied: (metrics) => {
        droppedEntries = metrics.droppedEntries;
        droppedScenes = metrics.droppedScenes;
      },
    });

    expect(hits.length).toBe(4); // chat profile top-k
    expect(hits[0].matchedScenes.length).toBe(1); // chat profile scene cap
    expect(droppedEntries).toBe(1);
    expect(droppedScenes).toBeGreaterThanOrEqual(1);
  });

  it('keeps deterministic order on score ties', () => {
    const hits = retrieveRelevantMemory({
      intent: 'chat',
      query: 'highlight',
      entries: [
        entry({ id: 'b', fileName: 'beta.mp4' }),
        entry({ id: 'a', fileName: 'alpha.mp4' }),
      ],
      maxEntries: 2,
      maxScenesPerEntry: 1,
    });

    expect(hits.map((hit) => hit.entry.fileName)).toEqual(['alpha.mp4', 'beta.mp4']);
  });
});
