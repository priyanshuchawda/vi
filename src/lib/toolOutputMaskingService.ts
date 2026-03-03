import type { AIChatMessage } from './aiService';

export interface ToolOutputMaskingOptions {
  protectLatestMessages?: number;
  minTokensPerBlock?: number;
  maxPreviewChars?: number;
}

export interface ToolOutputMaskingResult {
  history: AIChatMessage[];
  maskedCount: number;
  estimatedTokensSaved: number;
}

const DEFAULT_PROTECT_LATEST_MESSAGES = 8;
const DEFAULT_MIN_TOKENS_PER_BLOCK = 800;
const DEFAULT_PREVIEW_CHARS = 300;
const MASK_TAG = 'tool_output_masked';

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function formatMaskedPreview(value: string, previewChars: number): string {
  const preview = value.slice(0, previewChars).trim();
  const lines = value.split('\n').length;
  const sizeKb = (value.length / 1024).toFixed(1);
  return `<${MASK_TAG}>
output masked for token efficiency
size_kb=${sizeKb}
lines=${lines}
preview:
${preview}
</${MASK_TAG}>`;
}

function extractToolOutput(part: Record<string, any>): string | null {
  if (part?.toolResult) {
    return JSON.stringify(part.toolResult, null, 2);
  }
  if (part?.toolUse) {
    return JSON.stringify(part.toolUse, null, 2);
  }
  return null;
}

export function maskToolOutputsInHistory(
  history: AIChatMessage[],
  options: ToolOutputMaskingOptions = {},
): ToolOutputMaskingResult {
  if (history.length === 0) {
    return { history, maskedCount: 0, estimatedTokensSaved: 0 };
  }

  const protectLatestMessages = options.protectLatestMessages ?? DEFAULT_PROTECT_LATEST_MESSAGES;
  const minTokensPerBlock = options.minTokensPerBlock ?? DEFAULT_MIN_TOKENS_PER_BLOCK;
  const maxPreviewChars = options.maxPreviewChars ?? DEFAULT_PREVIEW_CHARS;

  const cutoff = Math.max(0, history.length - protectLatestMessages);
  let maskedCount = 0;
  let estimatedTokensSaved = 0;

  const nextHistory = history.map((message, index) => {
    if (index >= cutoff) return message;
    if (!Array.isArray(message.content) || message.content.length === 0) {
      return message;
    }

    let changed = false;
    const nextContent = message.content.map((part) => {
      const raw = extractToolOutput(part);
      if (!raw || raw.includes(`<${MASK_TAG}>`)) return part;

      const originalTokens = estimateTokens(raw);
      if (originalTokens < minTokensPerBlock) return part;

      const maskedText = formatMaskedPreview(raw, maxPreviewChars);
      const maskedTokens = estimateTokens(maskedText);
      if (maskedTokens >= originalTokens) return part;

      changed = true;
      maskedCount += 1;
      estimatedTokensSaved += originalTokens - maskedTokens;
      return { text: maskedText };
    });

    if (!changed) return message;
    return { ...message, content: nextContent };
  });

  return {
    history: nextHistory,
    maskedCount,
    estimatedTokensSaved,
  };
}
