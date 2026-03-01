import { describe, expect, it } from "vitest";
import { convertToAIHistory } from "../../src/lib/aiService";

function makeAttachment(overrides?: Partial<any>) {
  return {
    id: "a1",
    file: new File(["x"], "clip.mp4", { type: "video/mp4" }),
    type: "video" as const,
    mimeType: "video/mp4",
    name: "clip.mp4",
    size: 1024,
    base64Data: "AA==",
    ...overrides,
  };
}

describe("aiService media encoding mode", () => {
  it("converts attachments to descriptor text when mediaMode=descriptor_only", () => {
    const history = convertToAIHistory(
      [
        {
          role: "user",
          content: "edit this",
          attachments: [makeAttachment()],
        },
      ],
      { mediaMode: "descriptor_only" },
    );

    const content = history[0].content;
    const hasVideoBlock = content.some((part: any) => Boolean(part.video));
    const descriptor = content.find((part: any) => typeof part.text === "string" && part.text.includes("Attached Media Descriptors"));

    expect(hasVideoBlock).toBe(false);
    expect(descriptor).toBeTruthy();
  });

  it("keeps inline media blocks when mediaMode=inline_bytes", () => {
    const history = convertToAIHistory(
      [
        {
          role: "user",
          content: "analyze this",
          attachments: [makeAttachment()],
        },
      ],
      { mediaMode: "inline_bytes" },
    );

    const content = history[0].content;
    const hasVideoBlock = content.some((part: any) => Boolean(part.video));
    expect(hasVideoBlock).toBe(true);
  });
});
