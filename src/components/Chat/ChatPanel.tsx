import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useAiMemoryStore } from '../../stores/useAiMemoryStore';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';
import { TokenCounter } from './TokenCounter';
import type { ChatMessage as ChatRecord, MediaAttachment } from '../../types/chat';
import { getBudgetPolicy, updateBudgetPolicy, type BudgetPolicy } from '../../lib/costPolicy';
import {
  convertToAIHistory,
  sendMessageWithHistoryStream,
  sendToolResultsToAI,
  type AIChatMessage,
  type StreamChunk,
  type StreamOptions,
} from '../../lib/aiService';
import type { ExecutionPlan } from '../../lib/aiPlanningService';
import { getTelemetryRates, recordTurnRetry, resetTelemetry } from '../../lib/aiTelemetry';
import { classifyTransientError, getRetryDelayMs } from '../../lib/retryClassifier';
import { buildAIProjectSnapshot, type AIProjectSnapshot } from '../../lib/aiProjectSnapshot';
import { createChatRequestQueue } from '../../lib/chatRequestQueue';
import type { NormalizedIntent } from '../../lib/intentNormalizer';
import { createStreamCoalescer } from '../../lib/streamCoalescer';
import {
  buildClarificationQuestion,
  formatClarificationForChat,
} from '../../lib/clarificationBuilder';
import { detectContextNeeds, detectPublishIntent } from '../../lib/intentClassifier';
import { usePublishStore } from '../../stores/usePublishStore';
import {
  hasRecentEditingContext,
  inferAssistantArtifactFromText,
  isExecutionConfirmation,
  resolveConversationLane,
} from '../../lib/conversationLane';
import { optimizePromptForLane } from '../../lib/promptOptimizer';

interface SessionLogEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  content: string;
  tokenTotal?: number;
  isError?: boolean;
}

type ToolCallLike = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
};

const STREAM_FLUSH_INTERVAL_MS = 32;
const STREAM_MAX_BUFFERED_CHARS = 160;

function formatMissingAiConfigMessage(missingFields: string[]): string {
  const fieldList = missingFields.length > 0 ? missingFields.join(', ') : 'AWS credentials';
  return `AI setup is incomplete. Fill ${fieldList} in Settings before using the AI editor. I opened the Settings tab for you.`;
}

function isActionableUserMessage(message: string): boolean {
  const trimmed = String(message || '').trim();
  if (!trimmed) return false;
  return (
    !isExecutionConfirmation(trimmed) && !/^(continue|next|step by step|move next)$/i.test(trimmed)
  );
}

function isActionableAssistantTurn(message: ChatRecord): boolean {
  if (message.role !== 'assistant') return false;
  const artifact = message.metadata?.artifact || inferAssistantArtifactFromText(message.content);
  if (artifact?.type === 'tool_execution_result') return false;
  if (
    artifact?.type === 'script_draft' ||
    artifact?.type === 'execution_plan' ||
    artifact?.executable
  ) {
    return true;
  }

  return /\b(voiceover|on-screen text|caption|subtitle|execution plan|timeline|step-by-step)\b/i.test(
    message.content,
  );
}

