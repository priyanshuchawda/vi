import { describe, expect, it } from 'vitest';
import {
  formatRetrievedMemoryContext,
  retrieveRelevantMemory,
} from '../../src/lib/memoryRetrieval';
import type { MediaAnalysisEntry } from '../../src/types/aiMemory';

function buildEntry(overrides: Partial<MediaAnalysisEntry>): MediaAnalysisEntry {
  return {
    id: overrides.id || 'e-1',
    filePath: overrides.filePath || '/tmp/a.mp4',
    fileName: overrides.fileName || 'a.mp4',
    mediaType: overrides.mediaType || 'video',
    mimeType: overrides.mimeType || 'video/mp4',
    fileSize: overrides.fileSize || 1024,
    duration: overrides.duration,
    status: overrides.status || 'completed',
    analysis: overrides.analysis || '',
    tags: overrides.tags || [],
    summary: overrides.summary || '',
    scenes: overrides.scenes,
    audioInfo: overrides.audioInfo,
    visualInfo: overrides.visualInfo,
    createdAt: overrides.createdAt || Date.now(),
    updatedAt: overrides.updatedAt || Date.now(),
    clipId: overrides.clipId,
    thumbnail: overrides.thumbnail,
    error: overrides.error,
  };
}

describe('memoryRetrieval', () => {
  it('prioritizes relevant winner/award entries for shorts query', () => {
    const entries: MediaAnalysisEntry[] = [
      buildEntry({
        id: 'winner',
        fileName: 'award.mp4',
        summary: 'Team receives award on stage',
        tags: ['award', 'winner', 'celebration'],
        duration: 18,
        scenes: [{ startTime: 2, endTime: 8, description: 'winners get award' }],
      }),
      buildEntry({
        id: 'low',
        fileName: 'desk.mp4',
        summary: 'quiet desk scene',
        tags: ['office', 'work'],
        duration: 75,
      }),
    ];

    const hits = retrieveRelevantMemory({
      query: 'best 30s youtube short highlight winner moment',
      entries,
      maxEntries: 2,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe('winner');
  });

  it('returns compact retrieved memory prompt context', () => {
    const hits = retrieveRelevantMemory({
      query: 'script from speech',
      entries: [
        buildEntry({
          id: 'speech',
          fileName: 'talk.mp4',
          summary: 'speaker explains hackathon result',
          tags: ['speech', 'result'],
          audioInfo: {
            hasSpeech: true,
            hasMusic: false,
            transcriptSummary: 'team won second place',
          },
        }),
      ],
      maxEntries: 3,
      maxScenesPerEntry: 2,
    });

    const context = formatRetrievedMemoryContext(hits, 'script from speech', 600);
    expect(context).toContain('<retrieved-memory');
    expect(context).toContain('Top relevant analyzed assets');
    expect(context.length).toBeLessThanOrEqual(650);
  });
});
