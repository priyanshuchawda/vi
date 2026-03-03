/**
 * ContextManager - Cost optimization for Bedrock Converse API
 *
 * Implements 4 strategies:
 * 1. Duplicate context detection & elimination (dedup overlays)
 * 2. Savings threshold gate (skip truncation if dedup saved ≥ 30%)
 * 3. Sliding-window truncation (preserves first turn, removes middle)
 * 4. Auto-summarize trigger (when window is too full even after truncation)
 *
 * Message format: Bedrock Converse API
 *   { role: 'user' | 'assistant', content: [{ text }, { image }, ...] }
 */

import type { AIChatMessage } from './aiService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap: never send more than this many messages */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * If dedup alone saves ≥ this fraction of total chars, skip truncation entirely.
 */
const DEDUP_SAVINGS_THRESHOLD = 0.3;

/** Summarize when raw history (before optimization) exceeds this count */
export const SUMMARIZE_THRESHOLD = 20;

// Context block sentinel patterns
const CONTEXT_PATTERNS: Array<{ regex: RegExp; placeholder: string }> = [
  {
    regex: /=== TIMELINE STATE ===[\s\S]*?===========================/g,
    placeholder: '(Timeline State Removed — see current message)',
  },
  {
    regex: /=== USER'S YOUTUBE CHANNEL CONTEXT ===[\s\S]*?===================================/g,
    placeholder: '(Channel Context Removed — see current message)',
  },
  {
    regex: /\[Memory Context[^\]]*\][\s\S]*?(?=\n\[|\n===|$)/g,
    placeholder: '(Memory Context Removed — see current message)',
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimizationMetrics {
  originalMessages: number;
  originalChars: number;
  afterDedupChars: number;
  afterTruncationMessages: number;
  dedupSavingsPercent: number;
  truncationApplied: boolean;
  summarizeNeeded: boolean;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Count total characters across all text content blocks in a history array.
 * Bedrock format: content: [{ text }, { image }, ...]
 */
function countChars(history: AIChatMessage[]): number {
  return history.reduce((total, msg) => {
    if (!msg.content || !Array.isArray(msg.content)) return total;
    return total + msg.content.reduce((sum, block) => sum + (block.text?.length ?? 0), 0);
  }, 0);
}

/**
 * Strip known large context blocks from a single message's text content blocks.
 * Returns a new message object (does not mutate).
 */
function stripContextBlocks(msg: AIChatMessage): AIChatMessage {
  if (!msg.content || !Array.isArray(msg.content)) return msg;

  const newContent = msg.content.map((block) => {
    if (!block.text) return block;
    let text = block.text;
    for (const { regex, placeholder } of CONTEXT_PATTERNS) {
      text = text.replace(regex, placeholder);
    }
    return { ...block, text };
  });
  return { ...msg, content: newContent };
}

// ─── Step 1: Duplicate context elimination ────────────────────────────────────

/**
 * Scans all user messages except the last one and strips large context blocks.
 * The LAST user message always keeps its context (it's the "current" state).
 */
export function eliminateDuplicateContexts(history: AIChatMessage[]): AIChatMessage[] {
  if (history.length === 0) return history;

  let lastUserIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  return history.map((msg, i) => {
    if (msg.role === 'user' && i !== lastUserIndex) {
      return stripContextBlocks(msg);
    }
    return msg;
  });
}

// ─── Step 2: 30% savings threshold ────────────────────────────────────────────

export function calculateDedupSavings(originalChars: number, afterDedupChars: number): number {
  if (originalChars === 0) return 0;
  return (originalChars - afterDedupChars) / originalChars;
}

// ─── Step 3: Sliding-window truncation ────────────────────────────────────────

/**
 * Remove messages from the MIDDLE of history while always keeping:
 *   - indices [0, 1]  →  first user message + first assistant reply (the task anchor)
 *   - the last `keepTail` messages  →  recent context
 */
export function slidingWindowTruncate(
  history: AIChatMessage[],
  keepTail: number = 10,
): AIChatMessage[] {
  if (history.length <= 2 + keepTail) return history;

  const head = history.slice(0, 2);
  const tail = history.slice(-keepTail);
  return [...head, ...tail];
}

// ─── Step 4: Auto-summarize detection ────────────────────────────────────────

export function shouldSummarize(rawHistory: AIChatMessage[]): boolean {
  return rawHistory.length >= SUMMARIZE_THRESHOLD;
}

/**
 * Build the summarization prompt that asks the AI to compress prior conversation.
 */
export function buildSummarizePrompt(history: AIChatMessage[]): string {
  const historyText = history
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text = (msg.content || []).map((b) => b.text ?? '').join(' ');
      return `${role}: ${text}`;
    })
    .join('\n\n');

  return `<summarize_task>
You are a conversation compressor. Compress the following conversation into a STRUCTURED SUMMARY.
Do NOT call any tools. Output only the summary.

OUTPUT STRUCTURE (use these exact headers):
## Primary Goal
(What the user ultimately wants to achieve)

## Completed Operations
(List of editing operations that have already been executed, with specifics)

## Current Timeline State
(Key facts about clips, durations, tracks from the most recent timeline context)

## Pending Tasks
(Any tasks mentioned by the user that have NOT yet been done)

## Key Technical Details
(Clip IDs, exact times, file names, or other data the assistant will need to continue)

## Conversation to Summarize:
${historyText}
</summarize_task>`;
}

/**
 * Collapse a full history into a single-pair pseudo-history:
 *   [ { role: 'user', content: [...] }, { role: 'assistant', content: [...] } ]
 */
export function buildCondensedHistory(summaryText: string): AIChatMessage[] {
  return [
    {
      role: 'user',
      content: [{ text: '[Conversation Summary — context compressed to save tokens]' }],
    },
    {
      role: 'assistant',
      content: [{ text: summaryText }],
    },
  ];
}

// ─── Master optimizer ─────────────────────────────────────────────────────────

/**
 * Full pipeline:
 *   1. Dedup context blocks in old messages
 *   2. Calculate savings %
 *   3. If savings < 30%  →  apply sliding-window truncation
 *   4. Hard-cap at MAX_HISTORY_MESSAGES
 *   5. Return result + metrics
 */
export function optimizeContextHistory(
  history: AIChatMessage[],
  cumulativePromptTokens?: number,
): { history: AIChatMessage[]; metrics: OptimizationMetrics } {
  const originalMessages = history.length;
  const originalChars = countChars(history);

  // Step 1 — deduplicate context blocks
  const deduped = eliminateDuplicateContexts(history);
  const afterDedupChars = countChars(deduped);

  // Step 2 — measure savings
  const dedupSavings = calculateDedupSavings(originalChars, afterDedupChars);
  const dedupSavedEnough = dedupSavings >= DEDUP_SAVINGS_THRESHOLD;

  // Step 3 — only truncate if dedup didn't save enough
  let truncated = deduped;
  let truncationApplied = false;

  if (!dedupSavedEnough && deduped.length > MAX_HISTORY_MESSAGES) {
    truncated = slidingWindowTruncate(deduped, 10);
    truncationApplied = true;
  } else if (deduped.length > MAX_HISTORY_MESSAGES) {
    truncated = slidingWindowTruncate(deduped, 16);
    truncationApplied = true;
  }

  // Step 4: summarize check — message count OR token budget exceeded
  // Nova Lite: 300K context — trigger at 80K to keep room for response + tools
  const summarizeNeeded =
    shouldSummarize(history) ||
    (cumulativePromptTokens !== undefined && cumulativePromptTokens > 80_000);

  const metrics: OptimizationMetrics = {
    originalMessages,
    originalChars,
    afterDedupChars,
    afterTruncationMessages: truncated.length,
    dedupSavingsPercent: Math.round(dedupSavings * 100),
    truncationApplied,
    summarizeNeeded,
  };

  return { history: truncated, metrics };
}
