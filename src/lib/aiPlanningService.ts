/**
 * AI Planning Service — AWS Bedrock (Amazon Nova Lite v1)
 *
 * Multi-round tool-calling planning service for QuickCut.
 * Lets the AI explore all needed operations before execution.
 *
 * Uses ConverseCommand with manual message array accumulation
 * (Bedrock has no chat session — each call passes the full history).
 */

import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, MODEL_ID, isBedrockConfigured } from './bedrockClient';
import type { AIChatMessage } from './aiService';
import {
  getChannelAnalysisContext,
  getTimelineStateContext,
  summarizeHistory,
} from './aiService';
import { allVideoEditingTools } from './videoEditingTools';
import { getMemoryForChat } from './aiMemoryService';
import { useProjectStore } from '../stores/useProjectStore';
import { optimizeContextHistory } from './contextManager';
import { waitForSlot, withRetryOn429 } from './rateLimiter';
import { recordUsage } from './tokenTracker';

export interface PlannedOperation {
  round: number; // Which round of tool calling this belongs to
  functionCall: {
    name: string;
    args: any;
  };
  description: string; // Human-readable description
  isReadOnly: boolean; // Whether this operation modifies state
}

export interface ExecutionPlan {
  operations: PlannedOperation[];
  totalRounds: number;
  estimatedDuration: number; // In seconds
  requiresApproval: boolean;
}

/**
 * STATIC System Instruction for Planning
 * Optimized for batching and aggressive completion.
 */
const STATIC_PLANNING_INSTRUCTION = `<role>
You are a professional video editing assistant integrated into QuickCut.
You are precise, thorough, and focused on COMPLETING video editing tasks fully.
</role>

<critical-planning-rules>
⚠️ IMPORTANT: You are in PLANNING mode. You must discover ALL operations needed to FULLY complete the user's request.

1. UNDERSTAND THE COMPLETE GOAL
   - What is the user's final desired outcome?
   - What does "done" look like?
   - Don't just do the first step - complete the ENTIRE task

2. ALWAYS START WITH get_timeline_info
   - Before doing anything, check what clips exist
   - Understand the current state before planning changes

3. BATCH YOUR OPERATIONS (CRITICAL)
   - Do NOT ask for permission for each individual step.
   - Return MULTIPLE tool calls in a single response whenever possible.
   - Example: If you need to split and then delete, return BOTH function calls in the same turn.
   - Minimize the number of rounds.

4. THINK STEP-BY-STEP
   - Break complex tasks into logical steps
   - Execute ALL steps needed to reach the goal
   - Continue until the task is 100% complete

5. BE SPECIFIC WITH NUMBERS
   - If user says "15 seconds", make it exactly 15 seconds
   - If user says "split into 2 parts", create exactly 2 parts
   - Don't approximate - be precise
</critical-planning-rules>

<detailed-examples>
Example 1: "Make the project 20 seconds total, split into 10 second clips"
Step-by-step thinking:
1. First, I need to see current clips → get_timeline_info
2. User wants 20 seconds total → I'll need to trim or extend clips to reach 20s
3. User wants 10 second clips → I'll need to split at 10 second mark
4. Execute: get_timeline_info → update_clip_bounds (to 20s total) → split_clip (at 10s)

Example 2: "Prepare this for YouTube Shorts"
Step-by-step thinking:
1. YouTube Shorts need: max 60 seconds, 9:16 aspect ratio, captions
2. First check current state → get_timeline_info
3. Trim to max 60s → update_clip_bounds
4. Change to vertical → set_aspect_ratio (9:16)
5. Add captions → generate_captions
6. All requirements met → task complete
</detailed-examples>

<constraints>
- ALWAYS complete the full task, never stop halfway
- Be mathematically precise with durations and splits
- Verify your operations will achieve the user's exact goal
</constraints>

<available-tools>
Information: get_timeline_info, get_clip_details
Editing: split_clip, delete_clips, move_clip, merge_clips
Audio: set_clip_volume, toggle_clip_mute
Management: select_clips, copy_clips, paste_clips
History: undo_action, redo_action
Playback: set_playhead_position
Trimming: update_clip_bounds
</available-tools>`;

