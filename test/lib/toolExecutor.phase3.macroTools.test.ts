import { beforeEach, describe, expect, it } from 'vitest';
import { ToolExecutor } from '../../src/lib/toolExecutor';
import { useProjectStore } from '../../src/stores/useProjectStore';
import { useAiMemoryStore } from '../../src/stores/useAiMemoryStore';

beforeEach(() => {
  useProjectStore.setState({
    clips: [
      {
        id: 'clip-1',
        path: '/tmp/intro.mp4',
        name: 'Intro Moment',
        duration: 6.3,
        sourceDuration: 6.3,
        start: 0,
        end: 6.3,
        startTime: 0,
        mediaType: 'video',
        trackIndex: 0,
        volume: 1,
        muted: false,
      },
      {
        id: 'clip-2',
        path: '/tmp/team.mp4',
        name: 'Team Demo',
        duration: 5,
        sourceDuration: 5,
        start: 0,
        end: 5,
        startTime: 6.3,
        mediaType: 'video',
        trackIndex: 0,
        volume: 1,
        muted: false,
      },
      {
        id: 'clip-3',
        path: '/tmp/win.mp4',
        name: 'Winner Reveal',
        duration: 5,
        sourceDuration: 5,
        start: 0,
        end: 5,
        startTime: 11.3,
        mediaType: 'video',
        trackIndex: 0,
        volume: 1,
        muted: false,
      },
    ],
    subtitles: [],
    subtitleStyle: {
      fontSize: 24,
      fontFamily: 'Arial',
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      position: 'bottom',
      displayMode: 'progressive',
    },
    selectedClipIds: [],
    currentTime: 0,
    isPlaying: false,
    history: [],
    historyIndex: -1,
  } as any);

  useAiMemoryStore.setState({
    entries: [
      {
        id: 'mem-1',
        filePath: '/tmp/intro.mp4',
        fileName: 'intro.mp4',
        mediaType: 'video',
        mimeType: 'video/mp4',
        fileSize: 1234,
        duration: 6.3,
        status: 'completed',
        analysis: 'hackathon intro scene',
        tags: ['hackathon', 'demo', 'winner'],
        summary: 'Team presenting demo to judges and winning announcement.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        clipId: 'clip-1',
      },
    ],
  } as any);
});

describe('ToolExecutor phase 3 macro tools', () => {
  it('generates deterministic intro script blocks from timeline context', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [
        {
          name: 'generate_intro_script_from_timeline',
          args: {
            target_duration: 16,
            objective: 'how i won hackathon',
            tone: 'attractive',
          },
        },
      ],
      { mode: 'strict_sequential', stopOnFailure: true },
    );

    expect(results[0].result.success).toBe(true);
    const blocks = results[0].result.data?.script_blocks || [];
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(results[0].result.data?.formatted_script).toContain('[00:00 - 00:');
    const voiceovers = blocks.map((block: any) => block.voiceover);
    const uniqueVoiceovers = new Set(voiceovers);
    expect(uniqueVoiceovers.size).toBe(voiceovers.length);
  });

  it('applies script blocks as captions in a single macro call', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [
        {
          name: 'apply_script_as_captions',
          args: {
            script_blocks: [
              { start_time: 0, end_time: 2, text: 'Hackathon Victory' },
              { start_time: 2, end_time: 5, text: 'Built fast. Demoed stronger.' },
              { start_time: 5, end_time: 8, text: 'We took the winning spot.' },
            ],
            style_preset: 'bold_hype',
            replace_existing: true,
          },
        },
      ],
      { mode: 'strict_sequential', stopOnFailure: true },
    );

    expect(results[0].result.success).toBe(true);
    expect(useProjectStore.getState().subtitles.length).toBe(3);
    expect(useProjectStore.getState().subtitleStyle.fontSize).toBe(32);
  });

  it('previews caption fit and flags dense captions', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [
        {
          name: 'preview_caption_fit',
          args: {
            script_blocks: [
              {
                start_time: 0,
                end_time: 0.9,
                text: 'This is intentionally very dense text to trigger readability warnings quickly',
              },
            ],
            max_chars_per_second: 12,
            min_caption_duration: 1.2,
          },
        },
      ],
      { mode: 'strict_sequential', stopOnFailure: true },
    );

    expect(results[0].result.success).toBe(true);
    expect(results[0].result.data?.issues?.length).toBeGreaterThan(0);
    expect(results[0].result.data?.fit_score).toBeLessThan(1);
  });
});
