import { classifyIntentWithContext, type MessageIntent } from './intentClassifier';
import { normalizeUserIntent, type NormalizedIntent } from './intentNormalizer';
import type { ChatMessage } from '../types/chat';

export type ConversationLane = 'script_guidance' | 'timeline_edit';

export interface ConversationLaneInput {
  message: string;
  lastAssistantMessage: string;
  lastAssistantArtifact?: NonNullable<ChatMessage['metadata']>['artifact'];
  lastActionableUserMessage?: string;
  lastActionableAssistantMessage?: string;
  lastActionableAssistantArtifact?: NonNullable<ChatMessage['metadata']>['artifact'];
  hasTimeline: boolean;
  hasPendingPlan: boolean;
  hasRecentEditingContext: boolean;
}

export interface ConversationLaneDecision {
  lane: ConversationLane;
  plannerInput: string;
  reason: string;
  baseIntent: MessageIntent;
  normalizedIntent: NormalizedIntent;
}

export function inferAssistantArtifactFromText(
  text: string,
): NonNullable<ChatMessage['metadata']>['artifact'] | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  if (looksLikeExecutionResult(trimmed)) {
    return {
      type: 'tool_execution_result',
      executable: false,
      nextActions: ['undo_last_action', 'refine_request'],
    };
  }

  if (looksLikeExecutionPlan(trimmed)) {
    return {
      type: 'execution_plan',
      executable: true,
      nextActions: ['execute_plan', 'refine_plan', 'reject_plan'],
    };
  }

  if (looksLikeScriptDraft(trimmed)) {
    const executable = scriptDraftOffersExecution(trimmed);
    return {
      type: 'script_draft',
      executable,
      nextActions: executable ? ['apply_script_as_captions', 'revise_script'] : ['revise_script'],
    };
  }

  return null;
}

export function isExecutionConfirmation(input: string): boolean {
  const text = input.toLowerCase().trim();
  if (!text) return false;

  const normalized = text
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const explicitConfirmation =
    /^(yes|ok|okay|sure|continue|proceed|go ahead|do it|yes do it|yes[,.]? do it|just do it|execute|apply( it| that)?|make it|run it|let's do it|let's go|yep|yeah|confirm)(?: please)?(?: with (?:the )?(?:changes?|edits?|plan|this|that|it))?[.!?]*$/.test(
      normalized,
    ) ||
    /^(yes|ok|okay|sure)(?: please)? (?:proceed|continue|execute|run|go ahead)(?: with (?:the )?(?:changes?|edits?|plan|this|that|it))?[.!?]*$/.test(
      normalized,
    );
  if (!explicitConfirmation) return false;

  const hasConcreteEditSignal =
    /\b(trim|cut|clip|clips|photo|image|video|caption|subtitle|timeline|second|seconds|sec|duration|speed|volume|transition|script|add|remove|move|split|merge|resize|crop)\b/.test(
      text,
    );
  return !hasConcreteEditSignal;
}

export function isAmbiguousContinuation(input: string): boolean {
  const text = input.toLowerCase().trim();
  return (
    /\b(yes|ok|okay|sure|continue|next|step by step|move next)\b/.test(text) && text.length <= 60
  );
}

export function looksLikeEditPlan(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('step-by-step') ||
    lower.includes('editing process') ||
    lower.includes('execution plan') ||
    lower.includes('timeline') ||
    lower.includes('split') ||
    lower.includes('clip') ||
    lower.includes('add subtitle') ||
    lower.includes('caption')
  );
}

export function looksLikeScriptDraft(text: string): boolean {
  const lower = text.toLowerCase();
  const timestampMatches =
    lower.match(/\[\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\]/g) || lower.match(/\b0:[0-5]\d\b/g) || [];
  const hasScriptKeywords =
    /\b(voiceover|text overlay|on-screen text|caption|subtitle|script)\b/.test(lower);
  return (hasScriptKeywords && timestampMatches.length > 0) || timestampMatches.length >= 2;
}

export function scriptDraftOffersExecution(text: string): boolean {
  if (!looksLikeScriptDraft(text)) return false;
  return /\b(would you like to proceed|ready for the next steps|confirm if you'?re ready|apply these as captions(?: on timeline)?)\b/i.test(
    text,
  );
}

function looksLikeExecutionResult(text: string): boolean {
  return /execution complete|operations executed|timeline diff:|rollback: use undo/i.test(text);
}

function looksLikeExecutionPlan(text: string): boolean {
  return /complete execution plan|plan ready|execute \(\d+\)/i.test(text);
}

