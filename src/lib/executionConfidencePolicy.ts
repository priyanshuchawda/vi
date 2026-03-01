import type { EditMode } from "./intentNormalizer";

export type ExecutionRecommendation = "auto_execute" | "preview_required" | "clarify_required";

export interface ConfidencePolicyInput {
  confidenceScore: number;
  mode?: EditMode;
  hasAmbiguities?: boolean;
  mutating: boolean;
}

export interface ConfidencePolicyDecision {
  recommendation: ExecutionRecommendation;
  reason: string;
}

export function recommendExecutionPolicy(
  input: ConfidencePolicyInput,
): ConfidencePolicyDecision {
  const score = Number.isFinite(input.confidenceScore)
    ? Math.max(0, Math.min(1, input.confidenceScore))
    : 0;
  const mode = input.mode || "modify";
  const hasAmbiguities = Boolean(input.hasAmbiguities);
  const highRiskMutation = input.mutating && (mode === "delete" || mode === "modify");

  if (hasAmbiguities || score < 0.6) {
    return {
      recommendation: "clarify_required",
      reason: "Low confidence or ambiguous intent; clarification required before execution.",
    };
  }

  if (highRiskMutation && score < 0.85) {
    return {
      recommendation: "preview_required",
      reason: "Mutating edit below auto-execute confidence threshold; preview required.",
    };
  }

  if (!input.mutating && score >= 0.6) {
    return {
      recommendation: "auto_execute",
      reason: "Read-only operations are safe to auto-execute.",
    };
  }

  if (score >= 0.85) {
    return {
      recommendation: "auto_execute",
      reason: "High confidence and low ambiguity.",
    };
  }

  return {
    recommendation: "preview_required",
    reason: "Manual review recommended before execution.",
  };
}
