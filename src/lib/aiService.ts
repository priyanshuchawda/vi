/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Chat Service — AWS Bedrock (Amazon Nova Lite v1)
 *
 * Core chat service for QuickCut. Uses the Converse API for:
 * - Text chat with streaming
 * - Tool calling (30+ video editing tools)
 * - Multimodal input (images, videos)
 * - Context optimization (dedup, truncation, summarization)
 *
 * Model: amazon.nova-lite-v1:0
 * Pricing: $0.06/1M input, $0.24/1M output
 */

import { converseBedrock, isBedrockConfigured } from './bedrockGateway';
import type { MediaAttachment } from '../types/chat';
import type { ContextFlags } from './intentClassifier';
import { useProjectStore } from '../stores/useProjectStore';
import { allVideoEditingTools } from './videoEditingTools';
import {
  optimizeContextHistory,
  buildSummarizePrompt,
  buildCondensedHistory,
  type OptimizationMetrics,
} from './contextManager';
import { waitForSlot } from './rateLimiter';
import { recordUsage, getSessionEstimatedCost, getSessionPromptTokens } from './tokenTracker';
import { estimateTurnCost, evaluateBudgetPolicy, trimHistoryToLimit } from './costPolicy';
import { buildSemanticCacheKey, getCached, hashString, setCached } from './requestCache';
import { estimateBedrockRequestTokens, evaluateTokenGuard } from './bedrockTokenEstimator';
import { maskToolOutputsInHistory } from './toolOutputMaskingService';
import { routeBedrockModel } from './modelRoutingPolicy';
import { recordAssistantResponse } from './aiTelemetry';
import {
  buildAIProjectSnapshot,
  formatSnapshotForPrompt,
  type SnapshotScope,
} from './aiProjectSnapshot';
import { useAiMemoryStore } from '../stores/useAiMemoryStore';
import { formatRetrievedMemoryContext, retrieveRelevantMemory } from './memoryRetrieval';
import { getSupportedToolNames } from './toolCapabilityMatrix';
import { truncateToolResultForModel } from './outputTruncation';

const INLINE_MEDIA_LIMIT_BYTES = 25 * 1024 * 1024;
const CHAT_MAX_TOKENS = 1024;
const TOOL_CHAT_MAX_TOKENS = 1536;
const HISTORY_TOOL_RESULT_MAX_TOKENS = 1024;
const MAX_DYNAMIC_CONTEXT_CHARS = 5000;
const CHAT_CACHE_TTL_MS = 2 * 60 * 1000;
const TOKEN_GUARD_SOFT_LIMIT = 160_000;
const TOKEN_GUARD_HARD_LIMIT = 220_000;
let summarizeFailureStreak = 0;

// ─── Message Types (Bedrock Converse API format) ──────────────────────────────

/** Chat history format for Bedrock Converse API */
export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: Array<Record<string, any>>;
}

type MediaEncodingMode = 'inline_bytes' | 'descriptor_only';

// ─── System Instruction ───────────────────────────────────────────────────────

/**
 * STATIC System Instruction
 * Sent as `system: [{ text }]` in every ConverseCommand.
 */
const STATIC_SYSTEM_INSTRUCTION_WITH_TOOLS = `<role>
You are a helpful AI assistant integrated into QuickCut, a professional video editing application.
You are precise, knowledgeable, and focused on helping users with their video editing projects.
</role>

<instructions>
1. Help users with video editing questions, provide tips, and assist with their projects
2. When users share media files (images, videos, audio, documents), analyze them thoroughly:
   - For images: Describe content, composition, colors, and suggest editing tips
   - For videos: Analyze content, pacing, and suggest improvements
   - For audio: Describe audio content, quality, and suggest enhancements
   - For documents/PDFs: Summarize content and extract relevant information
3. Your knowledge cutoff date is January 2025
4. When providing answers, be concise yet comprehensive
5. If asked about something outside your knowledge, clearly state the limitation
</instructions>

<constraints>
- Verbosity: Medium (balanced between concise and comprehensive)
- Tone: Friendly and professional
- Focus: Video editing workflow and creative assistance
- Never claim edits were completed unless tool results explicitly confirm success
- Never invent commands, APIs, or tool names; use only tools actually provided in toolConfig
- If user asks to execute but required details are missing, ask one concise clarification
- Keep hidden reasoning internal; surface only conclusions, decisions, and next actions
</constraints>

<video-editing-tools>
You have access to video editing tools that let you manipulate the timeline directly:

AVAILABLE TOOLS:
1. get_timeline_info: Get current state of timeline (clips, selections, duration)
2. ask_clarification: Ask a structured clarification question with answer options
3. split_clip: Split a clip into two parts at a specific time
4. delete_clips: Remove one or more clips from timeline
5. move_clip: Move a clip to a different position or track
6. merge_clips: Combine multiple clips into one
7. copy_clips + paste_clips: Duplicate clips
8. set_clip_volume: Adjust volume (0.0 to 1.0)
9. toggle_clip_mute: Mute or unmute clips
10. select_clips: Select specific clips for operations
11. undo_action / redo_action: Undo/redo editing history
12. set_playhead_position: Move the playhead
13. update_clip_bounds: Trim start/end of a clip
14. get_clip_details: Get detailed information about a clip

WHEN TO USE TOOLS:
- User asks to perform editing operations ("split this", "move clip", "adjust volume")
- User requests timeline modifications ("clean up gaps", "remove silence")
- User wants to preview or understand timeline state ("show my clips", "what's selected?")

HOW TO USE TOOLS:
1. Understand user's intent
2. Get timeline state first if needed (use get_timeline_info)
3. Plan operations step by step
4. Call appropriate tools with correct parameters
5. Explain what you're doing in plain language

IMPORTANT RULES:
- Always reference clips by their ID, not just by name (multiple clips can have same name)
- For time-based operations, clarify if time is relative to clip start or timeline position
- When multiple clips match a description, ask user to clarify or select all matches
- If any required detail is missing, call ask_clarification with concise options instead of guessing
- For MODIFY/DELETE style requests, apply minimal timeline delta edits instead of rebuilding full sequence
- Use this response structure for edit requests:
  1) What I understood
  2) Exact operations to run
  3) Confirmation gate only if mutating
  4) Post-execution timeline diff
- If an operation seems destructive (delete, overwrite), be extra clear about what will happen
</video-editing-tools>`;