/**
 * Generate a complete execution plan by letting the AI explore all needed operations.
 * Runs multiple rounds of tool calling to build a complete plan before execution.
 */
export async function generateCompletePlan(
  message: string,
  history: AIChatMessage[],
  maxRounds: number = 5
): Promise<ExecutionPlan> {
  if (!isBedrockConfigured()) {
    throw new Error('AWS credentials not configured');
  }

  const operations: PlannedOperation[] = [];
  let currentRound = 0;

  // Optimize incoming history before planning loop
  let { history: optimizedStart, metrics: planMetrics } = optimizeContextHistory(history);
  if (planMetrics.summarizeNeeded) {
    optimizedStart = await summarizeHistory(optimizedStart);
  }

  // Bedrock: manual message accumulation (no chat session)
  const messages: AIChatMessage[] = [...optimizedStart];

  // Build dynamic context
  const channelContext = getChannelAnalysisContext();
  const memoryContext = getMemoryForChat();
  const timelineContext = getTimelineStateContext();
  const currentDate = new Date().toISOString().split('T')[0];

  const dynamicContext = `
[System Note: Planning Context - Date: ${currentDate}]
${channelContext}
${memoryContext}
${timelineContext}
<instruction>
Focus on the user's latest request. Use the tools to check state and execute changes.
Batch multiple operations in one round if possible.
</instruction>
`;

  // Planning loop - explore all needed operations
  while (currentRound < maxRounds) {
    currentRound++;

    // Inject dynamic context into the first message of the loop
    const messageContent = (currentRound === 1)
      ? `${dynamicContext}\n\nTask: ${message}`
      : 'Proceed with next steps or stop if done.';

    // Add user message to messages array
    messages.push({
      role: 'user',
      content: [{ text: messageContent }],
    });

    // Wait for rate-limit slot before each planning round API call
    await waitForSlot();

    const response = await withRetryOn429(() =>
      bedrockClient.send(new ConverseCommand({
        modelId: MODEL_ID,
        messages: messages as any,
        system: [{ text: STATIC_PLANNING_INSTRUCTION }],
        toolConfig: { tools: allVideoEditingTools as any },
        inferenceConfig: { maxTokens: 2048, temperature: 0.7 },
      }))
    );

    // Record token usage from planning calls
    if (response.usage) {
      recordUsage({
        promptTokenCount: response.usage.inputTokens,
        candidatesTokenCount: response.usage.outputTokens,
        totalTokenCount: response.usage.totalTokens,
      });
    }

    // Check if model wants to call tools
    if (response.stopReason === 'tool_use') {
      const toolUses = (response.output?.message?.content || [])
        .filter((c: any) => c.toolUse)
        .map((c: any) => c.toolUse);

      if (toolUses.length > 0) {
        // Collect all tool calls from this round
        for (const toolUse of toolUses) {
          const functionCall = {
            name: toolUse.name,
            args: toolUse.input,
          };
          const operation: PlannedOperation = {
            round: currentRound,
            functionCall,
            description: generateOperationDescription(functionCall),
            isReadOnly: isReadOnlyOperation(toolUse.name),
          };
          operations.push(operation);
        }

        // Add assistant's response to conversation
        messages.push({
          role: 'assistant',
          content: response.output!.message!.content!,
        } as any);

        // Simulate execution to get results for next round
        const simulatedResults = simulateFunctionExecution(toolUses);

        // Add tool results as a single user message with toolResult blocks
        const toolResultContent = toolUses.map((tu: any, i: number) => ({
          toolResult: {
            toolUseId: tu.toolUseId,
            content: [{ json: simulatedResults[i] }],
          },
        }));

        messages.push({
          role: 'user',
          content: toolResultContent,
        } as any);
      } else {
        break; // No tool uses despite stop reason — planning complete
      }
    } else {
      // stopReason is "end_turn" or "max_tokens" — planning is complete
      // Add assistant's final response to history
      if (response.output?.message) {
        messages.push({
          role: 'assistant',
          content: response.output.message.content,
        } as any);
      }
      break;
    }
  }

  // Determine if approval is needed (any state-changing operations)
  const requiresApproval = operations.some(op => !op.isReadOnly);

  return {
    operations,
    totalRounds: currentRound,
    estimatedDuration: operations.length * 0.5, // Rough estimate
    requiresApproval,
  };
}

