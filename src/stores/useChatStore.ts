import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { getSessionStats as getTrackedSessionStats, resetSession as resetTrackedSession } from '../lib/tokenTracker';
import type {
  ChatMessage,
  ChatContext,
  TokenInfo,
  SessionStats,
  MediaAttachment,
  ChatTurn,
  ChatTurnMode,
  ChatTurnStatus,
  TurnPart,
} from '../types/chat';

interface ChatStore {
  messages: ChatMessage[];
  turns: ChatTurn[];
  activeTurnId: string | null;
  isOpen: boolean;
  isTyping: boolean;
  context: ChatContext;
  sessionTokens: {
    totalPromptTokens: number;
    totalResponseTokens: number;
    totalTokens: number;
    totalCachedTokens: number;
  };
  currentProjectId: string | null;
  autoExecute: boolean;
  panelWidth: number;
  executionContext: {
    hasPendingPlan: boolean;
    lastUserMessageForPlan: string | null;
    updatedAt: number | null;
  };

  addMessage: (role: 'user' | 'assistant', content: string, metadata?: ChatMessage['metadata'], attachments?: MediaAttachment[]) => string;
  updateLastMessage: (content: string) => void;
  updateMessageTokens: (messageId: string, tokens: TokenInfo) => void;
  clearChat: () => void;
  togglePanel: () => void;
  setIsOpen: (isOpen: boolean) => void;
  setIsTyping: (isTyping: boolean) => void;
  updateContext: (context: Partial<ChatContext>) => void;
  getSessionStats: () => SessionStats;
  loadChatForProject: (projectId: string | null) => void;
  exportChatForProject: () => { messages: ChatMessage[]; sessionTokens: ChatStore['sessionTokens'] };
  clearChatForNewProject: () => void;
  toggleAutoExecute: () => void;
  setPanelWidth: (width: number) => void;
  setExecutionContext: (context: Partial<ChatStore['executionContext']>) => void;
  clearExecutionContext: () => void;
  startTurn: (userMessageId: string, mode: ChatTurnMode) => string;
  appendTurnPart: (turnId: string, part: TurnPart) => void;
  setTurnStatus: (turnId: string, status: ChatTurnStatus, retryInfo?: ChatTurn['retryInfo']) => void;
  closeTurn: (turnId: string, reason: ChatTurn['closeReason']) => void;
}

const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 900;
const TERMINAL_TURN_STATUSES: ChatTurnStatus[] = ['completed', 'error', 'interrupted'];

const TURN_STATUS_TRANSITIONS: Record<ChatTurnStatus, ChatTurnStatus[]> = {
  idle: ['planning', 'awaiting_approval', 'executing', 'completed', 'error', 'interrupted'],
  planning: ['awaiting_approval', 'executing', 'retry', 'completed', 'error', 'interrupted'],
  awaiting_approval: ['planning', 'executing', 'completed', 'error', 'interrupted'],
  executing: ['retry', 'completed', 'error', 'interrupted'],
  retry: ['planning', 'executing', 'error', 'interrupted'],
  completed: [],
  error: [],
  interrupted: [],
};

function isTerminalTurnStatus(status: ChatTurnStatus): boolean {
  return TERMINAL_TURN_STATUSES.includes(status);
}

function canTransitionTurnStatus(from: ChatTurnStatus, to: ChatTurnStatus): boolean {
  if (from === to) return true;
  return TURN_STATUS_TRANSITIONS[from].includes(to);
}

function clampPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return 320;
  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.round(width)));
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [
        {
          id: uuidv4(),
          role: 'system',
          content: 'Welcome to QuickCut AI Assistant powered by Amazon Bedrock. Ask about video editing, or attach images, videos, audio, and PDFs for AI analysis.',
          timestamp: Date.now(),
        }
      ],
      turns: [],
      activeTurnId: null,
      isOpen: false,
      isTyping: false,
      context: {},
      sessionTokens: {
        totalPromptTokens: 0,
        totalResponseTokens: 0,
        totalTokens: 0,
        totalCachedTokens: 0,
      },
      currentProjectId: null,
      autoExecute: false,
      panelWidth: 460,
      executionContext: {
        hasPendingPlan: false,
        lastUserMessageForPlan: null,
        updatedAt: null,
      },

      addMessage: (role, content, metadata, attachments) => {
        const id = uuidv4();
        set((state) => ({
          messages: [...state.messages, {
            id,
            role,
            content,
            timestamp: Date.now(),
            metadata,
            attachments,
          }],
        }));
        return id;
      },

      updateLastMessage: (content) => set((state) => {
        const messages = [...state.messages];
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage.role === 'assistant') {
            messages[messages.length - 1] = {
              ...lastMessage,
              content,
            };
          }
        }
        return { messages };
      }),

      updateMessageTokens: (messageId, tokens) => set((state) => {
        const messages = state.messages.map(msg =>
          msg.id === messageId ? { ...msg, tokens } : msg
        );
        return { messages };
      }),

      clearChat: () => {
        resetTrackedSession();
        set({
          messages: [{
            id: uuidv4(),
            role: 'system',
            content: 'Chat cleared. How can I help with your video project? Attach files for AI analysis.',
            timestamp: Date.now(),
          }],
          sessionTokens: {
            totalPromptTokens: 0,
            totalResponseTokens: 0,
            totalTokens: 0,
            totalCachedTokens: 0,
          },
          turns: [],
          activeTurnId: null,
        });
      },

      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      setIsOpen: (isOpen) => set({ isOpen }),

      setIsTyping: (isTyping) => set({ isTyping }),

      updateContext: (newContext) => set((state) => ({
        context: { ...state.context, ...newContext },
      })),

      getSessionStats: () => {
        const state = get();
        const trackedStats = getTrackedSessionStats();
        const messageCount = state.messages.filter(m => m.role !== 'system').length;

        // Amazon Nova Lite on-demand pricing
        const inputCostPer1M = 0.06;   // $0.06 per 1M input tokens
        const outputCostPer1M = 0.24;  // $0.24 per 1M output tokens

        const inputCost = (trackedStats.inputTokens / 1_000_000) * inputCostPer1M;
        const outputCost = (trackedStats.outputTokens / 1_000_000) * outputCostPer1M;

        return {
          messageCount,
          totalPromptTokens: trackedStats.inputTokens,
          totalResponseTokens: trackedStats.outputTokens,
          totalTokens: trackedStats.totalTokens,
          totalCachedTokens: 0,
          estimatedCost: inputCost + outputCost,
          cachedSavings: 0,
        };
      },

      loadChatForProject: (projectId: string | null) => {
        const state = get();
        
        // If same project, do nothing
        if (state.currentProjectId === projectId) return;
        
        // Set the current project ID
        set({ currentProjectId: projectId });
        
        // Chat messages will be loaded from project file during loadProject
        // This is just to track which project we're working with
      },

      exportChatForProject: () => {
        const state = get();
        const trackedStats = getTrackedSessionStats();
        return {
          messages: state.messages,
          sessionTokens: {
            totalPromptTokens: trackedStats.inputTokens,
            totalResponseTokens: trackedStats.outputTokens,
            totalTokens: trackedStats.totalTokens,
            totalCachedTokens: 0,
          },
        };
      },

      clearChatForNewProject: () => {
        resetTrackedSession();
        set({
          messages: [{
            id: uuidv4(),
            role: 'system',
            content: 'Welcome to QuickCut AI Assistant powered by Amazon Bedrock. Ask about video editing, or attach images, videos, audio, and PDFs for AI analysis.',
            timestamp: Date.now(),
          }],
          sessionTokens: {
            totalPromptTokens: 0,
            totalResponseTokens: 0,
            totalTokens: 0,
            totalCachedTokens: 0,
          },
          currentProjectId: null,
          turns: [],
          activeTurnId: null,
        });
      },

      toggleAutoExecute: () => set((state) => ({ autoExecute: !state.autoExecute })),

      setPanelWidth: (width) => set({ panelWidth: clampPanelWidth(width) }),
      setExecutionContext: (newContext) => set((state) => ({
        executionContext: {
          ...state.executionContext,
          ...newContext,
          updatedAt: Date.now(),
        },
      })),
      clearExecutionContext: () => set({
        executionContext: {
          hasPendingPlan: false,
          lastUserMessageForPlan: null,
          updatedAt: Date.now(),
        },
      }),
      startTurn: (userMessageId, mode) => {
        const id = uuidv4();
        const now = Date.now();
        set((state) => ({
          turns: [
            ...state.turns.map((turn) => {
              if (turn.id !== state.activeTurnId || turn.endedAt) return turn;
              const interruptedStatus: ChatTurnStatus = 'interrupted';
              return {
                ...turn,
                status: interruptedStatus,
                closeReason: 'interrupted' as const,
                endedAt: now,
                parts: [
                  ...turn.parts,
                  {
                    type: 'status' as const,
                    from: turn.status,
                    to: interruptedStatus,
                    timestamp: now,
                  },
                ],
              };
            }),
            {
              id,
              userMessageId,
              mode,
              status: mode === 'plan' ? 'planning' : 'idle',
              parts: [],
              startedAt: now,
            },
          ],
          activeTurnId: id,
        }));
        return id;
      },
      appendTurnPart: (turnId, part) => set((state) => ({
        turns: state.turns.map((turn) =>
          turn.id === turnId
            ? turn.endedAt
              ? turn
              : { ...turn, parts: [...turn.parts, part] }
            : turn
        ),
      })),
      setTurnStatus: (turnId, status, retryInfo) => set((state) => {
        const now = Date.now();
        return {
          turns: state.turns.map((turn) => {
            if (turn.id !== turnId || turn.endedAt) return turn;
            if (!canTransitionTurnStatus(turn.status, status)) return turn;
            const nextRetryInfo = status === 'retry' ? retryInfo : undefined;
            return {
              ...turn,
              mode: turn.mode === 'plan' && status === 'executing' ? 'edit' : turn.mode,
              status,
              retryInfo: nextRetryInfo,
              parts: turn.status === status
                ? turn.parts
                : [
                    ...turn.parts,
                    {
                      type: 'status' as const,
                      from: turn.status,
                      to: status,
                      timestamp: now,
                    },
                  ],
            };
          }),
        };
      }),
      closeTurn: (turnId, reason) => set((state) => ({
        turns: state.turns.map((turn) =>
          turn.id === turnId
            ? (() => {
                if (turn.endedAt) return turn;
                const now = Date.now();
                const nextStatus =
                  reason === 'error' ? 'error' : reason === 'interrupted' ? 'interrupted' : 'completed';
                return {
                  ...turn,
                  status: nextStatus,
                  closeReason: reason,
                  endedAt: now,
                  retryInfo: isTerminalTurnStatus(nextStatus) ? undefined : turn.retryInfo,
                  parts: turn.status === nextStatus
                    ? turn.parts
                    : [
                        ...turn.parts,
                        {
                          type: 'status' as const,
                          from: turn.status,
                          to: nextStatus,
                          timestamp: now,
                        },
                      ],
                };
              })()
            : turn
        ),
        activeTurnId: state.activeTurnId === turnId ? null : state.activeTurnId,
      })),
    }),
    {
      name: 'quickcut-chat-storage',
      partialize: (state) => ({
        messages: state.messages.map(msg => ({
          ...msg,
          // Don't persist File objects or previewUrls (not serializable) 
          attachments: msg.attachments?.map(a => ({
            ...a,
            file: undefined as any, // Can't serialize File objects
            previewUrl: undefined, // Object URLs are not persistent
            base64Data: undefined, // Don't persist large base64 in localStorage
          })),
        })),
        sessionTokens: state.sessionTokens,
        currentProjectId: state.currentProjectId,
        autoExecute: state.autoExecute,
        panelWidth: state.panelWidth,
        executionContext: state.executionContext,
        turns: state.turns,
        activeTurnId: state.activeTurnId,
      }),
    }
  )
);
