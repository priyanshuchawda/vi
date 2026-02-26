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
  summarizeHistory,
} from './aiService';
import { allVideoEditingTools } from './videoEditingTools';
import type { FunctionCall } from './videoEditingTools';
import { useProjectStore } from '../stores/useProjectStore';
import { optimizeContextHistory } from './contextManager';
import { waitForSlot, withRetryOn429 } from './rateLimiter';
import { recordUsage } from './tokenTracker';
import {
  buildAIProjectSnapshot,
  formatSnapshotForPrompt,
} from './aiProjectSnapshot';
import {
  formatCapabilityMatrixForPrompt,
  isReadOnlyTool,
  type ToolErrorCategory,
} from './toolCapabilityMatrix';

const DEFAULT_MAX_ROUNDS = 3;
const ABSOLUTE_MAX_ROUNDS = 4;
const MAX_OPERATIONS_PER_PLAN = 20;
const MAX_DYNAMIC_CONTEXT_CHARS = 5000;
const PLANNING_MAX_TOKENS = 1024;
const SUMMARY_MAX_TOKENS = 768;

export interface PlanStep {
  order: number;
  round: number;
  operationName: string;
  description: string;
  preconditions: string[];
  expectedResult: string;
}

export interface PlanValidationIssue {
  category: ToolErrorCategory;
  operationIndex: number;
  toolName: string;
  message: string;
}

export interface PlanValidationReport {
  valid: boolean;
  corrections: string[];
  issues: PlanValidationIssue[];
}

export interface PlanUnderstanding {
  goal: string;
  constraints: string[];
}

export interface PlanExecutionPolicy {
  mode: 'strict_sequential' | 'hybrid';
  maxReadOnlyBatchSize: number;
  stopOnFailure: boolean;
}

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
  understanding: PlanUnderstanding;
  operations: PlannedOperation[];
  steps: PlanStep[];
  validation: PlanValidationReport;
  executionPolicy: PlanExecutionPolicy;
  totalRounds: number;
  estimatedDuration: number; // In seconds
  requiresApproval: boolean;
}

/**
 * STATIC System Instruction for Planning
 * Enforces strict UNDERSTAND → PLAN → EXECUTE behavior.
 */
const STATIC_PLANNING_INSTRUCTION = `<role>
You are a professional video editing assistant integrated into QuickCut.
Your output must be deterministic, tool-grounded, and safe.
</role>

<mandatory-workflow>
Follow this order on every planning request:
1) UNDERSTAND: infer user goal and hard constraints from the snapshot.
2) PLAN: produce atomic tool operations with explicit order.
3) EXECUTE PLAN DRAFT: call only supported tools to validate state and produce executable operations.

Never skip UNDERSTAND or PLAN.
</mandatory-workflow>

<planning-rules>
1. Start by grounding on the AI_PROJECT_SNAPSHOT.
2. Use only tools provided in toolConfig.
3. Read-only inspection tools are allowed during planning and do not require user approval.
4. State-changing operations must be precise and fully specified.
5. Prefer fewer rounds, but never trade off correctness.
6. Never invent tool names or pseudo-functions.
</planning-rules>

<safety-rules>
- If IDs/bounds are uncertain, call read-only tools first.
- Do not assume successful execution without tool result success=true.
- Keep operations valid for current timeline bounds.
</safety-rules>`;

/**
 * Generate a complete execution plan by letting the AI explore all needed operations.
 * Runs multiple rounds of tool calling to build a complete plan before execution.
 */
