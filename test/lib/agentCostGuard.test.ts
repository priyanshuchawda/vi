import { describe, it, expect } from 'vitest';
import {
  createCostGuard,
  calculateStepCost,
  recordStepCost,
  evaluateCostGuard,
  estimateRemainingStepBudget,
  formatCostSummary,
} from '../../src/lib/agentCostGuard';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../../src/types/agentTypes';

describe('agentCostGuard', () => {
  describe('calculateStepCost', () => {
    it('calculates cost correctly for Nova Lite pricing', () => {
      // 1000 input + 500 output tokens
      const cost = calculateStepCost(1000, 500);
      // Expected: (1000 * 0.06/1M) + (500 * 0.24/1M) = 0.00006 + 0.00012 = 0.00018
      expect(cost).toBeCloseTo(0.00018, 6);
    });

    it('returns 0 for zero tokens', () => {
      expect(calculateStepCost(0, 0)).toBe(0);
    });

    it('handles large token counts', () => {
      const cost = calculateStepCost(100_000, 50_000);
      // 100K * 0.06/1M + 50K * 0.24/1M = 0.006 + 0.012 = 0.018
      expect(cost).toBeCloseTo(0.018, 4);
    });
  });

  describe('createCostGuard', () => {
    it('initializes with zero costs', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);
      expect(guard.totalCostUsd).toBe(0);
      expect(guard.totalInputTokens).toBe(0);
      expect(guard.totalOutputTokens).toBe(0);
      expect(guard.stepCosts).toHaveLength(0);
    });

    it('uses config budget', () => {
      const guard = createCostGuard({ ...DEFAULT_AGENT_LOOP_CONFIG, maxCostUsd: 0.50 });
      expect(guard.budgetUsd).toBe(0.50);
    });
  });

  describe('recordStepCost', () => {
    it('accumulates costs across steps', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);

      recordStepCost(guard, 1, 500, 200);
      recordStepCost(guard, 2, 700, 300);

      expect(guard.stepCosts).toHaveLength(2);
      expect(guard.totalInputTokens).toBe(1200);
      expect(guard.totalOutputTokens).toBe(500);
      expect(guard.totalCostUsd).toBeGreaterThan(0);
    });

    it('returns a complete step cost report', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);
      const report = recordStepCost(guard, 1, 1000, 500);

      expect(report.stepNumber).toBe(1);
      expect(report.inputTokens).toBe(1000);
      expect(report.outputTokens).toBe(500);
      expect(report.costUsd).toBeGreaterThan(0);
      expect(report.cumulativeCostUsd).toBe(report.costUsd);
      expect(report.budgetRemainingUsd).toBeLessThanOrEqual(DEFAULT_AGENT_LOOP_CONFIG.maxCostUsd);
      expect(report.budgetUsedPercent).toBeGreaterThan(0);
      expect(report.budgetUsedPercent).toBeLessThan(100);
    });
  });

  describe('evaluateCostGuard', () => {
    it('allows execution within budget', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);
      recordStepCost(guard, 1, 500, 200);

      const decision = evaluateCostGuard(guard, DEFAULT_AGENT_LOOP_CONFIG);
      expect(decision.action).toBe('allow');
    });

    it('warns when 80%+ budget used', () => {
      const config = { ...DEFAULT_AGENT_LOOP_CONFIG, maxCostUsd: 0.0002 };
      const guard = createCostGuard(config);

      // Use up most of the budget (5000 input + 2000 output = ~$0.00078)
      recordStepCost(guard, 1, 5000, 2000);

      const decision = evaluateCostGuard(guard, config);
      // With budget 0.0002 and cost ~0.00078, should be block (exceeded)
      expect(decision.action).toBe('block');
    });

    it('blocks when budget exceeded', () => {
      const config = { ...DEFAULT_AGENT_LOOP_CONFIG, maxCostUsd: 0.00001 };
      const guard = createCostGuard(config);

      recordStepCost(guard, 1, 10000, 5000);

      const decision = evaluateCostGuard(guard, config);
      expect(decision.action).toBe('block');
    });

    it('blocks when duration exceeded', () => {
      const config = { ...DEFAULT_AGENT_LOOP_CONFIG, maxDurationMs: 1 }; // 1ms
      const guard = createCostGuard(config);
      // Manually backdate the startedAt to ensure elapsed > 1ms
      guard.startedAt = Date.now() - 100;

      const decision = evaluateCostGuard(guard, config);
      expect(decision.action).toBe('block');
    });
  });

  describe('estimateRemainingStepBudget', () => {
    it('returns 10 with no history', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);
      expect(estimateRemainingStepBudget(guard)).toBe(10);
    });

    it('estimates based on average cost', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);
      recordStepCost(guard, 1, 1000, 500);
      recordStepCost(guard, 2, 1000, 500);

      const remaining = estimateRemainingStepBudget(guard);
      const expected = Math.floor(
        (guard.budgetUsd - guard.totalCostUsd) / (guard.totalCostUsd / guard.stepCosts.length),
      );
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBe(expected);
    });
  });

  describe('formatCostSummary', () => {
    it('formats summary string with all metrics', () => {
      const guard = createCostGuard(DEFAULT_AGENT_LOOP_CONFIG);
      recordStepCost(guard, 1, 500, 200);

      const summary = formatCostSummary(guard);
      expect(summary).toContain('Cost:');
      expect(summary).toContain('Budget:');
      expect(summary).toContain('Steps: 1');
      expect(summary).toContain('Input tokens: 500');
      expect(summary).toContain('Output tokens: 200');
    });
  });
});
