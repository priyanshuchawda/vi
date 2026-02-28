import type { AIChatMessage } from './aiService';

export type TurnIntent = 'chat' | 'edit_plan' | 'tool_followup';

export interface CostPolicyInput {
  intent: TurnIntent;
  history: AIChatMessage[];
  dynamicContextChars: number;
  userMessageChars: number;
  toolCount: number;
  maxOutputTokens: number;
}

export interface CostPolicyResult {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedInputCost: number;
  estimatedOutputCost: number;
  estimatedTotalCost: number;
  degraded: boolean;
  maxHistoryMessages: number;
  maxDynamicContextChars: number;
  economyTools: boolean;
}

const INPUT_COST_PER_1M = 0.06;
const OUTPUT_COST_PER_1M = 0.24;

const SOFT_INPUT_TOKEN_BUDGET = 14_000;
const SOFT_TOTAL_TOKEN_BUDGET = 17_000;

function textLength(content: AIChatMessage['content']): number {
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0);
}

function estimateTokensFromChars(chars: number): number {
  // Conservative average for English/code mixed text.
  return Math.ceil(chars / 4);
}

function estimateToolSchemaTokens(toolCount: number): number {
  // Rough average for Bedrock tool schema + descriptors.
  return Math.max(0, toolCount) * 90;
}

function estimateHistoryChars(history: AIChatMessage[]): number {
  return history.reduce((sum, message) => sum + textLength(message.content), 0);
}

export function estimateTurnCost(input: CostPolicyInput): CostPolicyResult {
  const historyChars = estimateHistoryChars(input.history);
  const estimatedInputTokens =
    estimateTokensFromChars(historyChars + input.dynamicContextChars + input.userMessageChars) +
    estimateToolSchemaTokens(input.toolCount);
  const estimatedOutputTokens = Math.max(1, input.maxOutputTokens);
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

  const estimatedInputCost = (estimatedInputTokens / 1_000_000) * INPUT_COST_PER_1M;
  const estimatedOutputCost = (estimatedOutputTokens / 1_000_000) * OUTPUT_COST_PER_1M;
  const estimatedTotalCost = estimatedInputCost + estimatedOutputCost;

  const overBudget =
    estimatedInputTokens > SOFT_INPUT_TOKEN_BUDGET ||
    estimatedTotalTokens > SOFT_TOTAL_TOKEN_BUDGET;

  // Keep edit planning richer than chat even in degraded mode.
  const maxHistoryMessages = overBudget
    ? input.intent === 'edit_plan'
      ? 10
      : 8
    : 20;
  const maxDynamicContextChars = overBudget
    ? input.intent === 'edit_plan'
      ? 3200
      : 2400
    : 5000;

  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    estimatedInputCost,
    estimatedOutputCost,
    estimatedTotalCost,
    degraded: overBudget,
    maxHistoryMessages,
    maxDynamicContextChars,
    economyTools: overBudget && input.intent !== 'tool_followup',
  };
}

export function trimHistoryToLimit(
  history: AIChatMessage[],
  maxMessages: number,
): AIChatMessage[] {
  if (history.length <= maxMessages) return history;
  const head = history.slice(0, 2);
  const tailCount = Math.max(0, maxMessages - head.length);
  const tail = history.slice(-tailCount);
  return [...head, ...tail];
}
