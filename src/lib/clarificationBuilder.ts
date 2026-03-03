import type { EditMode } from './intentNormalizer';

export interface ClarificationQuestion {
  question: string;
  options: string[];
  reason: string;
}

interface ClarificationInput {
  ambiguities?: string[];
  mode?: EditMode;
  constraints?: Record<string, string | number | boolean>;
}

function hasAmbiguity(ambiguities: string[], code: string): boolean {
  return ambiguities.includes(code);
}

export function buildClarificationQuestion(
  input: ClarificationInput,
): ClarificationQuestion | null {
  const ambiguities = Array.isArray(input.ambiguities) ? input.ambiguities : [];
  if (ambiguities.length === 0) return null;

  if (hasAmbiguity(ambiguities, 'target_reference_may_be_ambiguous')) {
    return {
      reason: 'target_reference_may_be_ambiguous',
      question: 'Which part should I edit?',
      options: ['The earlier segment', 'The second/middle segment', 'I will mark it on timeline'],
    };
  }

  if (hasAmbiguity(ambiguities, 'target_duration_missing')) {
    return {
      reason: 'target_duration_missing',
      question: 'Pick target duration:',
      options: ['15 seconds', '30 seconds', '45 seconds'],
    };
  }

  if (hasAmbiguity(ambiguities, 'style_reference_missing')) {
    return {
      reason: 'style_reference_missing',
      question: 'Choose an edit style:',
      options: ['Clean modern', 'Fast social', 'Cinematic soft'],
    };
  }

  if (hasAmbiguity(ambiguities, 'script_format_unspecified')) {
    const isShorts =
      String(input.constraints?.platform || '').includes('shorts') ||
      input.constraints?.aspect_ratio === '9:16';
    return {
      reason: 'script_format_unspecified',
      question: 'Which script format do you want?',
      options: isShorts
        ? ['On-screen captions', 'Voiceover lines', 'Both captions + voiceover']
        : ['Voiceover lines', 'On-screen text only', 'No script needed'],
    };
  }

  if (hasAmbiguity(ambiguities, 'contradictory_speed_directives')) {
    return {
      reason: 'contradictory_speed_directives',
      question: 'Choose pacing preference:',
      options: ['Keep it fast', 'Keep it slow and smooth', 'Balanced pacing'],
    };
  }

  if (input.mode === 'delete') {
    return {
      reason: 'delete_without_target',
      question: 'Before deleting, confirm scope:',
      options: [
        'Delete one selected segment',
        'Delete all low-value segments',
        'Preview first, then decide',
      ],
    };
  }

  return {
    reason: 'generic_ambiguity',
    question: 'I need one detail before editing:',
    options: ['Pick style', 'Pick target segment', 'Pick duration'],
  };
}

export function formatClarificationForChat(question: ClarificationQuestion): string {
  const optionLines = question.options
    .slice(0, 3)
    .map((option, index) => `${index + 1}. ${option}`)
    .join('\n');
  return `I need one clarification before running this safely.\n\n${question.question}\n${optionLines}`;
}
