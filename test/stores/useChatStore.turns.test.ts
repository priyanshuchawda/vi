import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../../src/stores/useChatStore';

describe('useChatStore turn lifecycle', () => {
  beforeEach(() => {
    useChatStore.setState({
      turns: [],
      activeTurnId: null,
    });
  });

  it('interrupts an active turn when a new turn starts', () => {
    const firstTurnId = useChatStore.getState().startTurn('user-msg-1', 'ask');
    const secondTurnId = useChatStore.getState().startTurn('user-msg-2', 'plan');
    const state = useChatStore.getState();

    const firstTurn = state.turns.find((turn) => turn.id === firstTurnId);
    const secondTurn = state.turns.find((turn) => turn.id === secondTurnId);

    expect(firstTurn?.status).toBe('interrupted');
    expect(firstTurn?.closeReason).toBe('interrupted');
    expect(firstTurn?.endedAt).toBeTypeOf('number');
    expect(firstTurn?.parts.some((part) => part.type === 'status')).toBe(true);

    expect(secondTurn?.status).toBe('planning');
    expect(state.activeTurnId).toBe(secondTurnId);
  });

  it('blocks invalid turn status transitions from terminal states', () => {
    const turnId = useChatStore.getState().startTurn('user-msg-1', 'ask');
    useChatStore.getState().setTurnStatus(turnId, 'completed');
    useChatStore.getState().setTurnStatus(turnId, 'executing');

    const turn = useChatStore.getState().turns.find((entry) => entry.id === turnId);
    expect(turn?.status).toBe('completed');

    const statusParts = turn?.parts.filter((part) => part.type === 'status') ?? [];
    expect(statusParts).toHaveLength(1);
    if (statusParts[0]?.type === 'status') {
      expect(statusParts[0].from).toBe('idle');
      expect(statusParts[0].to).toBe('completed');
    }
  });

  it('does not append new parts after a turn is closed', () => {
    const turnId = useChatStore.getState().startTurn('user-msg-1', 'ask');
    useChatStore.getState().closeTurn(turnId, 'completed');
    useChatStore.getState().appendTurnPart(turnId, {
      type: 'text',
      role: 'assistant',
      text: 'should not be added',
      timestamp: Date.now(),
    });

    const turn = useChatStore.getState().turns.find((entry) => entry.id === turnId);
    expect(turn?.status).toBe('completed');
    expect(turn?.parts.some((part) => part.type === 'text')).toBe(false);
  });

  it('allows agentic turns to pause for clarification and resume', () => {
    const turnId = useChatStore.getState().startTurn('user-msg-1', 'ask');

    useChatStore.getState().setTurnStatus(turnId, 'agentic_running');
    useChatStore.getState().setTurnStatus(turnId, 'agentic_step');
    useChatStore.getState().setTurnStatus(turnId, 'awaiting_approval');
    useChatStore.getState().setTurnStatus(turnId, 'agentic_running');

    const turn = useChatStore.getState().turns.find((entry) => entry.id === turnId);
    expect(turn?.status).toBe('agentic_running');

    const statusParts = turn?.parts.filter((part) => part.type === 'status') ?? [];
    expect(statusParts).toHaveLength(4);
  });
});
