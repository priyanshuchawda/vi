import { beforeEach, describe, expect, it } from 'vitest';
import { recordUsage, resetSession } from '../../src/lib/tokenTracker';
import { useChatStore } from '../../src/stores/useChatStore';

function resetChatStore(): void {
  useChatStore.setState({
    messages: [
      {
        id: 'system-message',
        role: 'system',
        content: 'Welcome',
        timestamp: Date.now(),
      },
    ],
    sessionTokens: {
      totalPromptTokens: 0,
      totalResponseTokens: 0,
      totalTokens: 0,
      totalCachedTokens: 0,
    },
    turns: [],
    activeTurnId: null,
    currentProjectId: null,
  });
}

describe('useChatStore token stats', () => {
  beforeEach(() => {
    resetSession();
    resetChatStore();
  });

  it('derives session stats from tokenTracker instead of persisted sessionTokens', () => {
    useChatStore.setState({
      sessionTokens: {
        totalPromptTokens: 9_999,
        totalResponseTokens: 9_999,
        totalTokens: 19_998,
        totalCachedTokens: 500,
      },
      messages: [
        {
          id: 'system-message',
          role: 'system',
          content: 'Welcome',
          timestamp: Date.now(),
        },
        {
          id: 'user-message',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        },
        {
          id: 'assistant-message',
          role: 'assistant',
          content: 'hi',
          timestamp: Date.now(),
        },
      ],
    });

    recordUsage({ inputTokens: 120, outputTokens: 80, totalTokens: 200 });

    const stats = useChatStore.getState().getSessionStats();

    expect(stats.messageCount).toBe(2);
    expect(stats.totalPromptTokens).toBe(120);
    expect(stats.totalResponseTokens).toBe(80);
    expect(stats.totalTokens).toBe(200);
    expect(stats.totalCachedTokens).toBe(0);
    expect(stats.cachedSavings).toBe(0);
    expect(stats.estimatedCost).toBeCloseTo((120 / 1_000_000) * 0.06 + (80 / 1_000_000) * 0.24, 10);
  });

  it('does not mutate sessionTokens aggregate in updateMessageTokens', () => {
    const messageId = useChatStore.getState().addMessage('assistant', 'draft');

    useChatStore.setState({
      sessionTokens: {
        totalPromptTokens: 10,
        totalResponseTokens: 20,
        totalTokens: 30,
        totalCachedTokens: 1,
      },
    });

    useChatStore.getState().updateMessageTokens(messageId, {
      promptTokens: 5,
      responseTokens: 6,
      totalTokens: 11,
    });

    const state = useChatStore.getState();
    const message = state.messages.find((entry) => entry.id === messageId);

    expect(message?.tokens).toEqual({
      promptTokens: 5,
      responseTokens: 6,
      totalTokens: 11,
    });
    expect(state.sessionTokens).toEqual({
      totalPromptTokens: 10,
      totalResponseTokens: 20,
      totalTokens: 30,
      totalCachedTokens: 1,
    });
  });

  it('resets tracked token totals when chat is cleared', () => {
    recordUsage({ inputTokens: 50, outputTokens: 50, totalTokens: 100 });
    useChatStore.getState().clearChat();

    const stats = useChatStore.getState().getSessionStats();
    expect(stats.totalTokens).toBe(0);
    expect(stats.messageCount).toBe(0);
  });

  it('resets tracked token totals when starting a new project chat', () => {
    recordUsage({ inputTokens: 70, outputTokens: 30, totalTokens: 100 });
    useChatStore.setState({ currentProjectId: 'project-1' });

    useChatStore.getState().clearChatForNewProject();

    const state = useChatStore.getState();
    const stats = state.getSessionStats();

    expect(state.currentProjectId).toBeNull();
    expect(stats.totalTokens).toBe(0);
    expect(stats.messageCount).toBe(0);
  });
});