const STATIC_SYSTEM_INSTRUCTION_NO_TOOLS = `<role>
You are a helpful AI assistant integrated into QuickCut, a professional video editing application.
You are precise, knowledgeable, and focused on helping users with planning and guidance.
</role>

<instructions>
1. Help users with video editing questions, creative planning, and script writing.
2. If user asks to execute timeline changes, ask them to confirm and then route to execution flow.
3. Provide concise, actionable answers.
</instructions>

<constraints>
- You DO NOT have tool access in this response.
- Do NOT output pseudo-commands, fake APIs, or code-like calls (e.g. add_audio(...), insert_clip(...)).
- Do NOT claim any timeline operation has been performed.
- If user asks to "do it", "execute", or "next step", ask for execution confirmation in plain language.
</constraints>`;

// ─── Context Helpers (unchanged — no API dependency) ──────────────────────────

/**
 * Get channel analysis context from localStorage if available
 */
export function getChannelAnalysisContext(): string {
  try {
    const onboardingData = localStorage.getItem('onboarding-storage');
    if (!onboardingData) return '';

    const parsed = JSON.parse(onboardingData);
    const analysisData = parsed?.state?.analysisData;

    if (!analysisData) return '';

    const { channel, analysis } = analysisData;

    return `\n\n=== USER'S YOUTUBE CHANNEL CONTEXT ===
Channel: ${channel.title}
Subscribers: ${channel.subscriber_count.toLocaleString()}
Videos: ${channel.video_count}

Channel Summary: ${analysis.channel_summary}

Content Strengths:
${analysis.content_strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Editing Style Recommendations:
${analysis.editing_style_recommendations.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Growth Opportunities:
${analysis.growth_suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Use this context to provide personalized advice tailored to their channel and content style.
===================================`;
  } catch (error) {
    console.error('Error loading channel analysis context:', error);
    return '';
  }
}

/**
 * Get timeline state context for AI to understand current project state
 */
export function getTimelineStateContext(): string {
  try {
    const state = useProjectStore.getState();

    if (state.clips.length === 0) {
      return '\n\n=== TIMELINE STATE ===\nTimeline is empty. No clips have been added yet.\n===========================\n';
    }

    const clipSummaries = state.clips
      .sort((a, b) => a.startTime - b.startTime)
      .map((clip, index) => {
        const selectedLabel = state.selectedClipIds.includes(clip.id) ? 'selected' : 'unselected';
        const mutedLabel = clip.muted ? 'Muted' : 'Unmuted';
        const volumePct = Math.round((clip.volume || 1) * 100);
        const trackLabel =
          (clip.trackIndex ?? 0) < 10
            ? `Video ${clip.trackIndex ?? 0}`
            : `Audio ${(clip.trackIndex ?? 10) - 10}`;

        return `${index + 1}. [${selectedLabel}] ${clip.name}
   ID: ${clip.id}
   Timeline: ${clip.startTime.toFixed(1)}s → ${(clip.startTime + clip.duration).toFixed(1)}s (duration: ${clip.duration.toFixed(1)}s)
   Source: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s of ${clip.sourceDuration.toFixed(1)}s total
   Track: ${trackLabel}
   Volume: ${volumePct}% (${mutedLabel})
   Type: ${clip.mediaType || 'video'}`;
      })
      .join('\n\n');

    const totalDuration = state.getTotalDuration();
    const selectedCount = state.selectedClipIds.length;

    return `\n\n=== TIMELINE STATE ===
Total Clips: ${state.clips.length}
Total Duration: ${totalDuration.toFixed(1)} seconds
Selected Clips: ${selectedCount}
Current Playhead: ${state.currentTime.toFixed(1)}s
Playing: ${state.isPlaying ? 'Yes' : 'No'}

CLIPS (in timeline order):
${clipSummaries}

EDITING HISTORY:
Can Undo: ${state.canUndo() ? 'Yes' : 'No'}
Can Redo: ${state.canRedo() ? 'Yes' : 'No'}
===========================\n`;
  } catch (error) {
    console.error('Error loading timeline state context:', error);
    return '';
  }
}

// ─── Media Helpers ────────────────────────────────────────────────────────────

/** Convert File to Uint8Array for Bedrock inline bytes */
async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/** Convert base64 string to Uint8Array */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Get Bedrock-compatible media format from MIME type */
function getMediaFormat(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  };
  return map[mimeType] || mimeType.split('/')[1] || 'jpeg';
}

