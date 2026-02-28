import { describe, expect, it } from "vitest";
import { routeBedrockModel } from "../../src/lib/modelRoutingPolicy";

describe("modelRoutingPolicy", () => {
  it("routes cheap model for simple chat without attachments", () => {
    const decision = routeBedrockModel({
      intent: "chat",
      message: "what is a jump cut?",
      hasAttachments: false,
    });
    expect(decision.reason).toBe("cheap_chat");
  });

  it("routes strong model for complex planning prompts", () => {
    const decision = routeBedrockModel({
      intent: "plan",
      message: "rebuild full timeline across tracks with multi-step sequence",
    });
    expect(decision.reason).toBe("complex_plan");
  });

  it("forces cheap model during degraded mode", () => {
    const decision = routeBedrockModel({
      intent: "plan",
      message: "complex sequence",
      degraded: true,
    });
    expect(decision.reason).toBe("degraded_budget");
  });
});

