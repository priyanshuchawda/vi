/**
 * Plan Compiler - Deterministic layer between LLM output and execution
 *
 * Converts high-level LLM intentions (with aliases) into validated executable operations (with UUIDs).
 * This layer ensures:
 * - Alias → UUID mapping
 * - Timestamp validation against clip durations
 * - Bounds normalization
 * - Invalid operation filtering with detailed errors
 */

import type { PlannedOperation } from './aiPlanningService';
import type { AliasMap } from './clipAliasMapper';
import { aliasArgsToUuid, validateAliasReferences } from './clipAliasMapper';
import type { AIProjectSnapshot } from './aiProjectSnapshot';
import type { NormalizedIntent } from './intentNormalizer';

export interface CompilationResult {
  operations: PlannedOperation[];
  errors: CompilationError[];
  warnings: string[];
}

export interface CompilePlanOptions {
  normalizedIntent?: NormalizedIntent;
  userMessage?: string;
}

export interface CompilationError {
  operationIndex: number;
  toolName: string;
  category: 'invalid_alias' | 'invalid_bounds' | 'invalid_args' | 'unknown_tool';
  message: string;
  suggestion?: string;
}

export interface PlannerOutputContract {
  understanding: {
    goal: string;
    constraints: string[];
  };
  operations: PlannedOperation[];
  riskNotes: string[];
  planReady: boolean;
}

/**
 * Compile LLM operations (with aliases) into executable operations (with UUIDs)
 */
export function compilePlan(
  rawOperations: PlannedOperation[],
  aliasMap: AliasMap,
  snapshot: AIProjectSnapshot,
  options?: CompilePlanOptions,
): CompilationResult {
  const compiled: PlannedOperation[] = [];
  const errors: CompilationError[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < rawOperations.length; i++) {
    const op = rawOperations[i];
    const result = compileOperation(op, aliasMap, snapshot, i);

    if (result.success && result.operation) {
      compiled.push(result.operation);
      if (result.warnings.length > 0) {
        warnings.push(...result.warnings);
      }
    } else {
      errors.push(...result.errors);
    }
  }

  const repaired = applyCompilerGuardrails(compiled, options);
  warnings.push(...repaired.warnings);

  return { operations: repaired.operations, errors, warnings };
}

/**
 * Compile a single operation
 */
function compileOperation(
  op: PlannedOperation,
  aliasMap: AliasMap,
  snapshot: AIProjectSnapshot,
  index: number,
): {
  success: boolean;
  operation?: PlannedOperation;
  errors: CompilationError[];
  warnings: string[];
} {
  const errors: CompilationError[] = [];
  const warnings: string[] = [];

  // Validate tool exists
  if (!isKnownTool(op.functionCall.name)) {
    errors.push({
      operationIndex: index,
      toolName: op.functionCall.name,
      category: 'unknown_tool',
      message: `Unknown tool: ${op.functionCall.name}`,
      suggestion: 'Use only tools from the provided toolConfig',
    });
    return { success: false, errors, warnings };
  }

  // Validate alias references
  const aliasErrors = validateAliasReferences(op.functionCall.name, op.functionCall.args, aliasMap);
  if (aliasErrors.length > 0) {
    errors.push({
      operationIndex: index,
      toolName: op.functionCall.name,
      category: 'invalid_alias',
      message: aliasErrors.join('; '),
      suggestion: 'Use only the clip aliases provided in the snapshot',
    });
    return { success: false, errors, warnings };
  }

  // Convert aliases to UUIDs
  const conversion = aliasArgsToUuid(op.functionCall.name, op.functionCall.args, aliasMap);
  if (!conversion.success) {
    errors.push({
      operationIndex: index,
      toolName: op.functionCall.name,
      category: 'invalid_alias',
      message: conversion.errors.join('; '),
      suggestion: 'Check that all clip references use valid aliases',
    });
    return { success: false, errors, warnings };
  }

  // Validate and normalize bounds for specific tools
  const boundsResult = validateAndNormalizeBounds(
    op.functionCall.name,
    conversion.args,
    aliasMap,
    snapshot,
  );

  if (!boundsResult.valid) {
    errors.push({
      operationIndex: index,
      toolName: op.functionCall.name,
      category: 'invalid_bounds',
      message: boundsResult.error || 'Invalid bounds',
      suggestion: boundsResult.suggestion,
    });
    return { success: false, errors, warnings };
  }

  if (boundsResult.warnings.length > 0) {
    warnings.push(...boundsResult.warnings.map((w) => `Op ${index + 1}: ${w}`));
  }

  // Create compiled operation
  const compiled: PlannedOperation = {
    ...op,
    functionCall: {
      ...op.functionCall,
      args: boundsResult.normalizedArgs,
    },
  };

  return { success: true, operation: compiled, errors, warnings };
}

