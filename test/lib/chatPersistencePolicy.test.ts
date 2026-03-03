import { describe, expect, it } from 'vitest';

import {
  CHAT_PERSISTENCE_LIMITS,
  compactPersistedChatSlice,
  compactPersistedMessages,
  compactPersistedTurns,
} from '../../src/lib/chatPersistencePolicy';
import type { ChatMessage, ChatTurn } from '../../src/types/chat';

function makeMessage(index: number, role: ChatMessage['role'] = 'user'): ChatMessage {
  return {
    id: `m-${index}`,
    role,
    content: `message-${index}`,
    timestamp: index,
  };
}

function makeTurn(index: number, parts = 1): ChatTurn {
  return {
    id: `t-${index}`,
    userMessageId: `m-${index}`,
    mode: 'ask',
    status: 'completed',
    startedAt: index,
    endedAt: index + 1,
    closeReason: 'completed',
    parts: Array.from({ length: parts }, (_, i) => ({
      type: 'text' as const,
      role: 'assistant' as const,
      text: `part-${i}`,
      timestamp: i,
    })),
  };
}

describe('chatPersistencePolicy', () => {
  it('caps messages while keeping latest system marker', () => {
    const messages = [
      makeMessage(1, 'system'),
      ...Array.from({ length: 200 }, (_, i) => makeMessage(i + 2, 'user')),
      makeMessage(999, 'system'),
    ];

    const compacted = compactPersistedMessages(messages);

    expect(compacted.length).toBe(CHAT_PERSISTENCE_LIMITS.maxMessages);
    expect(compacted[0].role).toBe('system');
    expect(compacted[0].id).toBe('m-999');
  });

  it('caps turn count and per-turn parts', () => {
    const turns = Array.from({ length: 100 }, (_, i) => makeTurn(i, 260));

    const compacted = compactPersistedTurns(turns);

    expect(compacted.length).toBe(CHAT_PERSISTENCE_LIMITS.maxTurns);
    expect(compacted[0].id).toBe('t-20');
    expect(compacted[0].parts.length).toBe(CHAT_PERSISTENCE_LIMITS.maxTurnParts);
  });

  it('drops stale active turn id after migration compaction', () => {
    const turns = Array.from({ length: 90 }, (_, i) => makeTurn(i));
    const compacted = compactPersistedChatSlice({
      messages: [makeMessage(1, 'system')],
      turns,
      activeTurnId: 't-5',
    });

    expect(compacted.activeTurnId).toBeNull();
  });

  it('truncates oversized message content', () => {
    const long = 'a'.repeat(CHAT_PERSISTENCE_LIMITS.maxMessageChars + 500);
    const compacted = compactPersistedMessages([
      {
        id: 'm-long',
        role: 'user',
        content: long,
        timestamp: Date.now(),
      },
    ]);

    expect(compacted[0].content.length).toBeLessThanOrEqual(CHAT_PERSISTENCE_LIMITS.maxMessageChars);
    expect(compacted[0].content).toContain('truncated');
  });
});