export function buildCaptionApplyRequest(lastAssistantMessage: string): string {
  const compactScript = lastAssistantMessage.replace(/\s+/g, ' ').slice(0, 2400);
  return `Apply the script from your previous response as on-screen captions on my current timeline.

Requirements:
- Prefer preview_caption_fit and apply_script_as_captions so this runs in one reliable pass.
- Only fall back to atomic subtitle tools if the macro path cannot represent the script.
- Keep the final caption sequence within the timeline duration.
- Preserve my existing clips; do not trim or reorder unless absolutely required.
- Use concise, attractive caption text matching the script tone.

Reference script:
${compactScript}`;
}

function compactText(text: string, maxLength = 2400): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function shouldResumeFullEditRequest(message: string): boolean {
  const lower = String(message || '').toLowerCase();
  if (!lower) return false;

  const hasCaptionOnlyIntent =
    /\b(apply|add|put|insert|use)\b/.test(lower) &&
    /\b(caption|captions|subtitle|subtitles)\b/.test(lower) &&
    !/\b(trim|edit|editing|timeline|clip|clips|duration|seconds?|shorts|reel|tiktok|views|viral|speed|arrange|modify)\b/.test(
      lower,
    );

  if (hasCaptionOnlyIntent) {
    return false;
  }

  return /\b(trim|edit|editing|timeline|clip|clips|duration|seconds?|shorts|reel|tiktok|views|viral|speed|arrange|modify|script|voiceover|hook|story|youtube short|yt short)\b/.test(
    lower,
  );
}

export function buildAutonomousResumeRequest(
  originalUserMessage: string,
  referenceAssistantMessage?: string,
): string {
  const compactOriginal = compactText(originalUserMessage, 1200);
  const compactReference = compactText(referenceAssistantMessage || '', 2400);
  const referenceBlock = compactReference
    ? `\n\nReference draft/context from the previous assistant response:\n${compactReference}`
    : '';

  return `Continue the previous editing request and complete it end-to-end.

Original request:
${compactOriginal}

Execution requirements:
- Treat this as a full autonomous editing task, not a partial single-step change.
- If the request includes a target duration, fill that duration with real visible content, not empty gaps.
- Re-check the timeline/media state after meaningful edits and keep iterating until the request is actually complete.
- Use the reference draft/context below as guidance for scripting, captions, and pacing when helpful.
- Prefer reliable macro tools for script/caption application, but keep editing the timeline if the overall short is still incomplete.
- Do not stop after only trimming/extending/moving one clip if the broader request still is not satisfied.${referenceBlock}`;
}

function deriveIntentForMessage(
  message: string,
  input: Pick<ConversationLaneInput, 'hasTimeline' | 'hasPendingPlan' | 'hasRecentEditingContext'>,
): {
  baseIntent: MessageIntent;
  normalizedIntent: NormalizedIntent;
} {
  const baseIntent = classifyIntentWithContext(message, {
    hasPendingPlan: input.hasPendingPlan,
    hasRecentEditingContext: input.hasRecentEditingContext,
  });

  const normalizedIntent = normalizeUserIntent(message, {
    hasTimeline: input.hasTimeline,
    baseIntent,
    hasPendingPlan: input.hasPendingPlan,
    hasRecentEditingContext: input.hasRecentEditingContext,
  });

  return { baseIntent, normalizedIntent };
}

export function hasRecentEditingContext(
  messages: Array<{ role: string; content: string }>,
): boolean {
  const recent = messages
    .slice(-8)
    .map((m) => m.content.toLowerCase())
    .join(' ');
  return /\b(edit|timeline|clip|split|trim|merge|subtitle|caption|transcribe|youtube video|execution plan)\b/.test(
    recent,
  );
}

