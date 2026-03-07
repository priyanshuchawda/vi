/**
 * Agent Router — Decides agentic vs single-pass execution mode
 *
 * Not every request needs the agentic loop. Simple, single-tool operations
 * use the existing fast path. Complex multi-step requests go through
 * the agentic loop.
 *
 * This keeps costs minimal — simple trims ($0.001) use single-pass,
 * complex highlight reels ($0.015) use the agentic loop.
 */

import type { NormalizedIntent } from './intentNormalizer';
import type { MessageIntent } from './intentClassifier';
import type { ExecutionModeDecision } from '../types/agentTypes';

// Keywords that suggest multi-step agentic reasoning
const AGENTIC_KEYWORDS = new Set([
  'highlight',
  'highlights',
  'reel',
  'montage',
  'compilation',
  'youtube short',
  'youtube shorts',
  'yt short',
  'yt shorts',
  'short form',
  'best moments',
  'best parts',
  'important parts',
  'short video',
  'analyze and',
  'check and',
  'review and',
  'step by step',
  'full edit',
  'complete edit',
  'transitions',
  'effects and',
  'captions and',
  'make it better',
  'improve',
  'optimize',
  'content aware',
  'smart trim',
  'make it best',
  'proper script',
  'for more views',
  'most views',
  'story arc',
  'hook',
  'proof',
  'cta',
  'text overlay',
  'on-screen text',
  'onscreen text',
  'watch till the end',
  'watch till end',
  'watch till last',
]);

// Keywords that suggest simple single-pass execution
const SINGLE_PASS_KEYWORDS = new Set([
  'trim',
  'cut',
  'split',
  'delete',
  'remove',
  'mute',
  'unmute',
  'volume',
  'speed',
  'undo',
  'redo',
  'save',
  'export',
  'move clip',
  'merge',
]);

/**
 * Decide whether to use the agentic loop or the existing single-pass flow.
 */