export async function generateCompletePlan(
  message: string,
  history: AIChatMessage[],
  maxRounds: number = DEFAULT_MAX_ROUNDS
): Promise<ExecutionPlan> {
  if (!isBedrockConfigured()) {
    throw new Error('AWS credentials not configured');
  }

  const operations: PlannedOperation[] = [];
  const seenOperations = new Set<string>();
  let currentRound = 0;
  const allowedRounds = Math.min(Math.max(1, maxRounds), ABSOLUTE_MAX_ROUNDS);

  // Optimize incoming history before planning loop
  let { history: optimizedStart, metrics: planMetrics } = optimizeContextHistory(history);
  if (planMetrics.summarizeNeeded) {
    optimizedStart = await summarizeHistory(optimizedStart);
  }

  // Bedrock: manual message accumulation (no chat session)
  const messages: AIChatMessage[] = [...optimizedStart];
  const toolSet = selectPlanningTools(message);
  const toolNames = toolSet
    .map((tool: any) => tool?.toolSpec?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
  const snapshot = buildAIProjectSnapshot(toolNames);
  const channelContext = truncateBlock(getChannelAnalysisContext(), 800);
  const snapshotContext = formatSnapshotForPrompt(snapshot, 'planning', 3400);
  const capabilityContext = formatCapabilityMatrixForPrompt(toolNames, 2400);
  const currentDate = new Date().toISOString().split('T')[0];

  let dynamicContext = `
[System Note: Planning Context - Date: ${currentDate}]
<ai-project-snapshot>
${snapshotContext}
</ai-project-snapshot>
<tool-capability-matrix>
${capabilityContext}
</tool-capability-matrix>
${channelContext}
<instruction>
Use UNDERSTAND -> PLAN -> EXECUTE PLAN DRAFT.
You may call read-only tools during planning to inspect timeline/media state.
State-changing operations must remain executable with valid IDs and bounds.
</instruction>
`;
  if (dynamicContext.length > MAX_DYNAMIC_CONTEXT_CHARS) {
    dynamicContext = `${dynamicContext.slice(0, MAX_DYNAMIC_CONTEXT_CHARS)}\n[Planning context truncated for token efficiency]`;
  }

  const planningIssues: PlanValidationIssue[] = [];

  // Planning loop - explore all needed operations
  while (currentRound < allowedRounds && operations.length < MAX_OPERATIONS_PER_PLAN) {
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
        toolConfig: { tools: toolSet as any },
        inferenceConfig: { maxTokens: PLANNING_MAX_TOKENS, temperature: 0.2 },
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
        for (const [index, toolUse] of toolUses.entries()) {
          if (!isKnownTool(toolUse.name)) {
            planningIssues.push({
              category: 'tool_missing',
              operationIndex: operations.length + index,
              toolName: toolUse.name,
              message: `Unsupported tool requested during planning: ${toolUse.name}`,
            });
            continue;
          }
          const fingerprint = `${toolUse.name}:${JSON.stringify(toolUse.input ?? {})}`;
          if (seenOperations.has(fingerprint)) continue;
          if (operations.length >= MAX_OPERATIONS_PER_PLAN) break;
          seenOperations.add(fingerprint);

          const functionCall = {
            name: toolUse.name,
            args: toolUse.input,
          };
          const operation: PlannedOperation = {
            round: currentRound,
            functionCall,
            description: generateOperationDescription(functionCall),
            isReadOnly: isReadOnlyTool(toolUse.name),
          };
          operations.push(operation);
        }

        if (operations.length >= MAX_OPERATIONS_PER_PLAN) {
          break;
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

        trimPlanningMessages(messages);
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

  const { ToolExecutor } = await import('./toolExecutor');
  const preflight = ToolExecutor.preflightPlan(
    operations.map((op) => op.functionCall as FunctionCall),
  );
  const normalizedOperations = operations.map((operation, index) => ({
    ...operation,
    functionCall: preflight.normalizedCalls[index] || operation.functionCall,
  }));
  const validationIssues: PlanValidationIssue[] = [
    ...planningIssues,
    ...preflight.issues.map((issue) => ({
      category: issue.errorType,
      operationIndex: issue.index,
      toolName: issue.name,
      message: issue.message,
    })),
  ];
  const validation: PlanValidationReport = {
    valid: validationIssues.length === 0 && preflight.valid,
    corrections: preflight.corrections,
    issues: validationIssues,
  };

  const understanding = buildUnderstanding(message, snapshot);
  const steps = buildPlanSteps(normalizedOperations);
  const executionPolicy = pickExecutionPolicy(normalizedOperations);

  // Determine if approval is needed (any state-changing operations)
  const requiresApproval = normalizedOperations.some((op) => !op.isReadOnly);

  return {
    understanding,
    operations: normalizedOperations,
    steps,
    validation,
    executionPolicy,
    totalRounds: currentRound,
    estimatedDuration: normalizedOperations.length * 0.5, // Rough estimate
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
  const runtimePreflight = ToolExecutor.preflightPlan(
    plan.operations.map((operation) => operation.functionCall as FunctionCall),
  );
  if (!runtimePreflight.valid) {
    const details = runtimePreflight.issues
      .map(
        (issue) =>
          `${issue.name} [${issue.errorType}]: ${issue.message}${
            issue.recoveryHint ? ` | Next: ${issue.recoveryHint}` : ''
          }`,
      )
      .join('\n');
    throw new Error(`Plan validation failed before execution:\n${details}`);
  }
  const executableOperations = plan.operations.map((operation, index) => ({
    ...operation,
    functionCall: runtimePreflight.normalizedCalls[index] || operation.functionCall,
  }));
  const executionPolicy: PlanExecutionPolicy = {
    mode: plan.executionPolicy?.mode || 'strict_sequential',
    maxReadOnlyBatchSize: Math.max(
      1,
      Math.min(3, plan.executionPolicy?.maxReadOnlyBatchSize || 3),
    ),
    stopOnFailure: plan.executionPolicy?.stopOnFailure ?? true,
  };

  // Add original user message
  messages.push({
    role: 'user',
    content: [{ text: originalMessage }],
  });

  let currentRound = 1;
  const operationsByRound = groupOperationsByRound(executableOperations);
  let completedOperations = 0;

  // Execute operations round by round
  for (const [_round, roundOperations] of operationsByRound.entries()) {
    const functionCalls = roundOperations.map(op => op.functionCall);

    // Default: strict sequential with output check after each operation.
    // Optional: hybrid mode allows read-only micro-batching (max 3) when safe.
    const results = await ToolExecutor.executeWithPolicy(
      functionCalls as FunctionCall[],
      {
        mode: executionPolicy.mode,
        maxReadOnlyBatchSize: executionPolicy.maxReadOnlyBatchSize,
        stopOnFailure: executionPolicy.stopOnFailure,
      },
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
      const errorMessages = failedOps
        .map(
          (op) =>
            `${op.name} [${op.result.errorType || 'execution_error'}]: ${
              op.result.error || 'Unknown error'
            }${op.result.recoveryHint ? ` | Next: ${op.result.recoveryHint}` : ''}`,
        )
        .join('\n');
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
  const compactSnapshot = formatSnapshotForPrompt(
    buildAIProjectSnapshot(),
    'planning',
    2000,
  );

  const executedOperations = executableOperations
    .map((op) => `- ${op.description}`)
    .join('\n');

  const summaryPrompt = `All requested editing operations have been completed.

Executed operations:
${executedOperations}

Current project snapshot:
${compactSnapshot}

Planning validation corrections:
${plan.validation?.corrections?.length ? plan.validation.corrections.map((c) => `- ${c}`).join('\n') : '- none'}

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
      // Bedrock requires toolConfig when messages include toolUse/toolResult blocks.
      toolConfig: { tools: allVideoEditingTools as any },
      inferenceConfig: { maxTokens: SUMMARY_MAX_TOKENS, temperature: 0.2 },
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

function trimPlanningMessages(messages: AIChatMessage[]): void {
  const MAX_MESSAGES = 12;
  if (messages.length <= MAX_MESSAGES) return;

  const head = messages.slice(0, 2);
  const tail = messages.slice(-8);
  messages.splice(0, messages.length, ...head, ...tail);
}

function truncateBlock(value: string, maxChars: number = 1800): string {
  if (!value) return '';
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[Context block truncated]`;
}

function isKnownTool(name: string): boolean {
  return allVideoEditingTools.some((tool: any) => tool?.toolSpec?.name === name);
}

function selectPlanningTools(message: string) {
  const text = message.toLowerCase();
  const base = new Set<string>([
    'get_timeline_info',
    'get_clip_details',
    'split_clip',
    'delete_clips',
    'move_clip',
    'merge_clips',
    'update_clip_bounds',
    'select_clips',
    'undo_action',
    'redo_action',
  ]);

  if (/\b(volume|mute|audio|sound|quiet|loud)\b/.test(text)) {
    base.add('set_clip_volume');
    base.add('toggle_clip_mute');
  }

  if (/\b(copy|duplicate|paste)\b/.test(text)) {
    base.add('copy_clips');
    base.add('paste_clips');
  }

  if (/\b(subtitle|caption)\b/.test(text)) {
    base.add('add_subtitle');
    base.add('update_subtitle');
    base.add('delete_subtitle');
    base.add('update_subtitle_style');
    base.add('get_subtitles');
    base.add('clear_all_subtitles');
  }

  if (/\b(transcribe|transcription|transcript)\b/.test(text)) {
    base.add('transcribe_clip');
    base.add('transcribe_timeline');
    base.add('get_transcription');
    base.add('apply_transcript_edits');
  }

  if (/\b(effect|filter|speed|highlight|chapter)\b/.test(text)) {
    base.add('set_clip_speed');
    base.add('apply_clip_effect');
    base.add('find_highlights');
    base.add('generate_chapters');
  }

  if (/\b(save|export|project)\b/.test(text)) {
    base.add('save_project');
    base.add('set_export_settings');
    base.add('get_project_info');
  }

  if (/\b(search|analy|memory|scene)\b/.test(text)) {
    base.add('search_clips_by_content');
    base.add('get_clip_analysis');
    base.add('get_all_media_analysis');
  }

  return allVideoEditingTools.filter((tool: any) =>
    base.has(tool?.toolSpec?.name),
  );
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

function buildUnderstanding(
  message: string,
  snapshot: ReturnType<typeof buildAIProjectSnapshot>,
): PlanUnderstanding {
  return {
    goal: message.trim(),
    constraints: [
      `Timeline duration: ${snapshot.timeline.totalDuration.toFixed(1)}s`,
      `Clip count: ${snapshot.timeline.clipCount}`,
      `Read-only tools do not require approval`,
      `Mutating operations require approval before execution`,
      `Execution default: strict sequential with post-step verification`,
    ],
  };
}

function buildPlanSteps(operations: PlannedOperation[]): PlanStep[] {
  return operations.map((operation, index) => ({
    order: index + 1,
    round: operation.round,
    operationName: operation.functionCall.name,
    description: operation.description,
    preconditions: buildPreconditions(operation.functionCall),
    expectedResult: buildExpectedResult(operation.functionCall),
  }));
}

function buildPreconditions(functionCall: FunctionCall): string[] {
  const shared = ['Tool is supported', 'All required args are present'];

  switch (functionCall.name) {
    case 'split_clip':
      return [...shared, 'Clip exists', 'time_in_clip is within clip bounds'];
    case 'delete_clips':
      return [...shared, 'All clip_ids exist on timeline'];
    case 'move_clip':
      return [...shared, 'clip_id exists', 'start_time >= 0'];
    case 'update_clip_bounds':
      return [
        ...shared,
        'clip_id exists',
        'new_start/new_end respect sourceDuration',
        'Resulting duration remains positive',
      ];
    case 'set_clip_volume':
      return [...shared, 'volume is between 0.0 and 1.0'];
    case 'set_clip_speed':
      return [...shared, 'speed is between 0.25 and 8.0'];
    case 'set_playhead_position':
      return [...shared, 'time is within timeline duration'];
    default:
      return shared;
  }
}

function buildExpectedResult(functionCall: FunctionCall): string {
  switch (functionCall.name) {
    case 'get_timeline_info':
      return 'Latest timeline snapshot is returned';
    case 'get_clip_details':
      return 'Clip metadata is returned for the requested clip';
    case 'split_clip':
      return 'Clip is split into two valid clips at target time';
    case 'delete_clips':
      return 'Target clips are removed from timeline';
    case 'move_clip':
      return 'Clip position is updated on timeline';
    case 'update_clip_bounds':
      return 'Clip source bounds are updated within valid media range';
    default:
      return `Tool ${functionCall.name} succeeds with success=true`;
  }
}

function pickExecutionPolicy(operations: PlannedOperation[]): PlanExecutionPolicy {
  const readOnlyOps = operations.filter((operation) => operation.isReadOnly).length;
  const mutatingOps = operations.length - readOnlyOps;

  if (readOnlyOps >= 2 && mutatingOps === 0) {
    return {
      mode: 'hybrid',
      maxReadOnlyBatchSize: 3,
      stopOnFailure: true,
    };
  }

  return {
    mode: 'strict_sequential',
    maxReadOnlyBatchSize: 3,
    stopOnFailure: true,
  };
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
