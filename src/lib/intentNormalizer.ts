import type { MessageIntent } from './intentClassifier';

export type EditMode = 'create' | 'modify' | 'delete';

export interface NormalizedIntent {
  intent_type: 'multi_video_edit' | 'chat_or_guidance';
  mode: EditMode;
  goals: string[];
  requestedOutputs: string[];
  constraints: Record<string, string | number | boolean>;
  ambiguities: string[];
  operationHint: string | null;
  confidence: number;
  requiresPlanning: boolean;
}

interface NormalizeOptions {
  hasTimeline: boolean;
  baseIntent?: MessageIntent;
  hasPendingPlan?: boolean;
  hasRecentEditingContext?: boolean;
}

const DELETE_PATTERN = /\b(delete|remove|cut out|drop|discard|erase|take out)\b/i;
const CREATE_PATTERN =
  /\b(create|make|build|start from scratch|combine|stitch|assemble|from my videos|from these clips|make (a )?(yt|youtube) short)\b/i;
const MODIFY_PATTERN =
  /\b(trim|split|move|reorder|merge|adjust|change|replace|fix|update|improve|polish|make flow smoother|make it smoother)\b/i;
const EXECUTION_PATTERN = /\b(do it|go ahead|execute|apply|proceed|make it|start editing)\b/i;
const QUESTION_PATTERN = /\b(how|what|why|explain|difference|tutorial|tips|advice)\b/i;
const STYLE_AMBIGUITY_PATTERN =
  /\b(like this|properly|make it cool|make it better|as usual|cinematic)\b/i;
const SHORT_FORM_PATTERN = /\b(yt short|youtube short|shorts|reel|tiktok)\b/i;
const SCRIPT_PATTERN = /\b(script|voiceover|narration|caption script|storyline|hook)\b/i;
const EDIT_OPERATION_PATTERN =
  /\b(trim|split|cut|crop|delete|remove|move|merge|combine|join|duplicate|copy|paste|reorder|timeline|clip|track|transition|effect|filter|fade|speed|audio|mute|unmute|volume|subtitle|caption|transcribe|playhead|export|render)\b/i;

function isScriptOnlyRequest(message: string): boolean {
  if (!SCRIPT_PATTERN.test(message)) return false;
  if (EXECUTION_PATTERN.test(message)) return false;
  return !EDIT_OPERATION_PATTERN.test(message);
}

function detectMode(message: string, hasTimeline: boolean): EditMode {
  if (SHORT_FORM_PATTERN.test(message)) {
    if (/\bfrom my videos|from these clips|from these videos|combine\b/i.test(message)) {
      return 'create';
    }
    return hasTimeline ? 'modify' : 'create';
  }
  if (DELETE_PATTERN.test(message)) return 'delete';
  if (MODIFY_PATTERN.test(message)) return 'modify';
  if (CREATE_PATTERN.test(message)) return 'create';
  return hasTimeline ? 'modify' : 'create';
}

function detectOperationHint(message: string): string | null {
  if (DELETE_PATTERN.test(message)) return 'delete';
  if (/\btrim\b/i.test(message)) return 'trim';
  if (/\bsplit\b/i.test(message)) return 'split';
  if (/\breorder|move\b/i.test(message)) return 'reorder';
  if (/\bmerge|combine|join|stitch\b/i.test(message)) return 'merge';
  if (/\btransition|fade|crossfade\b/i.test(message)) return 'transition';
  if (/\bvolume|audio|mute|music|duck\b/i.test(message)) return 'audio_adjust';
  if (/\bcaption|subtitle\b/i.test(message)) return 'subtitle';
  if (SCRIPT_PATTERN.test(message)) return 'script_outline';
  return null;
}

function detectGoals(message: string): string[] {
  const goals: string[] = [];
  if (/\bremove|delete|cut out|boring|awkward pause\b/i.test(message)) {
    goals.push('remove_low_value_segments');
  }
  if (/\bcombine|merge|join|stitch\b/i.test(message)) {
    goals.push('combine_sources');
  }
  if (/\bsmooth|transition|flow|properly\b/i.test(message)) {
    goals.push('smooth_transitions');
  }
  if (/\bmodern|clean|cinematic|reel|viral|cool\b/i.test(message)) {
    goals.push('style_enhancement');
  }
  if (/\bshorts|reel|youtube|yt|tiktok\b/i.test(message)) {
    goals.push('platform_optimized_output');
  }
  if (SCRIPT_PATTERN.test(message)) {
    goals.push('script_generation');
  }
  return goals;
}

