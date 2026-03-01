import { describe, expect, it } from "vitest";
import {
  buildClarificationQuestion,
  formatClarificationForChat,
} from "../../src/lib/clarificationBuilder";

describe("clarificationBuilder", () => {
  it("builds duration clarification for shorts without duration", () => {
    const result = buildClarificationQuestion({
      ambiguities: ["target_duration_missing"],
      mode: "create",
      constraints: { platform: "youtube_shorts" },
    });

    expect(result?.reason).toBe("target_duration_missing");
    expect(result?.options).toContain("30 seconds");
  });

  it("builds style clarification for vague style ask", () => {
    const result = buildClarificationQuestion({
      ambiguities: ["style_reference_missing"],
      mode: "modify",
      constraints: {},
    });

    expect(result?.reason).toBe("style_reference_missing");
    expect(result?.options[0]).toContain("Clean");
  });

  it("formats compact single-question chat output", () => {
    const result = buildClarificationQuestion({
      ambiguities: ["script_format_unspecified"],
      mode: "create",
      constraints: { aspect_ratio: "9:16" },
    });
    expect(result).toBeTruthy();
    const text = formatClarificationForChat(result!);

    expect(text).toContain("I need one clarification");
    expect(text).toContain("1.");
    expect(text).toContain("2.");
    expect(text).toContain("3.");
  });
});