/**
 * Build multimodal content blocks from media attachments
 * Bedrock format: { image: { format, source: { bytes } } } or { video: { ... } }
 */
async function buildMediaParts(
  attachments: MediaAttachment[],
  mode: MediaEncodingMode = 'inline_bytes',
): Promise<Array<Record<string, any>>> {
  const parts: Array<Record<string, any>> = [];
  if (mode === 'descriptor_only') {
    return parts;
  }

  for (const attachment of attachments) {
    const format = getMediaFormat(attachment.mimeType);

    if (attachment.mimeType.startsWith('image/')) {
      const bytes = attachment.base64Data
        ? base64ToUint8Array(attachment.base64Data)
        : await fileToUint8Array(attachment.file);
      parts.push({
        image: { format, source: { bytes } },
      });
    } else if (attachment.mimeType.startsWith('video/')) {
      const bytes = attachment.base64Data
        ? base64ToUint8Array(attachment.base64Data)
        : await fileToUint8Array(attachment.file);

      if (bytes.length > INLINE_MEDIA_LIMIT_BYTES) {
        throw new Error(
          `Attachment "${attachment.name}" is ${(bytes.length / 1024 / 1024).toFixed(1)}MB. Nova Lite inline media limit is 25MB.`,
        );
      }

      parts.push({
        video: { format, source: { bytes } },
      });
    }
    // Audio/documents: Nova Lite doesn't support audio inline — skip
    // (Audio is handled via Vosk local transcription)
  }

  return parts;
}

function buildMediaDescriptorText(attachments: MediaAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';
  const lines = attachments.map((attachment, index) => {
    const sizeMb = (attachment.size / (1024 * 1024)).toFixed(2);
    return `${index + 1}. ${attachment.type.toUpperCase()} | ${attachment.name} | ${attachment.mimeType} | ${sizeMb}MB`;
  });
  return `\n[Attached Media Descriptors]\n${lines.join('\n')}\n`;
}

// ─── Context Optimization ─────────────────────────────────────────────────────

/**
 * Run the full ContextManager pipeline on history.
 * Returns optimized history + metrics.
 */
async function runContextOptimization(
  history: AIChatMessage[],
): Promise<{ optimized: AIChatMessage[]; metrics: OptimizationMetrics }> {
  const { history: optimized, metrics } = optimizeContextHistory(history, getSessionPromptTokens());

  console.log(' ContextManager:', {
    messages: `${metrics.originalMessages} → ${metrics.afterTruncationMessages}`,
    dedupSaved: `${metrics.dedupSavingsPercent}%`,
    truncated: metrics.truncationApplied,
    summarizeNeeded: metrics.summarizeNeeded,
  });

  return { optimized, metrics };
}

/**
 * Summarize the conversation history into a condensed 2-message pair.
 * Call when metrics.summarizeNeeded is true.
 */
export async function summarizeHistory(history: AIChatMessage[]): Promise<AIChatMessage[]> {
  if (!isBedrockConfigured()) return history;
  if (summarizeFailureStreak >= 2) {
    return history;
  }

  try {
    console.log(' Auto-summarizing conversation history...');
    const prompt = buildSummarizePrompt(history);

    await waitForSlot();
    const summaryModel = routeBedrockModel({ intent: 'compression' }).modelId;
    const response = await converseBedrock({
      modelId: summaryModel,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      system: [
        {
          text: 'You are a conversation compressor. Output only the structured summary as instructed.',
        },
      ],
      inferenceConfig: { maxTokens: 2048, temperature: 0.3 },
    });

    const summaryText = response.output?.message?.content?.[0]?.text || '';
    if (!summaryText) {
      summarizeFailureStreak += 1;
      return history;
    }

    await waitForSlot();
    const verifyResponse = await converseBedrock({
      modelId: summaryModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              text:
                `Improve this conversation summary if it is missing concrete IDs, timestamps, failed attempts, or pending tasks. ` +
                `If complete, return it unchanged.\n\nSUMMARY:\n${summaryText}`,
            },
          ],
        },
      ],
      system: [
        {
          text: 'You are a summary verifier. Return only the final improved summary text.',
        },
      ],
      inferenceConfig: { maxTokens: 1536, temperature: 0.2 },
    });
    const verifiedSummary = verifyResponse.output?.message?.content?.[0]?.text || summaryText;
    const condensed = buildCondensedHistory(verifiedSummary);
    const originalEstimate = estimateBedrockRequestTokens({
      messages: history,
      maxOutputTokens: 1,
    }).estimatedInputTokens;
    const condensedEstimate = estimateBedrockRequestTokens({
      messages: condensed,
      maxOutputTokens: 1,
    }).estimatedInputTokens;

    if (condensedEstimate >= originalEstimate) {
      summarizeFailureStreak += 1;
      return history;
    }

    summarizeFailureStreak = 0;
    console.log(' Conversation condensed to verified summary.');
    return condensed;
  } catch (err) {
    summarizeFailureStreak += 1;
    console.error('Failed to summarize history, using original:', err);
    return history;
  }
}

export function __resetSummarizeFailureStateForTests(): void {
  summarizeFailureStreak = 0;
}

// ─── Build Dynamic Context ────────────────────────────────────────────────────

