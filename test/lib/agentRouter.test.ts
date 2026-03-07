import { describe, it, expect } from 'vitest';
import { decideExecutionMode, applyModeOverrides } from '../../src/lib/agentRouter';

describe('agentRouter', () => {
  describe('decideExecutionMode', () => {
    it('uses single-pass when no timeline', () => {
      const result = decideExecutionMode({
        message: 'make a highlight reel',
        baseIntent: 'edit',
        clipCount: 0,
        hasTimeline: false,
      });
      expect(result.mode).toBe('single_pass');
      expect(result.reason).toBe('no_timeline_content');
    });

    it('uses single-pass for chat intent', () => {
      const result = decideExecutionMode({
        message: 'what is the timeline duration?',
        baseIntent: 'chat',
        clipCount: 3,
        hasTimeline: true,
      });
      expect(result.mode).toBe('single_pass');
      expect(result.reason).toBe('non_edit_intent');
    });

    it('routes to agentic for highlight reel requests', () => {
      const result = decideExecutionMode({
        message: 'make a highlight reel from these clips',
        baseIntent: 'edit',
        clipCount: 5,
        hasTimeline: true,
      });
      expect(result.mode).toBe('agentic');
      expect(result.reason).toContain('highlight');
    });

    it('routes to agentic for best moments requests', () => {
      const result = decideExecutionMode({
        message: 'extract the best moments from this video',
        baseIntent: 'edit',
        clipCount: 3,
        hasTimeline: true,
      });
      expect(result.mode).toBe('agentic');
      expect(result.reason).toContain('best moments');
    });

    it('routes to agentic for montage requests', () => {
      const result = decideExecutionMode({
        message: 'create a montage from all clips',
        baseIntent: 'edit',
        clipCount: 4,
        hasTimeline: true,
      });
      expect(result.mode).toBe('agentic');
    });

    it('routes to single-pass for simple trim', () => {
      const result = decideExecutionMode({
        message: 'trim the first clip to 5 seconds',
        baseIntent: 'edit',
        clipCount: 3,
        hasTimeline: true,
      });
      expect(result.mode).toBe('single_pass');
    });

    it('routes to single-pass for simple split', () => {
      const result = decideExecutionMode({
        message: 'split clip at 3 seconds',
        baseIntent: 'edit',
        clipCount: 2,
        hasTimeline: true,
      });
      expect(result.mode).toBe('single_pass');
    });

    it('routes to agentic for multiple goals in normalized intent', () => {
      const result = decideExecutionMode({
        message: 'edit this video for youtube',
        baseIntent: 'edit',
        clipCount: 3,
        hasTimeline: true,
        normalizedIntent: {
          mode: 'modify',
          goals: ['trim_clips', 'add_transitions', 'add_captions'],
          constraints: {},
          operationHint: null,
          confidence: 0.8,
          requiresPlanning: true,
          ambiguities: [],
          intent_type: 'multi_video_edit',
          requestedOutputs: [],
        },
      });
      expect(result.mode).toBe('agentic');
      expect(result.reason).toContain('multiple_goals');
    });

    it('routes to agentic for target duration constraint', () => {
      const result = decideExecutionMode({
        message: 'make this 30 seconds',
        baseIntent: 'edit',
        clipCount: 4,
        hasTimeline: true,
        normalizedIntent: {
          mode: 'modify',
          goals: ['trim_to_duration'],
          constraints: { target_duration: 30 },
          operationHint: null,
          confidence: 0.9,
          requiresPlanning: true,
          ambiguities: [],
          intent_type: 'multi_video_edit',
          requestedOutputs: [],
        },
      });
      expect(result.mode).toBe('agentic');
      expect(result.reason).toContain('target_duration');
    });

    it('routes short-form script-plus-edit requests to agentic', () => {
      const result = decideExecutionMode({
        message:
          'make a 30 second youtube short with proper script and editing so it gets more views',
        baseIntent: 'edit',
        clipCount: 3,
        hasTimeline: true,
        normalizedIntent: {
          mode: 'modify',
          goals: ['platform_optimized_output', 'script_generation'],
          constraints: { target_duration: 30, platform: 'youtube_shorts' },
          operationHint: 'script_outline',
          confidence: 0.9,
          requiresPlanning: true,
          ambiguities: [],
          intent_type: 'multi_video_edit',
          requestedOutputs: ['edit_plan', 'short_script_outline'],
        },
      });
      expect(result.mode).toBe('agentic');
      expect(result.reason).toContain('agentic');
    });

    it('routes execution-heavy short-form asks to agentic even without normalized intent', () => {
      const result = decideExecutionMode({
        message: 'make this a youtube short with script captions and 30 second runtime for more views',
        baseIntent: 'edit',
        clipCount: 2,
        hasTimeline: true,
      });
      expect(result.mode).toBe('agentic');
    });

    it('routes to agentic for compound requests', () => {
      const result = decideExecutionMode({
        message: 'trim the clips and then add transitions between them',
        baseIntent: 'edit',
        clipCount: 3,
        hasTimeline: true,
      });
      expect(result.mode).toBe('agentic');
      // Note: matches 'transitions' agentic keyword before compound detection
    });

    it('estimates steps based on clip count for highlights', () => {
      const result = decideExecutionMode({
        message: 'create highlights',
        baseIntent: 'edit',
        clipCount: 10,
        hasTimeline: true,
      });
      expect(result.estimatedSteps).toBeGreaterThanOrEqual(5);
      expect(result.estimatedSteps).toBeLessThanOrEqual(15);
    });

    it('keeps estimated cost reasonable', () => {
      const result = decideExecutionMode({
        message: 'make a highlight reel',
        baseIntent: 'edit',
        clipCount: 5,
        hasTimeline: true,
      });
      expect(result.estimatedCostUsd).toBeLessThan(0.05);
    });
  });

  describe('applyModeOverrides', () => {
    it('forces agentic mode when user says "agent mode"', () => {
      const base = {
        mode: 'single_pass' as const,
        reason: 'default',
        estimatedSteps: 1,
        estimatedCostUsd: 0.001,
      };
      const result = applyModeOverrides(base, 'use agent mode for this');
      expect(result.mode).toBe('agentic');
    });

    it('forces single-pass when user says "quick"', () => {
      const base = {
        mode: 'agentic' as const,
        reason: 'highlight',
        estimatedSteps: 5,
        estimatedCostUsd: 0.01,
      };
      const result = applyModeOverrides(base, 'just do a quick trim');
      expect(result.mode).toBe('single_pass');
    });

    it('keeps original decision when no override keywords', () => {
      const base = {
        mode: 'agentic' as const,
        reason: 'highlight',
        estimatedSteps: 5,
        estimatedCostUsd: 0.01,
      };
      const result = applyModeOverrides(base, 'make a highlight reel');
      expect(result.mode).toBe('agentic');
    });
  });
});
