import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOnboardingStore } from '../../stores/useOnboardingStore';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import TypingIndicator from './TypingIndicator';
import { TokenCounter } from './TokenCounter';
import type { ChatTurn, MediaAttachment } from '../../types/chat';
import { getBudgetPolicy, updateBudgetPolicy, type BudgetPolicy } from '../../lib/costPolicy';
import {
  convertToAIHistory,
  sendMessageWithHistoryStream,
} from '../../lib/aiService';
import {
  recordTurnRetry,
} from '../../lib/aiTelemetry';
import { classifyTransientError, getRetryDelayMs } from '../../lib/retryClassifier';

const ChatPanel = () => {
  const {
    isOpen,
    messages,
    isTyping,
    togglePanel,
    addMessage,
    updateLastMessage,
    updateMessageTokens,
    clearChat,
    setIsTyping,
    autoExecute,
    toggleAutoExecute,
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
  const { clips, currentTime, addTurnAudit, getTurnAudit } = useProjectStore();
  const { analysisData } = useOnboardingStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [showBudgetControls, setShowBudgetControls] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<BudgetPolicy>(() => getBudgetPolicy());
  const [auditTurnId, setAuditTurnId] = useState<string | null>(null);

  // Planning state
  const [executionPlan, setExecutionPlan] = useState<{
    plan: any;
    originalMessage: string;
    history: any[];
  } | null>(null);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [toolExecutionProgress, setToolExecutionProgress] = useState<{
    current: number;
    total: number;
    operation?: string;
  } | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, uploadStatus]);

  // Update context when clips or time changes
  useEffect(() => {
    // Context will be used when AI is integrated
  }, [clips, currentTime]);

  const recordToolLifecycleForTurn = (
    currentTurnId: string | null,
    event: {
      call: { name: string; args: Record<string, any> };
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
    }
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

  const getTurnRetryCount = (turnId: string): number => {
    const turn = turns.find((entry) => entry.id === turnId);
    if (!turn) return 0;
    return turn.parts.filter(
      (part) => part.type === 'status' && part.to === 'retry'
    ).length;
  };

  const handleSendMessage = async (content: string, attachments?: MediaAttachment[]) => {
    // Add user message with attachments
    const userMessageId = addMessage('user', content, undefined, attachments);
    setIsTyping(true);
    setUploadStatus(null);
    let turnId: string | null = null;
    let turnClosed = false;

    const assistantMessage = (text: string, metadata?: { error?: boolean }) => {
      const id = addMessage('assistant', text, metadata);
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

    try {
      const activeAwaitingTurn = activeTurnId
        ? turns.find((turn) => turn.id === activeTurnId && turn.status === 'awaiting_approval' && !turn.endedAt)
        : null;
      const hasReadyPendingPlan = Boolean(
        executionPlan &&
        executionPlan.plan.planReady &&
        executionContext.hasPendingPlan &&
        activeAwaitingTurn
      );

      if (isExecutionConfirmation(content) && executionPlan && executionContext.hasPendingPlan && !hasReadyPendingPlan) {
        assistantMessage(
          `Plan is not ready for execution yet. ${executionPlan.plan.planReadyReason || 'Please refine or rebuild the plan first.'}`
        );
        return;
      }

      if (hasReadyPendingPlan && isExecutionConfirmation(content)) {
        assistantMessage('Using your pending plan and executing it now.');
        await handleExecutePlan();
        return;
      }

      // Import intent classifier (zero-cost, local)
      const { classifyIntentWithContext, detectContextNeeds } = await import('../../lib/intentClassifier');
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant')?.content || '';
      const recentEditingContext = hasRecentEditingContext(messages);
      let intent = classifyIntentWithContext(content, {
        hasPendingPlan: hasReadyPendingPlan,
        hasRecentEditingContext: recentEditingContext,
      });
      if (
        (isExecutionConfirmation(content) && looksLikeEditPlan(lastAssistantMessage)) ||
        (isAmbiguousContinuation(content) && recentEditingContext)
      ) {
        intent = 'edit';
      }
      turnId = startTurn(userMessageId, intent === 'edit' ? 'plan' : 'ask');
      appendTurnPart(turnId, {
        type: 'text',
        role: 'user',
        text: content,
        timestamp: Date.now(),
      });
      const contextFlags = detectContextNeeds(content, intent);

      console.log(`Intent: ${intent} | Context: T=${contextFlags.includeTimeline} M=${contextFlags.includeMemory} C=${contextFlags.includeChannel}`);

      // Convert chat history to Bedrock format (exclude system messages)
      const aiHistory = convertToAIHistory(
        messages.filter(m => m.role !== 'system')
      );

      // ── EDIT INTENT: Use planning pipeline ──────────────────────────
      if (intent === 'edit') {
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

        assistantMessage('Analyzing your request and generating execution plan...');

        const plan = await runWithTransientRetry(
          () => generateCompletePlan(content, aiHistory, 3),
          {
            turnId,
            onRetryStatus: (attempt, nextAt, reason) => {
              assistantMessage(
                `Transient planner error (${reason}). Retrying attempt ${attempt} at ${new Date(nextAt).toLocaleTimeString()}.`
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
            messages: currentMessages.slice(0, -1)
          });

          const hasValidationIssues = plan.validation && plan.validation.valid === false;
          if (hasValidationIssues) {
            const issuePreview = (plan.validation.issues || [])
              .slice(0, 3)
              .map((issue: any) => `- ${issue.toolName}: ${issue.message}`)
              .join('\n');
            addMessage(
              'assistant',
              `Plan needs fixes before execution.\n\n${issuePreview || 'Validation failed.'}\n\nI kept the draft plan visible so you can review and adjust.`,
              { error: true }
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
              originalMessage: content,
              history: aiHistory,
            });
            setExecutionContext({
              hasPendingPlan: plan.planReady,
              lastUserMessageForPlan: content,
            });
            setIsTyping(false);
            return;
          }

          // Auto-execute if enabled OR no approval is required (read-only plans)
          if (plan.planReady && (autoExecute || !plan.requiresApproval)) {
            if (turnId) {
              setTurnStatus(turnId, 'executing');
              appendTurnPart(turnId, {
                type: 'step_start',
                label: 'Executing plan',
                timestamp: Date.now(),
              });
            }
            const readOnlyNotice = !plan.requiresApproval ? ' (read-only plan)' : '';
            assistantMessage(`Auto-executing ${plan.operations.length} operation${plan.operations.length > 1 ? 's' : ''}${readOnlyNotice}...`);

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
                    operation: operation.description || operation.functionCall?.name,
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
                messages: msgs.slice(0, -1)
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
              setToolExecutionProgress(null);
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
              clearExecutionContext();
            }
            return;
          }

          // Show for approval if auto-execute is disabled
          setExecutionContext({
            hasPendingPlan: plan.planReady,
            lastUserMessageForPlan: content,
          });
          setIsTyping(false);
          return;
        }

        // Plan returned no executable operations — fail safe instead of fabricating edits
        const currentMessages = useChatStore.getState().messages;
        useChatStore.setState({
          messages: currentMessages.slice(0, -1)
        });
        addMessage(
          'assistant',
          "I couldn't generate executable edit operations from that. Please confirm exactly what to apply (clips/timestamps), and I'll execute it with tools."
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

      // For chat intent: skip tools + selective context = huge token savings
      const streamOptions = intent === 'chat'
        ? { includeTools: false, contextFlags }
        : { includeTools: true, contextFlags };

      for await (const chunk of sendMessageWithHistoryStream(content, aiHistory, attachments, streamOptions)) {
        if (chunk.type === 'upload_progress' && chunk.uploadProgress) {
          setUploadStatus(`Uploading ${chunk.uploadProgress.fileName}...`);
        } else if (chunk.type === 'tool_plan') {
          // Auto-execute all tool calls immediately (no approval gate)
          setUploadStatus(null);
          if (turnId) {
            setTurnStatus(turnId, 'executing');
          }
          setIsTyping(false);
          return;
        } else if (chunk.type === 'text' && chunk.text) {
          setUploadStatus(null);
          fullResponse += chunk.text;

          if (isFirstChunk) {
            addMessage('assistant', fullResponse);
            const lastMessage = useChatStore.getState().messages[useChatStore.getState().messages.length - 1];
            currentMessageId = lastMessage.id;
            isFirstChunk = false;
          } else {
            updateLastMessage(fullResponse);
          }
        } else if (chunk.type === 'metadata' && chunk.tokens) {
          if (currentMessageId) {
            updateMessageTokens(currentMessageId, chunk.tokens);
          }
        }
      }
      if (turnId) {
        closeTurn(turnId, 'completed');
        turnClosed = true;
      }

    } catch (error) {
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
      setIsTyping(false);
      setIsGeneratingPlan(false);
      setUploadStatus(null);
    }
  };

  const handleClearChat = () => {
    if (confirm('Clear all chat messages?')) {
      clearChat();
    }
  };

  const handleSaveBudgetPolicy = () => {
    const saved = updateBudgetPolicy(budgetDraft);
    setBudgetDraft(saved);
    setShowBudgetControls(false);
  };

  const handleExecutePlan = async () => {
    if (!executionPlan) return;
    if (!executionPlan.plan.planReady) {
      addMessage(
        'assistant',
        `Execution blocked: ${executionPlan.plan.planReadyReason || 'plan is not ready yet.'}`,
        { error: true }
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
    setIsTyping(true);
    let executionSucceeded = false;

    try {
      const { executePlan } = await import('../../lib/aiPlanningService');

      const finalResponse = await executePlan(
        executionPlan.plan,
        executionPlan.history,
        executionPlan.originalMessage,
        undefined, // no progress callback needed
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

      addMessage('assistant', finalResponse);
      if (activeTurnId) {
        appendTurnPart(activeTurnId, { type: 'step_finish', label: 'Plan execution', success: true, timestamp: Date.now() });
        closeTurn(activeTurnId, 'completed');
      }
      clearExecutionContext();
      executionSucceeded = true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      addMessage('assistant', `Error executing plan: ${errorMessage}`, { error: true });
      if (activeTurnId) {
        appendTurnPart(activeTurnId, { type: 'error', message: errorMessage, timestamp: Date.now() });
        closeTurn(activeTurnId, 'error');
      }
    } finally {
      setIsTyping(false);
      if (executionSucceeded) {
        setExecutionPlan(null);
        clearExecutionContext();
      }
    }
  };

  const recentTurns: ChatTurn[] = turns.slice(-5).reverse();
  const selectedAudit = auditTurnId ? getTurnAudit(auditTurnId) : undefined;

  // Toggle button when closed
  if (!isOpen) {
    return null; // Button now handled by layout
  }

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{
        width: '100%',
      }}
    >
      {/* Header */}
      <div className="border-b border-white/5 p-3 flex items-center justify-between bg-bg-elevated/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-accent/20 to-accent/10 rounded-lg flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-text-primary">AI Copilot</h2>
          <TokenCounter />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleAutoExecute}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${autoExecute ? 'text-green-400 bg-green-500/10' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
            title={autoExecute ? "Auto-execute ON" : "Auto-execute OFF"}
          >
            {autoExecute ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={handleClearChat}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 rounded-lg transition-all"
            title="Clear chat"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            onClick={togglePanel}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/5 rounded-lg transition-all"
            title="Close"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
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

      {/* Auto-Execute Mode Banner */}
      {autoExecute && (
        <div className="px-4 py-2 bg-green-500/5 border-b border-green-500/10 animate-slide-up">
          <div className="flex items-center gap-2 text-xs text-green-400">
            <svg className="w-3.5 h-3.5 animate-pulse-glow" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            <span>Auto-execute enabled. Operations will run automatically without approval.</span>
          </div>
        </div>
      )}

      {/* Channel Analysis Context Banner */}
      {analysisData && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 animate-slide-up" style={{ animationDelay: '0.1s', animationFillMode: 'both' }}>
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
            </svg>
            <span>Channel insights loaded • AI has context about {analysisData.channel.title}</span>
          </div>
        </div>
      )}

      {/* Project info - clean and minimal */}
      {clips.length > 0 && (
        <div className="px-3 py-2 bg-bg-surface/30 border-b border-border-primary/30 flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {clips.length} clip{clips.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {recentTurns.length > 0 && (
        <div className="border-b border-border-primary bg-bg-surface/30">
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className="w-full px-4 py-1.5 flex items-center justify-between hover:bg-white/5 transition-colors"
          >
            <span className="text-xs text-text-secondary">Turn Timeline</span>
            <svg
              className={`w-3.5 h-3.5 text-text-muted transition-transform ${showTimeline ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showTimeline && (
            <div className="px-4 pb-2 space-y-1">
              {recentTurns.map((turn) => (
                <div
                  key={turn.id}
                  className={`text-[11px] rounded px-2 py-1 border ${turn.id === activeTurnId
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-border-primary bg-bg-primary/60'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-text-primary">
                      {turn.mode.toUpperCase()} · {formatTurnStatus(turn.status)}
                    </span>
                    <span className="text-text-muted">
                      {formatTurnElapsed(turn)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-text-muted truncate">
                      {getTurnLatestSummary(turn)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-text-muted">
                        {turn.parts.length} part{turn.parts.length !== 1 ? 's' : ''}
                      </span>
                      {getTurnAudit(turn.id) && (
                        <button
                          onClick={() => setAuditTurnId(turn.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-border-primary hover:bg-bg-surface text-text-secondary"
                        >
                          View audit
                        </button>
                      )}
                    </div>
                  </div>
                  {turn.status === 'retry' && turn.retryInfo && (
                    <div className="mt-1 text-[10px] text-amber-300">
                      Retry #{turn.retryInfo.attempt} in {formatRetryCountdown(turn.retryInfo.nextAt)} · {turn.retryInfo.message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
                <div key={`${input.name}-${JSON.stringify(input.args || {})}`} className="border border-border-primary rounded p-2 bg-bg-primary/60">
                  <div>• {input.name}: {selectedAudit.toolResults[index]?.success ? 'success' : `failed (${selectedAudit.toolResults[index]?.error || 'unknown error'})`}</div>
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







        {/* Upload status */}
        {uploadStatus && (
          <div className="flex justify-start mb-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-bg-surface border border-border-primary rounded-2xl rounded-tl-sm text-xs text-text-muted">
              <svg className="w-4 h-4 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Generating complete execution plan...</span>
            </div>
          </div>
        )}

        {isTyping && <TypingIndicator />}
        
        {toolExecutionProgress && (
          <div className="flex justify-start mb-4">
            <div className="px-4 py-3 bg-gradient-to-br from-bg-surface to-bg-elevated border border-border-primary rounded-2xl rounded-tl-sm shadow-lg">
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm text-text-secondary">
                  Executing tools: {toolExecutionProgress.current} / {toolExecutionProgress.total}
                  {toolExecutionProgress.operation && ` - ${toolExecutionProgress.operation}`}
                </span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput onSendMessage={handleSendMessage} disabled={isTyping} />
    </div>
  );
};

export default ChatPanel;

function isExecutionConfirmation(input: string): boolean {
  const text = input.toLowerCase().trim();
  return /\b(do it|go ahead|execute|apply (it|that)|proceed|make it|yes|ok|okay|sure|continue)\b/.test(text);
}

function looksLikeEditPlan(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('step-by-step') ||
    lower.includes('editing process') ||
    lower.includes('execution plan') ||
    lower.includes('timeline') ||
    lower.includes('split') ||
    lower.includes('clip')
  );
}

function isAmbiguousContinuation(input: string): boolean {
  const text = input.toLowerCase().trim();
  return (
    /\b(yes|ok|okay|sure|continue|next|step by step|move next)\b/.test(text) &&
    text.length <= 60
  );
}

function hasRecentEditingContext(
  messages: Array<{ role: string; content: string }>
): boolean {
  const recent = messages.slice(-8).map((m) => m.content.toLowerCase()).join(" ");
  return /\b(edit|timeline|clip|split|trim|merge|subtitle|caption|transcribe|youtube video|execution plan)\b/.test(recent);
}

function formatTurnStatus(status: ChatTurn['status']): string {
  return status.replace(/_/g, ' ');
}

function formatTurnElapsed(turn: ChatTurn): string {
  const end = turn.endedAt ?? Date.now();
  const ms = Math.max(0, end - turn.startedAt);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
}

function getTurnLatestSummary(turn: ChatTurn): string {
  const last = turn.parts[turn.parts.length - 1];
  if (!last) return 'No events yet';
  switch (last.type) {
    case 'text':
      return `${last.role}: ${last.text}`;
    case 'tool_call':
      return `Tool ${last.name} ${last.state}`;
    case 'tool_result':
      return `${last.name}: ${last.success ? 'success' : 'failed'}`;
    case 'step_start':
      return `Started: ${last.label}`;
    case 'step_finish':
      return `${last.success ? 'Finished' : 'Failed'}: ${last.label}`;
    case 'status':
      return `Status: ${formatTurnStatus(last.to)}`;
    case 'error':
      return `Error: ${last.message}`;
    default:
      return 'Updated';
  }
}

function formatRetryCountdown(nextAt: number): string {
  const remainingMs = Math.max(0, nextAt - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);
  return `${seconds}s`;
}
