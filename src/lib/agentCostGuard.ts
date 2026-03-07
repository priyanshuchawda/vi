/**
 * Agent Cost Guard — Budget enforcement for the agentic loop
 *
 * Tracks per-step costs and enforces hard budget limits to prevent
 * runaway API spending. Uses Amazon Nova Lite pricing.
 *
 * Pricing (us.amazon.nova-lite-v1:0):
 *   Input:  $0.06  per 1M tokens
 *   Output: $0.24  per 1M tokens
 */

import type { AgentLoopConfig, StepCostReport } from '../types/agentTypes';

const NOVA_LITE_INPUT_COST_PER_TOKEN = 0.06 / 1_000_000;
const NOVA_LITE_OUTPUT_COST_PER_TOKEN = 0.24 / 1_000_000;

export interface CostGuardState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  stepCosts: StepCostReport[];
  budgetUsd: number;
  maxDurationMs: number;
  startedAt: number;
}

export type CostGuardDecision =
  | { action: 'allow' }
  | { action: 'warn'; message: string; budgetRemainingUsd: number }
  | { action: 'block'; reason: string };

export function createCostGuard(config: AgentLoopConfig): CostGuardState {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    stepCosts: [],
    budgetUsd: config.maxCostUsd,
    maxDurationMs: config.maxDurationMs,
    startedAt: Date.now(),
  };
}

export function calculateStepCost(inputTokens: number, outputTokens: number): number {
  return (
    inputTokens * NOVA_LITE_INPUT_COST_PER_TOKEN + outputTokens * NOVA_LITE_OUTPUT_COST_PER_TOKEN
  );
}

export function recordStepCost(
  guard: CostGuardState,
  stepNumber: number,
  inputTokens: number,
  outputTokens: number,
): StepCostReport {
  const stepCost = calculateStepCost(inputTokens, outputTokens);

  guard.totalInputTokens += inputTokens;
  guard.totalOutputTokens += outputTokens;
  guard.totalCostUsd += stepCost;

  const report: StepCostReport = {
    stepNumber,
    inputTokens,
    outputTokens,
    costUsd: stepCost,
    cumulativeCostUsd: guard.totalCostUsd,
    budgetRemainingUsd: Math.max(0, guard.budgetUsd - guard.totalCostUsd),
    budgetUsedPercent: Math.min(100, (guard.totalCostUsd / guard.budgetUsd) * 100),
  };

  guard.stepCosts.push(report);
  return report;
}

export function evaluateCostGuard(
  guard: CostGuardState,
  config: AgentLoopConfig,
): CostGuardDecision {
  const elapsed = Date.now() - guard.startedAt;

  if (guard.totalCostUsd >= config.maxCostUsd) {
    return {
      action: 'block',
      reason: `Cost budget exceeded: $${guard.totalCostUsd.toFixed(4)} >= $${config.maxCostUsd.toFixed(2)} limit`,
    };
  }

  if (elapsed >= config.maxDurationMs) {
    return {
      action: 'block',
      reason: `Duration limit exceeded: ${(elapsed / 1000).toFixed(1)}s >= ${(config.maxDurationMs / 1000).toFixed(0)}s limit`,
    };
  }

  const remaining = config.maxCostUsd - guard.totalCostUsd;
  const usedPercent = (guard.totalCostUsd / config.maxCostUsd) * 100;

  if (usedPercent >= 80) {
    return {
      action: 'warn',
      message: `Budget ${usedPercent.toFixed(0)}% used ($${guard.totalCostUsd.toFixed(4)} of $${config.maxCostUsd.toFixed(2)})`,
      budgetRemainingUsd: remaining,
    };
  }

  return { action: 'allow' };
}

export function estimateRemainingStepBudget(guard: CostGuardState): number {
  if (guard.stepCosts.length === 0) return 10;

  const avgCostPerStep = guard.totalCostUsd / guard.stepCosts.length;

  if (avgCostPerStep <= 0) return 10;

  const remaining = guard.budgetUsd - guard.totalCostUsd;
  return Math.max(0, Math.floor(remaining / avgCostPerStep));
}

export function formatCostSummary(guard: CostGuardState): string {
  const parts: string[] = [
    `Cost: $${guard.totalCostUsd.toFixed(4)}`,
    `Budget: $${guard.budgetUsd.toFixed(2)}`,
    `Used: ${((guard.totalCostUsd / guard.budgetUsd) * 100).toFixed(0)}%`,
    `Steps: ${guard.stepCosts.length}`,
    `Input tokens: ${guard.totalInputTokens}`,
    `Output tokens: ${guard.totalOutputTokens}`,
  ];

  return parts.join(' | ');
}
