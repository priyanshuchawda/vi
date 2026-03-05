import { classifyIntentWithContext, type MessageIntent } from './intentClassifier';
import { normalizeUserIntent, type NormalizedIntent } from './intentNormalizer';
import type { ChatMessage } from '../types/chat';

export type ConversationLane = 'script_guidance' | 'timeline_edit';

export interface ConversationLaneInput {
  message: string;
  lastAssistantMessage: string;
  lastAssistantArtifact?: NonNullable<ChatMessage['metadata']>['artifact'];
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

  const explicitConfirmation =
    /^(yes|ok|okay|sure|continue|proceed|go ahead|do it|yes do it|yes[,.]? do it|just do it|execute|apply( it| that)?|make it|run it|let's do it|let's go|yep|yeah|confirm)( please)?[.!?]*$/.test(
      text,
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
- Use subtitle/caption editing tools to add the timestamped lines.
- Keep the final caption sequence within the timeline duration.
- Preserve my existing clips; do not trim or reorder unless absolutely required.
- Use concise, attractive caption text matching the script tone.

Reference script:
${compactScript}`;
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
  const baseIntent = classifyIntentWithContext(input.message, {
    hasPendingPlan: input.hasPendingPlan,
    hasRecentEditingContext: input.hasRecentEditingContext,
  });

  const normalizedIntent = normalizeUserIntent(input.message, {
    hasTimeline: input.hasTimeline,
    baseIntent,
    hasPendingPlan: input.hasPendingPlan,
    hasRecentEditingContext: input.hasRecentEditingContext,
  });

  const confirmation = isExecutionConfirmation(input.message);
  const continuation = isAmbiguousContinuation(input.message);
  const assistantLooksLikeExecutionResult = looksLikeExecutionResult(input.lastAssistantMessage);
  const assistantHasEditPlan =
    !assistantLooksLikeExecutionResult && looksLikeEditPlan(input.lastAssistantMessage);
  const assistantHasExecutableScriptDraft =
    !assistantLooksLikeExecutionResult && scriptDraftOffersExecution(input.lastAssistantMessage);
  const artifact =
    input.lastAssistantArtifact || inferAssistantArtifactFromText(input.lastAssistantMessage);
  const artifactIsExecutable = Boolean(artifact?.executable);
  const artifactHasCaptionApply =
    artifact?.type === 'script_draft' &&
    Boolean(artifact?.nextActions?.includes('apply_script_as_captions'));

  if (confirmation && artifactIsExecutable && artifactHasCaptionApply) {
    return {
      lane: 'timeline_edit',
      plannerInput: buildCaptionApplyRequest(input.lastAssistantMessage),
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
    return {
      lane: 'timeline_edit',
      plannerInput: buildCaptionApplyRequest(input.lastAssistantMessage),
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
