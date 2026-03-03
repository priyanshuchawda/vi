import { describe, expect, it, vi } from 'vitest';

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

import { sendMessageWithHistoryStream, sendToolResultsToAI } from '../../src/lib/aiService';

describe('aiService cooperative abort', () => {
  it('aborts message stream before model call when signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const stream = sendMessageWithHistoryStream('hello', [], undefined, {
      includeTools: false,
      signal: controller.signal,
    });

    await expect(stream.next()).rejects.toThrow('Request cancelled');
    expect(converseBedrockMock).not.toHaveBeenCalled();
  });

  it('aborts tool follow-up before model call when signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const stream = sendToolResultsToAI([], null, [], {
      signal: controller.signal,
    });

    await expect(stream.next()).rejects.toThrow('Request cancelled');
    expect(converseBedrockMock).not.toHaveBeenCalled();
  });
});
