/**
 * Agent Step Tracker — Real-time step tracking and compression
 *
 * Tracks each step of the agentic loop, maintains state, detects
 * doom loops (repeated identical tool calls), and compresses
 * step history for context window efficiency.
 */

import type {
  AgentStep,
  AgentStepStatus,
  AgentToolCall,
  AgentToolResult,
  AgentVerification,
  CompressedStepSummary,
} from '../types/agentTypes';

export function createStep(stepNumber: number): AgentStep {
  return {
    stepNumber,
    status: 'thinking',
    thought: '',
    toolCall: null,
    result: null,
    verification: null,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    startedAt: Date.now(),
  };
}

export function updateStepStatus(step: AgentStep, status: AgentStepStatus): AgentStep {
  return {
    ...step,
    status,
    completedAt:
      status === 'completed' || status === 'failed' || status === 'skipped'
        ? Date.now()
        : step.completedAt,
    durationMs:
      status === 'completed' || status === 'failed' || status === 'skipped'
        ? Date.now() - step.startedAt
        : step.durationMs,
  };
}

export function setStepThought(step: AgentStep, thought: string): AgentStep {
  return { ...step, thought };
}

export function setStepToolCall(step: AgentStep, toolCall: AgentToolCall): AgentStep {
  return { ...step, toolCall, status: 'executing' };
}

export function setStepResult(step: AgentStep, result: AgentToolResult): AgentStep {
  return {
    ...step,
    result,
    status: result.success ? 'completed' : 'failed',
    completedAt: Date.now(),
    durationMs: Date.now() - step.startedAt,
  };
}

export function setStepVerification(step: AgentStep, verification: AgentVerification): AgentStep {
  return { ...step, verification };
}

export function setStepCost(
  step: AgentStep,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): AgentStep {
  return { ...step, inputTokens, outputTokens, costUsd };
}

/**
 * Doom loop detection — if the same tool call (name + serialized args) appears
 * N times in the last N steps, we're probably stuck.
 */
export function detectDoomLoop(steps: AgentStep[], threshold: number): boolean {
  if (steps.length < threshold) return false;

  const recentSteps = steps.slice(-threshold);
  const fingerprints = recentSteps
    .filter((s) => s.toolCall !== null)
    .map((s) => `${s.toolCall!.name}:${JSON.stringify(s.toolCall!.args)}`);

  if (fingerprints.length < threshold) return false;

  const uniqueFingerprints = new Set(fingerprints);
  return uniqueFingerprints.size === 1;
}

/**
 * Compress older steps into compact summaries to save context window tokens.
 * Keeps last `keepRecent` steps in full detail, summarizes the rest.
 */
export function compressStepHistory(
  steps: AgentStep[],
  keepRecent: number,
): {
  compressed: CompressedStepSummary[];
  recent: AgentStep[];
} {
  if (steps.length <= keepRecent) {
    return { compressed: [], recent: [...steps] };
  }

  const olderSteps = steps.slice(0, steps.length - keepRecent);
  const recentSteps = steps.slice(-keepRecent);

  const compressed: CompressedStepSummary[] = olderSteps.map((step) => ({
    stepNumber: step.stepNumber,
    tool: step.toolCall?.name || 'no_tool',
    success: step.status === 'completed',
    keyResult: extractKeyResult(step),
  }));

  return { compressed, recent: recentSteps };
}

function extractKeyResult(step: AgentStep): string {
  if (!step.result) return step.thought.slice(0, 80);

  if (!step.result.success) {
    return `FAILED: ${(step.result.error || 'unknown error').slice(0, 60)}`;
  }

  const output = step.result.output;
  if (output.length <= 80) return output;

  return output.slice(0, 77) + '...';
}

/**
 * Format compressed steps into a compact string for the LLM context window.
 */
export function formatCompressedStepsForContext(compressed: CompressedStepSummary[]): string {
  if (compressed.length === 0) return '';

  const lines = compressed.map(
    (s) => `  Step ${s.stepNumber}: ${s.tool} → ${s.success ? '✓' : '✗'} ${s.keyResult}`,
  );

  return `<previous-steps-summary>\n${lines.join('\n')}\n</previous-steps-summary>`;
}

/**
 * Calculate total duration across all steps.
 */
export function totalStepDuration(steps: AgentStep[]): number {
  return steps.reduce((sum, step) => sum + step.durationMs, 0);
}

/**
 * Count completed steps by status.
 */
export function stepStatusCounts(steps: AgentStep[]): Record<AgentStepStatus, number> {
  const counts: Record<AgentStepStatus, number> = {
    thinking: 0,
    executing: 0,
    verifying: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const step of steps) {
    counts[step.status]++;
  }

  return counts;
}
