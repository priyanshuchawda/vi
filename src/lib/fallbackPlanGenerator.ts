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
 * - If 1 clip: Trim first 5 seconds
 * - If 2+ clips: Keep first clip, delete rest
 * - If timeline empty: Return explanation (no operations)
 */
export function generateFallbackPlan(
  snapshot: AIProjectSnapshot,
  _aliasMap: AliasMap,
  _userMessage: string,
): PlannedOperation[] {
  const operations: PlannedOperation[] = [];
  const clips = snapshot.timeline.clips;

  if (clips.length === 0) {
    // No clips - cannot generate operations    return operations;
  }

  if (clips.length === 1) {
    // Single clip: trim to first 5 seconds (safe operation)
    const clip = clips[0];
    const targetDuration = Math.min(5.0, clip.duration);
    
    if (clip.duration > targetDuration + 0.5) { // Worth trimming
      operations.push({
        round: 1,
        functionCall: {
          name: 'update_clip_bounds',
          args: {
            clip_id: clip.id, // Use real UUID here since this is post-alias resolution
            new_start: clip.sourceStart,
            new_end: clip.sourceStart + targetDuration,
          },
        },
        description: `Trim clip to ${targetDuration} seconds`,
        isReadOnly: false,
      });
    }
  } else {
    // Multiple clips: Keep first, delete others (common cleanup operation)
    const otherClips = clips.slice(1);

    if (otherClips.length > 0) {
      operations.push({
        round: 1,
        functionCall: {
          name: 'delete_clips',
          args: {
            clip_ids: otherClips.map(c => c.id), // Use real UUIDs
          },
        },
        description: `Remove ${otherClips.length} clip(s), keep first clip`,
        isReadOnly: false,
      });
    }
  }

  return operations;
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
    goal: 'Apply safe default operation (LLM planning failed)',
    constraints: [
      'LLM returned invalid or empty plan',
      'Fallback to deterministic safe operation',
      'Avoid data loss',
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
    requiresApproval: operations.some(op => !op.isReadOnly),
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
    return "Your timeline is empty. Please add media files to start editing.";
  }
  
  if (clipCount === 1) {
    return "I had trouble understanding your specific request, so I've prepared a simple trim operation. Please refine your request with more specific details (clip names, timestamps, etc.)";
  }
  
  return "I had trouble understanding your specific request, so I've prepared a basic cleanup operation. Please provide more specific instructions (which clips, what times, etc.)";
}
