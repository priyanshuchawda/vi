import { describe, expect, it } from 'vitest';
import { resolveConversationLane, type ConversationLaneInput } from '../../src/lib/conversationLane';

function decide(input: Partial<ConversationLaneInput>) {
  return resolveConversationLane({
    message: input.message || '',
    lastAssistantMessage: input.lastAssistantMessage || '',
    lastActionableUserMessage: input.lastActionableUserMessage,
    lastActionableAssistantMessage: input.lastActionableAssistantMessage,
    lastActionableAssistantArtifact: input.lastActionableAssistantArtifact,
    hasTimeline: input.hasTimeline ?? true,
    hasPendingPlan: input.hasPendingPlan ?? false,
    hasRecentEditingContext: input.hasRecentEditingContext ?? false,
  });
}

describe('conversationLane phase 1', () => {
  it('keeps script-generation prompts in script guidance lane', () => {
    const result = decide({
      message:
        'you check the video and create a script for me of 16 seconds of how i won hackaton intro, should look really attractive',
    });
    expect(result.lane).toBe('script_guidance');
  });

  it('routes explicit timeline edit prompts to timeline edit lane', () => {
    const result = decide({
      message: 'trim the photo from 2 sec to 6 second and increase it',
      hasRecentEditingContext: true,
    });
    expect(result.lane).toBe('timeline_edit');
  });

  it('routes broad youtube short creation asks into the edit lane', () => {
    const result = decide({
      message:
        'create a vlog youtube short video which should be attractive lets plan properly and make this yt short video the best',
      hasRecentEditingContext: true,
    });
    expect(result.lane).toBe('timeline_edit');
  });

  it('does not execute on generic confirmation without executable artifact', () => {
    const result = decide({
      message: 'yes',
      lastAssistantMessage: 'Here is a script draft. Let me know if you want changes.',
      hasRecentEditingContext: true,
    });
    expect(result.lane).toBe('script_guidance');
    expect(result.reason).toBe('confirmation_without_executable_artifact');
  });

  it('maps yes-after-script-with-proceed into caption apply execution lane', () => {
    const result = decide({
      message: 'yes',
      lastAssistantMessage: `
        [0:00 - 0:02]
        [Text Overlay: Hackathon Victory]
        [0:03 - 0:05]
        [Text Overlay: Innovative Ideas]
        Would you like to proceed with these changes?
      `,
      hasRecentEditingContext: true,
    });
    expect(result.lane).toBe('timeline_edit');
    expect(result.reason).toBe('confirmation_bound_to_artifact_action');
    expect(result.plannerInput).toContain('Apply the script from your previous response');
  });

  it('routes yes to execution lane when a real plan artifact exists', () => {
    const result = decide({
      message: 'yes',
      lastAssistantMessage: 'Complete Execution Plan: update clip bounds on timeline',
      hasPendingPlan: true,
      hasRecentEditingContext: true,
    });
    expect(result.lane).toBe('timeline_edit');
    expect(result.reason).toBe('confirmation_bound_to_plan_artifact');
  });

  it('prints human-prompt evaluation matrix for manual review', () => {
    const scenarios = [
      {
        prompt:
          'you check the video and create a script for me of 16 seconds of how i won hackaton intro',
        lastAssistantMessage: '',
      },
      {
        prompt: 'trim the photo from 2 sec to 6 second increase it',
        lastAssistantMessage: '',
      },
      {
        prompt: 'yes',
        lastAssistantMessage:
          'Here is the script with [0:00 - 0:02] and [0:03 - 0:05]. Would you like to proceed with these changes?',
      },
      {
        prompt: 'yes',
        lastAssistantMessage: 'Sure, I can rewrite that script if you want.',
      },
    ];

    const matrix = scenarios.map((scenario) => {
      const result = decide({
        message: scenario.prompt,
        lastAssistantMessage: scenario.lastAssistantMessage,
        hasRecentEditingContext: true,
      });
      return {
        prompt: scenario.prompt,
        lane: result.lane,
        reason: result.reason,
      };
    });

    console.table(matrix);
    expect(matrix.length).toBe(4);
  });
});
