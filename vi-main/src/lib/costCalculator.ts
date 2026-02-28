/**
 * Cost Calculator for AWS Bedrock (Amazon Nova Lite v1)
 *
 * Provides cost estimation based on token usage and model pricing.
 *
 * Amazon Nova Lite pricing (US regions):
 * - Input: $0.06 per 1M tokens
 * - Output: $0.24 per 1M tokens
 * - Images: $0.021 per 1K input images
 * - Videos: $0.00084 per second of video
 *
 * No free tier — all usage is billed on-demand.
 */

/**
 * Pricing structure for Amazon Nova models (per 1M tokens)
 */
const PRICING = {
  "amazon.nova-lite-v1:0": {
    input: 0.06, // $0.06 per 1M input tokens
    output: 0.24, // $0.24 per 1M output tokens
  },
  "amazon.nova-micro-v1:0": {
    input: 0.035, // $0.035 per 1M input tokens
    output: 0.14, // $0.14 per 1M output tokens
  },
  "amazon.nova-pro-v1:0": {
    input: 0.8, // $0.80 per 1M input tokens
    output: 3.2, // $3.20 per 1M output tokens
  },
} as const;

type ModelId = keyof typeof PRICING;

/**
 * Token rates for different media types (approximate for Nova Lite)
 */
const MEDIA_TOKEN_RATES = {
  video: {
    low: 70, // tokens per frame at low resolution
    medium: 258, // tokens per frame at medium resolution
    high: 280, // tokens per frame at high resolution
    default: 258,
  },
  audio: {
    tokensPerSecond: 32, // tokens per second of audio
  },
} as const;

/**
 * Token usage breakdown
 */
export interface TokenUsage {
  input: number;
  output: number;
}

/**
 * Calculate cost for a specific model and token usage.
 */
export function calculateCost(
  model: ModelId = "amazon.nova-lite-v1:0",
  tokens: TokenUsage,
): number {
  const pricing = PRICING[model] || PRICING["amazon.nova-lite-v1:0"];

  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Format cost as a user-friendly string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `${(cost * 100).toFixed(2)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Calculate expected tokens for video analysis
 */
export function calculateVideoTokens(
  durationSeconds: number,
  mediaResolution: "low" | "medium" | "high" = "low",
  fps: number = 1,
): {
  videoTokens: number;
  audioTokens: number;
  totalTokens: number;
  cost: number;
} {
  const tokensPerFrame = MEDIA_TOKEN_RATES.video[mediaResolution];
  const audioTokensPerSec = MEDIA_TOKEN_RATES.audio.tokensPerSecond;

  const videoTokens = durationSeconds * fps * tokensPerFrame;
  const audioTokens = durationSeconds * audioTokensPerSec;
  const totalTokens = videoTokens + audioTokens;

  const cost = calculateCost("amazon.nova-lite-v1:0", {
    input: totalTokens,
    output: 1000,
  });

  return { videoTokens, audioTokens, totalTokens, cost };
}

/**
 * Estimate cost before video analysis
 */
export function estimateVideoAnalysisCost(
  durationSeconds: number,
  options: {
    mediaResolution?: "low" | "medium" | "high";
    fps?: number;
    startTime?: number;
    endTime?: number;
  } = {},
): { tokens: number; cost: string; costValue: number; warning?: string } {
  let actualDuration = durationSeconds;
  if (options.startTime !== undefined && options.endTime !== undefined) {
    actualDuration = options.endTime - options.startTime;
  } else if (options.endTime !== undefined) {
    actualDuration = options.endTime;
  }

  const resolution = options.mediaResolution || "low";
  const fps = options.fps || 1;

  const estimate = calculateVideoTokens(actualDuration, resolution, fps);

  let warning: string | undefined;
  if (estimate.cost > 1.0) {
    warning = `This operation will cost ${formatCost(estimate.cost)}. Consider using video clipping to analyze only specific segments.`;
  } else if (estimate.cost > 0.5) {
    warning = `This is a relatively expensive operation (${formatCost(estimate.cost)}).`;
  }

  return {
    tokens: estimate.totalTokens,
    cost: formatCost(estimate.cost),
    costValue: estimate.cost,
    warning,
  };
}

/**
 * Calculate potential savings from optimization
 */
export function calculateOptimizationSavings(
  originalDuration: number,
  optimizedDuration: number,
  originalResolution: "low" | "medium" | "high" = "medium",
  optimizedResolution: "low" | "medium" | "high" = "low",
): { savedTokens: number; savedCost: string; savingsPercentage: number } {
  const original = calculateVideoTokens(originalDuration, originalResolution);
  const optimized = calculateVideoTokens(
    optimizedDuration,
    optimizedResolution,
  );

  const savedTokens = original.totalTokens - optimized.totalTokens;
  const savedCost = original.cost - optimized.cost;
  const savingsPercentage = (savedTokens / original.totalTokens) * 100;

  return {
    savedTokens,
    savedCost: formatCost(savedCost),
    savingsPercentage: Math.round(savingsPercentage),
  };
}

/**
 * Format token count as a user-friendly string
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M tokens`;
  } else if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
}

/**
 * Get cost breakdown message for logging
 */
export function getCostBreakdown(
  tokens: TokenUsage,
  model: ModelId = "amazon.nova-lite-v1:0",
): string {
  const cost = calculateCost(model, tokens);
  const pricing = PRICING[model] || PRICING["amazon.nova-lite-v1:0"];
  const lines = [
    " Cost Breakdown:",
    `   Input tokens: ${formatTokens(tokens.input)} = ${formatCost((tokens.input / 1_000_000) * pricing.input)}`,
    `   Output tokens: ${formatTokens(tokens.output)} = ${formatCost((tokens.output / 1_000_000) * pricing.output)}`,
    `   Total cost: ${formatCost(cost)}`,
  ];

  return lines.join("\n");
}