/**
 * Validate and normalize timestamps/bounds for clip operations
 */
function validateAndNormalizeBounds(
  toolName: string,
  args: Record<string, unknown>,
  _aliasMap: AliasMap,
  snapshot: AIProjectSnapshot,
): {
  valid: boolean;
  normalizedArgs: Record<string, unknown>;
  error?: string;
  suggestion?: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const normalizedArgs = { ...args };

  // split_clip: validate time_in_clip
  if (toolName === 'split_clip' && args.clip_id) {
    const clip = snapshot.timeline.clips.find((c) => c.id === args.clip_id);
    if (!clip) {
      return {
        valid: false,
        normalizedArgs,
        error: `Clip not found`,
        suggestion: 'Ensure clip_id is correct',
        warnings: [],
      };
    }

    const time = Number(args.time_in_clip);
    if (!Number.isFinite(time)) {
      return {
        valid: false,
        normalizedArgs,
        error: `time_in_clip ${String(args.time_in_clip)} is not a finite number`,
        suggestion: `Use time between 0 and ${clip.duration}`,
        warnings: [],
      };
    }
    if (time <= 0 || time >= clip.duration) {
      const clamped = Math.max(0.05, Math.min(clip.duration - 0.05, time));
      warnings.push(`time_in_clip ${time}s clamped to ${clamped.toFixed(2)}s`);
      normalizedArgs.time_in_clip = Number(clamped.toFixed(2));
    }
  }

  // update_clip_bounds: validate and normalize new_start/new_end
  if (toolName === 'update_clip_bounds' && args.clip_id) {
    const clip = snapshot.timeline.clips.find((c) => c.id === args.clip_id);
    if (!clip) {
      return {
        valid: false,
        normalizedArgs,
        error: `Clip not found`,
        suggestion: 'Ensure clip_id is correct',
        warnings: [],
      };
    }

    let newStart = args.new_start !== undefined ? Number(args.new_start) : clip.sourceStart;
    let newEnd = args.new_end !== undefined ? Number(args.new_end) : clip.sourceEnd;
    const max = clip.sourceDuration;

    // Clamp to valid range
    if (newStart < 0) {
      warnings.push(`new_start ${newStart}s clamped to 0`);
      newStart = 0;
    }
    if (newStart > max) {
      warnings.push(`new_start ${newStart}s clamped to ${max}s`);
      newStart = max;
    }
    if (newEnd < 0) {
      warnings.push(`new_end ${newEnd}s clamped to 0`);
      newEnd = 0;
    }
    if (newEnd > max) {
      warnings.push(`new_end ${newEnd}s clamped to ${max}s`);
      newEnd = max;
    }

    // Ensure positive duration
    if (newStart >= newEnd) {
      warnings.push(`Adjusted bounds to ensure positive duration`);
      newEnd = Math.min(max, newStart + 0.1);
    }

    normalizedArgs.new_start = newStart;
    normalizedArgs.new_end = newEnd;
  }

  // set_playhead_position: validate time
  if (toolName === 'set_playhead_position') {
    const time = Number(args.time);
    const maxTime = snapshot.timeline.totalDuration;

    if (!Number.isFinite(time) || time < 0) {
      return {
        valid: false,
        normalizedArgs,
        error: `Invalid time: ${args.time}`,
        suggestion: 'Use time >= 0',
        warnings: [],
      };
    }

    if (time > maxTime) {
      warnings.push(`time ${time}s clamped to ${maxTime}s`);
      normalizedArgs.time = maxTime;
    }
  }

  // move_clip: validate start_time
  if (toolName === 'move_clip' && args.start_time !== undefined) {
    const startTime = Number(args.start_time);
    if (!Number.isFinite(startTime)) {
      return {
        valid: false,
        normalizedArgs,
        error: `Invalid start_time: ${args.start_time}`,
        suggestion: 'Use a numeric start_time >= 0',
        warnings: [],
      };
    }
    if (startTime < 0) {
      warnings.push(`start_time ${startTime}s clamped to 0s`);
      normalizedArgs.start_time = 0;
    }
  }

  return { valid: true, normalizedArgs, warnings };
}

