import { describe, expect, it } from "vitest";
import { classifyIntent } from "../../src/lib/intentClassifier";

describe("intentClassifier", () => {
  it("routes explicit execution confirmations to edit intent", () => {
    expect(classifyIntent("ok do it")).toBe("edit");
    expect(classifyIntent("go ahead and execute")).toBe("edit");
    expect(classifyIntent("apply that now")).toBe("edit");
  });

  it("routes video-creation and step-flow requests to edit intent", () => {
    expect(classifyIntent("How can I make a YouTube video from this script")).toBe("edit");
    expect(classifyIntent("whatever feels best to you do step by step")).toBe("edit");
    expect(classifyIntent("move next")).toBe("edit");
  });

  it("keeps simple acknowledgements as chat", () => {
    expect(classifyIntent("ok")).toBe("chat");
    expect(classifyIntent("thanks")).toBe("chat");
  });
});
