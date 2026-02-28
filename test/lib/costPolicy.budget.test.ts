import { beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateBudgetPolicy,
  getBudgetPolicy,
  updateBudgetPolicy,
} from '../../src/lib/costPolicy';

describe('costPolicy budget controls', () => {
  beforeEach(() => {
    localStorage.removeItem('qc_budget_policy_v1');
    updateBudgetPolicy({
      perTurnSoftUsd: 0.005,
      perTurnHardUsd: 0.02,
      perSessionSoftUsd: 0.05,
      perSessionHardUsd: 0.2,
      onCap: 'degrade',
    });
  });

  it('degrades on soft cap when onCap=degrade', () => {
    const decision = evaluateBudgetPolicy({
      estimatedTurnCostUsd: 0.006,
      currentSessionCostUsd: 0.0,
    });

    expect(decision.overTurnSoft).toBe(true);
    expect(decision.shouldDegrade).toBe(true);
    expect(decision.shouldBlock).toBe(false);
  });

  it('blocks on hard cap regardless of soft-cap behavior', () => {
    const decision = evaluateBudgetPolicy({
      estimatedTurnCostUsd: 0.03,
      currentSessionCostUsd: 0.0,
    });

    expect(decision.overTurnHard).toBe(true);
    expect(decision.shouldBlock).toBe(true);
    expect(decision.shouldDegrade).toBe(false);
  });

  it('can block on soft cap when onCap=block', () => {
    updateBudgetPolicy({ onCap: 'block' });
    const decision = evaluateBudgetPolicy({
      estimatedTurnCostUsd: 0.006,
      currentSessionCostUsd: 0.0,
    });

    expect(decision.overTurnSoft).toBe(true);
    expect(decision.shouldBlock).toBe(true);
  });

  it('normalizes invalid policy values and preserves hard>=soft', () => {
    updateBudgetPolicy({
      perTurnSoftUsd: 0.02,
      perTurnHardUsd: 0.01,
      perSessionSoftUsd: -1,
      perSessionHardUsd: 0.01,
    });

    const policy = getBudgetPolicy();
    expect(policy.perTurnHardUsd).toBeGreaterThanOrEqual(policy.perTurnSoftUsd);
    expect(policy.perSessionSoftUsd).toBeGreaterThanOrEqual(0);
    expect(policy.perSessionHardUsd).toBeGreaterThanOrEqual(policy.perSessionSoftUsd);
  });
});