/**
 * Check if a tool name is in the known tools list
 */
function isKnownTool(name: string): boolean {
  const knownTools = [
    'get_timeline_info',
    'split_clip',
    'delete_clips',
    'move_clip',
    'merge_clips',
    'copy_clips',
    'paste_clips',
    'set_clip_volume',
    'toggle_clip_mute',
    'select_clips',
    'undo_action',
    'redo_action',
    'set_playhead_position',
    'update_clip_bounds',
    'get_clip_details',
    'add_subtitle',
    'update_subtitle',
    'delete_subtitle',
    'update_subtitle_style',
    'get_subtitles',
    'clear_all_subtitles',
    'transcribe_clip',
    'transcribe_timeline',
    'get_transcription',
    'apply_transcript_edits',
    'save_project',
    'set_export_settings',
    'get_project_info',
    'search_clips_by_content',
    'get_clip_analysis',
    'get_all_media_analysis',
    'set_clip_speed',
    'apply_clip_effect',
    'find_highlights',
    'generate_chapters',
    'generate_intro_script_from_timeline',
    'apply_script_as_captions',
    'preview_caption_fit',
  ];

  return knownTools.includes(name);
}

const NON_DESTRUCTIVE_BLOCKED_TOOLS = new Set(['delete_clips', 'clear_all_subtitles']);
const CLIP_ORDER_MUTATION_TOOLS = new Set(['move_clip']);
const SCRIPT_CAPTION_SAFE_TOOLS = new Set([
  'get_timeline_info',
  'get_clip_details',
  'get_subtitles',
  'get_transcription',
  'get_project_info',
  'get_clip_analysis',
  'get_all_media_analysis',
  'search_clips_by_content',
  'ask_clarification',
  'add_subtitle',
  'update_subtitle',
  'delete_subtitle',
  'update_subtitle_style',
  'clear_all_subtitles',
  'generate_intro_script_from_timeline',
  'apply_script_as_captions',
  'preview_caption_fit',
]);

function hasTargetDurationConstraint(normalizedIntent?: NormalizedIntent): boolean {
  return Number(normalizedIntent?.constraints?.target_duration || 0) > 0;
}