function detectRequestedOutputs(message: string): string[] {
  const outputs: string[] = [];
  const scriptOnly = isScriptOnlyRequest(message);
  if (
    !scriptOnly &&
    /\b(edit|cut|timeline|trim|transition|merge|combine|stitch|assemble|make)\b/i.test(message)
  ) {
    outputs.push('edit_plan');
  }
  if (SCRIPT_PATTERN.test(message)) {
    outputs.push('short_script_outline');
  }
  if (/\bcaption|subtitle\b/i.test(message)) {
    outputs.push('subtitle_plan');
  }
  return Array.from(new Set(outputs));
}

function detectConstraints(message: string): Record<string, string | number | boolean> {
  const constraints: Record<string, string | number | boolean> = {};
  const durationMatch = message.match(/\b(\d+)\s*(s|sec|second|seconds|min|minute|minutes)\b/i);
  if (durationMatch) {
    constraints.target_duration = Number(durationMatch[1]);
    constraints.target_duration_unit = durationMatch[2].toLowerCase();
  }
  if (/\bno music\b/i.test(message)) constraints.music = false;
  if (/\bwith subtitles?\b/i.test(message)) constraints.subtitles = true;
  if (/\bvertical|9:16\b/i.test(message)) constraints.aspect_ratio = '9:16';
  if (/\bhorizontal|16:9\b/i.test(message)) constraints.aspect_ratio = '16:9';
  if (/\b(yt short|youtube short|shorts)\b/i.test(message)) {
    constraints.platform = 'youtube_shorts';
    constraints.aspect_ratio = constraints.aspect_ratio || '9:16';
  }
  if (/\breel|instagram\b/i.test(message)) {
    constraints.platform = 'instagram_reels';
    constraints.aspect_ratio = constraints.aspect_ratio || '9:16';
  }
  return constraints;
}

function detectAmbiguities(message: string): string[] {
  const ambiguities: string[] = [];
  if (STYLE_AMBIGUITY_PATTERN.test(message)) ambiguities.push('style_reference_missing');
  if (/\bthis|that one|earlier part|second one\b/i.test(message)) {
    ambiguities.push('target_reference_may_be_ambiguous');
  }
  if (/\bfast\b/i.test(message) && /\bslow\b/i.test(message)) {
    ambiguities.push('contradictory_speed_directives');
  }
  if (
    SHORT_FORM_PATTERN.test(message) &&
    !/\b(\d+)\s*(s|sec|second|seconds|min|minute|minutes)\b/i.test(message)
  ) {
    ambiguities.push('target_duration_missing');
  }
  if (SCRIPT_PATTERN.test(message) && !/\bvoice|onscreen|text|subtitle\b/i.test(message)) {
    ambiguities.push('script_format_unspecified');
  }
  return ambiguities;
}

export function normalizeUserIntent(message: string, options: NormalizeOptions): NormalizedIntent {
  const lower = message.trim().toLowerCase();
  const scriptOnlyRequest = isScriptOnlyRequest(lower);
  const mode = detectMode(lower, options.hasTimeline);
  const goals = detectGoals(lower);
  const requestedOutputs = detectRequestedOutputs(lower);
  const constraints = detectConstraints(lower);
  const ambiguities = detectAmbiguities(lower);
  const operationHint = detectOperationHint(lower);
  const looksLikeQuestion = QUESTION_PATTERN.test(lower) && !EXECUTION_PATTERN.test(lower);
  const imperativeEditSignal =
    EXECUTION_PATTERN.test(lower) ||
    Boolean(operationHint) ||
    /\bmy clip|my video|timeline|edit this|edit these\b/i.test(lower);
  const baseIntentIsEdit = options.baseIntent === 'edit';
  const contextSuggestsEdit = Boolean(options.hasPendingPlan || options.hasRecentEditingContext);
  const requiresPlanning =
    !scriptOnlyRequest &&
    !looksLikeQuestion &&
    (baseIntentIsEdit || imperativeEditSignal || contextSuggestsEdit);

  let confidence = 0.45;
  if (requiresPlanning) confidence += 0.3;
  if (operationHint) confidence += 0.15;
  if (goals.length > 0) confidence += 0.1;
  if (Object.keys(constraints).length > 0) confidence += 0.05;
  if (requestedOutputs.length > 0) confidence += 0.03;
  confidence -= ambiguities.length * 0.08;
  confidence = Math.max(0.05, Math.min(0.98, confidence));

  return {
    intent_type: requiresPlanning ? 'multi_video_edit' : 'chat_or_guidance',
    mode,
    goals,
    requestedOutputs,
    constraints,
    ambiguities,
    operationHint,
    confidence,
    requiresPlanning,
  };
}
