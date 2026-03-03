import { describe, expect, it } from 'vitest';
import {
  inferAssistantArtifactFromText,
  resolveConversationLane,
  type ConversationLaneInput,
} from '../../src/lib/conversationLane';

function lane(input: Partial<ConversationLaneInput>) {
  return resolveConversationLane({
    message: input.message || '',
    lastAssistantMessage: input.lastAssistantMessage || '',
    lastAssistantArtifact: input.lastAssistantArtifact,
    hasTimeline: input.hasTimeline ?? true,
    hasPendingPlan: input.hasPendingPlan ?? false,
    hasRecentEditingContext: input.hasRecentEditingContext ?? false,
  });
}

describe('conversationLane phase 2 confirmation contracts', () => {
  it('infers executable script artifact when script draft asks for proceed', () => {
    const artifact = inferAssistantArtifactFromText(`
      [0:00 - 0:02] Hackathon Victory
      [0:03 - 0:05] Innovative Ideas
      Would you like to proceed with these changes?
    `);

    expect(artifact?.type).toBe('script_draft');
    expect(artifact?.executable).toBe(true);
    expect(artifact?.nextActions).toContain('apply_script_as_captions');
  });

  it('blocks yes from execution when last artifact is not executable', () => {
    const decision = lane({
      message: 'yes',
      lastAssistantMessage: 'Here is your script draft. Tell me what to improve.',
      lastAssistantArtifact: {
        type: 'script_draft',
        executable: false,
        nextActions: ['revise_script'],
      },
      hasRecentEditingContext: true,
    });

    expect(decision.lane).toBe('script_guidance');
    expect(decision.reason).toBe('confirmation_without_executable_artifact');
  });

  it('binds yes to executable script artifact action', () => {
    const decision = lane({
      message: 'yes',
      lastAssistantMessage: '[0:00 - 0:02] Hackathon Victory',
      lastAssistantArtifact: {
        type: 'script_draft',
        executable: true,
        nextActions: ['apply_script_as_captions', 'revise_script'],
      },
      hasRecentEditingContext: true,
    });

    expect(decision.lane).toBe('timeline_edit');
    expect(decision.reason).toBe('confirmation_bound_to_artifact_action');
    expect(decision.plannerInput).toContain('Apply the script from your previous response');
  });

  it('binds yes to execution-plan artifact', () => {
    const decision = lane({
      message: 'yes',
      lastAssistantMessage: 'Plan ready. Execute 2 operations.',
      lastAssistantArtifact: {
        type: 'execution_plan',
        executable: true,
        nextActions: ['execute_plan'],
      },
      hasRecentEditingContext: true,
    });

    expect(decision.lane).toBe('timeline_edit');
    expect(decision.reason).toBe('confirmation_bound_to_plan_artifact');
  });

  it('does not treat edit request prefixed with ok as plain confirmation', () => {
    const lastAssistantMessage = `Execution complete.

What I understood: Apply the script from your previous response as on-screen captions on my current timeline.

Reference script:
[00:00 - 00:02] Voiceover: "Ready for the challenge?"
[00:03 - 00:05] Voiceover: "Teamwork and creativity."
Ask for Confirmation
"Apply these as captions on timeline?"

Operations executed:
1. Execute add subtitle
2. Execute add subtitle

Timeline diff:
- Clips: 3 -> 3
- Duration: 16.3s -> 16.3s
Rollback: Use Undo to revert the changes if needed.`;

    const decision = lane({
      message: 'ok lets make photo to 7 second both',
      lastAssistantMessage,
      hasRecentEditingContext: true,
    });

    expect(decision.lane).toBe('timeline_edit');
    expect(decision.plannerInput).toBe('ok lets make photo to 7 second both');
    expect(decision.plannerInput).not.toContain('Apply the script from your previous response');
  });
});
