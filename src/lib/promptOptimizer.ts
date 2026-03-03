import type { ConversationLaneDecision } from './conversationLane';

interface PromptOptimizationInput {
  message: string;
  laneDecision: ConversationLaneDecision;
  timelineDuration: number;
  clipCount: number;
}

const SCRIPT_REQUEST_PATTERN =
  /\b(script|intro|hook|voiceover|narration|storyline|on-?screen|caption)\b/i;

const ATTRACTIVE_TONE_PATTERN =
  /\b(attractive|engaging|cinematic|powerful|strong|viral|wow|best)\b/i;

function parseDurationSeconds(message: string): number | null {
  const match = message.match(/\b(\d+)\s*(s|sec|second|seconds|min|minute|minutes)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('min')) {
    return value * 60;
  }
  return value;
}

function secondsToTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildScriptPrompt(input: PromptOptimizationInput): string {
  const requestedDuration = parseDurationSeconds(input.message);
  const safeDuration = Math.max(
    8,
    Math.min(requestedDuration ?? Math.round(input.timelineDuration || 16), 60),
  );
  const beatCount = Math.max(4, Math.min(7, Math.round(safeDuration / 2.8)));
  const tone = ATTRACTIVE_TONE_PATTERN.test(input.message)
    ? 'high-energy, attractive'
    : 'confident';

  return `User request (keep intent): "${input.message}"

Task:
- Generate a polished short intro script grounded in the current project media context.
- Target duration: exactly ${safeDuration} seconds.
- Beat count: ${beatCount}.
- Tone: ${tone}.

Output format requirements:
1) Title (1 line)
2) Script beats using exact timestamp windows:
   [${secondsToTimestamp(0)} - ${secondsToTimestamp(2)}] Voiceover: ...
   On-screen text: ...
3) Keep each beat concise (max 14 words for on-screen text).
4) Use only scenes/topics likely present in the attached timeline/media context.
5) End with one strong winner line in the last beat.
6) After the script, ask exactly one question: "Apply these as captions on timeline?"

Do not claim any timeline edit was executed in this response.`;
}

export function optimizePromptForLane(input: PromptOptimizationInput): string {
  const text = input.message.trim();
  if (!text) return text;

  if (input.laneDecision.lane === 'script_guidance' && SCRIPT_REQUEST_PATTERN.test(text)) {
    return buildScriptPrompt(input);
  }

  return text;
}
