import { describe, expect, it } from "vitest";
import {
  estimateBedrockRequestTokens,
  evaluateTokenGuard,
} from "../../src/lib/bedrockTokenEstimator";

describe("bedrockTokenEstimator", () => {
  it("estimates text requests with system and output tokens", () => {
    const estimate = estimateBedrockRequestTokens({
      messages: [
        {
          role: "user",
          content: [{ text: "hello world" }],
        },
      ],
      systemTexts: ["system instruction"],
      maxOutputTokens: 500,
    });

    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBe(500);
    expect(estimate.estimatedTotalTokens).toBe(
      estimate.estimatedInputTokens + 500,
    );
  });

  it("assigns conservative token costs to media parts", () => {
    const estimate = estimateBedrockRequestTokens({
      messages: [
        {
          role: "user",
          content: [{ image: { format: "jpeg" } }, { video: { format: "mp4" } }],
        },
      ],
      maxOutputTokens: 128,
    });

    expect(estimate.estimatedInputTokens).toBeGreaterThanOrEqual(15_000);
  });

  it("returns ok/degrade/block using soft and hard limits", () => {
    const small = evaluateTokenGuard({
      messages: [{ role: "user", content: [{ text: "short" }] }],
      softLimitTokens: 100,
      hardLimitTokens: 200,
    });
    expect(small.status).toBe("ok");

    const degrade = evaluateTokenGuard({
      messages: [{ role: "user", content: [{ text: "a".repeat(500) }] }],
      softLimitTokens: 100,
      hardLimitTokens: 1000,
    });
    expect(degrade.status).toBe("degrade");

    const block = evaluateTokenGuard({
      messages: [{ role: "user", content: [{ text: "a".repeat(5000) }] }],
      softLimitTokens: 100,
      hardLimitTokens: 200,
    });
    expect(block.status).toBe("block");
  });
});

