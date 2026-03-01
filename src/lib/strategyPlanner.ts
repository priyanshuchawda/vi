import { z } from "zod";
import type { NormalizedIntent } from "./intentNormalizer";

export const STRATEGY_SCHEMA = z.object({
  segment_strategy: z
    .enum([
      "keep_high_activity",
      "keep_dialogue_priority",
      "remove_silence_first",
      "preserve_full_clips",
      "balanced_compact",
    ])
    .default("balanced_compact"),
  ordering: z
    .enum([
      "chronological",
      "narrative",
      "highlight_first",
      "source_order",
    ])
    .default("chronological"),
  transition: z
    .enum([
      "cut",
      "crossfade_200ms",
      "crossfade_300ms",
      "smooth_dissolve_400ms",
    ])
    .default("crossfade_300ms"),
  style_profile: z
    .enum([
      "clean_modern",
      "cinematic_soft",
      "social_fast",
      "minimal_neutral",
    ])
    .default("clean_modern"),
  global_constraints: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  confidence: z.number().min(0).max(1).default(0.6),
  notes: z.array(z.string()).default([]),
});

export type StrategyPlan = z.infer<typeof STRATEGY_SCHEMA>;

interface BuildFallbackInput {
  message: string;
  normalizedIntent?: NormalizedIntent;
}

function inferStyleProfile(message: string): StrategyPlan["style_profile"] {
  if (/\bcinematic\b/i.test(message)) return "cinematic_soft";
  if (/\breel|shorts|tiktok|viral|fast\b/i.test(message)) return "social_fast";
  if (/\bminimal|simple|clean\b/i.test(message)) return "minimal_neutral";
  return "clean_modern";
}

export function buildFallbackStrategy(input: BuildFallbackInput): StrategyPlan {
  const mode = input.normalizedIntent?.mode;
  const operationHint = input.normalizedIntent?.operationHint;
  const constraints = input.normalizedIntent?.constraints || {};

  const segmentStrategy: StrategyPlan["segment_strategy"] =
    mode === "delete"
      ? "remove_silence_first"
      : operationHint === "trim"
        ? "balanced_compact"
        : "keep_high_activity";

  const transition: StrategyPlan["transition"] =
    mode === "delete" ? "cut" : "crossfade_300ms";

  return {
    segment_strategy: segmentStrategy,
    ordering: mode === "create" ? "chronological" : "source_order",
    transition,
    style_profile: inferStyleProfile(input.message),
    global_constraints: constraints,
    confidence: 0.62,
    notes: ["fallback_strategy_generated"],
  };
}

export function parseStrategyResponse(
  responseText: string,
): { ok: true; strategy: StrategyPlan } | { ok: false; error: string } {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return { ok: false, error: "empty_strategy_response" };
  }

  const tryParse = (raw: string) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(trimmed);
  if (!parsed) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    }
  }

  if (!parsed) {
    return { ok: false, error: "invalid_json_strategy_response" };
  }

  const result = STRATEGY_SCHEMA.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: "strategy_schema_validation_failed" };
  }

  return { ok: true, strategy: result.data };
}

export function buildStrategyPrompt(input: {
  message: string;
  normalizedIntent?: NormalizedIntent;
  clipCount: number;
  timelineDurationSeconds: number;
}): string {
  const normalizedIntent = input.normalizedIntent
    ? JSON.stringify(input.normalizedIntent, null, 2)
    : "{}";

  return `<strategy_planner_task>
Generate ONLY JSON matching this schema:
{
  "segment_strategy": "keep_high_activity|keep_dialogue_priority|remove_silence_first|preserve_full_clips|balanced_compact",
  "ordering": "chronological|narrative|highlight_first|source_order",
  "transition": "cut|crossfade_200ms|crossfade_300ms|smooth_dissolve_400ms",
  "style_profile": "clean_modern|cinematic_soft|social_fast|minimal_neutral",
  "global_constraints": { "key": "value" },
  "confidence": 0.0,
  "notes": []
}

Rules:
- No prose, no markdown, no code fences.
- Keep it executable and conservative.
- Prefer deterministic defaults when user input is vague.

Context:
- clip_count: ${input.clipCount}
- timeline_duration_seconds: ${input.timelineDurationSeconds.toFixed(2)}
- normalized_intent: ${normalizedIntent}
- user_message: ${input.message}
</strategy_planner_task>`;
}
