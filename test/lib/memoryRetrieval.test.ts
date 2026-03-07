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
    editorialInsights: overrides.editorialInsights,
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

  it('surfaces editorial insights for shorts-style retrieval', () => {
    const hits = retrieveRelevantMemory({
      query: 'viral hook overlay for youtube shorts vlog',
      entries: [
        buildEntry({
          id: 'hooky',
          fileName: 'ocean.mp4',
          summary: 'Boat vlog hook with birds swarming over the ocean.',
          tags: ['ocean', 'boat', 'birds', 'vlog', 'hook'],
          editorialInsights: {
            shortFormPotential: 'high',
            memoryAnchors: ['Birds rush overhead', 'Boat moving across open sea'],
            recommendedUses: ['opening hook', 'payoff'],
            overlayIdeas: ['POV: the sea showed off'],
            hookMoments: ['Birds rush the boat in the first two seconds'],
          },
        }),
      ],
      maxEntries: 3,
    });

    expect(hits[0].entry.id).toBe('hooky');

    const context = formatRetrievedMemoryContext(
      hits,
      'viral hook overlay for youtube shorts vlog',
      800,
    );
    expect(context).toContain('shorts: high');
    expect(context).toContain('overlays: POV: the sea showed off');
    expect(context).toContain('memory: Birds rush overhead');
  });

  it('prioritizes winner-proof images over behind-the-scenes work for hackathon intro asks', () => {
    const entries: MediaAnalysisEntry[] = [
      buildEntry({
        id: 'proof-image',
        fileName: 'winner-post.jpeg',
        mediaType: 'image',
        summary: 'Screenshot announcing the winning team in a cybersecurity hackathon.',
        tags: ['hackathon', 'winner', 'award', 'team'],
        visualInfo: {
          style: 'announcement screenshot',
          quality: 'good',
          visibleTextHighlights: ['winning teams', 'AllKnighters', 'cyber security'],
        },
        editorialInsights: {
          shortFormPotential: 'medium',
          storyRole: 'proof',
          evidenceStrength: 'high',
          memoryAnchors: ['Winner announcement screenshot', 'AllKnighters visible on screen'],
          recommendedUses: ['proof/demo', 'payoff'],
        },
      }),
      buildEntry({
        id: 'bts-video',
        fileName: 'office-work.mp4',
        mediaType: 'video',
        summary: 'Two teammates work on laptops in an office.',
        tags: ['office', 'work', 'laptop', 'team'],
        editorialInsights: {
          shortFormPotential: 'medium',
          storyRole: 'behind_the_scenes',
          evidenceStrength: 'low',
          recommendedUses: ['b-roll', 'setup'],
        },
      }),
    ];

    const hits = retrieveRelevantMemory({
      query: 'create a 16 second intro of how i won the hackathon with proof first',
      entries,
      maxEntries: 2,
    });

    expect(hits.length).toBe(2);
    expect(hits[0].entry.id).toBe('proof-image');
  });

  it('matches scene search hints and edit value for generic editing asks', () => {
    const entries: MediaAnalysisEntry[] = [
      buildEntry({
        id: 'process-video',
        fileName: 'build.mp4',
        summary: 'Team assembling and testing a prototype on a desk.',
        scenes: [
          {
            startTime: 1,
            endTime: 4,
            description: 'Hands connect wires on a prototype board.',
            storyRole: 'behind_the_scenes',
            editValue: 'Useful process shot before the final reveal.',
            searchHints: ['prototype wiring', 'building process', 'hands on desk'],
          },
        ],
        editorialInsights: {
          storyRole: 'behind_the_scenes',
          bestFor: ['process montage', 'setup'],
        },
      }),
    ];

    const hits = retrieveRelevantMemory({
      query: 'show the building process before the reveal',
      entries,
      maxEntries: 1,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].entry.id).toBe('process-video');
  });
});
