import { describe, expect, it } from 'vitest';
import { classifyIntentWithContext } from '../../src/lib/intentClassifier';
import { buildFallbackExecutionPlan } from '../../src/lib/fallbackPlanGenerator';
import { classifyTransientError, getRetryDelayMs } from '../../src/lib/retryClassifier';
import { ToolExecutor } from '../../src/lib/toolExecutor';
import { useProjectStore } from '../../src/stores/useProjectStore';
import type { AIProjectSnapshot } from '../../src/lib/aiProjectSnapshot';
import type { AliasMap } from '../../src/lib/clipAliasMapper';

const emptyAliasMap: AliasMap = {
  byAlias: new Map(),
  byUuid: new Map(),
  metadata: new Map(),
};

function makeSnapshot(): AIProjectSnapshot {
  return {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    timeline: {
      totalDuration: 10,
      clipCount: 1,
      currentTime: 0,
      isPlaying: false,
      selectedClipIds: [],
      clips: [
        {
          id: 'clip-1',
          name: 'Clip 1',
          mediaType: 'video',
          trackIndex: 0,
          selected: false,
          locked: false,
          timelineStart: 0,
          timelineEnd: 10,
          duration: 10,
          sourceStart: 0,
          sourceEnd: 10,
          sourceDuration: 10,
          volume: 1,
          muted: false,
          speed: 1,
        },
      ],
    },
    mediaLibrary: {
      totalAnalyzed: 0,
      byType: {},
      entries: [],
    },
    subtitles: {
      count: 0,
      style: {
        fontSize: 24,
        fontFamily: 'Arial',
        color: '#fff',
        backgroundColor: '#000',
        position: 'bottom',
        displayMode: 'progressive',
      },
      entries: [],
    },
    transcript: {
      available: false,
      isTranscribing: false,
      segmentCount: 0,
      wordCount: 0,
    },
    exportSettings: {
      format: 'mp4',
      resolution: 'original',
      projectPath: null,
      projectId: null,
      hasUnsavedChanges: false,
      lastSaved: null,
    },
    constraints: {
      approvalPolicy: {
        readOnlyNoApproval: true,
        mutatingRequiresApproval: true,
      },
      executionPolicy: {
        defaultMode: 'strict_sequential',
        maxReadOnlyBatchSize: 3,
        stopOnFailure: true,
      },
      timelineBounds: {
        minTime: 0,
        maxTime: 10,
        maxClipEndById: { 'clip-1': 10 },
      },
      supportedToolNames: [],
    },
    neverAssume: [],
  };
}

describe('chat runtime regression matrix', () => {
  it('keeps fallback plans non-ready and safe', () => {
    const plan = buildFallbackExecutionPlan(makeSnapshot(), emptyAliasMap, 'yes do it');
    expect(plan.planReady).toBe(false);
    expect(plan.requiresApproval).toBe(false);
    expect(plan.riskNotes.length).toBeGreaterThan(0);
  });

  it('classifies confirmation intent based on pending-plan context', () => {
    expect(classifyIntentWithContext('yes', { hasPendingPlan: false })).toBe('chat');
    expect(classifyIntentWithContext('yes', { hasPendingPlan: true })).toBe('edit');
    expect(classifyIntentWithContext('yes do it', { hasPendingPlan: false })).toBe('edit');
  });

  it('captures transient retryable errors and enforces capped delay', () => {
    expect(classifyTransientError(new Error('429 Too Many Requests')).retryable).toBe(true);
    expect(classifyTransientError(new Error('Invalid clip id')).retryable).toBe(false);
    expect(getRetryDelayMs(12)).toBe(15000);
  });

  it('enforces mode gating and emits lifecycle transitions', async () => {
    useProjectStore.setState({
      clips: [
        {
          id: 'clip-1',
          path: '/tmp/clip.mp4',
          name: 'Clip 1',
          duration: 10,
          sourceDuration: 10,
          start: 0,
          end: 10,
          startTime: 0,
          mediaType: 'video',
          trackIndex: 0,
          volume: 1,
          muted: false,
        },
      ],
      selectedClipIds: [],
      currentTime: 0,
      isPlaying: false,
      history: [],
      historyIndex: -1,
    } as any);

    const states: string[] = [];
    const results = await ToolExecutor.executeWithPolicy(
      [{ name: 'delete_clips', args: { clip_ids: ['clip-1'] } }],
      { mode: 'strict_sequential', stopOnFailure: true },
      undefined,
      {
        mode: 'ask',
        onLifecycle: (event) => {
          states.push(event.state);
        },
      },
    );

    expect(states).toEqual(['pending', 'error']);
    expect(results[0].result.success).toBe(false);
    expect(results[0].result.errorType).toBe('constraint_violation');
  });
});
