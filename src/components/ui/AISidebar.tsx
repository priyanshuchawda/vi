import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOnboardingStore } from '../../stores/useOnboardingStore';
import { useGeminiMemoryStore } from '../../stores/useGeminiMemoryStore';
import ChatMessage from '../Chat/ChatMessage';
import ChatInput from '../Chat/ChatInput';
import TypingIndicator from '../Chat/TypingIndicator';
import { TokenCounter } from '../Chat/TokenCounter';
import type { MediaAttachment } from '../../types/chat';
import clsx from 'clsx';

const AISidebar = () => {
  const { messages, isTyping, addMessage, updateLastMessage, updateMessageTokens, clearChat, setIsTyping, autoExecute, toggleAutoExecute } = useChatStore();
  const { clips } = useProjectStore();
  const { analysisData } = useOnboardingStore();
  const { entries } = useGeminiMemoryStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [showContextDetails, setShowContextDetails] = useState(false);

  // Planning state
  const [executionPlan, setExecutionPlan] = useState<{
    plan: any;
    originalMessage: string;
    history: any[];
  } | null>(null);
  const [isExecutingTools, setIsExecutingTools] = useState(false);
  const [toolExecutionProgress, setToolExecutionProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);

  // Get memory stats
  const completedMemoryEntries = entries.filter(e => e.status === 'completed');
  const hasMemory = completedMemoryEntries.length > 0;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, uploadStatus]);

  const handleSendMessage = async (content: string, attachments?: MediaAttachment[]) => {
    // Add user message with attachments
    addMessage('user', content, undefined, attachments);
    setIsTyping(true);
    setUploadStatus(null);

    try {
      // Import services
      const { convertToGeminiHistory } = await import('../../lib/geminiService');
      const { generateCompletePlan } = await import('../../lib/geminiPlanningService');

      // Convert chat history to Gemini format (exclude system messages)
      const geminiHistory = convertToGeminiHistory(
        messages.filter(m => m.role !== 'system')
      );

      // Check if this is an editing operation by generating a plan
      addMessage('assistant', '🤔 Analyzing your request and generating execution plan...');
      
      const plan = await generateCompletePlan(content, geminiHistory, 10);

      // If plan has operations, auto-execute or show for approval
      if (plan.operations.length > 0) {
        // Remove the "analyzing" message
        const currentMessages = useChatStore.getState().messages;
        useChatStore.setState({
          messages: currentMessages.slice(0, -1)
        });

        // Auto-execute if enabled
        if (autoExecute) {
          addMessage('assistant', `⚡ Auto-executing ${plan.operations.length} operation${plan.operations.length > 1 ? 's' : ''}...`);
          
          try {
            const { executePlan } = await import('../../lib/geminiPlanningService');
            
            const finalResponse = await executePlan(
              plan,
              geminiHistory,
              content,
              (current, total, operation) => {
                setToolExecutionProgress({
                  current,
                  total,
                  message: operation.description
                });
              }
            );
            
            setToolExecutionProgress(null);
            
            // Remove the "auto-executing" message and add final response
            const msgs = useChatStore.getState().messages;
            useChatStore.setState({
              messages: msgs.slice(0, -1)
            });
            addMessage('assistant', finalResponse);
          } catch (error) {
            console.error('Auto-execution error:', error);
            let errorMessage = '⚠️ Error during auto-execution:\n\n';
            if (error instanceof Error) {
              errorMessage += error.message;
            } else {
              errorMessage += 'Unknown error occurred';
            }
            addMessage('assistant', errorMessage, { error: true });
          } finally {
            setIsTyping(false);
            setToolExecutionProgress(null);
          }
          return;
        }

        // Show for approval if auto-execute is disabled
        setExecutionPlan({
          plan,
          originalMessage: content,
          history: geminiHistory,
        });
        setIsTyping(false);
        return;
      }

      // No operations needed - just get a text response
      const currentMessages = useChatStore.getState().messages;
      useChatStore.setState({
        messages: currentMessages.slice(0, -1)
      });

      const { sendMessageWithHistoryStream } = await import('../../lib/geminiService');
      
      let fullResponse = '';
      let isFirstChunk = true;
      let currentMessageId = '';

      for await (const chunk of sendMessageWithHistoryStream(content, geminiHistory, attachments)) {
        if (chunk.type === 'upload_progress' && chunk.uploadProgress) {
          setUploadStatus(`Uploading ${chunk.uploadProgress.fileName}...`);
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

    } catch (error) {
      console.error('Error communicating with Gemini:', error);
      let errorMessage = '⚠️ Error: ';

      if (error instanceof Error) {
        if (error.message.includes('API key')) {
          errorMessage += 'Please configure your Gemini API key in the .env file.';
        } else if (error.message.includes('too large')) {
          errorMessage += 'The file is too large. Try a smaller file or compress it first.';
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += 'Failed to communicate with Gemini AI.';
      }

      addMessage('assistant', errorMessage, { error: true });
    } finally {
      setIsTyping(false);
      setUploadStatus(null);
    }
  };

  const handleClearChat = () => {
    if (confirm('Clear all chat messages?')) {
      clearChat();
    }
  };

  const handleExecutePlan = async () => {
    if (!executionPlan) return;
    
    setIsExecutingTools(true);
    setIsTyping(true);
    
    try {
      const { executePlan } = await import('../../lib/geminiPlanningService');
      
      const finalResponse = await executePlan(
        executionPlan.plan,
        executionPlan.history,
        executionPlan.originalMessage,
        (current, total, operation) => {
          setToolExecutionProgress({
            current,
            total,
            message: operation.description
          });
        }
      );
      
      setToolExecutionProgress(null);
      addMessage('assistant', finalResponse);
      
    } catch (error) {
      console.error('Plan execution error:', error);
      
      let errorMessage = '⚠️ Error executing plan:\n\n';
      if (error instanceof Error) {
        errorMessage = error.message.includes('Some operations failed:') 
          ? '⚠️ Some operations failed:\n\n' + error.message.replace('Some operations failed:\n', '')
          : errorMessage + error.message;
      } else {
        errorMessage += 'Unknown error occurred';
      }
      
      addMessage('assistant', errorMessage, { error: true });
    } finally {
      setIsExecutingTools(false);
      setIsTyping(false);
      setExecutionPlan(null);
    }
  };

  const handleRejectPlan = () => {
    addMessage('assistant', '❌ Execution plan rejected. How else can I help you?');
    setExecutionPlan(null);
  };

  return (
    <div className="w-80 bg-bg-secondary border-l border-border-primary flex flex-col h-full">
      {/* Header - Low Contrast */}
      <div className="px-5 py-4 border-b border-border-subtle/60 bg-bg-elevated/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/12 flex items-center justify-center">
              <svg className="w-4.5 h-4.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-medium text-text-primary">AI Copilot</h2>
              <p className="text-[10px] text-text-muted">Gemini 2.5 Pro</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={toggleAutoExecute}
              className={clsx(
                'p-1.5 rounded-lg transition-all duration-200',
                autoExecute 
                  ? 'text-accent bg-accent/10' 
                  : 'text-text-muted/60 hover:text-text-muted hover:bg-bg-hover'
              )}
              title={autoExecute ? "Auto-execute ON" : "Auto-execute OFF"}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={handleClearChat}
              className="p-1.5 text-text-muted/60 hover:text-text-muted hover:bg-bg-hover rounded-lg transition-all duration-200"
              title="Clear chat"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <TokenCounter />
          </div>
        </div>

        {/* Context Summary - Minimal Card */}
        <button
          onClick={() => setShowContextDetails(!showContextDetails)}
          className="w-full px-3 py-2 bg-bg-elevated/30 rounded-lg hover:bg-bg-elevated/50 transition-all duration-200 text-left border border-border-subtle/40"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-text-secondary">Context</span>
            <svg 
              className={clsx("w-3 h-3 text-text-muted/60 transition-transform", showContextDetails && "rotate-180")}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-bg-surface/50 rounded">
              <svg className="w-3 h-3 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
              <span className="text-xs text-text-primary">{clips.length}</span>
            </div>
            {hasMemory && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-accent/8 rounded">
                <svg className="w-3 h-3 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-xs text-accent">{completedMemoryEntries.length}</span>
              </div>
            )}
            {analysisData && (
              <div className="w-1.5 h-1.5 rounded-full bg-accent/70" title="Channel data loaded" />
            )}
          </div>
        </button>

        {showContextDetails && (
          <div className="mt-2 px-3 py-2.5 bg-bg-surface/30 rounded-lg text-xs space-y-1.5 border border-border-subtle/30">
            <div className="text-text-secondary">
              <span className="text-text-primary">{clips.length}</span> clips
            </div>
            {hasMemory && (
              <div className="text-text-secondary">
                <span className="text-accent">{completedMemoryEntries.length}</span> memories
              </div>
            )}
            {analysisData && (
              <div className="text-text-secondary">
                <span className="text-text-primary">{analysisData.channel.title}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Messages - 70% Height Scrollable */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 space-y-3 bg-bg-primary/20">
        {messages.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-lg bg-accent/8 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-accent/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <p className="text-sm text-text-secondary mb-1">Ready to assist</p>
            <p className="text-xs text-text-muted/50">Ask anything about your edit</p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Execution Plan UI - Calm Design */}
        {executionPlan && (
          <div className="p-3.5 bg-bg-elevated/50 rounded-lg border border-border-subtle/50">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                <span className="text-sm">📋</span>
              </div>
              <div className="flex-1">
                <h4 className="text-xs font-medium text-text-primary">Plan</h4>
                <p className="text-[10px] text-text-muted">
                  {executionPlan.plan.operations.length} ops • {executionPlan.plan.totalRounds} rounds
                </p>
              </div>
            </div>
            
            <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto custom-scrollbar">
              {executionPlan.plan.operations.map((op: any, i: number) => (
                <div key={i} className="text-[11px] text-text-secondary flex items-start gap-2 p-2 bg-bg-surface/30 rounded-lg">
                  <span className="opacity-50 text-xs">{op.isReadOnly ? '📖' : '✏️'}</span>
                  <span className="flex-1 leading-relaxed">{op.description}</span>
                </div>
              ))}
            </div>
            
            <div className="flex gap-2.5">
              <button
                onClick={handleExecutePlan}
                disabled={isExecutingTools}
                className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-xs font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-accent"
              >
                {isExecutingTools ? 'Executing...' : 'Execute Plan'}
              </button>
              <button
                onClick={handleRejectPlan}
                disabled={isExecutingTools}
                className="px-4 py-2 border border-border-secondary rounded-lg text-xs font-medium text-text-secondary hover:bg-bg-surface hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
              >
                Cancel
              </button>
            </div>
            
            {toolExecutionProgress && (
              <div className="mt-3 pt-3 border-t border-border-subtle">
                <div className="w-full bg-bg-primary rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-accent h-1.5 transition-all duration-300 shadow-accent"
                    style={{ width: `${(toolExecutionProgress.current / toolExecutionProgress.total) * 100}%` }}
                  />
                </div>
                <div className="text-[10px] text-text-muted mt-2 font-normal">
                  {toolExecutionProgress.message} ({toolExecutionProgress.current}/{toolExecutionProgress.total})
                </div>
              </div>
            )}
          </div>
        )}

        {uploadStatus && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-bg-elevated/60 rounded-lg text-[11px] text-text-secondary border border-border-subtle shadow-soft">
            <svg className="w-3.5 h-3.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="font-normal">{uploadStatus}</span>
          </div>
        )}

        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <div className="border-t border-border-subtle/80">
        <ChatInput onSendMessage={handleSendMessage} disabled={isTyping} />
      </div>
    </div>
  );
};

export default AISidebar;
