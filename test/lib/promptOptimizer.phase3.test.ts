import { describe, expect, it } from 'vitest';
import type { ConversationLaneDecision } from '../../src/lib/conversationLane';
import { optimizePromptForLane } from '../../src/lib/promptOptimizer';

function laneDecision(lane: 'script_guidance' | 'timeline_edit'): ConversationLaneDecision {
  return {
    lane,
    plannerInput: '',
    reason: 'test',
    baseIntent: lane === 'timeline_edit' ? 'edit' : 'chat',
    normalizedIntent: {
      intent_type: lane === 'timeline_edit' ? 'multi_video_edit' : 'chat_or_guidance',
      mode: 'modify',
      goals: [],
      requestedOutputs: [],
      constraints: {},
      ambiguities: [],
      operationHint: null,
      confidence: 0.7,
      requiresPlanning: lane === 'timeline_edit',
    },
  };
}

describe('prompt optimizer phase 3', () => {
  it('rewrites layman script prompts into structured instructions', () => {
    const output = optimizePromptForLane({
      message:
        'you check the video and create a script for me of 16 seconds of how i won hackaton intro, should look really attractive',
      laneDecision: laneDecision('script_guidance'),
      timelineDuration: 16.3,
      clipCount: 3,
    });

    expect(output).toContain('Target duration: exactly 16 seconds');
    expect(output).toContain('Output format requirements');
    expect(output).toContain('Apply these as captions on timeline?');
  });

  it('keeps non-script guidance prompts unchanged', () => {
    const message = 'what export format is best for youtube shorts?';
    const output = optimizePromptForLane({
      message,
      laneDecision: laneDecision('script_guidance'),
      timelineDuration: 20,
      clipCount: 3,
    });

    expect(output).toBe(message);
  });

  it('does not rewrite timeline-edit lane messages', () => {
    const message = 'trim clip 1 from 2 sec to 6 sec';
    const output = optimizePromptForLane({
      message,
      laneDecision: laneDecision('timeline_edit'),
      timelineDuration: 20,
      clipCount: 3,
    });

    expect(output).toBe(message);
  });
});

