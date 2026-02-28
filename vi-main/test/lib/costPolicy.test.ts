import { describe, expect, it } from 'vitest';
import {
  estimateTurnCost,
  trimHistoryToLimit,
  type CostPolicyInput,
} from '../../src/lib/costPolicy';

function makeHistory(messageCount: number, charsPerMessage: number) {
  return Array.from({ length: messageCount }).map((_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: [{ text: 'x'.repeat(charsPerMessage) }],
  }));
}

describe('costPolicy', () => {
  it('keeps normal policy for small turns', () => {
    const input: CostPolicyInput = {
      intent: 'chat',
      history: makeHistory(4, 120),
      dynamicContextChars: 800,
      userMessageChars: 80,
      toolCount: 0,
      maxOutputTokens: 1024,
    };

    const result = estimateTurnCost(input);
    expect(result.degraded).toBe(false);
    expect(result.maxHistoryMessages).toBe(20);
    expect(result.maxDynamicContextChars).toBe(5000);
    expect(result.economyTools).toBe(false);
  });

  it('degrades policy for high token pressure', () => {
    const input: CostPolicyInput = {
      intent: 'edit_plan',
      history: makeHistory(24, 2500),
      dynamicContextChars: 5000,
      userMessageChars: 700,
      toolCount: 24,
      maxOutputTokens: 1536,
    };

    const result = estimateTurnCost(input);
    expect(result.degraded).toBe(true);
    expect(result.maxHistoryMessages).toBe(10);
    expect(result.maxDynamicContextChars).toBe(3200);
    expect(result.economyTools).toBe(true);
  });

  it('trims history while preserving anchor + tail', () => {
    const history = makeHistory(15, 10);
    const trimmed = trimHistoryToLimit(history, 8);

    expect(trimmed).toHaveLength(8);
    expect(trimmed[0]).toEqual(history[0]);
    expect(trimmed[1]).toEqual(history[1]);
    expect(trimmed[7]).toEqual(history[14]);
  });
});