/**
 * Execute a complete plan
 */
export async function executePlan(
  plan: ExecutionPlan,
  originalHistory: AIChatMessage[],
  originalMessage: string,
  onProgress?: (current: number, total: number, operation: PlannedOperation) => void
): Promise<string> {
  if (!isBedrockConfigured()) {
    throw new Error('AWS credentials not configured');
  }

  const { ToolExecutor } = await import('./toolExecutor');
  const messages: AIChatMessage[] = [...originalHistory];

  // Add original user message
  messages.push({
    role: 'user',
    content: [{ text: originalMessage }],
  });

  let currentRound = 1;
  const operationsByRound = groupOperationsByRound(plan.operations);
  let completedOperations = 0;

  // Execute operations round by round
  for (const [_round, roundOperations] of operationsByRound.entries()) {
    const functionCalls = roundOperations.map(op => op.functionCall);

    // Execute each operation sequentially and track progress
    const results = await ToolExecutor.executeAll(
      functionCalls as any,
      (index, _total, _result) => {
        const operationIndex = index - 1;
        if (operationIndex >= 0 && operationIndex < roundOperations.length) {
          const currentOperation = roundOperations[operationIndex];
          completedOperations++;
          onProgress?.(completedOperations, plan.operations.length, currentOperation);
        }
      }
    );

    // Check for any failed operations
    const failedOps = results.filter(r => !r.result.success);
    if (failedOps.length > 0) {
      const errorMessages = failedOps.map(op => `${op.name}: ${op.result.error || 'Unknown error'}`).join('\n');
      throw new Error(`Some operations failed:\n${errorMessages}`);
    }

    // Build assistant message with toolUse blocks (Bedrock format)
    const assistantContent = functionCalls.map((fc, i) => ({
      toolUse: {
        toolUseId: `plan-tool-${currentRound}-${i}`,
        name: fc.name,
        input: fc.args,
      },
    }));
    messages.push({
      role: 'assistant',
      content: assistantContent,
    } as any);

    // Add tool results as toolResult blocks in a user message
    const toolResultContent = results.map((r, i) => ({
      toolResult: {
        toolUseId: `plan-tool-${currentRound}-${i}`,
        content: [{ json: r.result }],
      },
    }));
    messages.push({
      role: 'user',
      content: toolResultContent,
    } as any);

    currentRound++;
  }

  // Get final summary response with compact context to avoid large reinjection costs
  const timelineContext = getTimelineStateContext();
  const compactTimelineContext = timelineContext.length > 2000
    ? `${timelineContext.slice(0, 2000)}\n[Timeline context truncated for token efficiency]`
    : timelineContext;

  const executedOperations = plan.operations
    .map((op) => `- ${op.description}`)
    .join('\n');

  const summaryPrompt = `All requested editing operations have been completed.

Executed operations:
${executedOperations}

Current timeline snapshot:
${compactTimelineContext}

Provide a friendly, concise summary of what was done. Do NOT call any more tools.`;

  // Add summary request
  messages.push({
    role: 'user',
    content: [{ text: summaryPrompt }],
  });

  // Rate-limit the final summary call
  await waitForSlot();

  const summaryResponse = await withRetryOn429(() =>
    bedrockClient.send(new ConverseCommand({
      modelId: MODEL_ID,
      messages: messages as any,
      system: [{ text: STATIC_PLANNING_INSTRUCTION }],
      inferenceConfig: { maxTokens: 2048, temperature: 0.7 },
    }))
  );

  // Record token usage from summary call
  if (summaryResponse.usage) {
    recordUsage({
      promptTokenCount: summaryResponse.usage.inputTokens,
      candidatesTokenCount: summaryResponse.usage.outputTokens,
      totalTokenCount: summaryResponse.usage.totalTokens,
    });
  }

  return summaryResponse.output?.message?.content?.[0]?.text || 'Operations completed successfully.';
}

