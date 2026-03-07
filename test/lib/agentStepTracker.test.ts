import { describe, it, expect } from 'vitest';
import {
  createStep,
  updateStepStatus,
  setStepThought,
  setStepToolCall,
  setStepResult,
  setStepVerification,
  setStepCost,
  detectDoomLoop,
  compressStepHistory,
  formatCompressedStepsForContext,
  totalStepDuration,
  stepStatusCounts,
} from '../../src/lib/agentStepTracker';
import type { AgentStep } from '../../src/types/agentTypes';

function makeCompletedStep(
  stepNumber: number,
  toolName: string,
  args: Record<string, unknown> = {},
  success: boolean = true,
): AgentStep {
  let step = createStep(stepNumber);
  step = setStepThought(step, `Thinking about step ${stepNumber}`);
  step = setStepToolCall(step, { name: toolName, args });
  step = setStepResult(step, {
    success,
    output: success ? 'Done' : 'Failed',
    error: success ? undefined : 'Some error',
  });
  step = updateStepStatus(step, success ? 'completed' : 'failed');
  return step;
}

describe('agentStepTracker', () => {
  describe('createStep', () => {
    it('creates a step with default values', () => {
      const step = createStep(1);
      expect(step.stepNumber).toBe(1);
      expect(step.status).toBe('thinking');
      expect(step.thought).toBe('');
      expect(step.toolCall).toBeNull();
      expect(step.result).toBeNull();
      expect(step.verification).toBeNull();
      expect(step.costUsd).toBe(0);
      expect(step.startedAt).toBeGreaterThan(0);
    });
  });

  describe('updateStepStatus', () => {
    it('updates status to completed with timestamp', () => {
      const step = createStep(1);
      const updated = updateStepStatus(step, 'completed');
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
      expect(updated.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('does not set completedAt for non-terminal states', () => {
      const step = createStep(1);
      const updated = updateStepStatus(step, 'executing');
      expect(updated.status).toBe('executing');
      expect(updated.completedAt).toBeUndefined();
    });
  });

  describe('setStepThought', () => {
    it('sets the thought text', () => {
      const step = createStep(1);
      const updated = setStepThought(step, 'Analyzing timeline...');
      expect(updated.thought).toBe('Analyzing timeline...');
    });
  });

  describe('setStepToolCall', () => {
    it('sets tool call and status to executing', () => {
      const step = createStep(1);
      const updated = setStepToolCall(step, {
        name: 'get_timeline_info',
        args: {},
      });
      expect(updated.toolCall).toEqual({ name: 'get_timeline_info', args: {} });
      expect(updated.status).toBe('executing');
    });
  });

  describe('setStepResult', () => {
    it('sets success result and completes step', () => {
      const step = createStep(1);
      const updated = setStepResult(step, {
        success: true,
        output: 'Timeline has 3 clips',
      });
      expect(updated.result?.success).toBe(true);
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
    });

    it('sets failure result and marks step as failed', () => {
      const step = createStep(1);
      const updated = setStepResult(step, {
        success: false,
        output: '',
        error: 'Clip not found',
      });
      expect(updated.result?.success).toBe(false);
      expect(updated.status).toBe('failed');
    });
  });

  describe('setStepVerification', () => {
    it('sets verification data', () => {
      const step = createStep(1);
      const updated = setStepVerification(step, {
        verified: true,
        method: 'timeline_check',
        details: 'Timeline verified',
      });
      expect(updated.verification?.verified).toBe(true);
      expect(updated.verification?.method).toBe('timeline_check');
    });
  });

  describe('setStepCost', () => {
    it('sets cost metrics', () => {
      const step = createStep(1);
      const updated = setStepCost(step, 500, 200, 0.001);
      expect(updated.inputTokens).toBe(500);
      expect(updated.outputTokens).toBe(200);
      expect(updated.costUsd).toBe(0.001);
    });
  });

  describe('detectDoomLoop', () => {
    it('returns false when not enough steps', () => {
      const steps = [makeCompletedStep(1, 'get_timeline_info')];
      expect(detectDoomLoop(steps, 3)).toBe(false);
    });

    it('detects identical repeated tool calls', () => {
      const steps = [
        makeCompletedStep(1, 'get_timeline_info', { detail: 'full' }),
        makeCompletedStep(2, 'get_timeline_info', { detail: 'full' }),
        makeCompletedStep(3, 'get_timeline_info', { detail: 'full' }),
      ];
      expect(detectDoomLoop(steps, 3)).toBe(true);
    });

    it('returns false for varied tool calls', () => {
      const steps = [
        makeCompletedStep(1, 'get_timeline_info'),
        makeCompletedStep(2, 'update_clip_bounds', { clip_id: 'clip_1' }),
        makeCompletedStep(3, 'get_timeline_info'),
      ];
      expect(detectDoomLoop(steps, 3)).toBe(false);
    });

    it('respects custom threshold', () => {
      const steps = [
        makeCompletedStep(1, 'get_timeline_info'),
        makeCompletedStep(2, 'get_timeline_info'),
      ];
      expect(detectDoomLoop(steps, 2)).toBe(true);
      expect(detectDoomLoop(steps, 3)).toBe(false);
    });
  });

  describe('compressStepHistory', () => {
    it('returns all steps as recent when under threshold', () => {
      const steps = [makeCompletedStep(1, 'get_timeline_info')];
      const result = compressStepHistory(steps, 3);
      expect(result.compressed).toHaveLength(0);
      expect(result.recent).toHaveLength(1);
    });

    it('compresses older steps and keeps recent', () => {
      const steps = [
        makeCompletedStep(1, 'get_timeline_info'),
        makeCompletedStep(2, 'update_clip_bounds', { clip_id: 'clip_1' }),
        makeCompletedStep(3, 'get_clip_details', { clip_id: 'clip_2' }),
        makeCompletedStep(4, 'update_clip_bounds', { clip_id: 'clip_2' }),
        makeCompletedStep(5, 'get_timeline_info'),
      ];
      const result = compressStepHistory(steps, 2);
      expect(result.compressed).toHaveLength(3);
      expect(result.recent).toHaveLength(2);
      expect(result.recent[0].stepNumber).toBe(4);
      expect(result.recent[1].stepNumber).toBe(5);
    });

    it('compressed entries contain essential info', () => {
      const steps = [
        makeCompletedStep(1, 'get_timeline_info'),
        makeCompletedStep(2, 'update_clip_bounds', { clip_id: 'clip_1' }, false),
        makeCompletedStep(3, 'get_timeline_info'),
      ];
      const result = compressStepHistory(steps, 1);
      expect(result.compressed[0].tool).toBe('get_timeline_info');
      expect(result.compressed[0].success).toBe(true);
      expect(result.compressed[1].tool).toBe('update_clip_bounds');
      expect(result.compressed[1].success).toBe(false);
      expect(result.compressed[1].keyResult).toContain('FAILED');
    });
  });

  describe('formatCompressedStepsForContext', () => {
    it('returns empty string for empty array', () => {
      expect(formatCompressedStepsForContext([])).toBe('');
    });

    it('formats compressed steps as XML-like block', () => {
      const compressed = [
        { stepNumber: 1, tool: 'get_timeline_info', success: true, keyResult: 'Got info' },
        { stepNumber: 2, tool: 'update_clip_bounds', success: false, keyResult: 'FAILED: bad bounds' },
      ];
      const formatted = formatCompressedStepsForContext(compressed);
      expect(formatted).toContain('<previous-steps-summary>');
      expect(formatted).toContain('Step 1: get_timeline_info → ✓');
      expect(formatted).toContain('Step 2: update_clip_bounds → ✗');
    });
  });

  describe('totalStepDuration', () => {
    it('sums durations', () => {
      const steps: AgentStep[] = [
        { ...createStep(1), durationMs: 100 },
        { ...createStep(2), durationMs: 200 },
      ];
      expect(totalStepDuration(steps)).toBe(300);
    });
  });

  describe('stepStatusCounts', () => {
    it('counts statuses correctly', () => {
      const steps = [
        makeCompletedStep(1, 'a'),
        makeCompletedStep(2, 'b'),
        makeCompletedStep(3, 'c', {}, false),
      ];
      const counts = stepStatusCounts(steps);
      expect(counts.completed).toBe(2);
      expect(counts.failed).toBe(1);
      expect(counts.thinking).toBe(0);
    });
  });
});
