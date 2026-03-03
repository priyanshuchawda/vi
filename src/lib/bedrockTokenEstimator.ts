export interface BedrockTokenEstimateInput {
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
  systemTexts?: string[];
  toolCount?: number;
  maxOutputTokens?: number;
}

export interface BedrockTokenEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
}

export interface TokenGuardDecisionInput extends BedrockTokenEstimateInput {
  softLimitTokens?: number;
  hardLimitTokens?: number;
}

export interface TokenGuardDecision extends BedrockTokenEstimate {
  status: 'ok' | 'degrade' | 'block';
  softLimitTokens: number;
  hardLimitTokens: number;
}

const DEFAULT_SOFT_LIMIT_TOKENS = 160_000;
const DEFAULT_HARD_LIMIT_TOKENS = 220_000;

const TOKENS_PER_ASCII_CHAR = 0.25;
const TOKENS_PER_NON_ASCII_CHAR = 1.3;
const MAX_CHARS_FOR_FULL_HEURISTIC = 100_000;
const TOKENS_PER_TOOL_SCHEMA = 90;
const IMAGE_TOKENS = 3_000;
const VIDEO_TOKENS = 12_000;
const AUDIO_TOKENS = 4_000;
const DOCUMENT_TOKENS = 25_800;

function hasKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  if (text.length > MAX_CHARS_FOR_FULL_HEURISTIC) {
    return Math.ceil(text.length / 4);
  }

  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    tokens += text.charCodeAt(i) <= 127 ? TOKENS_PER_ASCII_CHAR : TOKENS_PER_NON_ASCII_CHAR;
  }
  return Math.ceil(tokens);
}

function estimatePartTokens(part: Record<string, unknown>): number {
  if (typeof part.text === 'string') {
    return estimateTextTokens(part.text);
  }

  if (hasKey(part, 'image')) return IMAGE_TOKENS;
  if (hasKey(part, 'video')) return VIDEO_TOKENS;
  if (hasKey(part, 'audio')) return AUDIO_TOKENS;
  if (hasKey(part, 'document')) return DOCUMENT_TOKENS;

  if (hasKey(part, 'toolResult')) {
    return Math.ceil(JSON.stringify(part.toolResult).length / 4);
  }
  if (hasKey(part, 'toolUse')) {
    return Math.ceil(JSON.stringify(part.toolUse).length / 4);
  }

  return Math.ceil(JSON.stringify(part ?? {}).length / 4);
}

function estimateMessagesTokens(
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>,
): number {
  let total = 0;
  for (const message of messages) {
    total += 3; // role/structure overhead
    for (const part of message.content || []) {
      total += estimatePartTokens(part);
    }
  }
  return total;
}

function estimateSystemTokens(systemTexts: string[] = []): number {
  return systemTexts.reduce((sum, text) => sum + estimateTextTokens(text), 0);
}

export function estimateBedrockRequestTokens(
  input: BedrockTokenEstimateInput,
): BedrockTokenEstimate {
  const toolCount = Math.max(0, input.toolCount ?? 0);
  const estimatedInputTokens =
    estimateMessagesTokens(input.messages) +
    estimateSystemTokens(input.systemTexts) +
    toolCount * TOKENS_PER_TOOL_SCHEMA;
  const estimatedOutputTokens = Math.max(1, input.maxOutputTokens ?? 1024);

  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
  };
}

export function evaluateTokenGuard(input: TokenGuardDecisionInput): TokenGuardDecision {
  const estimate = estimateBedrockRequestTokens(input);
  const softLimitTokens = input.softLimitTokens ?? DEFAULT_SOFT_LIMIT_TOKENS;
  const hardLimitTokens = input.hardLimitTokens ?? DEFAULT_HARD_LIMIT_TOKENS;

  let status: TokenGuardDecision['status'] = 'ok';
  if (estimate.estimatedInputTokens > hardLimitTokens) {
    status = 'block';
  } else if (estimate.estimatedInputTokens > softLimitTokens) {
    status = 'degrade';
  }

  return {
    ...estimate,
    status,
    softLimitTokens,
    hardLimitTokens,
  };
}
