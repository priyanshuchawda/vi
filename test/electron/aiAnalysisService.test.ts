// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAnalysisService } from '../../electron/services/aiAnalysisService.js';

const sampleChannel = {
  channel_id: 'channel-1',
  title: 'Sample Channel',
  description: 'A sample channel',
  subscriber_count: 1000,
  video_count: 50,
  view_count: 50000,
  published_at: '2024-01-01T00:00:00.000Z',
};

const sampleVideos = [
  {
    video_id: 'video-1',
    title: 'Sample Video',
    view_count: 10000,
    like_count: 800,
    comment_count: 50,
    published_at: '2024-02-01T00:00:00.000Z',
    duration: 'PT5M',
    tags: ['sample'],
  },
];

function buildService(send: ReturnType<typeof vi.fn>) {
  return new AIAnalysisService(
    'eu-central-1',
    '',
    '',
    'eu.amazon.nova-lite-v1:0',
    undefined,
    {
      client: { send: send as (command: unknown) => Promise<any> },
      maxTransportRetries: 2,
      retryBaseDelayMs: 0,
    },
  );
}

describe('AIAnalysisService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retries retryable Bedrock transport errors and eventually succeeds', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('socket hang up while talking to Bedrock'), {
          code: 'ECONNRESET',
        }),
      )
      .mockResolvedValueOnce({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  channel_summary: 'A concise summary',
                  content_strengths: ['Strong hooks'],
                  weaknesses: ['Low upload cadence'],
                  growth_suggestions: ['Test new formats'],
                  editing_style_recommendations: ['Tighter openings'],
                  audience_insights: ['Audience likes tutorials'],
                }),
              },
            ],
          },
        },
      });

    const service = buildService(send);

    const result = await service.analyzeChannel(sampleChannel, sampleVideos, sampleVideos);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      channel_summary: 'A concise summary',
      content_strengths: ['Strong hooks'],
    });
  });

  it('does not retry expired AWS credentials', async () => {
    const send = vi.fn().mockRejectedValueOnce(
      Object.assign(
        new Error('The security token included in the request is expired'),
        {
          name: 'ExpiredTokenException',
        },
      ),
    );

    const service = buildService(send);

    const result = await service.analyzeChannel(sampleChannel, sampleVideos, sampleVideos);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});
