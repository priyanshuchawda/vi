 
/**
 * Integration tests for the Agentic Execution Engine
 *
 * These tests mock the Bedrock API to validate the full loop flow:
 * - Multi-step tool execution
 * - Cost guard enforcement
 * - Doom loop detection
 * - Error recovery
 * - Abort signal handling
 * - Context compression
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Bedrock gateway
vi.mock('../../src/lib/bedrockGateway', () => ({
  isBedrockConfigured: () => true,
  converseBedrock: vi.fn(),
  MODEL_ID: 'us.amazon.nova-lite-v1:0',
}));

// Mock rate limiter
vi.mock('../../src/lib/rateLimiter', () => ({
  waitForSlot: () => Promise.resolve(),
  withRetryOn429: (fn: () => Promise<any>) => fn(),
}));

// Mock token tracker
vi.mock('../../src/lib/tokenTracker', () => ({
  recordUsage: vi.fn(),
}));

// Mock model routing
vi.mock('../../src/lib/modelRoutingPolicy', () => ({
  routeBedrockModel: () => ({ modelId: 'us.amazon.nova-lite-v1:0' }),
  recordRoutingModelOutcome: vi.fn(),
}));

// Mock project snapshot
vi.mock('../../src/lib/aiProjectSnapshot', () => ({
  buildAliasedSnapshotForPlanning: vi.fn(() => ({
    snapshot: { clips: [], tracks: [], totalDuration: 10 },
    aliasMap: { clip_1: 'uuid-1', clip_2: 'uuid-2' },
  })),
  formatSnapshotForPrompt: () => 'snapshot_context',
}));

// Mock capability matrix
vi.mock('../../src/lib/toolCapabilityMatrix', () => ({
  formatCapabilityMatrixForPrompt: () => 'capability_matrix',
  isReadOnlyTool: (name: string) =>
    ['get_timeline_info', 'get_clip_details', 'get_all_media_analysis'].includes(name),
}));

// Mock clip alias mapper
vi.mock('../../src/lib/clipAliasMapper', () => ({
  resolveAlias: (alias: string, map: Record<string, string>) => map[alias] || alias,
}));

// Mock video editing tools
vi.mock('../../src/lib/videoEditingTools', () => ({
  allVideoEditingTools: [
    { toolSpec: { name: 'get_timeline_info' } },
    { toolSpec: { name: 'update_clip_bounds' } },
    { toolSpec: { name: 'get_all_media_analysis' } },
    { toolSpec: { name: 'split_clip' } },
    { toolSpec: { name: 'generate_intro_script_from_timeline' } },
    { toolSpec: { name: 'preview_caption_fit' } },
    { toolSpec: { name: 'apply_script_as_captions' } },
    { toolSpec: { name: 'set_clip_speed' } },
    { toolSpec: { name: 'copy_clips' } },
    { toolSpec: { name: 'paste_clips' } },
  ],
}));

// Mock tool executor
vi.mock('../../src/lib/toolExecutor', () => ({
  ToolExecutor: {
    executeToolCallWithLifecycle: vi.fn().mockResolvedValue({
      result: {
        success: true,
        message: 'Tool executed successfully',
      },
    }),
  },
}));

// Mock UUID
vi.mock('uuid', () => ({
  v4: () => 'test-loop-id',
}));

import { converseBedrock } from '../../src/lib/bedrockGateway';
import { ToolExecutor } from '../../src/lib/toolExecutor';
import { buildAliasedSnapshotForPlanning } from '../../src/lib/aiProjectSnapshot';
import { useProjectStore } from '../../src/stores/useProjectStore';
import type { AgentLoopCallbacks, AgentLoopState, AgentStep } from '../../src/types/agentTypes';

const mockedConverse = vi.mocked(converseBedrock);
const mockedExecute = vi.mocked(ToolExecutor.executeToolCallWithLifecycle);
const mockedBuildSnapshot = vi.mocked(buildAliasedSnapshotForPlanning);

function createMockCallbacks(): AgentLoopCallbacks & {
  steps: AgentStep[];
  completedState: AgentLoopState | null;
  errors: string[];
  costs: number[];
} {
  const steps: AgentStep[] = [];
  let completedState: AgentLoopState | null = null;
  const errors: string[] = [];
  const costs: number[] = [];

  return {
    steps,
    completedState,
    errors,
    costs,
    onStepStart: vi.fn((step: AgentStep) => {
      steps.push({ ...step });
    }),
    onStepComplete: vi.fn((step: AgentStep) => {
      const idx = steps.findIndex((s) => s.stepNumber === step.stepNumber);
      if (idx >= 0) steps[idx] = { ...step };
    }),
    onLoopComplete: vi.fn((state: AgentLoopState) => {
      completedState = state;
    }),
    onLoopError: vi.fn((error: string) => {
      errors.push(error);
    }),
    onCostUpdate: vi.fn((cost: number) => {
      costs.push(cost);
    }),
  };
}

function bedrockToolResponse(
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolUseId: string = 'tool-use-1',
  textThought: string = '',
  inputTokens: number = 200,
  outputTokens: number = 100,
) {
  const content: any[] = [];
  if (textThought) content.push({ text: textThought });
  content.push({
    toolUse: {
      name: toolName,
      input: toolArgs,
      toolUseId,
    },
  });

  return {
    output: { message: { role: 'assistant', content } },
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    stopReason: 'tool_use',
  };
}

function bedrockEndResponse(
  text: string,
  inputTokens: number = 150,
  outputTokens: number = 80,
) {
  return {
    output: {
      message: {
        role: 'assistant',
        content: [{ text }],
      },
    },
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    stopReason: 'end_turn',
  };
}

describe('agentLoop integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecute.mockResolvedValue({
      result: {
        success: true,
        message: 'Tool executed successfully',
      },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes a simple 2-step task (read → done)', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    // Step 1: AI calls get_timeline_info
    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse('get_timeline_info', {}, 'tu-1', 'Let me check the timeline.'),
      )
      // Step 2: AI responds with summary (no more tools)
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Timeline has 3 clips, total duration 15s.'),
      );

    const result = await runAgentLoop({
      userMessage: 'what is on the timeline?',
      history: [],
      callbacks,
    });

    expect(result.success).toBe(true);
    expect(result.totalSteps).toBe(2);
    expect(result.finalSummary).toContain('Completed');
    expect(result.totalCostUsd).toBeGreaterThan(0);
    // onStepStart is called twice per tool step (initial + update with tool info)
    expect(callbacks.onStepStart).toHaveBeenCalled();
    expect(callbacks.onStepComplete).toHaveBeenCalled();
    expect(callbacks.onLoopComplete).toHaveBeenCalledTimes(1);
  });

  it('completes a highlight reel task with multiple tool calls', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      // Step 1: AI calls get_all_media_analysis
      .mockResolvedValueOnce(
        bedrockToolResponse('get_all_media_analysis', {}, 'tu-1', 'Analyzing clips...'),
      )
      // Step 2: AI trims clip_1
      .mockResolvedValueOnce(
        bedrockToolResponse(
          'update_clip_bounds',
          { clip_id: 'clip_1', new_start: 2, new_end: 8 },
          'tu-2',
          'Trimming clip_1 to best scene (2-8s).',
        ),
      )
      // Step 3: AI trims clip_2
      .mockResolvedValueOnce(
        bedrockToolResponse(
          'update_clip_bounds',
          { clip_id: 'clip_2', new_start: 0, new_end: 5 },
          'tu-3',
          'Trimming clip_2 to best scene (0-5s).',
        ),
      )
      // Step 4: Final summary
      .mockResolvedValueOnce(
        bedrockEndResponse(
          ' Completed: Trimmed 2 clips to best moments. Timeline: 11s, 2 clips.',
        ),
      );

    const result = await runAgentLoop({
      userMessage: 'make a highlight reel',
      history: [],
      callbacks,
    });

    expect(result.success).toBe(true);
    expect(result.totalSteps).toBe(4);
    expect(result.finalSummary).toContain('Trimmed 2 clips');
    // 3 tool calls + 2 verification calls (2 mutations trigger verify)
    expect(mockedExecute).toHaveBeenCalled();
    expect(mockedExecute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps only the executed toolUse block in agent history when Bedrock returns multiple tool uses', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce({
        output: {
          message: {
            role: 'assistant',
            content: [
              { text: 'Analyzing and starting edits.' },
              {
                toolUse: {
                  name: 'get_all_media_analysis',
                  input: {},
                  toolUseId: 'tu-keep',
                },
              },
              {
                toolUse: {
                  name: 'update_clip_bounds',
                  input: { clip_id: 'clip_1', new_start: 1, new_end: 4 },
                  toolUseId: 'tu-drop',
                },
              },
            ],
          },
        },
        usage: { inputTokens: 220, outputTokens: 120, totalTokens: 340 },
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Picked the best starting point. Timeline: 12s, 2 clips.'),
      );

    const result = await runAgentLoop({
      userMessage: 'make a youtube short from this hackathon footage',
      history: [],
      callbacks,
    });

    expect(result.success).toBe(true);
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute).toHaveBeenCalledWith(
      { name: 'get_all_media_analysis', args: {} },
      0,
      1,
    );

    const secondCall = mockedConverse.mock.calls[1]?.[0] as { messages: Array<{ role: string; content: any[] }> };
    const assistantMessage = secondCall.messages.find((message) => message.role === 'assistant');
    const userToolResultMessage = secondCall.messages[secondCall.messages.length - 1];

    const assistantToolUses = (assistantMessage?.content || []).filter((part) => part.toolUse);
    expect(assistantToolUses).toHaveLength(1);
    expect(assistantToolUses[0].toolUse.toolUseId).toBe('tu-keep');

    const toolResults = (userToolResultMessage?.content || []).filter((part) => part.toolResult);
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].toolResult.toolUseId).toBe('tu-keep');
  });

  it('drops leading assistant-only history when building the recent agent window', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse('get_timeline_info', {}, 'tu-history-fix', 'Checking current state.'),
      )
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Resized the short plan to 30s. Timeline: 30s, 3 clips.'),
      );

    await runAgentLoop({
      userMessage: 'make whole video of 30 second as yt shorts',
      history: [
        { role: 'assistant', content: [{ text: 'Completed previous edit.' }] },
        { role: 'user', content: [{ text: 'previous user request' }] },
        { role: 'assistant', content: [{ text: 'previous assistant reply' }] },
      ],
      callbacks,
    });

    const firstCall = mockedConverse.mock.calls[0]?.[0] as { messages: Array<{ role: string }> };
    expect(firstCall.messages[0]?.role).toBe('user');
  });

  it('builds agent context from the selected tool subset instead of the full registry', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse('get_all_media_analysis', {}, 'tu-tools', 'Finding the best hook.'),
      )
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Built the short package. Timeline: 30s, 3 clips.'),
      );

    await runAgentLoop({
      userMessage: 'make a 30 second youtube short with proper script and editing',
      history: [],
      callbacks,
      normalizedIntent: {
        mode: 'modify',
        goals: ['platform_optimized_output', 'script_generation'],
        constraints: { target_duration: 30, platform: 'youtube_shorts' },
        operationHint: 'script_outline',
        confidence: 0.92,
      },
    });

    expect(mockedBuildSnapshot).toHaveBeenCalledTimes(1);
    const toolNames = mockedBuildSnapshot.mock.calls[0]?.[0] as string[];
    expect(toolNames.length).toBeLessThanOrEqual(12);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'get_timeline_info',
        'get_all_media_analysis',
        'generate_intro_script_from_timeline',
        'preview_caption_fit',
        'apply_script_as_captions',
      ]),
    );
    expect(toolNames).not.toContain('add_subtitle');

    const firstCall = mockedConverse.mock.calls[0]?.[0] as { toolConfig?: { tools?: any[] } };
    const bedrockToolNames =
      firstCall.toolConfig?.tools?.map((tool: any) => tool?.toolSpec?.name).filter(Boolean) || [];
    expect(bedrockToolNames.length).toBeLessThanOrEqual(12);
    expect(toolNames).toEqual(expect.arrayContaining(bedrockToolNames));
    expect(bedrockToolNames.length).toBeLessThan(toolNames.length);
    expect(toolNames).not.toContain('delete_clips');
    expect(bedrockToolNames).not.toContain('delete_clips');
  });

  it('blocks delete_clips during non-destructive shorts edits even if the model asks for it', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse(
          'delete_clips',
          { clip_ids: ['clip_1'] },
          'tu-no-delete',
          'Deleting the weakest clip to hit 30 seconds.',
        ),
      )
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Kept the footage and prepared the short safely. Timeline: 30s, 3 clips.'),
      );

    await runAgentLoop({
      userMessage: 'make a 30 second youtube short with proper script and editing',
      history: [],
      callbacks,
      normalizedIntent: {
        mode: 'modify',
        goals: ['platform_optimized_output', 'script_generation'],
        constraints: { target_duration: 30, platform: 'youtube_shorts' },
        operationHint: 'script_outline',
        confidence: 0.92,
      },
    });

    expect(mockedExecute).not.toHaveBeenCalled();
    expect(callbacks.steps[0]?.toolCall?.name).toBe('delete_clips');
    expect(callbacks.steps[0]?.result?.success).toBe(false);
    expect(callbacks.steps[0]?.result?.error).toContain('blocked unless the user explicitly asks');
  });

  it('starts complex agentic turns with a read-focused tool subset', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse('get_all_media_analysis', {}, 'tu-read-focus', 'Inspecting footage first.'),
      )
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Reviewed the footage and prepared the edit. Timeline: 16s, 3 clips.'),
      );

    await runAgentLoop({
      userMessage: 'make a youtube short with proper script and editing',
      history: [],
      callbacks,
      normalizedIntent: {
        mode: 'modify',
        goals: ['platform_optimized_output', 'script_generation'],
        constraints: { platform: 'youtube_shorts' },
        operationHint: 'script_outline',
        confidence: 0.9,
      },
    });

    const firstCall = mockedConverse.mock.calls[0]?.[0] as { toolConfig?: { tools?: any[] } };
    const firstToolNames =
      firstCall.toolConfig?.tools?.map((tool: any) => tool?.toolSpec?.name).filter(Boolean) || [];

    expect(firstToolNames).toContain('get_all_media_analysis');
    expect(firstToolNames).toContain('get_timeline_info');
    expect(firstToolNames).not.toContain('update_clip_bounds');
    expect(firstToolNames).not.toContain('move_clip');
  });

  it('drops one-shot script generation tools after that phase completes', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse('get_all_media_analysis', {}, 'tu-read', 'Checking source footage.'),
      )
      .mockResolvedValueOnce(
        bedrockToolResponse(
          'generate_intro_script_from_timeline',
          { target_duration: 16, objective: 'how i won hackathon' },
          'tu-script',
          'Generating the script beats now.',
        ),
      )
      .mockResolvedValueOnce(
        bedrockEndResponse(' Completed: Built the script package. Timeline: 16s, 3 clips.'),
      );

    await runAgentLoop({
      userMessage: 'make a youtube short with script for how i won the hackathon',
      history: [],
      callbacks,
      normalizedIntent: {
        mode: 'modify',
        goals: ['platform_optimized_output', 'script_generation'],
        constraints: { platform: 'youtube_shorts', target_duration: 16 },
        operationHint: 'script_outline',
        confidence: 0.95,
      },
    });

    const thirdCall = mockedConverse.mock.calls[2]?.[0] as { toolConfig?: { tools?: any[] } };
    const thirdToolNames =
      thirdCall.toolConfig?.tools?.map((tool: any) => tool?.toolSpec?.name).filter(Boolean) || [];

    expect(thirdToolNames).not.toContain('generate_intro_script_from_timeline');
    expect(thirdToolNames).toContain('preview_caption_fit');
    expect(thirdToolNames).toContain('apply_script_as_captions');
  });

  it('enforces cost budget limit', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    // Return high token responses to burn through a tiny budget
    mockedConverse.mockResolvedValue(
      bedrockToolResponse('get_timeline_info', {}, 'tu-x', 'Checking...', 50000, 20000),
    );

    const result = await runAgentLoop({
      userMessage: 'do something',
      history: [],
      config: { maxCostUsd: 0.001 }, // Very tight budget
      callbacks,
    });

    expect(result.success).toBe(false);
    expect(result.state.status).toBe('cost_limit');
    expect(result.state.error).toContain('Cost budget exceeded');
  });

  it('enforces step limit', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    // AI always calls tools, never completes
    mockedConverse.mockResolvedValue(
      bedrockToolResponse('get_timeline_info', {}, 'tu-infinite', 'Checking again...'),
    );

    const result = await runAgentLoop({
      userMessage: 'keep checking',
      history: [],
      config: { maxSteps: 3 },
      callbacks,
    });

    expect(result.success).toBe(false);
    expect(result.state.status).toBe('step_limit');
    expect(result.totalSteps).toBe(3);
  });

  it('detects doom loop (3 identical calls)', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    // AI keeps calling the exact same tool with exact same args
    mockedConverse.mockResolvedValue(
      bedrockToolResponse('get_timeline_info', {}, 'tu-doom', 'Still checking...'),
    );

    const result = await runAgentLoop({
      userMessage: 'something',
      history: [],
      config: {
        maxSteps: 10,
        enableDoomLoopDetection: true,
        doomLoopThreshold: 3,
      },
      callbacks,
    });

    expect(result.success).toBe(false);
    expect(result.state.status).toBe('failed');
    expect(result.state.error).toContain('Doom loop');
    // Should stop after 3 steps (detected doom + stopped before 4th)
    expect(result.totalSteps).toBeLessThanOrEqual(4);
  });

  it('handles tool execution failure gracefully', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    // Tool fails
    mockedExecute.mockResolvedValueOnce({
      result: {
        success: false,
        message: 'Clip not found',
        error: 'Clip uuid-1 does not exist on timeline',
      },
    } as any);

    mockedConverse
      // Step 1: AI tries to trim a clip
      .mockResolvedValueOnce(
        bedrockToolResponse(
          'update_clip_bounds',
          { clip_id: 'clip_1', new_end: 5 },
          'tu-1',
        ),
      )
      // Step 2: AI gets the error and gives up gracefully
      .mockResolvedValueOnce(
        bedrockEndResponse(' Could not trim clip_1 — clip not found on timeline.'),
      );

    const result = await runAgentLoop({
      userMessage: 'trim clip 1 to 5 seconds',
      history: [],
      callbacks,
    });

    // Loop completed (AI decided to stop), even though a tool failed
    expect(result.success).toBe(true);
    expect(result.totalSteps).toBe(2);
  });

  it('handles abort signal', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();
    const abortController = new AbortController();

    // Abort before the loop even starts
    abortController.abort();

    const result = await runAgentLoop({
      userMessage: 'make highlights',
      history: [],
      callbacks,
      abortSignal: abortController.signal,
    });

    expect(result.success).toBe(false);
    expect(result.state.status).toBe('cancelled');
    expect(result.totalSteps).toBe(0);
  });

  it('handles Bedrock API failure', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse.mockRejectedValueOnce(new Error('ThrottlingException: Rate exceeded'));

    const result = await runAgentLoop({
      userMessage: 'do something',
      history: [],
      callbacks,
    });

    expect(result.success).toBe(false);
    expect(result.state.status).toBe('failed');
    expect(result.state.error).toContain('ThrottlingException');
  });

  it('tracks cost across all steps', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(bedrockToolResponse('get_timeline_info', {}, 'tu-1', '', 300, 100))
      .mockResolvedValueOnce(bedrockEndResponse('Done!', 200, 80));

    const result = await runAgentLoop({
      userMessage: 'check timeline',
      history: [],
      callbacks,
    });

    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(result.state.totalInputTokens).toBe(500); // 300 + 200
    expect(result.state.totalOutputTokens).toBe(180); // 100 + 80
    expect(callbacks.onCostUpdate).toHaveBeenCalled();
  });

  it('resolves clip aliases before execution', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse(
          'update_clip_bounds',
          { clip_id: 'clip_1', new_end: 5 },
          'tu-1',
        ),
      )
      .mockResolvedValueOnce(bedrockEndResponse('Done trimming clip_1.'));

    await runAgentLoop({
      userMessage: 'trim clip 1',
      history: [],
      callbacks,
    });

    // The executor should receive the resolved UUID, not the alias
    expect(mockedExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'update_clip_bounds',
        args: expect.objectContaining({ clip_id: 'uuid-1' }),
      }),
      0,
      1,
    );
  });

  it('verifies after mutation tool calls', async () => {
    const { runAgentLoop } = await import('../../src/lib/agentLoop');
    const callbacks = createMockCallbacks();

    useProjectStore.setState({
      clips: [
        {
          id: 'uuid-1',
          path: '/tmp/clip.mp4',
          name: 'Proof Clip',
          duration: 5,
          sourceDuration: 5,
          start: 0,
          end: 5,
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
      subtitles: [],
      history: [],
      historyIndex: -1,
    } as any);

    mockedConverse
      .mockResolvedValueOnce(
        bedrockToolResponse('update_clip_bounds', { clip_id: 'clip_1', new_end: 5 }, 'tu-1'),
      )
      .mockResolvedValueOnce(bedrockEndResponse('Done!'));

    mockedExecute.mockResolvedValueOnce({
      result: { success: true, message: 'Clip trimmed' },
    } as any);

    const result = await runAgentLoop({
      userMessage: 'trim clip 1',
      history: [],
      config: { verifyAfterMutation: true },
      callbacks,
    });

    expect(result.success).toBe(true);
    expect(mockedExecute).toHaveBeenCalledTimes(1);

    const secondCall = mockedConverse.mock.calls[1]?.[0] as {
      messages: Array<{ role: string; content: any[] }>;
    };
    const userToolResultMessage = secondCall.messages[secondCall.messages.length - 1];
    const verificationPayload = userToolResultMessage?.content?.[0]?.toolResult?.content?.[0]?.json
      ?.verification;

    expect(verificationPayload?.verified).toBe(true);
    expect(verificationPayload?.snapshot?.clipCount).toBe(1);
    expect(verificationPayload?.snapshot?.gapCount).toBe(0);
  });
});
