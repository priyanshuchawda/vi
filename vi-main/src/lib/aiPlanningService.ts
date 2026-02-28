/**
 * AI Planning Service — AWS Bedrock (Amazon Nova Lite v1)
 *
 * Multi-round tool-calling planning service for QuickCut.
 * Lets the AI explore all needed operations before execution.
 *
 * Uses ConverseCommand with manual message array accumulation
 * (Bedrock has no chat session — each call passes the full history).
 */

import {
  converseBedrock,
  isBedrockConfigured,
} from './bedrockGateway';
import type { AIChatMessage } from './aiService';
import {
  getChannelAnalysisContext,
  summarizeHistory,
} from './aiService';
import { allVideoEditingTools } from './videoEditingTools';
import type { FunctionCall, ToolResult } from './videoEditingTools';
import { useProjectStore } from '../stores/useProjectStore';
import { optimizeContextHistory } from './contextManager';
import { waitForSlot, withRetryOn429 } from './rateLimiter';
import { getSessionEstimatedCost, recordUsage } from './tokenTracker';
import { estimateTurnCost, evaluateBudgetPolicy, trimHistoryToLimit } from './costPolicy';
import { evaluateTokenGuard } from './bedrockTokenEstimator';
import { maskToolOutputsInHistory } from './toolOutputMaskingService';
import { routeBedrockModel } from './modelRoutingPolicy';
import {
  buildSemanticCacheKey,
  getCached,
  hashString,
  setCached,
} from './requestCache';
import {
  buildAliasedSnapshotForPlanning,
  buildAIProjectSnapshot,
  formatSnapshotForPrompt,
  type AIProjectSnapshot,
} from './aiProjectSnapshot';
import { resolveAlias, resolveUuid, validateAliasReferences, type AliasMap } from './clipAliasMapper';
import {
  formatCapabilityMatrixForPrompt,
  isReadOnlyTool,
  type ToolErrorCategory,
} from './toolCapabilityMatrix';
import { compilePlan, generateCorrectionPrompt, validatePlannerOutputContract, type CompilationError } from './planCompiler';
import { buildFallbackExecutionPlan, shouldUseFallback } from './fallbackPlanGenerator';
import { recordPlanningAttempt, recordExecutionAttempt } from './aiTelemetry';

const DEFAULT_MAX_ROUNDS = 2;
const ABSOLUTE_MAX_ROUNDS = 3;
const MAX_OPERATIONS_PER_PLAN = 20;
const MAX_DYNAMIC_CONTEXT_CHARS = 5000;
const PLANNING_MAX_TOKENS = 900;    // lowered from 1024 — plans need tool calls, not prose
const MIN_PLAN_QUALITY_SCORE = 0.55;
const PLAN_CACHE_TTL_MS = 90 * 1000;
const TOKEN_GUARD_SOFT_LIMIT = 160_000;
const TOKEN_GUARD_HARD_LIMIT = 220_000;
const RECOVERABLE_COMPILATION_CATEGORIES = new Set<CompilationError['category']>([
  'invalid_alias',
  'invalid_bounds',
  'invalid_args',
]);

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
  planReady: boolean;
  planReadyReason: string;
  riskNotes: string[];
  confidenceScore?: number;
  changeSummary?: string[];
  rollbackNote?: string;
}

export interface TurnAuditPayload {
  preSnapshotHash: string;
  postSnapshotHash: string;
  diffSummary: string[];
  toolInputs: Array<{ name: string; args: Record<string, any> }>;
  toolResults: Array<{ name: string; success: boolean; message?: string; error?: string }>;
  failures: string[];
}

export function shouldEscalatePlanningRounds(input: {
  currentRound: number;
  allowedRounds: number;
  operationsAddedThisRound: number;
  toolCallsInRound: number;
  maxAllowedRounds?: number;
}): boolean {
  const hardCap = input.maxAllowedRounds ?? ABSOLUTE_MAX_ROUNDS;
  if (input.allowedRounds >= hardCap) return false;
  if (input.currentRound < input.allowedRounds) return false;
  if (input.toolCallsInRound <= 0) return false;
  return input.operationsAddedThisRound > 0;
}