function applyCompilerGuardrails(
  operations: PlannedOperation[],
  options?: CompilePlanOptions,
): { operations: PlannedOperation[]; warnings: string[] } {
  const warnings: string[] = [];
  const userMessage = String(options?.userMessage || '').toLowerCase();
  const normalizedIntent = options?.normalizedIntent;

  const explicitDestructiveIntent =
    /\b(delete|remove|cut out|discard|erase|drop|clear all)\b/.test(userMessage) ||
    normalizedIntent?.mode === 'delete';
  const explicitReorderIntent =
    /\b(reorder|swap|change order|move .* (before|after)|shift clip order)\b/.test(userMessage) ||
    normalizedIntent?.operationHint === 'reorder';
  const scriptCaptionIntent =
    Boolean(
      normalizedIntent?.goals?.includes('script_generation') ||
      normalizedIntent?.operationHint === 'script_outline' ||
      normalizedIntent?.requestedOutputs?.includes('short_script_outline') ||
      normalizedIntent?.requestedOutputs?.includes('subtitle_plan'),
    ) || /\b(script|voiceover|narration|caption|subtitle|on-screen text)\b/.test(userMessage);
  const pureCaptionApplyIntent =
    (/\bapply\b.*\b(caption|captions|subtitle|subtitles)\b/.test(userMessage) ||
      /\bcaption\b.*\bapply\b/.test(userMessage)) &&
    !normalizedIntent?.requestedOutputs?.includes('edit_plan') &&
    !hasTargetDurationConstraint(normalizedIntent) &&
    !normalizedIntent?.goals?.includes('platform_optimized_output');

  const repaired = operations.filter((operation, index) => {
    const name = operation.functionCall.name;

    if (pureCaptionApplyIntent && !SCRIPT_CAPTION_SAFE_TOOLS.has(name)) {
      warnings.push(
        `Op ${index + 1}: Dropped ${name} due to caption-apply intent (non-caption timeline mutation blocked).`,
      );
      return false;
    }

    if (
      scriptCaptionIntent &&
      hasTargetDurationConstraint(normalizedIntent) &&
      name === 'move_clip'
    ) {
      warnings.push(
        `Op ${index + 1}: Dropped move_clip because duration-driven script requests must fill time with content, not gaps.`,
      );
      return false;
    }

    if (!explicitDestructiveIntent && NON_DESTRUCTIVE_BLOCKED_TOOLS.has(name)) {
      warnings.push(`Op ${index + 1}: Dropped ${name} due to non-destructive-default policy.`);
      return false;
    }

    if (!explicitReorderIntent && CLIP_ORDER_MUTATION_TOOLS.has(name)) {
      warnings.push(`Op ${index + 1}: Dropped ${name} to preserve clip order by default.`);
      return false;
    }

    return true;
  });

  return { operations: repaired, warnings };
}

/**
 * Generate a correction prompt for the LLM when compilation fails
 */
export function generateCorrectionPrompt(result: CompilationResult): string {
  if (result.errors.length === 0) {
    return '';
  }

  const errorSummary = result.errors
    .map((err, i) => {
      return `${i + 1}. Operation ${err.operationIndex + 1} (${err.toolName}): ${err.message}${err.suggestion ? ` → ${err.suggestion}` : ''}`;
    })
    .join('\n');

  return `Your previous plan had ${result.errors.length} error(s) that prevented execution:

${errorSummary}

Please generate a corrected plan that:
1. Uses only the clip aliases provided in the snapshot (clip_1, clip_2, etc.) - never invent IDs
2. Ensures all timestamps are within valid bounds (0 to clip duration)
3. Uses only tools from the provided toolConfig
4. Returns at least one valid operation

If you cannot generate valid operations, call get_timeline_info first to inspect the current state.`;
}

export function validatePlannerOutputContract(contract: PlannerOutputContract): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!contract || typeof contract !== 'object') {
    return { valid: false, errors: ['Planner contract payload is missing'] };
  }

  if (
    !contract.understanding ||
    typeof contract.understanding.goal !== 'string' ||
    contract.understanding.goal.trim().length === 0
  ) {
    errors.push('Missing understanding.goal');
  }
  if (!Array.isArray(contract.understanding?.constraints)) {
    errors.push('Missing understanding.constraints array');
  }
  if (!Array.isArray(contract.operations)) {
    errors.push('Missing operations array');
  }
  if (!Array.isArray(contract.riskNotes)) {
    errors.push('Missing riskNotes array');
  }
  if (typeof contract.planReady !== 'boolean') {
    errors.push('Missing boolean planReady field');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
