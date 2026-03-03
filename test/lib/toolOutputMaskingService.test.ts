import { describe, expect, it } from 'vitest';
import { maskToolOutputsInHistory } from '../../src/lib/toolOutputMaskingService';

describe('toolOutputMaskingService', () => {
  it('masks old bulky tool outputs', () => {
    const largeOutput = 'x'.repeat(10_000);
    const history = [
      {
        role: 'assistant' as const,
        content: [
          {
            toolResult: {
              toolUseId: 'a',
              content: [{ json: { output: largeOutput } }],
            },
          },
        ],
      },
      {
        role: 'assistant' as const,
        content: [{ text: 'recent message' }],
      },
    ];

    const result = maskToolOutputsInHistory(history, {
      protectLatestMessages: 1,
      minTokensPerBlock: 100,
    });

    expect(result.maskedCount).toBe(1);
    expect(result.estimatedTokensSaved).toBeGreaterThan(0);
    const maskedText = result.history[0].content[0].text;
    expect(maskedText).toContain('<tool_output_masked>');
  });

  it('does not mask protected recent messages', () => {
    const history = [
      {
        role: 'assistant' as const,
        content: [
          {
            toolResult: {
              toolUseId: 'a',
              content: [{ json: { output: 'x'.repeat(10_000) } }],
            },
          },
        ],
      },
    ];

    const result = maskToolOutputsInHistory(history, {
      protectLatestMessages: 5,
      minTokensPerBlock: 100,
    });
    expect(result.maskedCount).toBe(0);
  });

  it('does not mask below threshold', () => {
    const history = [
      {
        role: 'assistant' as const,
        content: [
          {
            toolResult: {
              toolUseId: 'a',
              content: [{ json: { output: 'tiny' } }],
            },
          },
        ],
      },
      {
        role: 'assistant' as const,
        content: [{ text: 'recent message' }],
      },
    ];

    const result = maskToolOutputsInHistory(history, {
      protectLatestMessages: 1,
      minTokensPerBlock: 10_000,
    });
    expect(result.maskedCount).toBe(0);
  });
});
