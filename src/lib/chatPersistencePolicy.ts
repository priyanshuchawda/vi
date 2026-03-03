import type { ChatMessage, ChatTurn } from '../types/chat';

export const CHAT_PERSISTENCE_LIMITS = {
  maxMessages: 120,
  maxTurns: 80,
  maxTurnParts: 200,
  maxMessageChars: 12_000,
};

export type PersistedChatSlice = {
  messages?: ChatMessage[];
  turns?: ChatTurn[];
  activeTurnId?: string | null;
};

function truncateTextWithTail(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const marker = `\n...[truncated ${content.length - maxChars} chars for persistence]...\n`;
  const available = Math.max(32, maxChars - marker.length);
  const headSize = Math.ceil(available * 0.7);
  const tailSize = Math.max(0, available - headSize);
  return `${content.slice(0, headSize)}${marker}${content.slice(content.length - tailSize)}`;
}

function sanitizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    content:
      typeof message.content === 'string'
        ? truncateTextWithTail(message.content, CHAT_PERSISTENCE_LIMITS.maxMessageChars)
        : '',
    attachments: message.attachments?.map((attachment) => ({
      ...attachment,
      file: undefined as unknown as File,
      previewUrl: undefined,
      base64Data: undefined,
    })),
  };
}

export function compactPersistedMessages(messages: ChatMessage[] | undefined): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const sanitized = messages.map(sanitizeMessage);
  const max = CHAT_PERSISTENCE_LIMITS.maxMessages;
  if (sanitized.length <= max) {
    return sanitized;
  }

  const latestSystemMessage = [...sanitized].reverse().find((msg) => msg.role === 'system');
  const nonSystem = sanitized.filter((msg) => msg.role !== 'system');
  const slotsForNonSystem = max - (latestSystemMessage ? 1 : 0);
  const retainedNonSystem = nonSystem.slice(-Math.max(0, slotsForNonSystem));

  return latestSystemMessage ? [latestSystemMessage, ...retainedNonSystem] : retainedNonSystem;
}

function compactSingleTurn(turn: ChatTurn): ChatTurn {
  if (turn.parts.length <= CHAT_PERSISTENCE_LIMITS.maxTurnParts) {
    return turn;
  }

  return {
    ...turn,
    parts: turn.parts.slice(-CHAT_PERSISTENCE_LIMITS.maxTurnParts),
  };
}

export function compactPersistedTurns(turns: ChatTurn[] | undefined): ChatTurn[] {
  if (!Array.isArray(turns) || turns.length === 0) {
    return [];
  }

  const compacted = turns.map(compactSingleTurn);
  if (compacted.length <= CHAT_PERSISTENCE_LIMITS.maxTurns) {
    return compacted;
  }

  return compacted.slice(-CHAT_PERSISTENCE_LIMITS.maxTurns);
}

export function compactPersistedChatSlice(slice: PersistedChatSlice): {
  messages: ChatMessage[];
  turns: ChatTurn[];
  activeTurnId: string | null;
} {
  const messages = compactPersistedMessages(slice.messages);
  const turns = compactPersistedTurns(slice.turns);
  const activeTurnId =
    slice.activeTurnId && turns.some((turn) => turn.id === slice.activeTurnId)
      ? slice.activeTurnId
      : null;

  return {
    messages,
    turns,
    activeTurnId,
  };
}