export function shouldRetryCompilation(errors: CompilationError[]): boolean {
  if (errors.length === 0) return false;
  return errors.every((error) => RECOVERABLE_COMPILATION_CATEGORIES.has(error.category));
}

/**
 * STATIC System Instruction for Planning
 * Enforces strict UNDERSTAND → PLAN → EXECUTE behavior with alias-based clip references.
 */
const STATIC_PLANNING_INSTRUCTION = `<role>
You are an expert video editor AI built into QuickCut. You think carefully, reason from the actual project state, and take precise actions with tools.
</role>

<how-you-work>
When given a task:
1. UNDERSTAND — Restate what the user wants in one sentence. Call out any assumptions.
2. INSPECT — If clip IDs or timeline state are uncertain, call get_timeline_info or get_clip_details FIRST.
3. PLAN — List the exact tool calls needed, in order, with the right arguments.
4. EXECUTE — Call the tools. Use ONLY the clip aliases from the snapshot (clip_1, clip_2, ...). Never invent IDs.
</how-you-work>

<clip-rules>
- Clips are referenced by alias: clip_1, clip_2, etc. (from the snapshot — do NOT invent IDs)
- If you are unsure which clip the user means, call get_timeline_info before anything else
- Never use raw hex UUIDs — always use the provided aliases
</clip-rules>

<timestamp-rules>
- split_clip: time_in_clip must be BETWEEN 0 and clip duration (exclusive)
- update_clip_bounds: new_start/new_end must be within 0 → sourceDuration
- set_playhead_position: time must be 0 → totalDuration
- move_clip: start_time must be ≥ 0
</timestamp-rules>

<safety>
- When IDs or bounds are uncertain → inspect first, then act
- Never fabricate clip names, IDs, or timeline state
- If the timeline is empty, say so clearly instead of guessing
- Prefer fewer operations — do exactly what was asked, nothing more
</safety>

<quality>
- Each tool call must have complete, valid arguments
- Read-only inspection (get_timeline_info, get_clip_details) is fine during planning
- Aim to complete in 1-2 rounds — avoid unnecessary round-trips
- Never return zero operations unless the timeline is truly empty
</quality>`;

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
  let allowedRounds = Math.min(Math.max(1, maxRounds), ABSOLUTE_MAX_ROUNDS);

  // Optimize incoming history before planning loop
  const { history: initialOptimizedStart, metrics: planMetrics } = optimizeContextHistory(history);
  let optimizedStart = initialOptimizedStart;
  if (planMetrics.summarizeNeeded) {
    optimizedStart = await summarizeHistory(optimizedStart);
  }
  optimizedStart = maskToolOutputsInHistory(optimizedStart).history;

  const standardToolSet = selectPlanningTools(message, 'standard');
  const standardToolNames = standardToolSet
    .map((tool: any) => tool?.toolSpec?.name)
    .filter((name: string | undefined): name is string => Boolean(name));

  const costPreflight = estimateTurnCost({
    intent: 'edit_plan',
    history: optimizedStart,
    dynamicContextChars: 5000,
    userMessageChars: message.length,
    toolCount: standardToolNames.length,
    maxOutputTokens: PLANNING_MAX_TOKENS,
  });
  const budgetDecision = evaluateBudgetPolicy({
    estimatedTurnCostUsd: costPreflight.estimatedTotalCost,
    currentSessionCostUsd: getSessionEstimatedCost(),
    intent: 'edit_plan',
  });
  if (budgetDecision.shouldBlock) {
    throw new Error('Cost policy blocked plan generation. Reduce scope or adjust budget settings.');
  }
  if (costPreflight.degraded || budgetDecision.shouldDegrade) {
    const maxHistoryMessages = budgetDecision.shouldDegrade
      ? Math.min(costPreflight.maxHistoryMessages, 6)
      : costPreflight.maxHistoryMessages;
    optimizedStart = trimHistoryToLimit(optimizedStart, maxHistoryMessages);
    allowedRounds = Math.max(1, allowedRounds - 1);
  }

  // Bedrock: manual message accumulation (no chat session)
  const messages: AIChatMessage[] = [...optimizedStart];
  const toolSet = costPreflight.economyTools
    ? selectPlanningTools(message, 'economy')
    : standardToolSet;
  const toolNames = toolSet
    .map((tool: any) => tool?.toolSpec?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
  const routingDecision = routeBedrockModel({
    intent: 'plan',
    message,
    degraded: costPreflight.degraded || budgetDecision.shouldDegrade,
  });

  // Build aliased snapshot for LLM-safe clip references
  const realSnapshot = buildAIProjectSnapshot(toolNames);
  const { snapshot: aliasedSnapshot, aliasMap } = buildAliasedSnapshotForPlanning(toolNames);

  const channelContext = truncateBlock(getChannelAnalysisContext(), 800);
  const snapshotContext = formatSnapshotForPrompt(aliasedSnapshot, 'planning', 3400);
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
  const dynamicCap = costPreflight.degraded || budgetDecision.shouldDegrade
    ? Math.min(
      MAX_DYNAMIC_CONTEXT_CHARS,
      budgetDecision.shouldDegrade
        ? Math.min(costPreflight.maxDynamicContextChars, 1800)
        : costPreflight.maxDynamicContextChars,
    )
    : MAX_DYNAMIC_CONTEXT_CHARS;
  if (dynamicContext.length > dynamicCap) {
    dynamicContext = `${dynamicContext.slice(0, dynamicCap)}\n[Planning context truncated for token efficiency]`;
  }

  const planCacheKey = buildSemanticCacheKey({
    intent: 'plan',
    modelId: routingDecision.modelId,
    message,
    historyHash: hashPlanningHistory(optimizedStart),
    snapshotHash: hashSnapshot(realSnapshot),
    toolSignature: toolNames.join(','),
    extra: String(allowedRounds),
  });
  const cachedPlan = getCached<ExecutionPlan>(planCacheKey);
  if (cachedPlan) {
    return JSON.parse(JSON.stringify(cachedPlan)) as ExecutionPlan;
  }

  const planningIssues: PlanValidationIssue[] = [];

  // Planning loop - explore all needed operations
  while (currentRound < allowedRounds && operations.length < MAX_OPERATIONS_PER_PLAN) {
    currentRound++;

    // Inject dynamic context into the first message of the loop
    const messageContent = (currentRound === 1)
      ? `${dynamicContext}\n\nTask: ${message}`
      : `Continue planning from previous tool results.

Return only the next concrete operation(s) that are executable now.
If the goal is complete, return no new tool calls.`;

    // Add user message to messages array
    messages.push({
      role: 'user',
      content: [{ text: messageContent }],
    });

    let tokenGuard = evaluateTokenGuard({
      messages,
      systemTexts: [STATIC_PLANNING_INSTRUCTION],
      toolCount: toolNames.length,
      maxOutputTokens: PLANNING_MAX_TOKENS,
      softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
      hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
    });
    if (tokenGuard.status !== 'ok') {
      // Keep planner stable under token pressure by trimming to latest context.
      const compacted = trimHistoryToLimit(messages, 8);
      messages.length = 0;
      messages.push(...compacted);
      tokenGuard = evaluateTokenGuard({
        messages,
        systemTexts: [STATIC_PLANNING_INSTRUCTION],
        toolCount: toolNames.length,
        maxOutputTokens: PLANNING_MAX_TOKENS,
        softLimitTokens: TOKEN_GUARD_SOFT_LIMIT,
        hardLimitTokens: TOKEN_GUARD_HARD_LIMIT,
      });
    }
    if (tokenGuard.status === 'block') {
      throw new Error(
        `Planning request exceeds token safety cap (${tokenGuard.estimatedInputTokens} > ${TOKEN_GUARD_HARD_LIMIT}). Reduce request scope.`,
      );
    }

    // Wait for rate-limit slot before each planning round API call
    await waitForSlot();

    const response = await withRetryOn429(() =>
      converseBedrock({
        modelId: routingDecision.modelId,
        messages: messages as any,
        system: [{ text: STATIC_PLANNING_INSTRUCTION }],
        toolConfig: { tools: toolSet as any },
        inferenceConfig: { maxTokens: PLANNING_MAX_TOKENS, temperature: 0.2 },
      }),
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
        const operationsBeforeRound = operations.length;
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
        const simulatedResults = simulateFunctionExecution(toolUses, aliasMap);

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
        const operationsAddedThisRound = operations.length - operationsBeforeRound;
        if (shouldEscalatePlanningRounds({
          currentRound,
          allowedRounds,
          operationsAddedThisRound,
          toolCallsInRound: toolUses.length,
        })) {
          allowedRounds = Math.min(ABSOLUTE_MAX_ROUNDS, allowedRounds + 1);
        }
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

  // ===== PLAN COMPILATION: Validate and convert aliases to UUIDs =====
  // Operations at this point may contain clip aliases (clip_1, clip_2, etc.)
  // We need to validate and convert them to executable UUIDs
  const selfCheckIssues = runPlannerSelfCheck(operations, aliasMap);
  planningIssues.push(...selfCheckIssues);

  let compiledOperations = operations;

  // First compilation attempt
  let compilationResult = compilePlan(operations, aliasMap, realSnapshot);
  const compileFailed = compilationResult.errors.length > 0;

  // If compilation found critical errors, try one retry with correction prompt
  if (shouldRetryCompilation(compilationResult.errors) && currentRound < allowedRounds) {
    const correctionPrompt = generateCorrectionPrompt(compilationResult);

    // Add correction prompt to conversation
    messages.push({
      role: 'user',
      content: [{ text: correctionPrompt }],
    });

    await waitForSlot();

    const retryResponse = await withRetryOn429(() =>
      converseBedrock({
        modelId: routingDecision.modelId,
        messages: messages as any,
        system: [{ text: STATIC_PLANNING_INSTRUCTION }],
        toolConfig: { tools: toolSet as any },
        inferenceConfig: { maxTokens: PLANNING_MAX_TOKENS, temperature: 0.2 },
      }),
    );

    // Record token usage from retry
    if (retryResponse.usage) {
      recordUsage({
        promptTokenCount: retryResponse.usage.inputTokens,
        candidatesTokenCount: retryResponse.usage.outputTokens,
        totalTokenCount: retryResponse.usage.totalTokens,
      });
    }

    // Extract retry tool calls
    if (retryResponse.stopReason === 'tool_use') {
      const retryToolUses = (retryResponse.output?.message?.content || [])
        .filter((c: any) => c.toolUse)
        .map((c: any) => c.toolUse);

      const retryOperations: PlannedOperation[] = [];
      for (const toolUse of retryToolUses) {
        if (!isKnownTool(toolUse.name)) continue;

        const functionCall = {
          name: toolUse.name,
          args: toolUse.input,
        };
        retryOperations.push({
          round: currentRound + 1,
          functionCall,
          description: generateOperationDescription(functionCall),
          isReadOnly: isReadOnlyTool(toolUse.name),
        });
      }

      // Try compiling the retry operations
      if (retryOperations.length > 0) {
        const retryCompilation = compilePlan(retryOperations, aliasMap, realSnapshot);
        if (retryCompilation.errors.length === 0) {
          // Retry succeeded - use these operations
          compiledOperations = retryOperations;
          compilationResult = retryCompilation;
        }
      }
    }
  }

  // If we still have no valid operations after retry, use fallback plan
  if (shouldUseFallback(compilationResult.operations)) {
    recordPlanningAttempt({
      compileFailed,
      fallbackUsed: true,
    });
    return buildFallbackExecutionPlan(realSnapshot, aliasMap, message);
  }

  // Use compiled operations (already preserve round/description/isReadOnly from source ops)
  compiledOperations = compilationResult.operations;

  const { ToolExecutor } = await import('./toolExecutor');
  const preflight = ToolExecutor.preflightPlan(
    compiledOperations.map((op) => op.functionCall as FunctionCall),
  );
  const normalizedOperations = compiledOperations.map((operation, index) => ({
    ...operation,
    functionCall: preflight.normalizedCalls[index] || operation.functionCall,
  }));
  // Compiler warnings (clamped values) are AUTO-CORRECTIONS — the values are already fixed.
  // Don't include them in validationIssues (which gate valid=false and block execution).
  // Instead surface them in corrections[] so the user sees what was adjusted.
  const compilationCorrections = compilationResult.warnings.map(
    (w) => `Auto-corrected: ${w}`,
  );
  const validationIssues: PlanValidationIssue[] = [
    ...planningIssues,
    ...preflight.issues.map((issue) => ({
      category: issue.errorType,
      operationIndex: issue.index,
      toolName: issue.name,
      message: issue.message,
    })),
    // NOTE: compiler warnings intentionally excluded — they are already corrected
  ];
  const validation: PlanValidationReport = {
    valid: validationIssues.length === 0 && preflight.valid,
    corrections: [...preflight.corrections, ...compilationCorrections],
    issues: validationIssues,
  };
  const planQuality = assessPlanQuality(normalizedOperations, validation);
  if (planQuality.score < MIN_PLAN_QUALITY_SCORE) {
    recordPlanningAttempt({
      compileFailed: true,
      fallbackUsed: true,
    });
    const fallback = buildFallbackExecutionPlan(realSnapshot, aliasMap, message);
    fallback.validation.corrections = [
      ...fallback.validation.corrections,
      `Low plan quality score (${planQuality.score.toFixed(2)}). Rebuilding safely from current timeline.`,
    ];
    return fallback;
  }

  const understanding = buildUnderstanding(message, realSnapshot);
  const steps = buildPlanSteps(normalizedOperations);
  const executionPolicy = pickExecutionPolicy(normalizedOperations);
  const changeSummary = buildChangeSummary(normalizedOperations);

  // Determine if approval is needed (any state-changing operations)
  const requiresApproval = normalizedOperations.some((op) => !op.isReadOnly);
  const readiness = evaluatePlanReadiness({
    compileSucceeded: compilationResult.errors.length === 0,
    selfCheckIssueCount: selfCheckIssues.length,
    confidenceScore: planQuality.score,
    preflightValid: preflight.valid,
    operationCount: normalizedOperations.length,
  });
  recordPlanningAttempt({
    compileFailed,
    fallbackUsed: false,
  });
  const riskNotes = planQuality.notes.length > 0
    ? planQuality.notes
    : ['No major planning risks detected'];
  const contractValidation = validatePlannerOutputContract({
    understanding,
    operations: normalizedOperations,
    riskNotes,
    planReady: readiness.planReady,
  });
  if (!contractValidation.valid) {
    const fallback = buildFallbackExecutionPlan(realSnapshot, aliasMap, message);
    fallback.validation.corrections = [
      ...fallback.validation.corrections,
      `Planner contract failed: ${contractValidation.errors.join('; ')}`,
    ];
    return fallback;
  }

  const planResult: ExecutionPlan = {
    understanding,
    operations: normalizedOperations,
    steps,
    validation,
    executionPolicy,
    totalRounds: currentRound,
    estimatedDuration: normalizedOperations.length * 0.5, // Rough estimate
    requiresApproval,
    planReady: readiness.planReady,
    planReadyReason: readiness.planReadyReason,
    riskNotes,
    confidenceScore: planQuality.score,
    changeSummary,
    rollbackNote: 'Undo is available immediately after execution if the result is not what you expected.',
  };
  setCached<ExecutionPlan>(planCacheKey, planResult, PLAN_CACHE_TTL_MS);
  return planResult;
}

/**
 * Execute a complete plan
 */
export async function executePlan(
  plan: ExecutionPlan,
  originalHistory: AIChatMessage[],
  originalMessage: string,
  onProgress?: (current: number, total: number, operation: PlannedOperation) => void,
  onToolLifecycle?: (event: {
    call: FunctionCall;
    state: 'pending' | 'running' | 'completed' | 'error';
    index: number;
    total: number;
    result?: ToolResult;
  }) => void,
  onAudit?: (audit: TurnAuditPayload) => void,
): Promise<string> {
  const { ToolExecutor } = await import('./toolExecutor');
  const messages: AIChatMessage[] = [...originalHistory];
  const beforeSnapshot = buildAIProjectSnapshot();
  const runtimePreflight = ToolExecutor.preflightPlan(
    plan.operations.map((operation) => operation.functionCall as FunctionCall),
  );
  if (!runtimePreflight.valid) {
    recordExecutionAttempt({ validationFailed: true });
    const details = runtimePreflight.issues
      .map(
        (issue) =>
          `${issue.name} [${issue.errorType}]: ${issue.message}${issue.recoveryHint ? ` | Next: ${issue.recoveryHint}` : ''
          }`,
      )
      .join('\n');
    throw new Error(`Plan validation failed before execution:\n${details}`);
  }
  recordExecutionAttempt({ validationFailed: false });
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
  const allResults: ToolResult[] = [];

  // Execute operations round by round
  for (const roundOperations of operationsByRound.values()) {
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
      (index) => {
        const operationIndex = index - 1;
        if (operationIndex >= 0 && operationIndex < roundOperations.length) {
          const currentOperation = roundOperations[operationIndex];
          completedOperations++;
          onProgress?.(completedOperations, plan.operations.length, currentOperation);
        }
      },
      {
        mode: 'edit',
        onLifecycle: onToolLifecycle,
      },
    );
    allResults.push(...results);

    // Check for any failed operations
    const failedOps = results.filter(r => !r.result.success);
    if (failedOps.length > 0) {
      const errorMessages = failedOps
        .map(
          (op) =>
            `${op.name} [${op.result.errorType || 'execution_error'}]: ${op.result.error || 'Unknown error'
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

  const afterSnapshot = buildAIProjectSnapshot();
  const diff = summarizeTimelineDiff(beforeSnapshot, afterSnapshot);
  const diffSummary = [
    `Clips: ${diff.clipCountBefore} -> ${diff.clipCountAfter}`,
    `Duration: ${diff.durationBefore.toFixed(1)}s -> ${diff.durationAfter.toFixed(1)}s`,
    `Added: ${diff.addedClipNames.length > 0 ? diff.addedClipNames.join(', ') : 'none'}`,
    `Removed: ${diff.removedClipNames.length > 0 ? diff.removedClipNames.join(', ') : 'none'}`,
  ];
  onAudit?.({
    preSnapshotHash: hashSnapshot(beforeSnapshot),
    postSnapshotHash: hashSnapshot(afterSnapshot),
    diffSummary,
    toolInputs: executableOperations.map((operation) => ({
      name: operation.functionCall.name,
      args: operation.functionCall.args || {},
    })),
    toolResults: allResults.map((result) => ({
      name: result.name,
      success: result.result.success,
      message: result.result.message,
      error: result.result.error,
    })),
    failures: allResults
      .filter((result) => !result.result.success)
      .map((result) => `${result.name}: ${result.result.error || 'unknown error'}`),
  });

  // Build a concise, human-friendly summary of what was done
  const successResults = allResults.filter(r => r.result.success);
  const failedResults = allResults.filter(r => !r.result.success);

  const lines: string[] = [];

  // What the AI understood
  const goal = plan.understanding?.goal || 'your request';
  lines.push(`✅ Done! Here's what I did for: "${goal}"`);
  lines.push('');

  // What changed on the timeline
  if (diff.clipCountBefore !== diff.clipCountAfter || diff.addedClipNames.length > 0 || diff.removedClipNames.length > 0) {
    lines.push('**Timeline changes:**');
    if (diff.addedClipNames.length > 0) lines.push(`- Added: ${diff.addedClipNames.join(', ')}`);
    if (diff.removedClipNames.length > 0) lines.push(`- Removed: ${diff.removedClipNames.join(', ')}`);
    if (diff.clipCountBefore !== diff.clipCountAfter) {
      lines.push(`- Clips: ${diff.clipCountBefore} → ${diff.clipCountAfter}`);
    }
    if (diff.durationBefore !== diff.durationAfter) {
      lines.push(`- Duration: ${diff.durationBefore.toFixed(1)}s → ${diff.durationAfter.toFixed(1)}s`);
    }
    lines.push('');
  }

  // Operations performed
  if (successResults.length > 0) {
    lines.push('**Operations performed:**');
    successResults.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.result.message || r.name}`);
    });
    lines.push('');
  }

  // Any failures
  if (failedResults.length > 0) {
    lines.push('**⚠️ Some steps had issues:**');
    failedResults.forEach(r => {
      lines.push(`- ${r.name}: ${r.result.error || 'Unknown error'}`);
      if (r.result.recoveryHint) lines.push(`  → ${r.result.recoveryHint}`);
    });
    lines.push('');
  }

  // Undo hint
  lines.push('💡 Not what you wanted? Press **Ctrl+Z** to undo.');

  return lines.join('\n');
}

function hashSnapshot(snapshot: AIProjectSnapshot): string {
  const raw = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv32-${(hash >>> 0).toString(16)}`;
}

function hashPlanningHistory(history: AIChatMessage[]): string {
  const raw = history
    .map((message) => {
      const text = (message.content || [])
        .map((block) => (typeof block?.text === 'string' ? block.text : ''))
        .join(' ')
        .slice(0, 240);
      return `${message.role}:${text}`;
    })
    .join('|');
  return hashString(raw);
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

function selectPlanningTools(
  message: string,
  mode: 'standard' | 'economy' = 'standard',
) {
  const text = message.toLowerCase();
  const base = new Set<string>([
    'get_timeline_info',
    'ask_clarification',
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

  if (/\b(subtitle|caption)\b/.test(text) && mode === 'standard') {
    base.add('add_subtitle');
    base.add('update_subtitle');
    base.add('delete_subtitle');
    base.add('update_subtitle_style');
    base.add('get_subtitles');
    base.add('clear_all_subtitles');
  }

  if (/\b(transcribe|transcription|transcript)\b/.test(text) && mode === 'standard') {
    base.add('transcribe_clip');
    base.add('transcribe_timeline');
    base.add('get_transcription');
    base.add('apply_transcript_edits');
  }

  if (/\b(effect|filter|speed|highlight|chapter)\b/.test(text) && mode === 'standard') {
    base.add('set_clip_speed');
    base.add('apply_clip_effect');
    base.add('find_highlights');
    base.add('generate_chapters');
  }

  if (/\b(save|export|project)\b/.test(text) && mode === 'standard') {
    base.add('save_project');
    base.add('set_export_settings');
    base.add('get_project_info');
  }

  if (/\b(search|analy|memory|scene)\b/.test(text) && mode === 'standard') {
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
function simulateFunctionExecution(toolUses: any[], aliasMap: AliasMap): any[] {
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
            id: resolveUuid(clip.id, aliasMap) || clip.id,
            name: clip.name,
            startTime: clip.startTime,
            duration: clip.duration,
            endTime: clip.startTime + clip.duration,
          })),
        },
      };
    } else if (name === 'get_clip_details') {
      const requestedClipId = typeof args?.clip_id === 'string'
        ? (resolveAlias(args.clip_id, aliasMap) || args.clip_id)
        : '';
      const clip = state.clips.find((c: any) => c.id === requestedClipId);
      if (clip) {
        return {
          success: true,
          data: {
            id: resolveUuid(clip.id, aliasMap) || clip.id,
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
  snapshot: AIProjectSnapshot,
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

function runPlannerSelfCheck(
  operations: PlannedOperation[],
  aliasMap: AliasMap,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];

  operations.forEach((operation, index) => {
    const aliasErrors = validateAliasReferences(
      operation.functionCall.name,
      operation.functionCall.args || {},
      aliasMap,
    );

    aliasErrors.forEach((message) => {
      issues.push({
        category: 'validation_warning',
        operationIndex: index,
        toolName: operation.functionCall.name,
        message: `Planner self-check: ${message}`,
      });
    });
  });

  return issues;
}

function assessPlanQuality(
  operations: PlannedOperation[],
  validation: PlanValidationReport,
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 1.0;

  if (operations.length === 0) {
    score -= 0.7;
    notes.push('No operations generated');
  }

  if (operations.length > MAX_OPERATIONS_PER_PLAN) {
    score -= 0.2;
    notes.push('Too many operations');
  }

  const mutatingOps = operations.filter((op) => !op.isReadOnly).length;
  if (mutatingOps === 0) {
    score -= 0.15;
    notes.push('Plan has no mutating operations');
  }

  if (!validation.valid) {
    score -= 0.35;
    notes.push('Validation is not fully clean');
  }

  if ((validation.issues || []).length > 0) {
    score -= Math.min(0.25, validation.issues.length * 0.05);
    notes.push(`${validation.issues.length} validation issue(s)`);
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    notes,
  };
}

function evaluatePlanReadiness(input: {
  compileSucceeded: boolean;
  selfCheckIssueCount: number;
  confidenceScore: number;
  preflightValid: boolean;
  operationCount: number;
}): { planReady: boolean; planReadyReason: string } {
  if (!input.compileSucceeded) {
    return {
      planReady: false,
      planReadyReason: 'Compile failed for one or more planned operations.',
    };
  }
  if (input.operationCount === 0) {
    return {
      planReady: false,
      planReadyReason: 'No executable operations were produced.',
    };
  }
  if (input.selfCheckIssueCount > 0) {
    return {
      planReady: false,
      planReadyReason: `Planner self-check reported ${input.selfCheckIssueCount} issue(s).`,
    };
  }
  if (!input.preflightValid) {
    return {
      planReady: false,
      planReadyReason: 'Runtime preflight validation failed.',
    };
  }
  if (input.confidenceScore < MIN_PLAN_QUALITY_SCORE) {
    return {
      planReady: false,
      planReadyReason: `Confidence too low (${Math.round(input.confidenceScore * 100)}%).`,
    };
  }
  return {
    planReady: true,
    planReadyReason: 'Plan passed compile, self-check, confidence, and preflight gates.',
  };
}

function buildChangeSummary(operations: PlannedOperation[]): string[] {
  const summaries: string[] = [];
  const mutatingOps = operations.filter((op) => !op.isReadOnly);

  if (mutatingOps.length === 0) {
    summaries.push('Read-only inspection only; no timeline edits.');
    return summaries;
  }

  const byTool = new Map<string, number>();
  for (const op of mutatingOps) {
    byTool.set(op.functionCall.name, (byTool.get(op.functionCall.name) || 0) + 1);
  }

  for (const [tool, count] of byTool.entries()) {
    summaries.push(`${formatToolLabel(tool)}: ${count} operation${count > 1 ? 's' : ''}`);
  }

  return summaries;
}

function formatToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    split_clip: 'Split clips',
    delete_clips: 'Delete clips',
    move_clip: 'Move clips',
    merge_clips: 'Merge clips',
    update_clip_bounds: 'Trim clip bounds',
    set_clip_volume: 'Adjust clip volume',
    toggle_clip_mute: 'Toggle clip mute',
    set_playhead_position: 'Move playhead',
    set_clip_speed: 'Adjust clip speed',
    apply_clip_effect: 'Apply clip effects',
  };

  return labels[tool] || tool.replace(/_/g, ' ');
}

function summarizeTimelineDiff(
  before: AIProjectSnapshot,
  after: AIProjectSnapshot,
): {
  clipCountBefore: number;
  clipCountAfter: number;
  durationBefore: number;
  durationAfter: number;
  addedClipNames: string[];
  removedClipNames: string[];
} {
  const beforeIds = new Set(before.timeline.clips.map((clip) => clip.id));
  const afterIds = new Set(after.timeline.clips.map((clip) => clip.id));

  const addedClipNames = after.timeline.clips
    .filter((clip) => !beforeIds.has(clip.id))
    .map((clip) => clip.name);

  const removedClipNames = before.timeline.clips
    .filter((clip) => !afterIds.has(clip.id))
    .map((clip) => clip.name);

  return {
    clipCountBefore: before.timeline.clipCount,
    clipCountAfter: after.timeline.clipCount,
    durationBefore: before.timeline.totalDuration,
    durationAfter: after.timeline.totalDuration,
    addedClipNames,
    removedClipNames,
  };
}