function buildDynamicContextWithOptions(
  flags?: ContextFlags,
  options?: DynamicContextBuildOptions,
): string {
  const currentDate = new Date().toISOString().split('T')[0];
  const maxChars = options?.maxChars ?? MAX_DYNAMIC_CONTEXT_CHARS;
  const userMessage = options?.userMessage || '';

  // Default: include all (backward compatibility for planning service)
  const includeAll = !flags;
  const channelContext = includeAll || flags?.includeChannel ? getChannelAnalysisContext() : '';
  const includeTimeline = includeAll || Boolean(flags?.includeTimeline);
  const includeMemory = includeAll || Boolean(flags?.includeMemory);
  const includeSnapshot = includeTimeline || includeMemory;

  let snapshotContext = '';
  if (includeSnapshot) {
    const scope: SnapshotScope =
      includeTimeline && includeMemory
        ? 'planning'
        : includeTimeline
          ? 'timeline_only'
          : 'media_only';
    snapshotContext = formatSnapshotForPrompt(
      buildAIProjectSnapshot(getSupportedToolNames()),
      scope,
      3200,
    );
  }
  const retrievedMemoryContext =
    includeMemory && userMessage
      ? formatRetrievedMemoryContext(
          retrieveRelevantMemory({
            query: userMessage,
            entries: useAiMemoryStore.getState().getCompletedEntries(),
            maxEntries: 5,
            maxScenesPerEntry: 2,
          }),
          userMessage,
          Math.min(1400, Math.floor(maxChars * 0.45)),
        )
      : '';

  let context = `\n[System Note: Current Date is ${currentDate}]`;
  if (channelContext) context += channelContext;
  if (snapshotContext) {
    context += `\n<ai-project-snapshot>\n${snapshotContext}\n</ai-project-snapshot>`;
  }
  if (retrievedMemoryContext) {
    context += `\n${retrievedMemoryContext}`;
  }

  // Only add grounding note if we have context
  if (channelContext || snapshotContext) {
    context += `\n<grounding>\nBase your answer on the above context for the user's project state.\n</grounding>`;
  }

  return context.length <= maxChars
    ? context
    : `${context.slice(0, maxChars)}\n[Context truncated for token efficiency]`;
}

// ─── StreamChunk Interface ────────────────────────────────────────────────────

export interface StreamChunk {
  type: 'text' | 'metadata' | 'upload_progress' | 'tool_plan';
  text?: string;
  tokens?: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
  };
  uploadProgress?: {
    fileName: string;
    progress: number;
  };
  functionCalls?: Array<{ name: string; args: any; id: string }>;
  modelContent?: any;
}

// ─── Non-Streaming Send ───────────────────────────────────────────────────────

/**
 * Sends a message with history (non-streaming, simple text response)
 */