const ChatPanel = () => {
  const {
    isOpen,
    messages,
    isTyping,
    togglePanel,
    addMessage,
    updateLastMessage,
    updateMessageTokens,
    updateMessageMetadata,
    clearChat,
    setIsTyping,
    autoExecute,
    executionContext,
    setExecutionContext,
    clearExecutionContext,
    turns,
    activeTurnId,
    startTurn,
    appendTurnPart,
    setTurnStatus,
    closeTurn,
  } = useChatStore();
  const { clips, currentTime, addTurnAudit, getTurnAudit, setActiveSidebarTab, setNotification } =
    useProjectStore();
  const { entries } = useAiMemoryStore();
  const { requestPublish, setIsGeneratingMeta } = usePublishStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const sendQueueRef = useRef(createChatRequestQueue());
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  // Always points to the latest processSendMessage so the stable handleSendMessage
  // callback below never closes over stale state.
  const processSendMessageRef = useRef<
    (content: string, attachments?: MediaAttachment[]) => Promise<void>
  >(async () => {
    /* populated after component mounts */
  });
  const [hasActiveAbortableRequest, setHasActiveAbortableRequest] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [showBudgetControls, setShowBudgetControls] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<BudgetPolicy>(() => getBudgetPolicy());
  const [auditTurnId, setAuditTurnId] = useState<string | null>(null);
  const [telemetryRates, setTelemetryRates] = useState<{
    plan_compile_fail_rate: number;
    fallback_rate: number;
    execution_validation_fail_rate: number;
    repeat_response_rate: number;
    turn_retry_rate: number;
  } | null>(null);
  const [sessionLogs, setSessionLogs] = useState<SessionLogEntry[]>([]);
  const hasInitializedLogsRef = useRef(false);
  const seenLogIdsRef = useRef(new Set<string>());
  const autoRecoveredDraftPlanKeysRef = useRef(new Set<string>());

  // Tool calling state
  const [pendingToolCalls, setPendingToolCalls] = useState<{
    functionCalls: ToolCallLike[];
    modelContent: StreamChunk['modelContent'];
    history: AIChatMessage[];
  } | null>(null);
  const [pendingClarification, setPendingClarification] = useState<{
    question: string;
    options: string[];
    context?: string;
    functionCall: ToolCallLike;
    modelContent: StreamChunk['modelContent'];
    history: AIChatMessage[];
    turnId: string | null;
  } | null>(null);
  const [isExecutingTools, setIsExecutingTools] = useState(false);
  const [toolExecutionProgress, setToolExecutionProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);

  // Planning state
  const [executionPlan, setExecutionPlan] = useState<{
    plan: ExecutionPlan;
    originalMessage: string;
    history: AIChatMessage[];
    normalizedIntent?: NormalizedIntent;
  } | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [lastPlanExecutionError, setLastPlanExecutionError] = useState<string | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, uploadStatus]);

  // Temporary in-memory log collector (not persisted)
  useEffect(() => {
    if (!hasInitializedLogsRef.current) {
      messages.forEach((m) => seenLogIdsRef.current.add(m.id));
      hasInitializedLogsRef.current = true;
      return;
    }

    const newMessages = messages.filter((m) => !seenLogIdsRef.current.has(m.id));
    if (newMessages.length === 0) return;

    newMessages.forEach((m) => seenLogIdsRef.current.add(m.id));

    setSessionLogs((prev) => {
      const next = [
        ...prev,
        ...newMessages.map((m) => ({
          id: m.id,
          role: m.role,
          timestamp: m.timestamp,
          content: m.content,
          tokenTotal: m.tokens?.totalTokens,
          isError: m.metadata?.error === true,
        })),
      ];
      return next.slice(-200);
    });
  }, [messages]);

  useEffect(() => {
    if (!showTelemetry) return;
    try {
      setTelemetryRates(getTelemetryRates());
    } catch {
      setTelemetryRates(null);
    }
  }, [showTelemetry, messages.length]);

  // Update context when clips or time changes
  useEffect(() => {
    // Context will be used when AI is integrated
  }, [clips, currentTime]);

  const tagAssistantMessageArtifact = (messageId: string, text: string) => {
    const inferred = inferAssistantArtifactFromText(text);
    if (!inferred) return;
    updateMessageMetadata(messageId, { artifact: inferred });
  };

  const recordToolLifecycleForTurn = (
    currentTurnId: string | null,
    event: {
      call: { name: string; args: Record<string, unknown> };
      state: 'pending' | 'running' | 'completed' | 'error';
      result?: {
        name?: string;
        result?: {
          success?: boolean;
          message?: string;
          error?: string;
        };
        success?: boolean;
        message?: string;
        error?: string;
      };
    },
  ) => {
    if (!currentTurnId) return;
    appendTurnPart(currentTurnId, {
      type: 'tool_call',
      name: event.call.name,
      args: event.call.args || {},
      state: event.state,
      timestamp: Date.now(),
    });

    if (event.state !== 'completed' && event.state !== 'error') return;
    const normalizedSuccess =
      typeof event.result?.success === 'boolean'
        ? event.result.success
        : Boolean(event.result?.result?.success);
    const normalizedMessage = event.result?.message || event.result?.result?.message;
    const normalizedError = event.result?.error || event.result?.result?.error;
    appendTurnPart(currentTurnId, {
      type: 'tool_result',
      name: event.result?.name || event.call.name,
      success: normalizedSuccess,
      message: normalizedMessage,
      error: normalizedError,
      timestamp: Date.now(),
    });
  };

  const runWithTransientRetry = async <T,>(
    run: () => Promise<T>,
    options: {
      turnId: string | null;
      onRetryStatus: (attempt: number, nextAt: number, reason: string) => void;
      maxRetries?: number;
    },
  ): Promise<T> => {
    const maxRetries = options.maxRetries ?? 2;
    let attempt = 0;

    while (true) {
      try {
        return await run();
      } catch (error) {
        attempt += 1;
        const classification = classifyTransientError(error);
        if (!classification.retryable || attempt > maxRetries) {
          throw error;
        }

        const delayMs = getRetryDelayMs(attempt);
        const nextAt = Date.now() + delayMs;
        recordTurnRetry();
        options.onRetryStatus(attempt, nextAt, classification.reason);
        if (options.turnId) {
          setTurnStatus(options.turnId, 'retry', {
            attempt,
            message: classification.reason,
            nextAt,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };

  const openClarificationPrompt = (params: {
    functionCalls: ToolCallLike[];
    modelContent: StreamChunk['modelContent'];
    history: AIChatMessage[];
    turnId: string | null;
  }): boolean => {
    const clarificationCall = params.functionCalls.find(isClarificationToolCall);
    if (!clarificationCall) return false;

    const question = String(clarificationCall.args?.question || 'Need clarification');
    const options = Array.isArray(clarificationCall.args?.options)
      ? clarificationCall.args.options
      : [];
    const context = clarificationCall.args?.context
      ? String(clarificationCall.args.context)
      : undefined;

    setPendingToolCalls(null);
    setPendingClarification({
      question,
      options,
      context,
      functionCall: clarificationCall,
      modelContent: params.modelContent,
      history: params.history,
      turnId: params.turnId,
    });

    if (params.turnId) {
      setTurnStatus(params.turnId, 'awaiting_approval');
      appendTurnPart(params.turnId, {
        type: 'tool_call',
        name: clarificationCall.name,
        args: clarificationCall.args || {},
        state: 'pending',
        timestamp: Date.now(),
      });
    }
    return true;
  };

  const getTurnRetryCount = (turnId: string): number => {
    const turn = turns.find((entry) => entry.id === turnId);
    if (!turn) return 0;
    return turn.parts.filter((part) => part.type === 'status' && part.to === 'retry').length;
  };

  const hashSnapshot = (snapshot: AIProjectSnapshot): string => {
    const raw = JSON.stringify(snapshot);
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv32-${(hash >>> 0).toString(16)}`;
  };

  const getDraftPlanRecoveryKey = (planState: { plan: ExecutionPlan; originalMessage: string }) =>
    JSON.stringify({
      message: planState.originalMessage,
      reason: planState.plan.planReadyReason,
      operations: planState.plan.operations.map((operation) => ({
        name: operation.functionCall.name,
        args: operation.functionCall.args || {},
        readOnly: operation.isReadOnly,
      })),
    });

  const summarizeSnapshotDiff = (before: AIProjectSnapshot, after: AIProjectSnapshot): string[] => {
    const beforeClips = before?.timeline?.clips || [];
    const afterClips = after?.timeline?.clips || [];
    const beforeIds = new Set(beforeClips.map((clip) => clip.id));
    const afterIds = new Set(afterClips.map((clip) => clip.id));
    const added = afterClips
      .filter((clip) => !beforeIds.has(clip.id))
      .map((clip) => clip.name || clip.id);
    const removed = beforeClips
      .filter((clip) => !afterIds.has(clip.id))
      .map((clip) => clip.name || clip.id);
    return [
      `Clips: ${before?.timeline?.clipCount ?? beforeClips.length} -> ${after?.timeline?.clipCount ?? afterClips.length}`,
      `Duration: ${(before?.timeline?.totalDuration ?? 0).toFixed(1)}s -> ${(after?.timeline?.totalDuration ?? 0).toFixed(1)}s`,
      `Added: ${added.length > 0 ? added.join(', ') : 'none'}`,
      `Removed: ${removed.length > 0 ? removed.join(', ') : 'none'}`,
    ];
  };

  /**
   * Handles the "publish to YouTube" flow:
   * generates AI metadata from project context and opens the Publish panel pre-filled.
   */
  const handlePublishFlow = async (
    userMessageId: string,
    appendAssistantMessage: (text: string, meta?: ChatRecord['metadata']) => string,
  ) => {
    setIsTyping(true);
    const turnId = startTurn(userMessageId, 'ask');

    try {
      // Acknowledge intent immediately
      appendAssistantMessage(
        'Got it! Let me prepare your YouTube publish metadata based on your project and channel style...',
      );
      setIsGeneratingMeta(true);

      // Gather context
      const clipNames = clips.filter((c) => c.name).map((c) => c.name as string);
      const totalDurationSec = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
      const channelRules = localStorage.getItem('channel-rules') ?? '';
      const memorySnippets = entries
        .filter((e) => e.status === 'completed' && e.summary)
        .map((e) => e.summary as string)
        .slice(0, 8);
      const recentChatSummary = [...messages]
        .slice(-6)
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join(' | ')
        .slice(0, 500);

      const { generatePublishMeta } = await import('../../lib/publishMetaGenerator');
      const meta = await generatePublishMeta({
        clipNames,
        totalDurationSec,
        channelRules,
        memorySnippets,
        recentChatSummary,
      });

      // Store metadata and signal App.tsx to switch panels
      requestPublish(meta);

      // Update the assistant message in-place
      const currentMsgs = useChatStore.getState().messages;
      useChatStore.setState({ messages: currentMsgs.slice(0, -1) });
      appendAssistantMessage(
        `I've prepared your publish metadata based on your ${channelRules ? 'channel style and ' : ''}project content:\n\n` +
          `**Title:** ${meta.title}\n\n` +
          `**Tags:** ${meta.tags || '(generated)'}\n\n` +
          `Privacy is set to **private** so you can review before publishing. ` +
          `Opening the Publish panel now — you can edit any field before uploading.`,
      );

      closeTurn(turnId, 'completed');
    } catch {
      appendAssistantMessage(
        "I couldn't generate publish metadata right now. Please open the Publish panel manually from the right-side toolbar.",
        { error: true },
      );
      closeTurn(turnId, 'error');
    } finally {
      setIsGeneratingMeta(false); // always reset, even on success
      setIsTyping(false);
    }
  };

  const processSendMessage = async (content: string, attachments?: MediaAttachment[]) => {
    const requestAbortController = new AbortController();
    const requestSignal = requestAbortController.signal;
    activeAbortControllerRef.current = requestAbortController;
    setHasActiveAbortableRequest(true);
    // Add user message with attachments
    const userMessageId = addMessage('user', content, undefined, attachments);
    setIsTyping(true);
    setUploadStatus(null);
    let turnId: string | null = null;
    let turnClosed = false;
    let messageCoalescer: ReturnType<typeof createStreamCoalescer> | null = null;

    const assistantMessage = (text: string, metadata?: ChatRecord['metadata']) => {
      const inferredArtifact = inferAssistantArtifactFromText(text);
      const resolvedMetadata: ChatRecord['metadata'] = inferredArtifact
        ? {
            ...(metadata || {}),
            artifact: metadata?.artifact || inferredArtifact,
          }
        : metadata;
      const id = addMessage('assistant', text, resolvedMetadata);
      if (turnId) {
        appendTurnPart(turnId, {
          type: 'text',
          role: 'assistant',
          text,
          timestamp: Date.now(),
        });
      }
      return id;
    };

    // ── PUBLISH INTENT: open Publish panel with AI-generated metadata ──────────
    if (detectPublishIntent(content) && !attachments?.length) {
      await handlePublishFlow(userMessageId, assistantMessage);
      setHasActiveAbortableRequest(false);
      return;
    }
    // ──────────────────────────────────────────────────────────────────────────

    try {
      const aiStatus = await window.electronAPI.aiConfig.getStatus();
      if (!aiStatus.bedrockReady) {
        setActiveSidebarTab('settings');
        setNotification({
          type: 'warning',
          message: 'AI settings are incomplete. Open Settings and fill your AWS credentials.',
        });
        assistantMessage(formatMissingAiConfigMessage(aiStatus.missingBedrockFields), {
          error: true,
        });
        setIsTyping(false);
        setHasActiveAbortableRequest(false);
        return;
      }
    } catch {
      assistantMessage(
        'I could not verify your AI configuration. Open Settings and check your Bedrock credentials before retrying.',
        { error: true },
      );
      setIsTyping(false);
      setHasActiveAbortableRequest(false);
      return;
    }

    try {
      const activeAwaitingTurn = activeTurnId
        ? turns.find(
            (turn) =>
              turn.id === activeTurnId && turn.status === 'awaiting_approval' && !turn.endedAt,
          )
        : null;
      const hasReadyPendingPlan = Boolean(
        executionPlan &&
        executionPlan.plan.planReady &&
        executionContext.hasPendingPlan &&
        activeAwaitingTurn,
      );

      if (
        isExecutionConfirmation(content) &&
        executionPlan &&
        executionContext.hasPendingPlan &&
        !hasReadyPendingPlan
      ) {
        assistantMessage(
          `Plan is not ready for execution yet. ${executionPlan.plan.planReadyReason || 'Please refine or rebuild the plan first.'}`,
        );
        return;
      }

      if (hasReadyPendingPlan && isExecutionConfirmation(content)) {
        assistantMessage('Using your pending plan and executing it now.');
        await handleExecutePlan();
        return;
      }

      const lastAssistantTurn = [...messages].reverse().find((m) => m.role === 'assistant');
      const lastActionableAssistantTurn = [...messages]
        .reverse()
        .find((m) => isActionableAssistantTurn(m));
      const lastActionableUserTurn = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && isActionableUserMessage(m.content));
      const lastAssistantMessage = lastAssistantTurn?.content || '';
      const recentEditingContext = hasRecentEditingContext(messages);
      const laneDecision = resolveConversationLane({
        message: content,
        lastAssistantMessage,
        lastAssistantArtifact: lastAssistantTurn?.metadata?.artifact,
        lastActionableUserMessage: lastActionableUserTurn?.content,
        lastActionableAssistantMessage: lastActionableAssistantTurn?.content,
        lastActionableAssistantArtifact: lastActionableAssistantTurn?.metadata?.artifact,
        hasTimeline: clips.length > 0,
        hasPendingPlan: hasReadyPendingPlan,
        hasRecentEditingContext: recentEditingContext,
      });
      const plannerInput = laneDecision.plannerInput;
      const normalizedIntent = laneDecision.normalizedIntent;
      const intent = laneDecision.lane === 'timeline_edit' ? 'edit' : 'chat';
      const timelineDuration = clips.reduce(
        (max, clip) => Math.max(max, clip.startTime + clip.duration),
        0,
      );
      const optimizedPrompt = optimizePromptForLane({
        message: content,
        laneDecision,
        timelineDuration,
        clipCount: clips.length,
      });
      turnId = startTurn(userMessageId, intent === 'edit' ? 'plan' : 'ask');
      appendTurnPart(turnId, {
        type: 'text',
        role: 'user',
        text: content,
        timestamp: Date.now(),
      });
      const contextFlags = detectContextNeeds(content, intent);

      console.log(
        `Intent: ${intent} | Lane: ${laneDecision.lane} (${laneDecision.reason}) | Context: T=${contextFlags.includeTimeline} M=${contextFlags.includeMemory} C=${contextFlags.includeChannel}`,
      );

      // Convert chat history to Bedrock format (exclude system messages)
      const aiHistory = convertToAIHistory(
        messages.filter((m) => m.role !== 'system'),
        { mediaMode: intent === 'edit' ? 'descriptor_only' : 'inline_bytes' },
      );

      // ── EDIT INTENT: Route through Agent Router first ──────────────
      if (intent === 'edit') {
        // Decide: agentic loop or single-pass planning
        const { decideExecutionMode, applyModeOverrides } = await import('../../lib/agentRouter');
        const routingMessage = plannerInput || content;
        const routingDecision = applyModeOverrides(
          decideExecutionMode({
            message: routingMessage,
            baseIntent: intent,
            normalizedIntent,
            clipCount: clips.length,
            hasTimeline: clips.length > 0,
          }),
          routingMessage,
        );

        console.log(
          `Agent Router: mode=${routingDecision.mode} reason=${routingDecision.reason} est_steps=${routingDecision.estimatedSteps} est_cost=$${routingDecision.estimatedCostUsd}`,
        );

        // ── AGENTIC MODE: Autonomous Plan → Act → Verify → Iterate ──
        if (routingDecision.mode === 'agentic') {
          if (turnId) {
            setTurnStatus(turnId, 'agentic_running');
            appendTurnPart(turnId, {
              type: 'step_start',
              label: `Agentic mode: ~${routingDecision.estimatedSteps} steps`,
              timestamp: Date.now(),
            });
          }
          setIsTyping(true);

          try {
            const { runAgentLoop } = await import('../../lib/agentLoop');
            const agentTurnId = turnId;
            const requestAbortController = activeAbortControllerRef.current;

            const agentResult = await runAgentLoop({
              userMessage: plannerInput,
              history: aiHistory,
              callbacks: {
                onStepStart: (step) => {
                  if (agentTurnId) {
                    setTurnStatus(agentTurnId, 'agentic_step');
                    appendTurnPart(agentTurnId, {
                      type: 'agent_step',
                      stepNumber: step.stepNumber,
                      status: step.status,
                      thought: step.thought,
                      toolName: step.toolCall?.name || null,
                      toolArgs: step.toolCall?.args || null,
                      success: null,
                      resultSummary: '',
                      costUsd: step.costUsd,
                      durationMs: step.durationMs,
                      timestamp: Date.now(),
                    });
                  }
                  // agentLoop calls onStepStart twice per step: once with no toolCall
                  // ("Thinking...") and again after tool selection ("Executing...").
                  // On the second call we update in-place so we don't accumulate
                  // orphaned "Thinking..." messages in the chat.
                  if (step.toolCall) {
                    updateLastMessage(
                      ` Step ${step.stepNumber}: Executing ${step.toolCall.name}...`,
                    );
                  } else {
                    assistantMessage(` Step ${step.stepNumber}: Thinking...`);
                  }
                },
                onStepComplete: (step) => {
                  if (agentTurnId) {
                    appendTurnPart(agentTurnId, {
                      type: 'agent_step',
                      stepNumber: step.stepNumber,
                      status: step.status,
                      thought: step.thought,
                      toolName: step.toolCall?.name || null,
                      toolArgs: step.toolCall?.args || null,
                      success: step.result?.success ?? null,
                      resultSummary: step.result?.output?.slice(0, 200) || '',
                      costUsd: step.costUsd,
                      durationMs: step.durationMs,
                      timestamp: Date.now(),
                    });
                  }
                  // Update the last message with step result
                  const statusIcon =
                    step.status === 'completed' ? '' : step.status === 'failed' ? '' : '';
                  updateLastMessage(
                    `${statusIcon} Step ${step.stepNumber}: ${step.toolCall?.name || 'thinking'} — ${step.result?.success ? 'success' : step.result?.error || 'done'}`,
                  );
                },
                onLoopComplete: (loopState) => {
                  if (agentTurnId) {
                    appendTurnPart(agentTurnId, {
                      type: 'agent_complete',
                      totalSteps: loopState.steps.length,
                      totalCostUsd: loopState.totalCostUsd,
                      totalDurationMs: loopState.totalDurationMs,
                      success: loopState.status === 'completed',
                      summary: loopState.finalSummary || '',
                      timestamp: Date.now(),
                    });
                  }
                },
                onLoopError: (errorMsg) => {
                  if (agentTurnId) {
                    appendTurnPart(agentTurnId, {
                      type: 'error',
                      message: errorMsg,
                      timestamp: Date.now(),
                    });
                  }
                },
                onCostUpdate: () => {
                  // Could update a cost badge in UI here
                },
              },
              abortSignal: requestAbortController?.signal,
              normalizedIntent: normalizedIntent
                ? {
                    mode: normalizedIntent.mode,
                    goals: normalizedIntent.goals,
                    constraints: normalizedIntent.constraints as Record<string, string | number>,
                    operationHint: normalizedIntent.operationHint,
                    confidence: normalizedIntent.confidence,
                  }
                : undefined,
            });

            // Replace the step-by-step messages with the final summary
            const currentMessages = useChatStore.getState().messages;
            useChatStore.setState({
              messages: currentMessages.slice(0, -1),
            });

            const costInfo = `\n\n_Cost: $${agentResult.totalCostUsd.toFixed(4)} | ${agentResult.totalSteps} steps | ${(agentResult.state.totalDurationMs / 1000).toFixed(1)}s_`;
            addMessage('assistant', agentResult.finalSummary + costInfo);

            if (agentTurnId) {
              closeTurn(agentTurnId, agentResult.success ? 'agentic_done' : 'error');
              turnClosed = true; // prevent outer finally from overwriting the turn status
            }
            clearExecutionContext();
          } catch (error) {
            console.error('Agentic loop error:', error);
            const errorMessage =
              error instanceof Error ? error.message : 'Agentic execution failed';
            assistantMessage(` Agentic execution error: ${errorMessage}`, { error: true });
            if (turnId) {
              appendTurnPart(turnId, {
                type: 'error',
                message: errorMessage,
                timestamp: Date.now(),
              });
              closeTurn(turnId, 'error');
            }
          } finally {
            setIsTyping(false);
            setIsGeneratingPlan(false);
          }
          return;
        }

        // ── SINGLE-PASS MODE: Existing planning pipeline ──────────────
        if (turnId) {
          setTurnStatus(turnId, 'planning');
          appendTurnPart(turnId, {
            type: 'step_start',
            label: 'Generating execution plan',
            timestamp: Date.now(),
          });
        }
        setIsGeneratingPlan(true);
        const { generateCompletePlan } = await import('../../lib/aiPlanningService');

        // If this is a bare confirmation (e.g. "execute", "yes"), restore the original
        // planning message and intent so constraints like target_duration are preserved.
        const isBareConfirmation = isExecutionConfirmation(content) && executionPlan !== null;
        const effectivePlannerInput = isBareConfirmation
          ? (executionPlan?.originalMessage ?? plannerInput)
          : plannerInput;
        const effectiveNormalizedIntent = isBareConfirmation
          ? (executionPlan?.normalizedIntent ?? normalizedIntent)
          : normalizedIntent;

        assistantMessage('Analyzing your request and generating execution plan...');

        const plan = await runWithTransientRetry(
          () =>
            generateCompletePlan(effectivePlannerInput, aiHistory, 3, {
              normalizedIntent: effectiveNormalizedIntent,
            }),
          {
            turnId,
            onRetryStatus: (attempt, nextAt, reason) => {
              assistantMessage(
                `Transient planner error (${reason}). Retrying attempt ${attempt} at ${new Date(nextAt).toLocaleTimeString()}.`,
              );
            },
            maxRetries: 2,
          },
        );
        if (turnId) {
          setTurnStatus(turnId, 'planning');
        }

        setIsGeneratingPlan(false);

        if (plan.operations.length > 0) {
          // Remove the "analyzing" message
          const currentMessages = useChatStore.getState().messages;
          useChatStore.setState({
            messages: currentMessages.slice(0, -1),
          });

          const validationIssues = plan.validation?.issues || [];
          const hasHardValidationIssues = validationIssues.some(
            (issue) => issue.category !== 'validation_warning',
          );
          if (hasHardValidationIssues) {
            const issuePreview = (plan.validation.issues || [])
              .slice(0, 3)
              .map((issue) => `- ${issue.toolName}: ${issue.message}`)
              .join('\n');
            addMessage(
              'assistant',
              `Plan needs fixes before execution.\n\n${issuePreview || 'Validation failed.'}\n\nI kept the draft plan visible so you can review and adjust.`,
              { error: true },
            );
            if (turnId) {
              appendTurnPart(turnId, {
                type: 'error',
                message: issuePreview || 'Plan validation failed',
                timestamp: Date.now(),
              });
              setTurnStatus(turnId, 'awaiting_approval');
            }
            setExecutionPlan({
              plan,
              originalMessage: plannerInput,
              history: aiHistory,
              normalizedIntent,
            });
            setLastPlanExecutionError(null);
            setExecutionContext({
              hasPendingPlan: plan.planReady,
              lastUserMessageForPlan: plannerInput,
            });
            setIsTyping(false);
            return;
          }

          const clarifyRequired = plan.executionRecommendation === 'clarify_required';
          const isReadOnlyDraftPlan =
            !plan.planReady &&
            plan.operations.length > 0 &&
            plan.operations.every((operation) => operation.isReadOnly);

          if (clarifyRequired && !autoExecute) {
            const clarificationQuestion = buildClarificationQuestion({
              ambiguities: normalizedIntent.ambiguities,
              mode: normalizedIntent.mode,
              constraints: normalizedIntent.constraints,
            });
            if (clarificationQuestion) {
              assistantMessage(formatClarificationForChat(clarificationQuestion));
            } else {
              assistantMessage(
                `I need one clarification before running this safely. ${plan.executionRecommendationReason || plan.planReadyReason || ''}`.trim(),
              );
            }
            setExecutionPlan({
              plan,
              originalMessage: plannerInput,
              history: aiHistory,
              normalizedIntent,
            });
            if (turnId) {
              setTurnStatus(turnId, 'awaiting_approval');
            }
            setExecutionContext({
              hasPendingPlan: false,
              lastUserMessageForPlan: plannerInput,
            });
            setIsTyping(false);
            return;
          }

          if (autoExecute && isReadOnlyDraftPlan) {
            setExecutionPlan({
              plan,
              originalMessage: plannerInput,
              history: aiHistory,
              normalizedIntent,
            });
            if (turnId) {
              setTurnStatus(turnId, 'planning');
            }
            setLastPlanExecutionError(null);
            setExecutionContext({
              hasPendingPlan: false,
              lastUserMessageForPlan: plannerInput,
            });
            assistantMessage(
              `Generated an inspection-only draft plan. Rebuilding automatically from the current timeline before execution.`,
            );
            setIsTyping(false);
            return;
          }

          // Auto-execute any executable draft when auto mode is enabled.
          const canAutoExecutePlan =
            autoExecute && plan.operations.length > 0 && !hasHardValidationIssues;
          const canExecuteReadOnlyPlan = plan.planReady && !plan.requiresApproval;
          if (canAutoExecutePlan || canExecuteReadOnlyPlan) {
            if (turnId) {
              setTurnStatus(turnId, 'executing');
              appendTurnPart(turnId, {
                type: 'step_start',
                label: 'Executing plan',
                timestamp: Date.now(),
              });
            }
            const readOnlyNotice = !plan.requiresApproval ? ' (read-only plan)' : '';
            const readinessNotice = !plan.planReady ? ' (draft plan)' : '';
            assistantMessage(
              `Auto-executing ${plan.operations.length} operation${plan.operations.length > 1 ? 's' : ''}${readOnlyNotice}${readinessNotice}...`,
            );

            try {
              const { executePlan } = await import('../../lib/aiPlanningService');

              const finalResponse = await executePlan(
                plan,
                aiHistory,
                content,
                (current, total, operation) => {
                  setToolExecutionProgress({
                    current,
                    total,
                    message: operation.description,
                  });
                },
                (event) => {
                  recordToolLifecycleForTurn(turnId, event);
                },
                (audit) => {
                  if (!turnId) return;
                  addTurnAudit({
                    turnId,
                    mode: 'edit',
                    preSnapshotHash: audit.preSnapshotHash,
                    postSnapshotHash: audit.postSnapshotHash,
                    diffSummary: audit.diffSummary,
                    toolInputs: audit.toolInputs,
                    toolResults: audit.toolResults,
                    failures: audit.failures,
                    retries: getTurnRetryCount(turnId),
                  });
                },
              );

              setToolExecutionProgress(null);

              const msgs = useChatStore.getState().messages;
              useChatStore.setState({
                messages: msgs.slice(0, -1),
              });
              assistantMessage(finalResponse);
              if (turnId) {
                appendTurnPart(turnId, {
                  type: 'step_finish',
                  label: 'Plan execution',
                  success: true,
                  timestamp: Date.now(),
                });
                closeTurn(turnId, 'completed');
                turnClosed = true;
              }
            } catch (error) {
              console.error('Auto-execution error:', error);
              let errorMessage = 'Error during auto-execution:\n\n';
              if (error instanceof Error) {
                errorMessage += error.message;
              } else {
                errorMessage += 'Unknown error occurred';
              }
              assistantMessage(errorMessage, { error: true });
              if (turnId) {
                appendTurnPart(turnId, {
                  type: 'error',
                  message: errorMessage,
                  timestamp: Date.now(),
                });
                closeTurn(turnId, 'error');
                turnClosed = true;
              }
            } finally {
              setIsTyping(false);
              setToolExecutionProgress(null);
              clearExecutionContext();
            }
            return;
          }

          // Show for approval if auto-execute is disabled
          setExecutionPlan({
            plan,
            originalMessage: plannerInput,
            history: aiHistory,
            normalizedIntent,
          });
          if (turnId) {
            setTurnStatus(turnId, 'awaiting_approval');
            appendTurnPart(turnId, {
              type: 'step_finish',
              label: 'Plan generation',
              success: true,
              timestamp: Date.now(),
            });
          }
          setLastPlanExecutionError(null);
          setExecutionContext({
            hasPendingPlan: plan.planReady,
            lastUserMessageForPlan: plannerInput,
          });
          setIsTyping(false);
          return;
        }

        // Plan returned no executable operations — fail safe instead of fabricating edits
        const currentMessages = useChatStore.getState().messages;
        useChatStore.setState({
          messages: currentMessages.slice(0, -1),
        });
        addMessage(
          'assistant',
          "I couldn't generate executable edit operations from that. Please confirm exactly what to apply (clips/timestamps), and I'll execute it with tools.",
        );
        if (turnId) {
          appendTurnPart(turnId, {
            type: 'error',
            message: "Couldn't generate executable edit operations",
            timestamp: Date.now(),
          });
          closeTurn(turnId, 'error');
          turnClosed = true;
        }
        clearExecutionContext();
        setIsTyping(false);
        return;
      }

      // ── CHAT INTENT: Direct text response (no planning, no tools) ──
      let fullResponse = '';
      let isFirstChunk = true;
      let currentMessageId = '';
      messageCoalescer = createStreamCoalescer({
        flushIntervalMs: STREAM_FLUSH_INTERVAL_MS,
        maxBufferedChars: STREAM_MAX_BUFFERED_CHARS,
        onFlush: (text) => {
          fullResponse += text;
          if (isFirstChunk) {
            addMessage('assistant', fullResponse);
            const lastMessage =
              useChatStore.getState().messages[useChatStore.getState().messages.length - 1];
            currentMessageId = lastMessage.id;
            isFirstChunk = false;
          } else {
            updateLastMessage(fullResponse);
          }
        },
      });

      // For chat intent: skip tools + selective context = huge token savings
      const streamOptions: StreamOptions =
        intent === 'chat'
          ? {
              includeTools: false,
              contextFlags,
              mediaMode: shouldInlineMediaBytes(content, attachments)
                ? 'inline_bytes'
                : 'descriptor_only',
              signal: requestSignal,
            }
          : {
              includeTools: true,
              contextFlags,
              mediaMode: 'descriptor_only' as const,
              signal: requestSignal,
            };

      for await (const chunk of sendMessageWithHistoryStream(
        optimizedPrompt,
        aiHistory,
        attachments,
        streamOptions,
      )) {
        if (chunk.type === 'upload_progress' && chunk.uploadProgress) {
          setUploadStatus(`Uploading ${chunk.uploadProgress.fileName}...`);
        } else if (chunk.type === 'tool_plan') {
          const functionCalls = chunk.functionCalls || [];
          if (
            openClarificationPrompt({
              functionCalls,
              modelContent: chunk.modelContent,
              history: aiHistory,
              turnId,
            })
          ) {
            setUploadStatus(null);
            setIsTyping(false);
            return;
          }

          // Auto-execute read-only tools without approval prompt.
          if (functionCalls.length > 0 && functionCalls.every(isReadOnlyToolCall)) {
            const { ToolExecutor } = await import('../../lib/toolExecutor');

            const results = await ToolExecutor.executeWithPolicy(
              functionCalls,
              {
                mode: 'hybrid',
                maxReadOnlyBatchSize: 3,
                stopOnFailure: true,
              },
              undefined,
              {
                mode: 'ask',
                onLifecycle: (event) => {
                  recordToolLifecycleForTurn(turnId, event);
                },
              },
            );
            let followupText = '';
            let first = true;
            let currentMessageId = '';
            const followupCoalescer = createStreamCoalescer({
              flushIntervalMs: STREAM_FLUSH_INTERVAL_MS,
              maxBufferedChars: STREAM_MAX_BUFFERED_CHARS,
              onFlush: (text) => {
                followupText += text;
                if (first) {
                  addMessage('assistant', followupText);
                  const last =
                    useChatStore.getState().messages[useChatStore.getState().messages.length - 1];
                  currentMessageId = last.id;
                  first = false;
                } else {
                  updateLastMessage(followupText);
                }
              },
            });

            for await (const followupChunk of sendToolResultsToAI(
              aiHistory,
              chunk.modelContent,
              results,
              { signal: requestSignal },
            )) {
              if (followupChunk.type === 'text' && followupChunk.text) {
                followupCoalescer.push(followupChunk.text);
              } else if (
                followupChunk.type === 'metadata' &&
                followupChunk.tokens &&
                currentMessageId
              ) {
                followupCoalescer.flush();
                updateMessageTokens(currentMessageId, followupChunk.tokens);
              }
            }
            followupCoalescer.flush();
            if (currentMessageId) {
              tagAssistantMessageArtifact(currentMessageId, followupText);
            }

            if (turnId) {
              closeTurn(turnId, 'completed');
              turnClosed = true;
            }
            setIsTyping(false);
            return;
          }

          // Auto-execute all remaining tool plans when auto mode is enabled.
          if (functionCalls.length > 0 && autoExecute) {
            setUploadStatus(null);
            setPendingClarification(null);
            setPendingToolCalls({
              functionCalls,
              modelContent: chunk.modelContent,
              history: aiHistory,
            });
            if (turnId) {
              setTurnStatus(turnId, 'executing');
              functionCalls.forEach((call) => {
                appendTurnPart(turnId!, {
                  type: 'tool_call',
                  name: call.name,
                  args: call.args || {},
                  state: 'pending',
                  timestamp: Date.now(),
                });
              });
            }
            setIsTyping(false);
            return;
          }

          // Non-read-only calls require approval when auto mode is disabled.
          setUploadStatus(null);
          setPendingClarification(null);
          setPendingToolCalls({
            functionCalls,
            modelContent: chunk.modelContent,
            history: aiHistory,
          });
          if (turnId) {
            const safeTurnId = turnId;
            setTurnStatus(safeTurnId, 'awaiting_approval');
            functionCalls.forEach((call) => {
              appendTurnPart(safeTurnId, {
                type: 'tool_call',
                name: call.name,
                args: call.args || {},
                state: 'pending',
                timestamp: Date.now(),
              });
            });
          }
          setIsTyping(false);
          return;
        } else if (chunk.type === 'text' && chunk.text) {
          setUploadStatus(null);
          messageCoalescer.push(chunk.text);
        } else if (chunk.type === 'metadata' && chunk.tokens) {
          messageCoalescer.flush();
          if (currentMessageId) {
            updateMessageTokens(currentMessageId, chunk.tokens);
          }
        }
      }
      messageCoalescer.flush();
      if (currentMessageId) {
        tagAssistantMessageArtifact(currentMessageId, fullResponse);
      }
      if (turnId) {
        closeTurn(turnId, 'completed');
        turnClosed = true;
      }
    } catch (error) {
      messageCoalescer?.flush();
      if (error instanceof Error && error.message === 'Request cancelled') {
        if (turnId && !turnClosed) {
          closeTurn(turnId, 'interrupted');
          turnClosed = true;
        }
        return;
      }
      console.error('Error communicating with AI:', error);
      let errorMessage = 'Error: ';

      if (error instanceof Error) {
        if (error.message.includes('credentials') || error.message.includes('API key')) {
          errorMessage += 'Please configure your AWS credentials in the .env file.';
        } else if (error.message.includes('too large')) {
          errorMessage += 'The file is too large. Try a smaller file or compress it first.';
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += 'Failed to communicate with AI.';
      }

      assistantMessage(errorMessage, { error: true });
      if (turnId && !turnClosed) {
        appendTurnPart(turnId, {
          type: 'error',
          message: errorMessage,
          timestamp: Date.now(),
        });
        closeTurn(turnId, 'error');
        turnClosed = true;
      }
    } finally {
      if (turnId && !turnClosed) {
        closeTurn(turnId, 'interrupted');
      }
      if (activeAbortControllerRef.current === requestAbortController) {
        activeAbortControllerRef.current = null;
        setHasActiveAbortableRequest(false);
      }
      setIsTyping(false);
      setIsGeneratingPlan(false);
      setUploadStatus(null);
    }
  };

  // Keep the ref up-to-date with the latest processSendMessage closure on every render.
  processSendMessageRef.current = processSendMessage;

  const handleStopActiveRequest = () => {
    const activeController = activeAbortControllerRef.current;
    if (activeController && !activeController.signal.aborted) {
      activeController.abort();
    }
    // Force-reset the queue so it can accept new messages even if the
    // in-flight IPC/API call doesn't honour the abort signal.
    sendQueueRef.current.forceReset('Stopped by user');
    activeAbortControllerRef.current = null;
    setHasActiveAbortableRequest(false);
    setIsTyping(false);
    setIsGeneratingPlan(false);
    setUploadStatus(null);
  };

  const handleSendMessage = useCallback((content: string, attachments?: MediaAttachment[]) => {
    const label = content.trim().slice(0, 80) || '[attachment-only message]';
    void sendQueueRef.current.enqueue(() => processSendMessageRef.current(content, attachments), {
      label,
    });
    // sendQueueRef and processSendMessageRef are stable refs — no deps needed.
     
  }, []);

  const handleClearChat = () => {
    if (confirm('Clear all chat messages?')) {
      clearChat();
    }
  };

  const handleCompactContext = () => {
    const systemMessage = messages.find((message) => message.role === 'system');
    const nonSystemMessages = messages.filter((message) => message.role !== 'system');
    if (nonSystemMessages.length <= 8) {
      return;
    }

    const retainedMessages = nonSystemMessages.slice(-8);
    const compactedCount = nonSystemMessages.length - retainedMessages.length;
    const compactSummary = {
      id: `compact-${Date.now()}`,
      role: 'system' as const,
      content: `Context compacted manually. Archived ${compactedCount} older messages to reduce token usage.`,
      timestamp: Date.now(),
    };

    useChatStore.setState({
      messages: [...(systemMessage ? [systemMessage] : []), compactSummary, ...retainedMessages],
    });
  };

  const handleOpenBudgetControls = () => {
    setBudgetDraft(getBudgetPolicy());
    setShowBudgetControls((value) => !value);
  };

  const handleSaveBudgetPolicy = () => {
    const saved = updateBudgetPolicy(budgetDraft);
    setBudgetDraft(saved);
    setShowBudgetControls(false);
  };

  const handleCopyLogs = async () => {
    if (sessionLogs.length === 0) return;
    const payload = sessionLogs
      .map((entry) => {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const tokenInfo = entry.tokenTotal ? ` | tokens=${entry.tokenTotal}` : '';
        const errorInfo = entry.isError ? ' | error=true' : '';
        return `[${time}] ${entry.role}${tokenInfo}${errorInfo}\n${entry.content}`;
      })
      .join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // no-op
    }
  };

  const handleClearLogs = () => {
    setSessionLogs([]);
  };

  const handleResetTelemetry = async () => {
    resetTelemetry();
    setTelemetryRates(getTelemetryRates());
  };

  const handleCopyExecutionPlan = async () => {
    if (!executionPlan) return;

    const payload = {
      understanding: executionPlan.plan.understanding,
      executionPolicy: executionPlan.plan.executionPolicy,
      validation: executionPlan.plan.validation,
      planReady: executionPlan.plan.planReady,
      planReadyReason: executionPlan.plan.planReadyReason,
      riskNotes: executionPlan.plan.riskNotes,
      operations: executionPlan.plan.operations,
      steps: executionPlan.plan.steps,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // no-op
    }
  };

  const handleExecutePlan = async () => {
    if (!executionPlan) return;
    const validationIssues = executionPlan.plan.validation?.issues || [];
    const hasHardValidationIssues = validationIssues.some(
      (issue) => issue.category !== 'validation_warning',
    );
    const canForceExecute = executionPlan.plan.operations.length > 0 && !hasHardValidationIssues;

    if (!executionPlan.plan.planReady) {
      if (!canForceExecute) {
        addMessage(
          'assistant',
          `Execution blocked: ${executionPlan.plan.planReadyReason || 'plan is not ready yet. Please refine or rebuild.'}`,
          { error: true },
        );
        return;
      }

      addMessage(
        'assistant',
        `Plan is not fully ready (${executionPlan.plan.planReadyReason || 'validation warning'}). Proceeding automatically with best effort.`,
      );
    }
    if (executionPlan.plan.validation && hasHardValidationIssues) {
      addMessage(
        'assistant',
        'Execution blocked: plan has validation issues. Please update the request or regenerate the plan.',
        { error: true },
      );
      return;
    }

    if (activeTurnId) {
      setTurnStatus(activeTurnId, 'executing');
      appendTurnPart(activeTurnId, {
        type: 'step_start',
        label: 'Plan execution',
        timestamp: Date.now(),
      });
    }
    setIsExecutingTools(true);
    setIsTyping(true);
    setLastPlanExecutionError(null);
    let executionSucceeded = false;

    try {
      const { executePlan } = await import('../../lib/aiPlanningService');

      // Execute the complete plan
      const finalResponse = await executePlan(
        executionPlan.plan,
        executionPlan.history,
        executionPlan.originalMessage,
        (current, total, operation) => {
          setToolExecutionProgress({
            current,
            total,
            message: operation.description,
          });
        },
        (event) => {
          recordToolLifecycleForTurn(activeTurnId, event);
        },
        (audit) => {
          if (!activeTurnId) return;
          addTurnAudit({
            turnId: activeTurnId,
            mode: 'edit',
            preSnapshotHash: audit.preSnapshotHash,
            postSnapshotHash: audit.postSnapshotHash,
            diffSummary: audit.diffSummary,
            toolInputs: audit.toolInputs,
            toolResults: audit.toolResults,
            failures: audit.failures,
            retries: getTurnRetryCount(activeTurnId),
          });
        },
      );

      // Clear progress
      setToolExecutionProgress(null);

      // Add final response
      addMessage('assistant', finalResponse, {
        artifact: inferAssistantArtifactFromText(finalResponse) || undefined,
      });
      if (activeTurnId) {
        appendTurnPart(activeTurnId, {
          type: 'step_finish',
          label: 'Plan execution',
          success: true,
          timestamp: Date.now(),
        });
        closeTurn(activeTurnId, 'completed');
      }
      clearExecutionContext();
      executionSucceeded = true;
    } catch (error) {
      console.error('Plan execution error:', error);

      let errorMessage = 'Error executing plan:\n\n';
      if (error instanceof Error) {
        // If error contains multiple operation failures, format them nicely
        if (error.message.includes('Some operations failed:')) {
          errorMessage =
            'Some operations failed:\n\n' + error.message.replace('Some operations failed:\n', '');
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += 'Unknown error occurred';
      }

      addMessage('assistant', errorMessage, { error: true });
      if (activeTurnId) {
        appendTurnPart(activeTurnId, {
          type: 'error',
          message: errorMessage,
          timestamp: Date.now(),
        });
        closeTurn(activeTurnId, 'error');
      }
      setLastPlanExecutionError(errorMessage);
    } finally {
      setIsExecutingTools(false);
      setIsTyping(false);
      if (executionSucceeded) {
        setExecutionPlan(null);
        clearExecutionContext();
      }
    }
  };

  const handleRejectPlan = () => {
    addMessage('assistant', 'Execution plan rejected. How else can I help you?');
    setExecutionPlan(null);
    setLastPlanExecutionError(null);
    clearExecutionContext();
  };

  const handleRefinePlan = () => {
    if (!executionPlan) return;
    addMessage(
      'assistant',
      'Tell me exactly what to change in this plan, and I will regenerate a refined version.',
    );
  };

  const handleRebuildPlanFromCurrentTimeline = async (options?: { automatic?: boolean }) => {
    if (!executionPlan) return;
    setIsGeneratingPlan(true);
    setIsTyping(true);
    setLastPlanExecutionError(null);
    const rebuildingTurnId = activeTurnId;

    try {
      const { generateCompletePlan } = await import('../../lib/aiPlanningService');
      const rebuilt = await runWithTransientRetry(
        () =>
          generateCompletePlan(executionPlan.originalMessage, executionPlan.history, 3, {
            normalizedIntent: executionPlan.normalizedIntent,
          }),
        {
          turnId: rebuildingTurnId,
          onRetryStatus: (attempt, nextAt, reason) => {
            addMessage(
              'assistant',
              `Transient rebuild error (${reason}). Retrying attempt ${attempt} at ${new Date(nextAt).toLocaleTimeString()}.`,
            );
          },
          maxRetries: 2,
        },
      );
      setExecutionPlan({
        ...executionPlan,
        plan: rebuilt,
      });
      if (rebuildingTurnId) {
        setTurnStatus(rebuildingTurnId, options?.automatic ? 'planning' : 'awaiting_approval');
      }
      addMessage(
        'assistant',
        options?.automatic
          ? 'Rebuilt plan from current timeline state. Continuing automatically.'
          : 'Rebuilt plan from current timeline state. Please review and execute.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rebuild plan';
      addMessage('assistant', `Failed to rebuild plan: ${message}`, { error: true });
      setLastPlanExecutionError(`Failed to rebuild plan: ${message}`);
    } finally {
      setIsTyping(false);
      setIsGeneratingPlan(false);
    }
  };

  const handleClarificationAnswer = async (answer: string) => {
    if (!pendingClarification) return;
    const requestAbortController = new AbortController();
    const requestSignal = requestAbortController.signal;
    activeAbortControllerRef.current = requestAbortController;
    setHasActiveAbortableRequest(true);
    const clarification = pendingClarification;
    setPendingClarification(null);
    setIsTyping(true);
    let turnFailed = false;
    let messageCoalescer: ReturnType<typeof createStreamCoalescer> | null = null;

    if (clarification.turnId) {
      setTurnStatus(clarification.turnId, 'executing');
      appendTurnPart(clarification.turnId, {
        type: 'text',
        role: 'user',
        text: `Clarification: ${answer}`,
        timestamp: Date.now(),
      });
      appendTurnPart(clarification.turnId, {
        type: 'tool_result',
        name: 'ask_clarification',
        success: true,
        message: `User selected: ${answer}`,
        timestamp: Date.now(),
      });
    }

    try {
      const toolResults = [
        {
          name: 'ask_clarification',
          toolUseId: clarification.functionCall.id,
          result: {
            success: true,
            message: `User selected: ${answer}`,
            data: {
              answer,
            },
          },
        },
      ];

      let fullResponse = '';
      let isFirstChunk = true;
      let currentMessageId = '';
      messageCoalescer = createStreamCoalescer({
        flushIntervalMs: STREAM_FLUSH_INTERVAL_MS,
        maxBufferedChars: STREAM_MAX_BUFFERED_CHARS,
        onFlush: (text) => {
          fullResponse += text;
          if (isFirstChunk) {
            addMessage('assistant', fullResponse);
            const lastMessage =
              useChatStore.getState().messages[useChatStore.getState().messages.length - 1];
            currentMessageId = lastMessage.id;
            isFirstChunk = false;
          } else {
            updateLastMessage(fullResponse);
          }
        },
      });

      for await (const chunk of sendToolResultsToAI(
        clarification.history,
        clarification.modelContent,
        toolResults,
        { signal: requestSignal },
      )) {
        if (chunk.type === 'tool_plan') {
          const functionCalls = chunk.functionCalls || [];
          if (
            openClarificationPrompt({
              functionCalls,
              modelContent: chunk.modelContent,
              history: clarification.history,
              turnId: clarification.turnId,
            })
          ) {
            setIsTyping(false);
            return;
          }
          setPendingToolCalls({
            functionCalls,
            modelContent: chunk.modelContent,
            history: clarification.history,
          });
          if (clarification.turnId) {
            setTurnStatus(clarification.turnId, 'awaiting_approval');
            functionCalls.forEach((call) => {
              appendTurnPart(clarification.turnId!, {
                type: 'tool_call',
                name: call.name,
                args: call.args || {},
                state: 'pending',
                timestamp: Date.now(),
              });
            });
          }
          setIsTyping(false);
          return;
        }

        if (chunk.type === 'text' && chunk.text) {
          messageCoalescer.push(chunk.text);
        } else if (chunk.type === 'metadata' && chunk.tokens) {
          messageCoalescer.flush();
          if (currentMessageId) {
            updateMessageTokens(currentMessageId, chunk.tokens);
          }
        }
      }
      messageCoalescer.flush();
      if (currentMessageId) {
        tagAssistantMessageArtifact(currentMessageId, fullResponse);
      }

      if (clarification.turnId) {
        closeTurn(clarification.turnId, 'completed');
      }
    } catch (error) {
      messageCoalescer?.flush();
      if (error instanceof Error && error.message === 'Request cancelled') {
        if (clarification.turnId) {
          closeTurn(clarification.turnId, 'interrupted');
        }
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed after clarification';
      addMessage('assistant', `Error after clarification: ${message}`, { error: true });
      if (clarification.turnId) {
        appendTurnPart(clarification.turnId, {
          type: 'error',
          message,
          timestamp: Date.now(),
        });
        closeTurn(clarification.turnId, 'error');
      }
      turnFailed = true;
    } finally {
      if (activeAbortControllerRef.current === requestAbortController) {
        activeAbortControllerRef.current = null;
        setHasActiveAbortableRequest(false);
      }
      if (turnFailed) {
        setPendingToolCalls(null);
      }
      setIsTyping(false);
    }
  };

  const handleExecuteTools = async () => {
    if (!pendingToolCalls) return;
    const requestAbortController = new AbortController();
    const requestSignal = requestAbortController.signal;
    activeAbortControllerRef.current = requestAbortController;
    setHasActiveAbortableRequest(true);
    setPendingClarification(null);

    const beforeSnapshot = buildAIProjectSnapshot();
    if (activeTurnId) {
      setTurnStatus(activeTurnId, 'executing');
    }
    setIsExecutingTools(true);
    setIsTyping(true);
    let toolExecutionFailed = false;

    let messageCoalescer: ReturnType<typeof createStreamCoalescer> | null = null;
    try {
      // Import ToolExecutor
      const { ToolExecutor } = await import('../../lib/toolExecutor');

      // Execute all tools with progress
      const results = await ToolExecutor.executeWithPolicy(
        pendingToolCalls.functionCalls,
        {
          mode: 'hybrid',
          maxReadOnlyBatchSize: 3,
          stopOnFailure: true,
        },
        (current, total, result) => {
          setToolExecutionProgress({
            current,
            total,
            message: result.result.message,
          });
        },
        {
          mode: 'edit',
          onLifecycle: (event) => {
            recordToolLifecycleForTurn(activeTurnId, event);
          },
        },
      );

      // Clear progress
      setToolExecutionProgress(null);

      // Send results back to AI for final response
      let fullResponse = '';
      let isFirstChunk = true;
      let currentMessageId = '';
      messageCoalescer = createStreamCoalescer({
        flushIntervalMs: STREAM_FLUSH_INTERVAL_MS,
        maxBufferedChars: STREAM_MAX_BUFFERED_CHARS,
        onFlush: (text) => {
          fullResponse += text;
          if (isFirstChunk) {
            addMessage('assistant', fullResponse);
            const lastMessage =
              useChatStore.getState().messages[useChatStore.getState().messages.length - 1];
            currentMessageId = lastMessage.id;
            isFirstChunk = false;
          } else {
            updateLastMessage(fullResponse);
          }
        },
      });

      for await (const chunk of sendToolResultsToAI(
        pendingToolCalls.history,
        pendingToolCalls.modelContent,
        results,
        { signal: requestSignal },
      )) {
        if (chunk.type === 'text' && chunk.text) {
          messageCoalescer.push(chunk.text);
        } else if (chunk.type === 'metadata' && chunk.tokens) {
          messageCoalescer.flush();
          if (currentMessageId) {
            updateMessageTokens(currentMessageId, chunk.tokens);
          }
        }
      }
      messageCoalescer.flush();
      if (currentMessageId) {
        tagAssistantMessageArtifact(currentMessageId, fullResponse);
      }

      if (activeTurnId) {
        const afterSnapshot = buildAIProjectSnapshot();
        addTurnAudit({
          turnId: activeTurnId,
          mode: 'edit',
          preSnapshotHash: hashSnapshot(beforeSnapshot),
          postSnapshotHash: hashSnapshot(afterSnapshot),
          diffSummary: summarizeSnapshotDiff(beforeSnapshot, afterSnapshot),
          toolInputs: pendingToolCalls.functionCalls.map((call) => ({
            name: call.name,
            args: call.args || {},
          })),
          toolResults: results.map((result) => ({
            name: result.name,
            success: result.result.success,
            message: result.result.message,
            error: result.result.error,
          })),
          failures: results
            .filter((result) => !result.result.success)
            .map((result) => `${result.name}: ${result.result.error || 'unknown error'}`),
          retries: getTurnRetryCount(activeTurnId),
        });
      }
    } catch (error) {
      messageCoalescer?.flush();
      if (error instanceof Error && error.message === 'Request cancelled') {
        if (activeTurnId) {
          closeTurn(activeTurnId, 'interrupted');
        }
        return;
      }
      console.error('Tool execution error:', error);
      addMessage('assistant', 'Error executing operations: ' + (error as Error).message, {
        error: true,
      });
      if (activeTurnId) {
        appendTurnPart(activeTurnId, {
          type: 'error',
          message: String((error as Error).message || error),
          timestamp: Date.now(),
        });
        closeTurn(activeTurnId, 'error');
      }
      toolExecutionFailed = true;
    } finally {
      if (activeAbortControllerRef.current === requestAbortController) {
        activeAbortControllerRef.current = null;
        setHasActiveAbortableRequest(false);
      }
      setIsExecutingTools(false);
      setIsTyping(false);
      setPendingToolCalls(null);
      if (activeTurnId && !toolExecutionFailed) {
        closeTurn(activeTurnId, 'completed');
      }
    }
  };

  const handleAutoClarificationAnswer = useEffectEvent(() => {
    if (!pendingClarification) return;
    const autoAnswer = pendingClarification.options[0] || 'Proceed with best effort';
    void handleClarificationAnswer(autoAnswer);
  });

  const handleAutoExecuteTools = useEffectEvent(() => {
    void handleExecuteTools();
  });

  const handleAutoExecutePlan = useEffectEvent(() => {
    void handleExecutePlan();
  });

  const handleAutoRecoverDraftPlan = useEffectEvent(() => {
    void handleRebuildPlanFromCurrentTimeline({ automatic: true });
  });

  useEffect(() => {
    if (!autoExecute || !pendingClarification || isTyping) return;
    handleAutoClarificationAnswer();
  }, [autoExecute, pendingClarification, isTyping]);

  useEffect(() => {
    if (!autoExecute || !pendingToolCalls || isExecutingTools || isTyping) return;
    handleAutoExecuteTools();
  }, [autoExecute, pendingToolCalls, isExecutingTools, isTyping]);

  useEffect(() => {
    if (!autoExecute || !executionPlan || isGeneratingPlan || isExecutingTools || isTyping) return;
    if (pendingToolCalls || pendingClarification || lastPlanExecutionError) return;
    const validationIssues = executionPlan.plan.validation?.issues || [];
    const hasHardValidationIssues = validationIssues.some(
      (issue) => issue.category !== 'validation_warning',
    );
    const canForceExecute = executionPlan.plan.operations.length > 0 && !hasHardValidationIssues;
    if (!executionPlan.plan.planReady) {
      const isReadOnlyDraft =
        executionPlan.plan.operations.length > 0 &&
        executionPlan.plan.operations.every((operation) => operation.isReadOnly);
      if (isReadOnlyDraft) {
        const recoveryKey = getDraftPlanRecoveryKey(executionPlan);
        if (!autoRecoveredDraftPlanKeysRef.current.has(recoveryKey)) {
          autoRecoveredDraftPlanKeysRef.current.add(recoveryKey);
          handleAutoRecoverDraftPlan();
          return;
        }
      }
      if (!canForceExecute) return;
    }
    handleAutoExecutePlan();
  }, [
    autoExecute,
    executionPlan,
    isGeneratingPlan,
    isExecutingTools,
    isTyping,
    pendingToolCalls,
    pendingClarification,
    lastPlanExecutionError,
  ]);

  const selectedAudit = auditTurnId ? getTurnAudit(auditTurnId) : undefined;

  const getToolDescription = (call: { name: string; args: Record<string, unknown> }): string => {
    const state = useProjectStore.getState();
    const args = call.args as {
      clip_id?: string;
      time_in_clip?: number;
      clip_ids?: string[];
      volume?: number;
      start_time?: number;
      time?: number;
      question?: string;
    };

    switch (call.name) {
      case 'split_clip': {
        const clip = state.clips.find((c) => c.id === args.clip_id);
        return `Split "${clip?.name || 'clip'}" at ${args.time_in_clip}s`;
      }
      case 'set_clip_volume': {
        const clipIds = args.clip_ids || [];
        const clipCount = clipIds.includes('all') ? state.clips.length : clipIds.length;
        const volumePct = Math.round((args.volume ?? 0) * 100);
        return `Set volume to ${volumePct}% for ${clipCount} clip(s)`;
      }
      case 'delete_clips': {
        const clipNames = (args.clip_ids || [])
          .map((id: string) => state.clips.find((c) => c.id === id)?.name || id)
          .join(', ');
        return `Delete: ${clipNames}`;
      }
      case 'move_clip': {
        const clip = state.clips.find((c) => c.id === args.clip_id);
        return `Move "${clip?.name || 'clip'}" to ${args.start_time}s`;
      }
      case 'merge_clips': {
        const clipNames = (args.clip_ids || [])
          .map((id: string) => state.clips.find((c) => c.id === id)?.name || id)
          .join(', ');
        return `Merge: ${clipNames}`;
      }
      case 'toggle_clip_mute': {
        return `Toggle mute for ${(args.clip_ids || []).length} clip(s)`;
      }
      case 'select_clips': {
        const clipIds = args.clip_ids || [];
        const count = clipIds.includes('all') ? state.clips.length : clipIds.length;
        return `Select ${count} clip(s)`;
      }
      case 'copy_clips': {
        return `Copy ${(args.clip_ids || []).length} clip(s)`;
      }
      case 'paste_clips': {
        return `Paste clips from clipboard`;
      }
      case 'undo_action': {
        return `Undo last action`;
      }
      case 'redo_action': {
        return `Redo last action`;
      }
      case 'set_playhead_position': {
        return `Move playhead to ${args.time}s`;
      }
      case 'update_clip_bounds': {
        const clip = state.clips.find((c) => c.id === args.clip_id);
        return `Trim "${clip?.name || 'clip'}"`;
      }
      case 'get_clip_details': {
        const clip = state.clips.find((c) => c.id === args.clip_id);
        return `Get details for "${clip?.name || 'clip'}"`;
      }
      case 'get_timeline_info': {
        return `Get timeline information`;
      }
      case 'ask_clarification': {
        return `Ask clarification: ${args.question || 'Need more details'}`;
      }
      default:
        return `Execute ${call.name}`;
    }
  };

  // Toggle button when closed
  if (!isOpen) {
    return null; // Button now handled by layout
  }

  return (
    <div
      data-chat-panel="true"
      className="h-full flex flex-col overflow-hidden"
      style={{
        width: '100%',
      }}
    >
      {/* Header */}
      <div className="border-b border-white/5 px-3 py-2.5 flex items-start justify-between gap-2 bg-bg-elevated/50 backdrop-blur-sm animate-slide-up">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 bg-gradient-to-br from-accent/20 to-accent/10 rounded-md flex items-center justify-center animate-float">
            <svg
              className="w-3.5 h-3.5 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-[15px] leading-5 font-semibold text-text-primary">AI Copilot</h2>
            <p className="text-[11px] leading-4 text-text-muted/70">
              Intelligent Editing Assistant
            </p>
          </div>
          <div className="hidden 2xl:block">
            <TokenCounter />
          </div>
        </div>
        <div className="flex items-center gap-1 max-w-[62%] overflow-x-auto custom-scrollbar pb-1">
          <button
            onClick={() => setShowLogs((v) => !v)}
            className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-md transition-all duration-200 hover:scale-110 active:scale-95 ${showLogs ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
            title="Session logs"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 17h6M9 13h6M9 9h6M5 5h14v14H5z"
              />
            </svg>
          </button>
          <button
            onClick={() => setShowTelemetry((v) => !v)}
            className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-md transition-all duration-200 hover:scale-110 active:scale-95 ${showTelemetry ? 'text-cyan-300 bg-cyan-500/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
            title="AI reliability telemetry"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M7 12l3-3 2 2 5-5M5 19h14"
              />
            </svg>
          </button>
          <button
            onClick={handleCompactContext}
            className="w-7 h-7 shrink-0 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 rounded-md transition-all duration-200 hover:scale-110 active:scale-95"
            title="Compact context"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 8h16M4 12h12M4 16h8"
              />
            </svg>
          </button>
          <button
            onClick={handleOpenBudgetControls}
            className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-md transition-all duration-200 hover:scale-110 active:scale-95 ${showBudgetControls ? 'text-amber-300 bg-amber-500/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
            title="Cost budget settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-10V6m0 12v-2M5 12a7 7 0 1014 0 7 7 0 10-14 0z"
              />
            </svg>
          </button>
          <button
            onClick={handleClearChat}
            className="w-7 h-7 shrink-0 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 rounded-md transition-all duration-200 hover:scale-110 active:scale-95"
            title="Clear chat"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            onClick={togglePanel}
            className="w-7 h-7 shrink-0 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 rounded-md transition-all duration-200 hover:scale-110 active:scale-95"
            title="Close (Ctrl+K)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {showBudgetControls && (
        <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/5 animate-slide-up">
          <div className="text-xs text-amber-200 font-medium mb-2">Budget Policy</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <label className="flex flex-col gap-1 text-text-muted">
              Turn Soft ($)
              <input
                type="number"
                min={0}
                step={0.001}
                value={budgetDraft.perTurnSoftUsd}
                onChange={(event) =>
                  setBudgetDraft((prev) => ({
                    ...prev,
                    perTurnSoftUsd: Number(event.target.value),
                  }))
                }
                className="bg-black/20 border border-white/10 rounded px-2 py-1 text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-text-muted">
              Turn Hard ($)
              <input
                type="number"
                min={0}
                step={0.001}
                value={budgetDraft.perTurnHardUsd}
                onChange={(event) =>
                  setBudgetDraft((prev) => ({
                    ...prev,
                    perTurnHardUsd: Number(event.target.value),
                  }))
                }
                className="bg-black/20 border border-white/10 rounded px-2 py-1 text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-text-muted">
              Session Soft ($)
              <input
                type="number"
                min={0}
                step={0.01}
                value={budgetDraft.perSessionSoftUsd}
                onChange={(event) =>
                  setBudgetDraft((prev) => ({
                    ...prev,
                    perSessionSoftUsd: Number(event.target.value),
                  }))
                }
                className="bg-black/20 border border-white/10 rounded px-2 py-1 text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-text-muted">
              Session Hard ($)
              <input
                type="number"
                min={0}
                step={0.01}
                value={budgetDraft.perSessionHardUsd}
                onChange={(event) =>
                  setBudgetDraft((prev) => ({
                    ...prev,
                    perSessionHardUsd: Number(event.target.value),
                  }))
                }
                className="bg-black/20 border border-white/10 rounded px-2 py-1 text-text-primary"
              />
            </label>
          </div>
          <div className="flex items-center justify-between mt-2">
            <label className="text-[11px] text-text-muted flex items-center gap-2">
              On Soft Cap
              <select
                value={budgetDraft.onCap}
                onChange={(event) =>
                  setBudgetDraft((prev) => ({
                    ...prev,
                    onCap: event.target.value as BudgetPolicy['onCap'],
                  }))
                }
                className="bg-black/20 border border-white/10 rounded px-2 py-1 text-text-primary"
              >
                <option value="ask">ask</option>
                <option value="degrade">degrade</option>
                <option value="block">block</option>
              </select>
            </label>
            <button
              onClick={handleSaveBudgetPolicy}
              className="px-2 py-1 text-[11px] rounded bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 transition-colors"
            >
              Save Policy
            </button>
          </div>
        </div>
      )}

      {/* Multimodal capability banner */}
      <div className="px-4 py-1.5 bg-gradient-to-r from-emerald-500/5 via-purple-500/5 to-amber-500/5 border-b border-border-primary/50">
        <div className="flex items-center gap-2 text-[10px] text-text-muted/60">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60"></span>Images
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60"></span>Videos
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>Audio
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60"></span>PDFs
          </span>
        </div>
      </div>

      {/* Temporary session logs */}
      {showLogs && (
        <div className="border-b border-border-primary bg-bg-surface/40">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="text-xs text-text-secondary">
              Session Logs ({sessionLogs.length}) • Temporary (not persisted)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyLogs}
                className="text-[11px] px-2 py-1 rounded bg-bg-elevated border border-border-primary hover:bg-bg-surface text-text-secondary"
              >
                Copy All
              </button>
              <button
                onClick={handleClearLogs}
                className="text-[11px] px-2 py-1 rounded bg-bg-elevated border border-border-primary hover:bg-bg-surface text-text-secondary"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto px-4 pb-2 custom-scrollbar">
            {sessionLogs.length === 0 ? (
              <div className="text-[11px] text-text-muted py-2">
                No logs captured yet in this session.
              </div>
            ) : (
              sessionLogs
                .slice()
                .reverse()
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="text-[11px] py-1 border-t border-border-primary/40 first:border-t-0"
                  >
                    <div className="text-text-muted">
                      {new Date(entry.timestamp).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      • {entry.role}
                      {entry.tokenTotal ? ` • ${entry.tokenTotal}t` : ''}
                      {entry.isError ? ' • error' : ''}
                    </div>
                    <div className="text-text-secondary whitespace-pre-wrap break-words line-clamp-2">
                      {entry.content}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {showTelemetry && (
        <div className="border-b border-border-primary bg-cyan-500/5">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="text-xs text-cyan-200">AI Reliability Telemetry</div>
            <button
              onClick={handleResetTelemetry}
              className="text-[11px] px-2 py-1 rounded bg-bg-elevated border border-border-primary hover:bg-bg-surface text-text-secondary"
            >
              Reset
            </button>
          </div>
          <div className="px-4 pb-3 grid grid-cols-1 gap-1.5 text-[11px]">
            <div className="text-text-secondary">
              plan_compile_fail_rate:{' '}
              <span className="text-cyan-200">
                {formatRate(telemetryRates?.plan_compile_fail_rate)}
              </span>
            </div>
            <div className="text-text-secondary">
              fallback_rate:{' '}
              <span className="text-cyan-200">{formatRate(telemetryRates?.fallback_rate)}</span>
            </div>
            <div className="text-text-secondary">
              execution_validation_fail_rate:{' '}
              <span className="text-cyan-200">
                {formatRate(telemetryRates?.execution_validation_fail_rate)}
              </span>
            </div>
            <div className="text-text-secondary">
              turn_retry_rate:{' '}
              <span className="text-cyan-200">{formatRate(telemetryRates?.turn_retry_rate)}</span>
            </div>
            <div className="text-text-secondary">
              repeat_response_rate:{' '}
              <span className="text-cyan-200">
                {formatRate(telemetryRates?.repeat_response_rate)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Context Info */}
      {clips.length > 0 && (
        <div className="px-4 py-2 bg-bg-surface/30 border-b border-border-primary">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <svg
              className="w-3.5 h-3.5 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span>
              {clips.length} clip{clips.length !== 1 ? 's' : ''} in project
            </span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar bg-bg-primary"
      >
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {selectedAudit && (
          <div className="mb-4 border border-cyan-500/30 rounded-lg p-3 bg-cyan-500/5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-cyan-200 font-semibold">Turn Audit</div>
              <button
                onClick={() => setAuditTurnId(null)}
                className="text-xs px-2 py-1 border border-border-primary rounded hover:bg-bg-surface text-text-secondary"
              >
                Close
              </button>
            </div>
            <div className="text-xs text-text-secondary mb-1">Turn: {selectedAudit.turnId}</div>
            <div className="text-xs text-text-secondary mb-1">
              {`Snapshots: ${selectedAudit.preSnapshotHash} -> ${selectedAudit.postSnapshotHash}`}
            </div>
            <div className="text-xs text-text-secondary mb-2">Retries: {selectedAudit.retries}</div>
            <div className="text-xs text-cyan-200 mb-1">Diff Summary</div>
            <div className="text-xs text-text-muted space-y-1 mb-2">
              {selectedAudit.diffSummary.map((line) => (
                <div key={line}>• {line}</div>
              ))}
            </div>
            <div className="text-xs text-cyan-200 mb-1">Tools</div>
            <div className="text-xs text-text-muted space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
              {selectedAudit.toolInputs.map((input, index) => (
                <div
                  key={`${input.name}-${JSON.stringify(input.args || {})}`}
                  className="border border-border-primary rounded p-2 bg-bg-primary/60"
                >
                  <div>
                    • {input.name}:{' '}
                    {selectedAudit.toolResults[index]?.success
                      ? 'success'
                      : `failed (${selectedAudit.toolResults[index]?.error || 'unknown error'})`}
                  </div>
                  <div className="font-mono text-[10px] text-text-muted mt-1 overflow-x-auto">
                    {JSON.stringify(input.args || {}, null, 2)}
                  </div>
                </div>
              ))}
            </div>
            {selectedAudit.failures.length > 0 && (
              <div className="mt-2 text-xs text-red-300">
                Failures: {selectedAudit.failures.join(' | ')}
              </div>
            )}
          </div>
        )}

        {pendingClarification && (
          <div className="mb-4 border-2 border-amber-500 rounded-lg p-4 bg-bg-secondary shadow-lg">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-text-primary mb-1">Need Clarification</h3>
                <p className="text-text-secondary text-sm mb-2">{pendingClarification.question}</p>
                {pendingClarification.context && (
                  <div className="text-xs text-amber-300 mb-3">{pendingClarification.context}</div>
                )}
                <div className="flex flex-wrap gap-2 mb-3">
                  {pendingClarification.options.map((option) => (
                    <button
                      key={option}
                      onClick={() => handleClarificationAnswer(option)}
                      disabled={isTyping}
                      className="px-3 py-1.5 text-sm bg-amber-500/20 text-amber-200 rounded-lg hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPendingClarification(null)}
                  disabled={isTyping}
                  className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tool Approval UI */}
        {pendingToolCalls && (
          <div className="mb-4 border-2 border-accent-blue rounded-lg p-4 bg-bg-secondary shadow-lg">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-text-primary mb-2">AI Video Editing Plan</h3>
                <p className="text-text-secondary text-sm mb-3">
                  AI suggests the following operations:
                </p>

                <div className="space-y-2 mb-4 max-h-64 overflow-y-auto custom-scrollbar">
                  {pendingToolCalls.functionCalls.map((call, i) => (
                    <div
                      key={`${call.name}-${JSON.stringify(call.args)}`}
                      className="bg-bg-primary rounded p-3 border border-border-primary"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-accent-blue font-semibold text-sm">
                          {i + 1}. {call.name.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-text-muted font-mono bg-bg-surface rounded p-2 mb-2 overflow-x-auto">
                        {JSON.stringify(call.args, null, 2)}
                      </div>
                      <div className="text-sm text-text-secondary">{getToolDescription(call)}</div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleExecuteTools}
                    disabled={isExecutingTools}
                    className="px-3 py-1.5 text-sm bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
                  >
                    {isExecutingTools
                      ? 'Executing...'
                      : `Execute All (${pendingToolCalls.functionCalls.length})`}
                  </button>
                  <button
                    onClick={() => setPendingToolCalls(null)}
                    disabled={isExecutingTools}
                    className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Cancel
                  </button>
                </div>

                {toolExecutionProgress && (
                  <div className="mt-3">
                    <div className="text-sm text-text-secondary mb-1">
                      Progress: {toolExecutionProgress.current} / {toolExecutionProgress.total}
                    </div>
                    <div className="w-full bg-bg-primary rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-accent-blue h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${(toolExecutionProgress.current / toolExecutionProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {toolExecutionProgress.message}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Execution Plan UI - New queuing system */}
        {executionPlan && (
          <div className="mb-4 border-2 border-purple-500 rounded-lg p-4 bg-bg-secondary shadow-lg">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
                  Complete Execution Plan
                  <span className="text-xs font-normal text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded">
                    {executionPlan.plan.totalRounds} round
                    {executionPlan.plan.totalRounds > 1 ? 's' : ''}
                  </span>
                </h3>
                <p className="text-text-secondary text-sm mb-3">
                  AI has analyzed your request and planned {executionPlan.plan.operations.length}{' '}
                  operation{executionPlan.plan.operations.length > 1 ? 's' : ''} across multiple
                  steps:
                </p>

                {executionPlan.plan.understanding && (
                  <div className="mb-3 bg-bg-primary border border-purple-500/25 rounded-lg p-3">
                    <div className="text-xs text-purple-300 uppercase mb-1">Goal Understanding</div>
                    <div className="text-sm text-text-primary mb-2">
                      {executionPlan.plan.understanding.goal}
                    </div>
                    {Array.isArray(executionPlan.plan.understanding.constraints) &&
                      executionPlan.plan.understanding.constraints.length > 0 && (
                        <div className="space-y-1">
                          {executionPlan.plan.understanding.constraints.map(
                            (constraint: string) => (
                              <div key={constraint} className="text-xs text-text-muted">
                                • {constraint}
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    {executionPlan.plan.executionPolicy && (
                      <div className="mt-2 text-[11px] text-purple-300">
                        Execution policy: {executionPlan.plan.executionPolicy.mode} (read-only batch
                        up to {executionPlan.plan.executionPolicy.maxReadOnlyBatchSize})
                      </div>
                    )}
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                      <div className="bg-bg-surface border border-border-primary rounded p-2">
                        <div className="text-purple-300 font-medium mb-1">Why this plan</div>
                        <div className="text-text-muted">
                          Generated from current timeline and tool constraints with runtime-safe
                          preflight checks.
                        </div>
                      </div>
                      <div className="bg-bg-surface border border-border-primary rounded p-2">
                        <div className="text-purple-300 font-medium mb-1">What will change</div>
                        {Array.isArray(executionPlan.plan.changeSummary) &&
                        executionPlan.plan.changeSummary.length > 0 ? (
                          executionPlan.plan.changeSummary.map((line: string) => (
                            <div key={line} className="text-text-muted">
                              • {line}
                            </div>
                          ))
                        ) : (
                          <div className="text-text-muted">
                            No explicit change summary available.
                          </div>
                        )}
                      </div>
                      <div className="bg-bg-surface border border-border-primary rounded p-2">
                        <div className="text-purple-300 font-medium mb-1">Confidence</div>
                        <div className="text-text-muted">
                          {typeof executionPlan.plan.confidenceScore === 'number'
                            ? `${Math.round(executionPlan.plan.confidenceScore * 100)}%`
                            : 'n/a'}
                        </div>
                      </div>
                      <div className="bg-bg-surface border border-border-primary rounded p-2">
                        <div className="text-purple-300 font-medium mb-1">Rollback</div>
                        <div className="text-text-muted">
                          {executionPlan.plan.rollbackNote ||
                            'Undo is available immediately after execution.'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {executionPlan.plan.validation && (
                  <div
                    className={`mb-3 rounded-lg border p-3 ${
                      executionPlan.plan.validation.valid
                        ? 'bg-green-500/10 border-green-500/20'
                        : 'bg-orange-500/10 border-orange-500/30'
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold mb-1 ${
                        executionPlan.plan.validation.valid ? 'text-green-300' : 'text-orange-300'
                      }`}
                    >
                      {executionPlan.plan.validation.valid
                        ? 'Validation Passed'
                        : 'Validation Needs Attention'}
                    </div>
                    {Array.isArray(executionPlan.plan.validation.corrections) &&
                      executionPlan.plan.validation.corrections.length > 0 && (
                        <div className="mb-2">
                          <div className="text-[11px] text-text-secondary mb-1">
                            Auto-corrections
                          </div>
                          {executionPlan.plan.validation.corrections.map((correction: string) => (
                            <div key={correction} className="text-xs text-text-muted">
                              • {correction}
                            </div>
                          ))}
                        </div>
                      )}
                    {Array.isArray(executionPlan.plan.validation.issues) &&
                      executionPlan.plan.validation.issues.length > 0 && (
                        <div>
                          <div className="text-[11px] text-text-secondary mb-1">Issues</div>
                          {executionPlan.plan.validation.issues.slice(0, 4).map((issue) => (
                            <div
                              key={`${issue.category}-${issue.toolName}-${issue.message}`}
                              className="text-xs text-orange-200"
                            >
                              • [{issue.category}] {issue.toolName}: {issue.message}
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                <div className="space-y-3 mb-4 max-h-96 overflow-y-auto custom-scrollbar">
                  {Array.isArray(executionPlan.plan.steps) &&
                    executionPlan.plan.steps.length > 0 && (
                      <div className="bg-bg-primary rounded-lg p-3 border border-purple-500/30">
                        <div className="text-purple-400 font-semibold text-sm mb-2">
                          Planned Steps
                        </div>
                        <div className="space-y-2">
                          {executionPlan.plan.steps.slice(0, 8).map((step) => (
                            <div
                              key={step.order}
                              className="text-xs text-text-secondary border border-border-primary rounded p-2"
                            >
                              <div className="text-text-primary font-medium">
                                {step.order}. {step.description}
                              </div>
                              <div className="mt-1 text-text-muted">
                                Preconditions:{' '}
                                {Array.isArray(step.preconditions)
                                  ? step.preconditions.join('; ')
                                  : 'n/a'}
                              </div>
                              <div className="text-text-muted">Expected: {step.expectedResult}</div>
                            </div>
                          ))}
                          {executionPlan.plan.steps.length > 8 && (
                            <div className="text-xs text-text-muted">
                              +{executionPlan.plan.steps.length - 8} more step(s)
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Group operations by round */}
                  {Array.from(
                    new Set<number>(executionPlan.plan.operations.map((op) => op.round)),
                  ).map((round) => {
                    const roundOps = executionPlan.plan.operations.filter(
                      (op) => op.round === round,
                    );
                    return (
                      <div
                        key={round}
                        className="bg-bg-primary rounded-lg p-3 border border-purple-500/30"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-purple-400 font-semibold text-sm">
                            Round {round}
                          </span>
                          <span className="text-xs text-text-muted">
                            ({roundOps.length} operation{roundOps.length > 1 ? 's' : ''})
                          </span>
                        </div>

                        <div className="space-y-2">
                          {roundOps.map((op, i: number) => (
                            <div key={i} className="flex items-start gap-2 pl-2">
                              <span className="text-purple-300 text-sm mt-0.5">
                                {op.isReadOnly ? 'Read' : 'Edit'}
                              </span>
                              <div className="flex-1">
                                <div className="text-sm text-text-primary">{op.description}</div>
                                <div className="text-xs text-text-muted font-mono mt-1">
                                  {formatOperationName(op.functionCall.name)}
                                </div>
                              </div>
                              {!op.isReadOnly && (
                                <span className="text-xs bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded">
                                  Modifies
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  className={`mb-3 rounded-lg border p-3 ${
                    executionPlan.plan.planReady
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-amber-500/10 border-amber-500/30'
                  }`}
                >
                  <div
                    className={`text-xs font-semibold ${
                      executionPlan.plan.planReady ? 'text-emerald-200' : 'text-amber-200'
                    }`}
                  >
                    {executionPlan.plan.planReady ? 'Plan Ready' : 'Plan Not Ready'}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    {executionPlan.plan.planReadyReason}
                  </div>
                  {Array.isArray(executionPlan.plan.riskNotes) &&
                    executionPlan.plan.riskNotes.length > 0 && (
                      <div className="mt-2 text-xs text-text-muted">
                        Risks: {executionPlan.plan.riskNotes.join(' | ')}
                      </div>
                    )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleExecutePlan}
                    disabled={isExecutingTools}
                    className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center gap-2"
                  >
                    {isExecutingTools
                      ? 'Executing...'
                      : `Execute (${executionPlan.plan.operations.length})`}
                  </button>
                  <button
                    onClick={handleRefinePlan}
                    disabled={isExecutingTools}
                    className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Refine
                  </button>
                  <button
                    onClick={() => {
                      void handleRebuildPlanFromCurrentTimeline();
                    }}
                    disabled={isGeneratingPlan || isExecutingTools}
                    className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isGeneratingPlan ? 'Rebuilding...' : 'Rebuild'}
                  </button>
                  <button
                    onClick={handleCopyExecutionPlan}
                    disabled={isExecutingTools}
                    className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Copy Plan
                  </button>
                  <button
                    onClick={handleRejectPlan}
                    disabled={isExecutingTools}
                    className="px-3 py-1.5 text-sm border border-border-primary rounded-lg hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Reject
                  </button>
                </div>

                {lastPlanExecutionError && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <div className="text-xs text-red-200 whitespace-pre-wrap">
                      {lastPlanExecutionError}
                    </div>
                  </div>
                )}

                {toolExecutionProgress && (
                  <div className="mt-3">
                    <div className="text-sm text-text-secondary mb-1 flex items-center justify-between">
                      <span>Executing: {toolExecutionProgress.message}</span>
                      <span className="text-purple-400 font-mono">
                        {toolExecutionProgress.current} / {toolExecutionProgress.total}
                      </span>
                    </div>
                    <div className="w-full bg-bg-primary rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${(toolExecutionProgress.current / toolExecutionProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 text-xs text-text-muted bg-purple-500/10 rounded p-2">
                  <strong>Note:</strong> This plan was generated by analyzing all necessary steps.
                  Operations marked with Edit will modify your timeline.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload status */}
        {uploadStatus && (
          <div className="flex justify-start mb-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface border border-border-primary rounded-2xl rounded-tl-sm text-xs text-text-muted">
              <svg className="w-4 h-4 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>{uploadStatus}</span>
            </div>
          </div>
        )}

        {/* Plan generation status */}
        {isGeneratingPlan && !executionPlan && (
          <div className="flex justify-start mb-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-2xl rounded-tl-sm text-xs text-purple-300">
              <svg className="w-4 h-4 animate-spin text-purple-400" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Generating complete execution plan...</span>
            </div>
          </div>
        )}

        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {hasActiveAbortableRequest && (
        <div className="px-4 pb-2 flex justify-end">
          <button
            onClick={handleStopActiveRequest}
            className="px-3 py-1 text-xs rounded-md border border-rose-400/40 text-rose-300 hover:bg-rose-500/10 transition-colors"
          >
            Stop
          </button>
        </div>
      )}
      <ChatInput onSendMessage={handleSendMessage} disabled={false} />
    </div>
  );
};

export default ChatPanel;

function shouldInlineMediaBytes(input: string, attachments?: MediaAttachment[]): boolean {
  if (!attachments || attachments.length === 0) return false;
  return /\b(analyze|describe|what do you see|review this frame|visual analysis|inspect image|inspect video)\b/i.test(
    input,
  );
}

function isReadOnlyToolCall(call: { name: string }): boolean {
  const readOnlyTools = new Set([
    'get_timeline_info',
    'get_clip_details',
    'get_subtitles',
    'get_transcription',
    'get_project_info',
    'get_clip_analysis',
    'get_all_media_analysis',
    'search_clips_by_content',
    'ask_clarification',
    'generate_intro_script_from_timeline',
    'preview_caption_fit',
  ]);
  return readOnlyTools.has(call.name);
}

function isClarificationToolCall(call: { name: string }): boolean {
  return call.name === 'ask_clarification';
}

function formatOperationName(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRate(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0.0%';
  return `${(value * 100).toFixed(1)}%`;
}
