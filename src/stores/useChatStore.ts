import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, ChatContext, TokenInfo, SessionStats, MediaAttachment } from '../types/chat';

interface ChatStore {
  messages: ChatMessage[];
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

  addMessage: (role: 'user' | 'assistant', content: string, metadata?: ChatMessage['metadata'], attachments?: MediaAttachment[]) => void;
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
}

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 520;

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
      panelWidth: 320,

      addMessage: (role, content, metadata, attachments) => set((state) => ({
        messages: [...state.messages, {
          id: uuidv4(),
          role,
          content,
          timestamp: Date.now(),
          metadata,
          attachments,
        }],
      })),

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

        // Update session totals
        const sessionTokens = {
          totalPromptTokens: state.sessionTokens.totalPromptTokens + tokens.promptTokens,
          totalResponseTokens: state.sessionTokens.totalResponseTokens + tokens.responseTokens,
          totalTokens: state.sessionTokens.totalTokens + tokens.totalTokens,
          totalCachedTokens: state.sessionTokens.totalCachedTokens + (tokens.cachedTokens || 0),
        };

        return { messages, sessionTokens };
      }),

      clearChat: () => set({
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
      }),

      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      setIsOpen: (isOpen) => set({ isOpen }),

      setIsTyping: (isTyping) => set({ isTyping }),

      updateContext: (newContext) => set((state) => ({
        context: { ...state.context, ...newContext },
      })),

      getSessionStats: () => {
        const state = get();
        const messageCount = state.messages.filter(m => m.role !== 'system').length;

        // Amazon Nova Lite on-demand pricing
        const inputCostPer1M = 0.06;   // $0.06 per 1M input tokens
        const outputCostPer1M = 0.24;  // $0.24 per 1M output tokens

        // Bedrock prompt-cache tokens are not currently tracked in this app
        const inputCost = (state.sessionTokens.totalPromptTokens / 1_000_000) * inputCostPer1M;
        const outputCost = (state.sessionTokens.totalResponseTokens / 1_000_000) * outputCostPer1M;

        return {
          messageCount,
          totalPromptTokens: state.sessionTokens.totalPromptTokens,
          totalResponseTokens: state.sessionTokens.totalResponseTokens,
          totalTokens: state.sessionTokens.totalTokens,
          totalCachedTokens: state.sessionTokens.totalCachedTokens,
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
        return {
          messages: state.messages,
          sessionTokens: state.sessionTokens,
        };
      },

      clearChatForNewProject: () => {
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
        });
      },

      toggleAutoExecute: () => set((state) => ({ autoExecute: !state.autoExecute })),

      setPanelWidth: (width) => set({ panelWidth: clampPanelWidth(width) }),
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
      }),
    }
  )
);