/**
 * Simulate function execution to get mock results for planning.
 * Returns realistic mock data so the model can plan subsequent operations.
 */
function simulateFunctionExecution(toolUses: any[]): any[] {
  const state = useProjectStore.getState();

  return toolUses.map(tu => {
    const name = tu.name;
    const args = tu.input;

    // For read-only functions, return actual current state
    if (name === 'get_timeline_info') {
      const totalDuration = state.getTotalDuration();
      const clipCount = state.clips.length;
      return {
        success: true,
        data: {
          totalDuration,
          clipCount,
          clips: state.clips.map((clip: any) => ({
            id: clip.id,
            name: clip.name,
            startTime: clip.startTime,
            duration: clip.duration,
            endTime: clip.startTime + clip.duration,
          })),
        },
      };
    } else if (name === 'get_clip_details') {
      const clip = state.clips.find((c: any) => c.id === args.clip_id);
      if (clip) {
        return {
          success: true,
          data: {
            id: clip.id,
            name: clip.name,
            duration: clip.duration,
            startTime: clip.startTime,
            volume: clip.volume || 1,
            muted: clip.muted || false,
          },
        };
      }
      return { success: false, error: 'Clip not found' };
    } else {
      // For state-changing functions, return optimistic success
      return {
        success: true,
        message: `Successfully executed ${name.replace(/_/g, ' ')}`,
        details: args,
      };
    }
  });
}

/**
 * Check if an operation is read-only (doesn't modify state)
 */
function isReadOnlyOperation(functionName: string): boolean {
  const readOnlyFunctions = [
    'get_timeline_info',
    'get_clip_details',
    'get_subtitles',
    'get_transcription',
    'get_project_info',
    'get_clip_analysis',
    'get_all_media_analysis',
    'search_clips_by_content',
  ];
  return readOnlyFunctions.includes(functionName);
}

/**
 * Generate human-readable description for an operation
 */
function generateOperationDescription(functionCall: any): string {
  const state = useProjectStore.getState();

  switch (functionCall.name) {
    case 'split_clip': {
      const clip = state.clips.find(c => c.id === functionCall.args.clip_id);
      return `Split "${clip?.name || 'clip'}" at ${functionCall.args.time_in_clip}s`;
    }
    case 'set_clip_volume': {
      const clipCount = functionCall.args.clip_ids.includes('all')
        ? state.clips.length
        : functionCall.args.clip_ids.length;
      const volumePct = Math.round(functionCall.args.volume * 100);
      return `Set volume to ${volumePct}% for ${clipCount} clip(s)`;
    }
    case 'delete_clips': {
      const clipNames = functionCall.args.clip_ids
        .map((id: string) => state.clips.find(c => c.id === id)?.name || id)
        .join(', ');
      return `Delete: ${clipNames}`;
    }
    case 'move_clip': {
      const clip = state.clips.find(c => c.id === functionCall.args.clip_id);
      return `Move "${clip?.name || 'clip'}" to ${functionCall.args.start_time}s`;
    }
    case 'merge_clips': {
      return `Merge ${functionCall.args.clip_ids.length} clips`;
    }
    case 'get_timeline_info': {
      return `Check timeline state`;
    }
    case 'get_clip_details': {
      const clip = state.clips.find(c => c.id === functionCall.args.clip_id);
      return `Get details for "${clip?.name || 'clip'}"`;
    }
    default:
      return `Execute ${functionCall.name.replace(/_/g, ' ')}`;
  }
}

/**
 * Group operations by their round number
 */
function groupOperationsByRound(operations: PlannedOperation[]): Map<number, PlannedOperation[]> {
  const grouped = new Map<number, PlannedOperation[]>();

  for (const operation of operations) {
    if (!grouped.has(operation.round)) {
      grouped.set(operation.round, []);
    }
    grouped.get(operation.round)!.push(operation);
  }

  return grouped;
}