export function decideExecutionMode(input: {
  message: string;
  baseIntent: MessageIntent;
  normalizedIntent?: NormalizedIntent;
  clipCount: number;
  hasTimeline: boolean;
}): ExecutionModeDecision {
  const messageLower = input.message.toLowerCase();
  const normalizedGoals = input.normalizedIntent?.goals || [];
  const requestedOutputs = input.normalizedIntent?.requestedOutputs || [];
  const targetPlatform = input.normalizedIntent?.constraints?.platform;

  // If no timeline, always use single-pass (or chat)
  if (!input.hasTimeline || input.clipCount === 0) {
    return {
      mode: 'single_pass',
      reason: 'no_timeline_content',
      estimatedSteps: 1,
      estimatedCostUsd: 0.001,
    };
  }

  // If intent is not edit, use single-pass
  if (input.baseIntent !== 'edit') {
    return {
      mode: 'single_pass',
      reason: 'non_edit_intent',
      estimatedSteps: 1,
      estimatedCostUsd: 0.001,
    };
  }

  const retentionOverlayRequest =
    (/\b(text overlay|on-screen text|onscreen text|caption|subtitle)\b/i.test(messageLower) &&
      /\b(retention|hook)\b/i.test(messageLower)) ||
    (/\b(text overlay|on-screen text|onscreen text|caption|subtitle)\b/i.test(messageLower) &&
      /\bwatch\b[\s\S]{0,30}\btil+l?\b[\s\S]{0,10}\b(end|last)\b/i.test(messageLower));
  if (retentionOverlayRequest) {
    return {
      mode: 'agentic',
      reason: 'retention_overlay_request',
      estimatedSteps: Math.min(10, Math.max(4, input.clipCount + 2)),
      estimatedCostUsd: estimateCost(input.clipCount, 'highlight'),
    };
  }

  // Check for explicit agentic keywords
  for (const keyword of AGENTIC_KEYWORDS) {
    if (messageLower.includes(keyword)) {
      return {
        mode: 'agentic',
        reason: `agentic_keyword: ${keyword}`,
        estimatedSteps: estimateSteps(input.clipCount, keyword),
        estimatedCostUsd: estimateCost(input.clipCount, keyword),
      };
    }
  }

  // Check normalized intent for multi-goal scenarios
  const norm = input.normalizedIntent;
  if (norm) {
    // Multiple goals → agentic
    if (norm.goals && norm.goals.length > 1) {
      return {
        mode: 'agentic',
        reason: `multiple_goals: ${norm.goals.length}`,
        estimatedSteps: norm.goals.length * 2 + 2,
        estimatedCostUsd: estimateCost(input.clipCount, 'multi_goal'),
      };
    }

    // Target duration → usually needs content analysis + trimming
    if (norm.constraints?.target_duration) {
      return {
        mode: 'agentic',
        reason: 'target_duration_constraint',
        estimatedSteps: input.clipCount + 3,
        estimatedCostUsd: estimateCost(input.clipCount, 'target_duration'),
      };
    }

    const shortFormStoryRequest =
      (targetPlatform === 'youtube_shorts' || targetPlatform === 'instagram_reels') &&
      (normalizedGoals.includes('script_generation') ||
        normalizedGoals.includes('platform_optimized_output') ||
        requestedOutputs.includes('short_script_outline'));
    if (shortFormStoryRequest) {
      return {
        mode: 'agentic',
        reason: 'short_form_story_request',
        estimatedSteps: Math.min(15, Math.max(6, input.clipCount + 4)),
        estimatedCostUsd: estimateCost(input.clipCount, 'highlight'),
      };
    }

    // Highlight/vlog operation hint
    if (norm.operationHint === 'highlight' || norm.operationHint === 'vlog') {
      return {
        mode: 'agentic',
        reason: `operation_hint: ${norm.operationHint}`,
        estimatedSteps: input.clipCount + 4,
        estimatedCostUsd: estimateCost(input.clipCount, 'highlight'),
      };
    }

    // Low confidence + ambiguities → let agent figure it out
    if (norm.confidence < 0.6 && (norm.ambiguities?.length || 0) > 0) {
      return {
        mode: 'agentic',
        reason: 'low_confidence_ambiguous',
        estimatedSteps: 6,
        estimatedCostUsd: 0.008,
      };
    }
  }

  // Check for compound sentences (A and B, A then B)
  const hasCompound = /\b(and then|then|after that|also|plus|and also|followed by)\b/i.test(
    messageLower,
  );
  const hasMultipleVerbs =
    (
      messageLower.match(/\b(trim|cut|split|add|remove|adjust|change|make|set|move|apply)\b/gi) ||
      []
    ).length >= 2;

  if (hasCompound && hasMultipleVerbs) {
    return {
      mode: 'agentic',
      reason: 'compound_request',
      estimatedSteps: 5,
      estimatedCostUsd: 0.006,
    };
  }

  const executionHeavyShortForm =
    /\b(make|create|turn|edit|arrange|optimi[sz]e|polish)\b/i.test(messageLower) &&
    /\b(shorts|reel|tiktok|youtube short|yt short)\b/i.test(messageLower) &&
    /\b(script|caption|hook|story|views|viral|upload|30\s*(?:s|sec|second))\b/i.test(messageLower);
  if (executionHeavyShortForm) {
    return {
      mode: 'agentic',
      reason: 'execution_heavy_short_form',
      estimatedSteps: Math.min(15, Math.max(6, input.clipCount + 4)),
      estimatedCostUsd: estimateCost(input.clipCount, 'highlight'),
    };
  }

  // Default: use single-pass for everything else
  // Check for simple single-pass keywords
  for (const keyword of SINGLE_PASS_KEYWORDS) {
    if (messageLower.includes(keyword)) {
      return {
        mode: 'single_pass',
        reason: `simple_operation: ${keyword}`,
        estimatedSteps: 1,
        estimatedCostUsd: 0.001,
      };
    }
  }

  // Default for edit intents with clips
  return {
    mode: 'single_pass',
    reason: 'default_single_pass',
    estimatedSteps: 2,
    estimatedCostUsd: 0.002,
  };
}

function estimateSteps(clipCount: number, trigger: string): number {
  switch (trigger) {
    case 'highlight':
    case 'highlights':
    case 'reel':
    case 'montage':
    case 'best moments':
      // Analysis + trim per clip + verify + summary
      return Math.min(15, clipCount + 4);
    case 'target_duration':
      return Math.min(12, clipCount + 3);
    case 'multi_goal':
      return 6;
    case 'transitions':
    case 'effects and':
      return Math.min(10, clipCount * 2 + 2);
    default:
      return 5;
  }
}

function estimateCost(clipCount: number, trigger: string): number {
  const baseSteps = estimateSteps(clipCount, trigger);
  // Average ~500 input tokens + ~200 output tokens per step with Nova Lite
  const inputCostPerStep = 500 * (0.06 / 1_000_000);
  const outputCostPerStep = 200 * (0.24 / 1_000_000);
  const costPerStep = inputCostPerStep + outputCostPerStep;
  return Number((baseSteps * costPerStep).toFixed(6));
}

/**
 * Override mode based on user preference or explicit keywords.
 */
export function applyModeOverrides(
  decision: ExecutionModeDecision,
  userMessage: string,
): ExecutionModeDecision {
  const lower = userMessage.toLowerCase();

  // Force agentic
  if (
    lower.includes('agent mode') ||
    lower.includes('do everything') ||
    lower.includes('autonomous')
  ) {
    return { ...decision, mode: 'agentic', reason: 'user_forced_agentic' };
  }

  // Force single-pass
  if (lower.includes('just do') || lower.includes('quick') || lower.includes('simple')) {
    return { ...decision, mode: 'single_pass', reason: 'user_forced_single_pass' };
  }

  return decision;
}
