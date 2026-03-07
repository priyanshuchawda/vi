import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../../src/lib/toolExecutor';
import { useProjectStore } from '../../src/stores/useProjectStore';
import { useAiMemoryStore } from '../../src/stores/useAiMemoryStore';
import { resolveConversationLane } from '../../src/lib/conversationLane';
import { optimizePromptForLane } from '../../src/lib/promptOptimizer';

function seedState(): void {
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
        path: '/tmp/demo.mp4',
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
        path: '/tmp/win.jpg',
        name: 'Winner Photo',
        duration: 5,
        sourceDuration: 8,
        start: 0,
        end: 5,
        startTime: 11.3,
        mediaType: 'image',
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
        analysis: 'hackathon intro',
        tags: ['hackathon', 'demo', 'winner'],
        summary: 'Team presenting demo to judges and winning announcement.',
        scenes: [{ startTime: 0.5, endTime: 3.8, description: 'demo to judges' }],
        audioInfo: {
          hasSpeech: true,
          hasMusic: false,
          transcriptSummary: 'we showed the final demo to the judges',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        clipId: 'clip-1',
      },
    ],
  } as any);
}

describe('phase 5 layman quality smoke', () => {
  it('improves layman script handling with structured prompt and non-repetitive lines', async () => {
    seedState();
    const message =
      'you check the video and create a script for me of 16 seconds of how i won hackaton intro, should look really attractive';
    const lane = resolveConversationLane({
      message,
      lastAssistantMessage: '',
      hasTimeline: true,
      hasPendingPlan: false,
      hasRecentEditingContext: true,
    });
    const optimized = optimizePromptForLane({
      message,
      laneDecision: lane,
      timelineDuration: useProjectStore.getState().getTotalDuration(),
      clipCount: useProjectStore.getState().clips.length,
    });

    const result = (
      await ToolExecutor.executeWithPolicy(
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
      )
    )[0];

    const blocks = result.result.data?.script_blocks || [];
    const voiceovers = blocks.map((block: any) => block.voiceover);
    const uniqueVoiceovers = new Set(voiceovers);

    console.table({
      lane: lane.lane,
      lane_reason: lane.reason,
      optimized_includes_distinct_rule: optimized.includes('Each beat should feel distinct'),
      beats: blocks.length,
      unique_voiceovers: uniqueVoiceovers.size,
    });

    expect(lane.lane).toBe('script_guidance');
    expect(optimized).toContain('Avoid repeating the same sentence starter');
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(uniqueVoiceovers.size).toBe(voiceovers.length);
    expect(voiceovers.join(' ').toLowerCase()).toMatch(/judges|demo|winner/);
  });
});
