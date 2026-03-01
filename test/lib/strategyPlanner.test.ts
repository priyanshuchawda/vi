import { describe, expect, it } from "vitest";
import {
  buildFallbackStrategy,
  buildStrategyPrompt,
  parseStrategyResponse,
} from "../../src/lib/strategyPlanner";

describe("strategyPlanner", () => {
  it("parses valid JSON strategy responses", () => {
    const parsed = parseStrategyResponse(`{
      "segment_strategy": "keep_high_activity",
      "ordering": "chronological",
      "transition": "crossfade_300ms",
      "style_profile": "clean_modern",
      "global_constraints": { "aspect_ratio": "9:16" },
      "confidence": 0.88,
      "notes": ["ok"]
    }`);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.strategy.style_profile).toBe("clean_modern");
      expect(parsed.strategy.confidence).toBe(0.88);
    }
  });

  it("rejects invalid strategy payloads", () => {
    const parsed = parseStrategyResponse(`{"segment_strategy":"unknown"}`);
    expect(parsed.ok).toBe(false);
  });

  it("builds deterministic fallback strategy", () => {
    const fallback = buildFallbackStrategy({
      message: "remove silence and keep it cinematic",
      normalizedIntent: {
        intent_type: "multi_video_edit",
        mode: "delete",
        goals: ["remove_low_value_segments"],
        requestedOutputs: ["edit_plan"],
        constraints: {},
        ambiguities: [],
        operationHint: "delete",
        confidence: 0.7,
        requiresPlanning: true,
      },
    });

    expect(fallback.transition).toBe("cut");
    expect(fallback.style_profile).toBe("cinematic_soft");
    expect(fallback.notes).toContain("fallback_strategy_generated");
  });

  it("builds prompt with normalized intent and clip context", () => {
    const prompt = buildStrategyPrompt({
      message: "make this clean and modern",
      normalizedIntent: {
        intent_type: "multi_video_edit",
        mode: "modify",
        goals: ["style_enhancement"],
        requestedOutputs: ["edit_plan"],
        constraints: { subtitles: true },
        ambiguities: [],
        operationHint: "transition",
        confidence: 0.75,
        requiresPlanning: true,
      },
      clipCount: 4,
      timelineDurationSeconds: 86.5,
    });

    expect(prompt).toContain("clip_count: 4");
    expect(prompt).toContain("\"mode\": \"modify\"");
    expect(prompt).toContain("user_message:");
  });
});
