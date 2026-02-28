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

export type CostCapBehavior = 'ask' | 'degrade' | 'block';

export interface BudgetPolicy {
  perTurnSoftUsd: number;
  perTurnHardUsd: number;
  perSessionSoftUsd: number;
  perSessionHardUsd: number;
  onCap: CostCapBehavior;
}

export interface BudgetPolicyDecision {
  overTurnSoft: boolean;
  overTurnHard: boolean;
  overSessionSoft: boolean;
  overSessionHard: boolean;
  shouldDegrade: boolean;
  shouldBlock: boolean;
  reason?: string;
}

const INPUT_COST_PER_1M = 0.06;
const OUTPUT_COST_PER_1M = 0.24;
const BUDGET_POLICY_STORAGE_KEY = 'qc_budget_policy_v1';

const SOFT_INPUT_TOKEN_BUDGET = 14_000;
const SOFT_TOTAL_TOKEN_BUDGET = 17_000;

const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  perTurnSoftUsd: 0.005,
  perTurnHardUsd: 0.02,
  perSessionSoftUsd: 0.05,
  perSessionHardUsd: 0.2,
  onCap: 'degrade',
};

let _budgetPolicy: BudgetPolicy = loadBudgetPolicy();

function clampCurrency(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Number(value.toFixed(4));
}

function normalizeBudgetPolicy(next: Partial<BudgetPolicy>): BudgetPolicy {
  const merged = {
    ...DEFAULT_BUDGET_POLICY,
    ..._budgetPolicy,
    ...next,
  };
  const normalizedTurnSoft = clampCurrency(
    merged.perTurnSoftUsd,
    DEFAULT_BUDGET_POLICY.perTurnSoftUsd,
  );
  const normalizedSessionSoft = clampCurrency(
    merged.perSessionSoftUsd,
    DEFAULT_BUDGET_POLICY.perSessionSoftUsd,
  );
  return {
    perTurnSoftUsd: normalizedTurnSoft,
    perTurnHardUsd: clampCurrency(
      Math.max(merged.perTurnHardUsd, normalizedTurnSoft),
      DEFAULT_BUDGET_POLICY.perTurnHardUsd,
    ),
    perSessionSoftUsd: normalizedSessionSoft,
    perSessionHardUsd: clampCurrency(
      Math.max(merged.perSessionHardUsd, normalizedSessionSoft),
      DEFAULT_BUDGET_POLICY.perSessionHardUsd,
    ),
    onCap: merged.onCap ?? DEFAULT_BUDGET_POLICY.onCap,
  };
}

function loadBudgetPolicy(): BudgetPolicy {
  if (typeof window === 'undefined') return DEFAULT_BUDGET_POLICY;
  try {
    const raw = localStorage.getItem(BUDGET_POLICY_STORAGE_KEY);
    if (!raw) return DEFAULT_BUDGET_POLICY;
    const parsed = JSON.parse(raw) as Partial<BudgetPolicy>;
    return normalizeBudgetPolicy(parsed);
  } catch {
    return DEFAULT_BUDGET_POLICY;
  }
}

function saveBudgetPolicy(policy: BudgetPolicy): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BUDGET_POLICY_STORAGE_KEY, JSON.stringify(policy));
  } catch {
    /* ignore */
  }
}

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

export function getBudgetPolicy(): BudgetPolicy {
  return { ..._budgetPolicy };
}

export function updateBudgetPolicy(next: Partial<BudgetPolicy>): BudgetPolicy {
  _budgetPolicy = normalizeBudgetPolicy(next);
  saveBudgetPolicy(_budgetPolicy);
  return getBudgetPolicy();
}

export function evaluateBudgetPolicy(input: {
  estimatedTurnCostUsd: number;
  currentSessionCostUsd: number;
}): BudgetPolicyDecision {
  const policy = getBudgetPolicy();
  const nextSessionCost = input.currentSessionCostUsd + input.estimatedTurnCostUsd;
  const overTurnSoft = input.estimatedTurnCostUsd > policy.perTurnSoftUsd;
  const overTurnHard = input.estimatedTurnCostUsd > policy.perTurnHardUsd;
  const overSessionSoft = nextSessionCost > policy.perSessionSoftUsd;
  const overSessionHard = nextSessionCost > policy.perSessionHardUsd;

  const hardBreach = overTurnHard || overSessionHard;
  const softBreach = overTurnSoft || overSessionSoft;
  const shouldBlock = hardBreach || (policy.onCap === 'block' && softBreach);
  const shouldDegrade = !shouldBlock && softBreach && policy.onCap === 'degrade';

  let reason: string | undefined;
  if (hardBreach) {
    reason = 'Hard budget cap exceeded.';
  } else if (softBreach) {
    reason = 'Soft budget cap exceeded.';
  }

  return {
    overTurnSoft,
    overTurnHard,
    overSessionSoft,
    overSessionHard,
    shouldDegrade,
    shouldBlock,
    reason,
  };
}