export async function sendMessageWithHistory(
  message: string,
  history: AIChatMessage[] = [],
  attachments?: MediaAttachment[],
): Promise<string> {
  if (!isBedrockConfigured()) {
    throw new Error('Bedrock gateway not available. Ensure Electron preload API is active.');
  }

  try {
    // Run full context optimization pipeline
    const { optimized: initialOptimizedHistory, metrics: optimizationMetrics } =
      await runContextOptimization(history);
    let optimizedHistory = initialOptimizedHistory;
    if (optimizationMetrics.summarizeNeeded) {
      optimizedHistory = await summarizeHistory(optimizedHistory);
    }
    optimizedHistory = maskToolOutputsInHistory(optimizedHistory).history;
    let dynamicContext = buildDynamicContextWithOptions(undefined, {
      userMessage: message,
    });
    const preflight = estimateTurnCost({
      intent: 'chat',
      history: optimizedHistory,
      dynamicContextChars: dynamicContext.length,
      userMessageChars: message.length,
      toolCount: 0,
      maxOutputTokens: CHAT_MAX_TOKENS,
    });
    const budgetDecision = evaluateBudgetPolicy({
      estimatedTurnCostUsd: preflight.estimatedTotalCost,
      currentSessionCostUsd: getSessionEstimatedCost(),
      intent: 'chat',
    });
    if (budgetDecision.shouldBlock) {
      throw new Error(
        'Cost policy blocked this turn. Reduce request scope or adjust budget settings.',
      );
    }
    if (preflight.degraded || budgetDecision.shouldDegrade) {
      const maxHistoryMessages = budgetDecision.shouldDegrade
        ? Math.min(preflight.maxHistoryMessages, 6)
        : preflight.maxHistoryMessages;
      const maxDynamicContextChars = budgetDecision.shouldDegrade
        ? Math.min(preflight.maxDynamicContextChars, 1800)
        : preflight.maxDynamicContextChars;
      optimizedHistory = trimHistoryToLimit(optimizedHistory, maxHistoryMessages);
      dynamicContext = buildDynamicContextWithOptions(undefined, {
        maxChars: maxDynamicContextChars,
        userMessage: message,
      });
    }

    let fullMessage = `${dynamicContext}\n\nUser Query: ${message}`;
    const selectedModel = routeBedrockModel({
      intent: 'chat',
      message,
      hasAttachments: Boolean(attachments && attachments.length > 0),
      degraded: preflight.degraded || budgetDecision.shouldDegrade,
    }).modelId;
    const cacheKey = buildSemanticCacheKey({
      intent: 'chat',
      modelId: selectedModel,
      message,
      historyHash: historyFingerprint(optimizedHistory),
      snapshotHash: hashString(dynamicContext),
      mode: 'non_stream',
    });
    if (!attachments || attachments.length === 0) {
      const cached = getCached<CachedChatResponse>(cacheKey);
      if (cached) {
        return cached.text;
      }
    }

    // Build messages array (no chat session — flat array per Bedrock pattern)
    let messages: AIChatMessage[] = [
      ...optimizedHistory,
      {
        role: 'user' as const,
        content: [
          ...(attachments && attachments.length > 0 ? await buildMediaParts(attachments) : []),
          { text: fullMessage },
        ],
      },
    ];
    const getToolCount = () => 0;
    let tokenGuard = evaluateTokenGuard({
      messages,
      systemTexts: [STATIC_SYSTEM_INSTRUCTION_NO_TOOLS],
      toolCount: getToolCount(),
      maxOutputTokens: CHAT_MAX_TOKENS,
      softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
      hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
    });

    if (tokenGuard.status !== 'ok') {
      const reducedHistory = trimHistoryToLimit(optimizedHistory, 6);
      const reducedContext = buildDynamicContextWithOptions(undefined, {
        maxChars: 1600,
        userMessage: message,
      });
      fullMessage = `${reducedContext}\n\nUser Query: ${message}`;
      messages = [
        ...reducedHistory,
        {
          role: 'user' as const,
          content: [
            ...(attachments && attachments.length > 0 ? await buildMediaParts(attachments) : []),
            { text: fullMessage },
          ],
        },
      ];
      tokenGuard = evaluateTokenGuard({
        messages,
        systemTexts: [STATIC_SYSTEM_INSTRUCTION_NO_TOOLS],
        toolCount: getToolCount(),
        maxOutputTokens: CHAT_MAX_TOKENS,
        softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
        hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
      });
    }
    if (tokenGuard.status === 'block') {
      throw new Error(
        `Request exceeds token safety cap (${tokenGuard.estimatedInputTokens} > ${TOKEN_GUARD_HARD_LIMIT}). Reduce context or attachments.`,
      );
    }

    console.log(' Sending Message to Bedrock Nova Lite');
    console.log('   Stats:', {
      historyLength: optimizedHistory.length,
      contextSize: dynamicContext.length,
    });

    await waitForSlot();
    const response = await converseBedrock({
      modelId: selectedModel,
      messages: messages as any,
      system: [{ text: STATIC_SYSTEM_INSTRUCTION_NO_TOOLS }],
      inferenceConfig: { maxTokens: CHAT_MAX_TOKENS, temperature: 0.2 },
    });

    // Record token usage
    if (response.usage) {
      recordUsage({
        promptTokenCount: response.usage.inputTokens,
        candidatesTokenCount: response.usage.outputTokens,
        totalTokenCount: response.usage.totalTokens,
      });
    }

    const responseText = response.output?.message?.content?.[0]?.text || '';
    if ((!attachments || attachments.length === 0) && responseText) {
      setCached<CachedChatResponse>(cacheKey, { text: responseText }, CHAT_CACHE_TTL_MS);
    }

    return responseText;
  } catch (error) {
    console.error('Bedrock API error:', error);
    if (error instanceof Error) {
      throw new Error(`Bedrock API error: ${error.message}`);
    }
    throw new Error('Failed to communicate with Bedrock API');
  }
}

// ─── Streaming Send (with Tool Calling) ───────────────────────────────────────

/**
 * Options for controlling what gets sent to Bedrock.
 * Used by the intent router to minimize unnecessary tokens.
 */
export interface StreamOptions {
  /** Include tool declarations — only needed for editing intent */
  includeTools?: boolean;
  /** Which context to inject — selective injection saves tokens */
  contextFlags?: ContextFlags;
  /** Whether to send raw media bytes or compact descriptors */
  mediaMode?: MediaEncodingMode;
  /** Abort signal for cooperative cancellation */
  signal?: AbortSignal;
}

interface DynamicContextBuildOptions {
  maxChars?: number;
  userMessage?: string;
}

interface CachedChatResponse {
  text: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Request cancelled');
  }
}

function historyFingerprint(history: AIChatMessage[]): string {
  const compact = history
    .map((msg) => {
      const text = (msg.content || [])
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .join(' ')
        .slice(0, 240);
      return `${msg.role}:${text}`;
    })
    .join('|');
  return hashString(compact);
}

/**
 * Stream a message with conversation history.
 * Uses ConverseCommand (non-streaming for tool detection, same as original AI approach).
 * Yields StreamChunk events for the UI to consume.
 */