export function resolveConversationLane(input: ConversationLaneInput): ConversationLaneDecision {
  const currentIntent = deriveIntentForMessage(input.message, input);
  const baseIntent = currentIntent.baseIntent;
  const normalizedIntent = currentIntent.normalizedIntent;

  const confirmation = isExecutionConfirmation(input.message);
  const continuation = isAmbiguousContinuation(input.message);
  const effectiveAssistantMessage =
    input.lastActionableAssistantMessage || input.lastAssistantMessage;
  const effectiveAssistantArtifact =
    input.lastActionableAssistantArtifact ||
    input.lastAssistantArtifact ||
    inferAssistantArtifactFromText(effectiveAssistantMessage);
  const resumeCandidateMessage = input.lastActionableUserMessage || '';
  const resumeIntent = resumeCandidateMessage
    ? deriveIntentForMessage(resumeCandidateMessage, input)
    : currentIntent;
  const wantsFullEditResume = shouldResumeFullEditRequest(resumeCandidateMessage);
  const assistantLooksLikeExecutionResult = looksLikeExecutionResult(input.lastAssistantMessage);
  const assistantHasEditPlan =
    !assistantLooksLikeExecutionResult && looksLikeEditPlan(effectiveAssistantMessage);
  const assistantHasExecutableScriptDraft =
    !assistantLooksLikeExecutionResult && scriptDraftOffersExecution(effectiveAssistantMessage);
  const artifact = effectiveAssistantArtifact;
  const artifactIsExecutable = Boolean(artifact?.executable);
  const artifactHasCaptionApply =
    artifact?.type === 'script_draft' &&
    Boolean(artifact?.nextActions?.includes('apply_script_as_captions'));

  if (confirmation && artifactIsExecutable && artifactHasCaptionApply) {
    if (wantsFullEditResume) {
      return {
        lane: 'timeline_edit',
        plannerInput: buildAutonomousResumeRequest(
          resumeCandidateMessage,
          effectiveAssistantMessage,
        ),
        reason: 'confirmation_resume_full_edit_request',
        baseIntent: resumeIntent.baseIntent,
        normalizedIntent: resumeIntent.normalizedIntent,
      };
    }

    return {
      lane: 'timeline_edit',
      plannerInput: buildCaptionApplyRequest(effectiveAssistantMessage),
      reason: 'confirmation_bound_to_artifact_action',
      baseIntent,
      normalizedIntent,
    };
  }

  if (confirmation && artifactIsExecutable && artifact?.type === 'execution_plan') {
    return {
      lane: 'timeline_edit',
      plannerInput: input.message,
      reason: 'confirmation_bound_to_plan_artifact',
      baseIntent,
      normalizedIntent,
    };
  }

  if (confirmation && assistantHasExecutableScriptDraft) {
    if (wantsFullEditResume) {
      return {
        lane: 'timeline_edit',
        plannerInput: buildAutonomousResumeRequest(
          resumeCandidateMessage,
          effectiveAssistantMessage,
        ),
        reason: 'confirmation_resume_full_edit_request',
        baseIntent: resumeIntent.baseIntent,
        normalizedIntent: resumeIntent.normalizedIntent,
      };
    }

    return {
      lane: 'timeline_edit',
      plannerInput: buildCaptionApplyRequest(effectiveAssistantMessage),
      reason: 'confirmation_for_executable_script_draft',
      baseIntent,
      normalizedIntent,
    };
  }

  if (confirmation && (input.hasPendingPlan || assistantHasEditPlan)) {
    return {
      lane: 'timeline_edit',
      plannerInput: input.message,
      reason: 'confirmation_for_existing_edit_execution',
      baseIntent,
      normalizedIntent,
    };
  }

  if (confirmation) {
    return {
      lane: 'script_guidance',
      plannerInput: input.message,
      reason: 'confirmation_without_executable_artifact',
      baseIntent,
      normalizedIntent,
    };
  }

  if (continuation && input.hasRecentEditingContext) {
    if (wantsFullEditResume) {
      return {
        lane: 'timeline_edit',
        plannerInput: buildAutonomousResumeRequest(
          resumeCandidateMessage,
          effectiveAssistantMessage,
        ),
        reason: 'editing_continuation_resume_previous_request',
        baseIntent: resumeIntent.baseIntent,
        normalizedIntent: resumeIntent.normalizedIntent,
      };
    }

    if (resumeCandidateMessage) {
      return {
        lane: 'timeline_edit',
        plannerInput: resumeCandidateMessage,
        reason: 'editing_continuation_reuse_previous_request',
        baseIntent: resumeIntent.baseIntent,
        normalizedIntent: resumeIntent.normalizedIntent,
      };
    }

    return {
      lane: 'timeline_edit',
      plannerInput: input.message,
      reason: 'editing_continuation',
      baseIntent,
      normalizedIntent,
    };
  }

  if (normalizedIntent.requiresPlanning || baseIntent === 'edit') {
    return {
      lane: 'timeline_edit',
      plannerInput: input.message,
      reason: normalizedIntent.requiresPlanning
        ? 'normalized_requires_planning'
        : 'base_edit_intent',
      baseIntent,
      normalizedIntent,
    };
  }

  return {
    lane: 'script_guidance',
    plannerInput: input.message,
    reason: 'chat_guidance',
    baseIntent,
    normalizedIntent,
  };
}
