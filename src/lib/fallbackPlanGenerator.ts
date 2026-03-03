/**
 * Fallback Plan Generator
 *
 * Generates safe, deterministic plans when LLM fails to return valid operations.
 * Ensures the system never shows "empty plan" errors to users.
 */

import type { PlannedOperation, ExecutionPlan, PlanUnderstanding } from './aiPlanningService';
import type { AIProjectSnapshot } from './aiProjectSnapshot';
import type { AliasMap } from './clipAliasMapper';

/**
 * Generate a safe fallback plan based on project state
 *
 * Strategy:
 * - Never mutate timeline by default
 * - Use read-only inspection to recover context safely
 * - If timeline empty: no operations
 */
export function generateFallbackPlan(
  snapshot: AIProjectSnapshot,
  aliasMap: AliasMap,
  userMessage: string,
): PlannedOperation[] {
  const clipCount = snapshot.timeline.clipCount;
  const aliasCount = aliasMap.byAlias.size;
  const trimmedMessage = userMessage.trim();
  const summaryParts = [
    `Timeline clips: ${clipCount}`,
    `Resolvable aliases: ${aliasCount}`,
    trimmedMessage ? `User intent: "${trimmedMessage.slice(0, 120)}"` : null,
  ].filter(Boolean);

  return [
    {
      round: 1,
      functionCall: {
        name: 'get_timeline_info',
        args: {},
      },
      description: `Inspect timeline to rebuild a valid execution plan. ${summaryParts.join(' | ')}`,
      isReadOnly: true,
    },
  ];
}

/**
 * Create a complete fallback execution plan
 */
export function buildFallbackExecutionPlan(
  snapshot: AIProjectSnapshot,
  aliasMap: AliasMap,
  userMessage: string,
): ExecutionPlan {
  const operations = generateFallbackPlan(snapshot, aliasMap, userMessage);

  const understanding: PlanUnderstanding = {
    goal: 'Rebuild plan safely from current timeline state',
    constraints: [
      'LLM returned invalid or empty plan',
      'Fallback uses read-only inspection only',
      'No destructive edits in fallback mode',
    ],
  };

  return {
    understanding,
    operations,
    steps: operations.map((op, i) => ({
      order: i + 1,
      round: op.round,
      operationName: op.functionCall.name,
      description: op.description,
      preconditions: ['Timeline has clips'],
      expectedResult: op.description,
    })),
    validation: {
      valid: true,
      corrections: ['Using fallback plan due to LLM planning failure'],
      issues: [],
    },
    executionPolicy: {
      mode: 'strict_sequential',
      maxReadOnlyBatchSize: 1,
      stopOnFailure: true,
    },
    totalRounds: 1,
    estimatedDuration: operations.length * 0.5,
    requiresApproval: operations.some((op) => !op.isReadOnly),
    planReady: false,
    planReadyReason: 'Fallback inspection plan only. Rebuild or refine before execution.',
    riskNotes: ['Fallback mode active due to malformed or low-confidence planner output'],
  };
}

/**
 * Determine if a fallback plan is needed
 * Returns true if operations array is empty or all operations failed validation
 */
export function shouldUseFallback(operations: PlannedOperation[] | undefined): boolean {
  return !operations || operations.length === 0;
}

/**
 * Create an informative message for when fallback is used
 */
export function getFallbackExplanation(clipCount: number): string {
  if (clipCount === 0) {
    return 'Your timeline is empty. Please add media files to start editing.';
  }

  if (clipCount === 1) {
    return "I couldn't compile a safe edit plan. I prepared a read-only timeline inspection so we can rebuild an executable plan from current state.";
  }

  return "I couldn't compile a safe edit plan. I prepared a read-only timeline inspection so we can rebuild an executable plan from current state.";
}