export async function* sendMessageWithHistoryStream(
  message: string,
  history: AIChatMessage[] = [],
  attachments?: MediaAttachment[],
  options?: StreamOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  const abortSignal = options?.signal;
  throwIfAborted(abortSignal);
  if (!isBedrockConfigured()) {
    throw new Error('Bedrock gateway not available. Ensure Electron preload API is active.');
  }

  const includeTools = options?.includeTools ?? true; // Default: include tools (backward compat)

  try {
    throwIfAborted(abortSignal);
    // Run full context optimization pipeline
    const { optimized: initialOptimizedHistory, metrics: optimizationMetrics } =
      await runContextOptimization(history);
    let optimizedHistory = initialOptimizedHistory;
    if (optimizationMetrics.summarizeNeeded) {
      optimizedHistory = await summarizeHistory(optimizedHistory);
    }
    optimizedHistory = maskToolOutputsInHistory(optimizedHistory).history;
    let dynamicContext = buildDynamicContextWithOptions(options?.contextFlags, {
      userMessage: message,
    });
    const standardTools = includeTools ? pickToolsForMessage(message) : [];
    const preflight = estimateTurnCost({
      intent: includeTools ? 'edit_plan' : 'chat',
      history: optimizedHistory,
      dynamicContextChars: dynamicContext.length,
      userMessageChars: message.length,
      toolCount: standardTools.length,
      maxOutputTokens: includeTools ? TOOL_CHAT_MAX_TOKENS : CHAT_MAX_TOKENS,
    });
    const budgetDecision = evaluateBudgetPolicy({
      estimatedTurnCostUsd: preflight.estimatedTotalCost,
      currentSessionCostUsd: getSessionEstimatedCost(),
      intent: includeTools ? 'edit_plan' : 'chat',
    });
    if (budgetDecision.shouldBlock) {
      throw new Error(
        'Cost policy blocked this turn. Reduce request scope or adjust budget settings.',
      );
    }
    if (preflight.degraded || budgetDecision.shouldDegrade) {
      const maxHistoryMessages = budgetDecision.shouldDegrade
        ? Math.min(preflight.maxHistoryMessages, 6)
        : preflight.maxHistoryMessages;
      const maxDynamicContextChars = budgetDecision.shouldDegrade
        ? Math.min(preflight.maxDynamicContextChars, 1800)
        : preflight.maxDynamicContextChars;
      optimizedHistory = trimHistoryToLimit(optimizedHistory, maxHistoryMessages);
      dynamicContext = buildDynamicContextWithOptions(options?.contextFlags, {
        maxChars: maxDynamicContextChars,
        userMessage: message,
      });
    }

    // Build multimodal parts if attachments exist
    const mediaMode = options?.mediaMode ?? 'inline_bytes';
    const mediaDescriptorText = buildMediaDescriptorText(attachments || []);
    const fullMessage = `${dynamicContext}${mediaDescriptorText}\n\nUser Query: ${message}`;

    // Yield upload progress for each file
    if (attachments && attachments.length > 0) {
      for (let i = 0; i < attachments.length; i++) {
        throwIfAborted(abortSignal);
        yield {
          type: 'upload_progress',
          uploadProgress: {
            fileName: attachments[i].name,
            progress: ((i + 1) / attachments.length) * 100,
          },
        };
      }
    }

    const mediaParts =
      attachments && attachments.length > 0 ? await buildMediaParts(attachments, mediaMode) : [];
    throwIfAborted(abortSignal);
    const cacheableChat = !includeTools && mediaParts.length === 0;
    const selectedModel = routeBedrockModel({
      intent: includeTools ? 'plan' : 'chat',
      message,
      hasAttachments: mediaParts.length > 0,
      degraded: preflight.degraded || budgetDecision.shouldDegrade,
    }).modelId;
    const streamCacheKey = cacheableChat
      ? buildSemanticCacheKey({
          intent: 'chat',
          modelId: selectedModel,
          message,
          historyHash: historyFingerprint(optimizedHistory),
          snapshotHash: hashString(dynamicContext),
          mode: 'stream',
        })
      : '';
    if (cacheableChat) {
      const cached = getCached<CachedChatResponse>(streamCacheKey);
      if (cached) {
        recordAssistantResponse(cached.text);
        yield { type: 'text', text: cached.text };
        return;
      }
    }

    // Build messages array
    let messages: AIChatMessage[] = [
      ...optimizedHistory,
      {
        role: 'user' as const,
        content: [...mediaParts, { text: fullMessage }],
      },
    ];
    let selectedTools = includeTools
      ? preflight.economyTools
        ? pickToolsForMessage(message, 'economy')
        : standardTools
      : [];
    const systemText = includeTools
      ? STATIC_SYSTEM_INSTRUCTION_WITH_TOOLS
      : STATIC_SYSTEM_INSTRUCTION_NO_TOOLS;
    let tokenGuard = evaluateTokenGuard({
      messages,
      systemTexts: [systemText],
      toolCount: selectedTools.length,
      maxOutputTokens: includeTools ? TOOL_CHAT_MAX_TOKENS : CHAT_MAX_TOKENS,
      softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
      hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
    });

    if (tokenGuard.status !== 'ok') {
      optimizedHistory = trimHistoryToLimit(optimizedHistory, 6);
      dynamicContext = buildDynamicContextWithOptions(options?.contextFlags, {
        maxChars: 1600,
        userMessage: message,
      });
      const reducedFullMessage = `${dynamicContext}\n\nUser Query: ${message}`;
      if (includeTools) {
        selectedTools = pickToolsForMessage(message, 'economy');
      }
      messages = [
        ...optimizedHistory,
        {
          role: 'user' as const,
          content: [...mediaParts, { text: reducedFullMessage }],
        },
      ];
      tokenGuard = evaluateTokenGuard({
        messages,
        systemTexts: [systemText],
        toolCount: selectedTools.length,
        maxOutputTokens: includeTools ? TOOL_CHAT_MAX_TOKENS : CHAT_MAX_TOKENS,
        softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
        hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
      });
    }
    if (tokenGuard.status === 'block') {
      throw new Error(
        `Request exceeds token safety cap (${tokenGuard.estimatedInputTokens} > ${TOKEN_GUARD_HARD_LIMIT}). Compact context or reduce attachments.`,
      );
    }

    // Wait for a rate-limit slot before making the API call
    await waitForSlot();
    throwIfAborted(abortSignal);

    // Build the command — conditionally include tools
    const commandInput: Record<string, unknown> = {
      modelId: selectedModel,
      messages: messages as any,
      system: [{ text: systemText }],
      inferenceConfig: {
        maxTokens: includeTools ? TOOL_CHAT_MAX_TOKENS : CHAT_MAX_TOKENS,
        temperature: 0.2,
      },
    };

    // Only include tool config when editing intent is detected
    // This saves ~1500 tokens per chat-only message
    if (includeTools) {
      commandInput.toolConfig = { tools: selectedTools as any };
    }

    const response = await converseBedrock(commandInput as any);
    throwIfAborted(abortSignal);

    // Check if response contains tool use requests
    if (response.stopReason === 'tool_use') {
      const toolUses = (response.output?.message?.content || [])
        .filter((c: any) => c.toolUse)
        .map((c: any) => ({
          name: c.toolUse.name,
          args: c.toolUse.input,
          id: c.toolUse.toolUseId,
        }));

      if (toolUses.length > 0) {
        yield {
          type: 'tool_plan',
          functionCalls: toolUses,
          modelContent: response.output?.message,
        };
        return; // Stop here — wait for user approval
      }
    }

    // No function calls — yield text response
    const textContent = (response.output?.message?.content || []).find((c: any) => c.text);
    if (textContent?.text) {
      recordAssistantResponse(textContent.text);
      if (cacheableChat) {
        setCached<CachedChatResponse>(
          streamCacheKey,
          { text: textContent.text },
          CHAT_CACHE_TTL_MS,
        );
      }
      yield { type: 'text', text: textContent.text };
    }

    // Yield token metadata and record usage
    if (response.usage) {
      recordUsage({
        promptTokenCount: response.usage.inputTokens,
        candidatesTokenCount: response.usage.outputTokens,
        totalTokenCount: response.usage.totalTokens,
      });

      yield {
        type: 'metadata',
        tokens: {
          promptTokens: response.usage.inputTokens || 0,
          responseTokens: response.usage.outputTokens || 0,
          totalTokens: response.usage.totalTokens || 0,
        },
      };
    }
  } catch (error) {
    console.error('Bedrock API error:', error);
    if (error instanceof Error) {
      throw new Error(`Bedrock API error: ${error.message}`);
    }
    throw new Error('Failed to communicate with Bedrock API');
  }
}

