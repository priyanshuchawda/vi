import { describe, expect, it } from 'vitest';

import { capAttachments, getContextBudgetProfile } from '../../src/lib/contextBudgetPolicy';

describe('contextBudgetPolicy', () => {
  it('returns per-intent limits', () => {
    const chat = getContextBudgetProfile('chat');
    const plan = getContextBudgetProfile('plan');

    expect(plan.maxRetrievedEntries).toBeGreaterThan(chat.maxRetrievedEntries);
    expect(chat.maxAttachments).toBe(2);
  });

  it('caps attachments and reports dropped count', () => {
    const result = capAttachments([1, 2, 3, 4], 2);
    expect(result.selected).toEqual([1, 2]);
    expect(result.dropped).toBe(2);
  });
});
