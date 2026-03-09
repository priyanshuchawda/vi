import { beforeEach, describe, expect, it } from 'vitest';
import { ToolExecutor } from '../../src/lib/toolExecutor';
import { useProjectStore } from '../../src/stores/useProjectStore';

beforeEach(() => {
  useProjectStore.setState({
    clips: [
      {
        id: 'clip-1',
        path: '/tmp/clip-1.mp4',
        name: 'Clip 1',
        duration: 6,
        sourceDuration: 10,
        start: 0,
        end: 6,
        startTime: 0,
        mediaType: 'video',
        trackIndex: 0,
        volume: 1,
        muted: false,
      },
    ],
    selectedClipIds: [],
    subtitles: [],
    currentTime: 0,
    isPlaying: false,
    exportFormat: 'mp4',
    exportResolution: 'original',
    history: [],
    historyIndex: -1,
  } as any);
});

describe('ToolExecutor planning guard + policy execution', () => {
  it('preflight normalizes safe clip-bound adjustments', () => {
    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'update_clip_bounds',
        args: {
          clip_id: 'clip-1',
          new_start: -1,
          new_end: 12,
        },
      },
    ]);

    expect(preflight.valid).toBe(true);
    expect(preflight.normalizedCalls[0].args.new_start).toBe(0);
    expect(preflight.normalizedCalls[0].args.new_end).toBe(10);
    expect(preflight.corrections.length).toBeGreaterThan(0);
  });

  it('preflight repairs reversed clip-bound ranges', () => {
    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'update_clip_bounds',
        args: {
          clip_id: 'clip-1',
          new_start: 8,
          new_end: 2,
        },
      },
    ]);

    expect(preflight.valid).toBe(true);
    expect(preflight.normalizedCalls[0].args.new_start).toBe(2);
    expect(preflight.normalizedCalls[0].args.new_end).toBe(8);
    expect(preflight.corrections.some((entry) => entry.includes('reversed and swapped'))).toBe(
      true,
    );
  });

  it('preflight repairs ranges that collapse at the source boundary', () => {
    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'update_clip_bounds',
        args: {
          clip_id: 'clip-1',
          new_start: 12,
          new_end: 13,
        },
      },
    ]);

    expect(preflight.valid).toBe(true);
    expect(preflight.normalizedCalls[0].args.new_start).toBe(9);
    expect(preflight.normalizedCalls[0].args.new_end).toBe(10);
    expect(preflight.corrections.some((entry) => entry.includes('auto-shifted'))).toBe(true);
  });

  it('allows still-image clips to extend beyond their current visible duration', () => {
    useProjectStore.setState({
      clips: [
        {
          id: 'image-1',
          path: '/tmp/still.png',
          name: 'Still',
          duration: 5,
          assetDuration: 5,
          sourceDuration: 300,
          start: 0,
          end: 5,
          startTime: 0,
          mediaType: 'image',
          trackIndex: 0,
          volume: 1,
          muted: false,
        },
      ],
    } as any);

    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'update_clip_bounds',
        args: {
          clip_id: 'image-1',
          new_end: 12,
        },
      },
    ]);

    expect(preflight.valid).toBe(true);
    expect(preflight.normalizedCalls[0].args.new_end).toBe(12);
  });

  it('preflight fails unsupported tools with tool_missing taxonomy', () => {
    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'insert_clip',
        args: {},
      },
    ]);

    expect(preflight.valid).toBe(false);
    expect(preflight.issues[0].errorType).toBe('tool_missing');
  });

  it('preflight simulates subtitle count across sequential add/update calls', () => {
    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'add_subtitle',
        args: {
          text: 'Hook',
          start_time: 0,
          end_time: 2,
        },
      },
      {
        name: 'update_subtitle',
        args: {
          index: 1,
          text: 'Better Hook',
        },
      },
    ]);

    expect(preflight.valid).toBe(true);
    expect(preflight.issues).toHaveLength(0);
  });

  it('preflight explains how to recover when updating a missing subtitle', () => {
    const preflight = ToolExecutor.preflightPlan([
      {
        name: 'update_subtitle',
        args: {
          index: 1,
          text: 'Hook',
        },
      },
    ]);

    expect(preflight.valid).toBe(false);
    expect(preflight.issues[0].message).toContain('Subtitle 1 not found');
    expect(preflight.issues[0].recoveryHint).toContain(
      'Use add_subtitle or apply_script_as_captions first',
    );
  });

  it('hybrid execution batches read-only operations safely', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [
        { name: 'get_timeline_info', args: {} },
        { name: 'get_project_info', args: {} },
      ],
      {
        mode: 'hybrid',
        maxReadOnlyBatchSize: 3,
        stopOnFailure: true,
      },
    );

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.result.success)).toBe(true);
  });

  it('stops on first failure in strict sequential mode', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [
        { name: 'split_clip', args: { clip_id: 'clip-1', time_in_clip: 100 } },
        { name: 'get_timeline_info', args: {} },
      ],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].result.success).toBe(false);
    expect(results[0].result.errorType).toBe('validation_error');
  });

  it('executes repaired clip-bound updates instead of failing on collapsed ranges', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [{ name: 'update_clip_bounds', args: { clip_id: 'clip-1', new_start: 12, new_end: 13 } }],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
      },
    );

    const clip = useProjectStore.getState().clips[0];
    expect(results).toHaveLength(1);
    expect(results[0].result.success).toBe(true);
    expect(clip.start).toBe(9);
    expect(clip.end).toBe(10);
    expect(clip.duration).toBe(1);
    expect(results[0].result.message).toContain('Updated bounds for "Clip 1"');
  });

  it('delete_clips reports deleted and missing IDs at execution time', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [{ name: 'delete_clips', args: { clip_ids: ['clip-1', 'missing-clip'] } }],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].result.success).toBe(true);
    expect(results[0].result.data?.deleted_count).toBe(1);
    expect(results[0].result.data?.missing_ids).toContain('missing-clip');
  });

  it('emits lifecycle states and before/after hooks for each tool call', async () => {
    const lifecycleStates: string[] = [];
    const hooks: string[] = [];

    await ToolExecutor.executeWithPolicy(
      [{ name: 'get_timeline_info', args: {} }],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
      },
      undefined,
      {
        onLifecycle: (event) => {
          lifecycleStates.push(event.state);
        },
        onHook: (event) => {
          hooks.push(event.event);
        },
      },
    );

    expect(lifecycleStates).toEqual(['pending', 'running', 'completed']);
    expect(hooks).toEqual(['tool.execute.before', 'tool.execute.after']);
  });

  it('blocks mutating tools in ask mode with structured mode-policy errors', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [{ name: 'delete_clips', args: { clip_ids: ['clip-1'] } }],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
      },
      undefined,
      {
        mode: 'ask',
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].result.success).toBe(false);
    expect(results[0].result.errorType).toBe('constraint_violation');
    expect(results[0].result.error).toContain('not allowed in "ask" mode');
    expect(results[0].result.recoveryHint).toContain('Switch to edit mode');
  });

  it('allows ask_clarification in ask mode and returns prompt payload', async () => {
    const results = await ToolExecutor.executeWithPolicy(
      [
        {
          name: 'ask_clarification',
          args: {
            question: 'Which clip should I edit?',
            options: ['Clip 1', 'Clip 2'],
            context: 'Two candidate clips were found.',
          },
        },
      ],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
      },
      undefined,
      {
        mode: 'ask',
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0].result.success).toBe(true);
    expect(results[0].result.data?.question).toContain('Which clip');
    expect(results[0].result.data?.options).toHaveLength(2);
  });

  it('recovers invalid split bounds via constraint repair retry', async () => {
    const execution = await ToolExecutor.executeWithRecovery(
      [{ name: 'split_clip', args: { clip_id: 'clip-1', time_in_clip: 100 } }],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
        maxAttemptsPerOperation: 4,
      },
    );

    expect(execution.results).toHaveLength(1);
    expect(execution.results[0].result.success).toBe(true);
    expect(execution.results[0].result.recovery?.recovered).toBe(true);
    expect(execution.results[0].result.recovery?.reasonCodes).toContain(
      'constraint_recompile_retry',
    );
    expect(
      execution.recoveryEvents.some(
        (event) => event.code === 'constraint_recompile_retry' && event.success,
      ),
    ).toBe(true);
  });

  it('records recovery exhaustion when operation cannot be repaired', async () => {
    const execution = await ToolExecutor.executeWithRecovery(
      [
        { name: 'update_clip_bounds', args: { clip_id: 'missing-clip', new_start: 1, new_end: 2 } },
        { name: 'get_timeline_info', args: {} },
      ],
      {
        mode: 'strict_sequential',
        stopOnFailure: true,
        maxAttemptsPerOperation: 4,
      },
    );

    expect(execution.results).toHaveLength(1);
    expect(execution.results[0].result.success).toBe(false);
    expect(execution.results[0].result.recovery?.reasonCodes).toContain(
      'fallback_readonly_recovery',
    );
    expect(execution.results[0].result.recovery?.reasonCodes).toContain('recovery_exhausted');
    expect(execution.recoveryEvents.some((event) => event.code === 'recovery_exhausted')).toBe(
      true,
    );
  });
});