// ─── History Conversion ───────────────────────────────────────────────────────

/**
 * Convert our chat message format to Bedrock Converse format
 */
export function convertToAIHistory(
  messages: Array<{
    role: string;
    content: string;
    attachments?: MediaAttachment[];
  }>,
  options?: { mediaMode?: MediaEncodingMode },
): AIChatMessage[] {
  const mediaMode = options?.mediaMode ?? 'inline_bytes';
  return messages
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => {
      const content: Array<Record<string, any>> = [];

      // Add media parts from attachments (for user messages with media)
      if (msg.attachments && msg.attachments.length > 0 && mediaMode === 'inline_bytes') {
        for (const attachment of msg.attachments) {
          if (attachment.base64Data) {
            const bytes = base64ToUint8Array(attachment.base64Data);
            const format = getMediaFormat(attachment.mimeType);

            if (attachment.mimeType.startsWith('image/')) {
              content.push({ image: { format, source: { bytes } } });
            } else if (attachment.mimeType.startsWith('video/')) {
              content.push({ video: { format, source: { bytes } } });
            }
          }
        }
      }

      if (msg.attachments && msg.attachments.length > 0 && mediaMode === 'descriptor_only') {
        content.push({
          text: buildMediaDescriptorText(msg.attachments),
        });
      }

      // Add text part
      content.push({ text: msg.content });

      return {
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content,
      };
    });
}

// ─── Tool Results ─────────────────────────────────────────────────────────────

/**
 * Send tool execution results back to Bedrock and get final response.
 *
 * Called after user approves and tools are executed. Sends
 * results back so the AI can generate a user-friendly confirmation message.
 */
