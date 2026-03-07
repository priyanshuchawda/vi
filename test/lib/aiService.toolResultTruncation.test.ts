import { describe, expect, it, vi } from 'vitest';

import { getToolOutputMaxChars } from '../../src/lib/outputTruncation';

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

import { sendToolResultsToAI, type AIChatMessage } from '../../src/lib/aiService';

describe('aiService tool result truncation', () => {
  it('truncates oversized tool payloads before forwarding to model', async () => {
    converseBedrockMock.mockResolvedValue({
      output: { message: { content: [{ text: 'done' }] } },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const history: AIChatMessage[] = [];
    const modelContent = {
      content: [
        {
          toolUse: {
            toolUseId: 'tool-1',
            name: 'move_clip',
            input: { clip_id: 'clip-1', start_time: 5 },
          },
        },
      ],
    };

    const toolResults = [
      {
        name: 'move_clip',
        toolUseId: 'tool-1',
        result: {
          success: true,
          message: 'Updated clip',
          data: {
            debugDump: 'x'.repeat(20_000),
          },
        },
      },
    ];

    const stream = sendToolResultsToAI(history, modelContent, toolResults);
    for await (const chunk of stream) {
      void chunk;
    }

    expect(converseBedrockMock).toHaveBeenCalledTimes(1);
    const forwarded = converseBedrockMock.mock.calls[0][0].messages;
    const userToolResultJson = forwarded[forwarded.length - 1].content[0].toolResult.content[0].json;

    expect(userToolResultJson._truncated).toBe(true);
    expect(userToolResultJson._truncation?.tool).toBe('move_clip');
    expect(JSON.stringify(userToolResultJson).length).toBeLessThanOrEqual(
      getToolOutputMaxChars('move_clip'),
    );
  });
});
