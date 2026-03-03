import { beforeEach, describe, expect, it, vi } from 'vitest';

const { converseBedrockMock } = vi.hoisted(() => ({
  converseBedrockMock: vi.fn(),
}));

vi.mock('../../src/lib/bedrockGateway', () => ({
  MODEL_ID: 'test-model',
  isBedrockConfigured: () => true,
  converseBedrock: converseBedrockMock,
}));

vi.mock('../../src/lib/rateLimiter', () => ({
  waitForSlot: vi.fn(async () => {}),
}));

import {
  __resetSummarizeFailureStateForTests,
  summarizeHistory,
  type AIChatMessage,
} from '../../src/lib/aiService';

describe('aiService summarizeHistory', () => {
  const history: AIChatMessage[] = [
    {
      role: 'user',
      content: [{ text: 'please split clip_1 at 00:12 and remove silence' }],
    },
    {
      role: 'assistant',
      content: [{ text: "I'll plan the edits and ask for confirmation." }],
    },
  ];

  beforeEach(() => {
    converseBedrockMock.mockReset();
    __resetSummarizeFailureStateForTests();
  });

  it('uses two-pass summary and returns condensed history when smaller', async () => {
    const longHistory: AIChatMessage[] = [
      {
        role: 'user',
        content: [{ text: 'timeline dump '.repeat(1200) }],
      },
      {
        role: 'assistant',
        content: [{ text: 'acknowledged '.repeat(800) }],
      },
    ];

    converseBedrockMock
      .mockResolvedValueOnce({
        output: { message: { content: [{ text: '## Primary Goal\nTrim intro' }] } },
      })
      .mockResolvedValueOnce({
        output: {
          message: {
            content: [{ text: '## Primary Goal\nTrim intro\n## Pending Tasks\nConfirm cut' }],
          },
        },
      });

    const result = await summarizeHistory(longHistory);

    expect(result.length).toBe(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content[0].text).toContain('Pending Tasks');
    expect(converseBedrockMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to original history when summary inflates token footprint', async () => {
    converseBedrockMock
      .mockResolvedValueOnce({
        output: { message: { content: [{ text: 'x'.repeat(20_000) }] } },
      })
      .mockResolvedValueOnce({
        output: { message: { content: [{ text: 'x'.repeat(25_000) }] } },
      });

    const result = await summarizeHistory(history);
    expect(result).toEqual(history);
  });

  it('skips summarization after repeated failures', async () => {
    converseBedrockMock.mockRejectedValue(new Error('temporary failure'));

    await summarizeHistory(history);
    await summarizeHistory(history);
    const third = await summarizeHistory(history);

    expect(third).toEqual(history);
    expect(converseBedrockMock).toHaveBeenCalledTimes(2);
  });
});