export async function* sendToolResultsToAI(
  originalHistory: AIChatMessage[],
  modelContent: any,
  toolResults: Array<{ name: string; result: any; toolUseId?: string }>,
  options?: { signal?: AbortSignal },
): AsyncGenerator<StreamChunk, void, unknown> {
  const abortSignal = options?.signal;
  throwIfAborted(abortSignal);
  if (!isBedrockConfigured()) {
    throw new Error('AWS credentials not configured.');
  }

  try {
    throwIfAborted(abortSignal);
    // Build conversation with tool responses
    const messages: AIChatMessage[] = [...originalHistory];

    // Add the assistant's message (contains toolUse blocks)
    if (modelContent) {
      messages.push({
        role: 'assistant',
        content: modelContent.content || [modelContent],
      });
    }

    // Add tool results as a single user message with toolResult blocks.
    // Per Bedrock Converse API: a message containing toolResult blocks must
    // contain ONLY toolResult blocks — mixing text blocks causes a
    // ValidationException. The reply instruction goes in the last toolResult.
    const followupInstruction =
      'Reply: 1) What changed, 2) Any failures, 3) Timeline diff if available, 4) Next best action.';
    const toolResultContent: Array<Record<string, any>> = toolResults.map((tr, idx) => {
      const isLastResult = idx === toolResults.length - 1;
      const truncatedResult = truncateToolResultForModel(tr.name, tr.result, {
        reserveChars: isLastResult ? followupInstruction.length + 48 : 0,
      });
      return {
        toolResult: {
          toolUseId: tr.toolUseId!, // must be the real toolUseId from the response
          content: [
            {
              json: {
                ...(truncatedResult.payload as Record<string, unknown>),
                // Attach the reply instruction only to the last tool result so
                // Bedrock sees it without mixing content block types.
                ...(isLastResult
                  ? {
                      _instruction: followupInstruction,
                    }
                  : {}),
              },
            },
          ],
        },
      };
    });

    messages.push({
      role: 'user',
      content: toolResultContent,
    });

    const guard = evaluateTokenGuard({
      messages,
      systemTexts: [STATIC_SYSTEM_INSTRUCTION_WITH_TOOLS],
      toolCount: allVideoEditingTools.length,
      maxOutputTokens: HISTORY_TOOL_RESULT_MAX_TOKENS,
      softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
      hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
    });
    if (guard.status === 'block') {
      throw new Error(
        `Tool follow-up exceeds token safety cap (${guard.estimatedInputTokens} > ${TOKEN_GUARD_HARD_LIMIT}). Please compact context and retry.`,
      );
    }

    // Wait for rate limit
    await waitForSlot();
    throwIfAborted(abortSignal);

    const response = await converseBedrock({
      modelId: routeBedrockModel({ intent: 'tool_followup' }).modelId,
      messages: messages as any,
      system: [{ text: STATIC_SYSTEM_INSTRUCTION_WITH_TOOLS }],
      // Required by Bedrock when conversation includes toolUse/toolResult blocks.
      toolConfig: { tools: allVideoEditingTools as any },
      inferenceConfig: {
        maxTokens: HISTORY_TOOL_RESULT_MAX_TOKENS,
        temperature: 0.2,
      },
    });
    throwIfAborted(abortSignal);

    // Yield text response
    const textContent = (response.output?.message?.content || []).find((c: any) => c.text);
    if (textContent?.text) {
      recordAssistantResponse(textContent.text);
      yield { type: 'text', text: textContent.text };
    }

    // Yield usage metadata and record
    if (response.usage) {
      recordUsage({
        promptTokenCount: response.usage.inputTokens,
        candidatesTokenCount: response.usage.outputTokens,
        totalTokenCount: response.usage.totalTokens,
      });

      yield {
        type: 'metadata',
        tokens: {
          promptTokens: response.usage.inputTokens || 0,
          responseTokens: response.usage.outputTokens || 0,
          totalTokens: response.usage.totalTokens || 0,
        },
      };
    }
  } catch (error) {
    console.error('Bedrock API error:', error);
    if (error instanceof Error) {
      throw new Error(`Bedrock API error: ${error.message}`);
    }
    throw new Error('Failed to communicate with Bedrock API');
  }
}

function pickToolsForMessage(message: string, mode: 'standard' | 'economy' = 'standard') {
  const text = message.toLowerCase();
  const selected = new Set<string>([
    'get_timeline_info',
    'ask_clarification',
    'get_clip_details',
    'split_clip',
    'delete_clips',
    'move_clip',
    'merge_clips',
    'update_clip_bounds',
    'select_clips',
    'undo_action',
    'redo_action',
  ]);

  if (/\b(volume|mute|audio|sound|quiet|loud)\b/.test(text)) {
    selected.add('set_clip_volume');
    selected.add('toggle_clip_mute');
  }
  if (/\b(copy|duplicate|paste)\b/.test(text)) {
    selected.add('copy_clips');
    selected.add('paste_clips');
  }
  if (/\b(subtitle|caption)\b/.test(text) && mode === 'standard') {
    selected.add('add_subtitle');
    selected.add('update_subtitle');
    selected.add('delete_subtitle');
    selected.add('update_subtitle_style');
    selected.add('get_subtitles');
    selected.add('clear_all_subtitles');
  }
  if (/\b(transcribe|transcription|transcript)\b/.test(text) && mode === 'standard') {
    selected.add('transcribe_clip');
    selected.add('transcribe_timeline');
    selected.add('get_transcription');
    selected.add('apply_transcript_edits');
  }
  if (/\b(effect|filter|speed|highlight|chapter)\b/.test(text) && mode === 'standard') {
    selected.add('set_clip_speed');
    selected.add('apply_clip_effect');
    selected.add('find_highlights');
    selected.add('generate_chapters');
  }
  if (/\b(save|export|project)\b/.test(text) && mode === 'standard') {
    selected.add('save_project');
    selected.add('set_export_settings');
    selected.add('get_project_info');
  }
  if (/\b(search|analy|memory|scene)\b/.test(text) && mode === 'standard') {
    selected.add('search_clips_by_content');
    selected.add('get_clip_analysis');
    selected.add('get_all_media_analysis');
  }

  return allVideoEditingTools.filter((tool: any) => selected.has(tool?.toolSpec?.name));
}
