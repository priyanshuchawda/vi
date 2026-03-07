/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Agent Loop — The autonomous Plan → Act → Verify → Iterate engine
 *
 * This is the core agentic execution loop that allows the AI to
 * continuously reason and execute tools until the user's goal is met.
 *
 * Unlike the current single-pass plan→execute flow, this loop:
 * 1. Sends context to the LLM with a single tool call expected
 * 2. Executes the tool
 * 3. Feeds the result back to the LLM
 * 4. Repeats until the LLM says "I'm done" (stop reason = end_turn)
 *
 * Inspired by Kilocode's SessionPrompt.loop() but adapted for:
 * - AWS Bedrock Converse API (not streaming)
 * - Video editing domain (not code editing)
 * - Cost optimization for Nova Lite ($0.06/1M input)
 */

import { v4 as uuidv4 } from 'uuid';
import { converseBedrock, isBedrockConfigured } from './bedrockGateway';
import { ToolExecutor } from './toolExecutor';
import type { FunctionCall } from './videoEditingTools';
import { isReadOnlyTool } from './toolCapabilityMatrix';
import { waitForSlot, withRetryOn429 } from './rateLimiter';
import { recordUsage } from './tokenTracker';
import { routeBedrockModel, recordRoutingModelOutcome } from './modelRoutingPolicy';
import { buildAliasedSnapshotForPlanning, formatSnapshotForPrompt } from './aiProjectSnapshot';
import { formatCapabilityMatrixForPrompt } from './toolCapabilityMatrix';
import { resolveAlias, type AliasMap } from './clipAliasMapper';
import { createCostGuard, recordStepCost, evaluateCostGuard } from './agentCostGuard';
import { selectToolsForRequest } from './toolSelection';
import { useProjectStore } from '../stores/useProjectStore';
import { useAiMemoryStore } from '../stores/useAiMemoryStore';
import {
  createStep,
  setStepThought,
  setStepToolCall,
  setStepResult,
  setStepVerification,
  setStepCost,
  updateStepStatus,
  detectDoomLoop,
  compressStepHistory,
  formatCompressedStepsForContext,
} from './agentStepTracker';
import type {
  AgentLoopConfig,
  AgentLoopState,
  AgentLoopInput,
  AgentLoopResult,
  AgentToolResult,
  AgentVerification,
  AgentStep,
} from '../types/agentTypes';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/agentTypes';

const AGENTIC_MAX_TOKENS = 1024;

/**
 * System prompt for the agentic loop.
 * Key difference from planning prompt: tells the AI to work step-by-step
 * and continue autonomously instead of outputting a batch plan.
 */
function buildAgenticSystemPrompt(config: AgentLoopConfig): string {
  return `<role>
You are QuickCut's autonomous video editing copilot.
You work step-by-step until the user's goal is FULLY achieved.
You NEVER stop partway through — finish everything in one session.
</role>

<agentic-workflow>
For each step:
1. THINK: Review what's done. What's the SINGLE best next action?
2. ACT: Call exactly ONE tool. Choose the highest-impact action first.
3. OBSERVE: Read the tool result carefully. Did it succeed? Any adjustments?
4. DECIDE: Is the goal fully achieved? If not → step 1. If yes → summarize.

Strategy — follow this sequence for complex tasks:
  Step 1: Call get_timeline_info or get_all_media_analysis (understand state)
  Step 2-N: Execute mutations (trim, split, move, effects, etc.)
  Final: Summarize with concrete metrics

When the goal is FULLY achieved:
- Do NOT call any more tools
- Respond with a summary including: what changed, new timeline duration, clip count
</agentic-workflow>

<clip-reference-rules>
CRITICAL: You must ONLY use clip aliases from the provided snapshot.
- Clips are labeled: clip_1, clip_2, clip_3, etc.
- NEVER generate or invent clip IDs or UUIDs.
- After mutations (split, delete), the alias map may change. If you need
  updated IDs, call get_timeline_info.
</clip-reference-rules>

<content-aware-editing>
For highlight reels, best moments, or vlog edits:
1. FIRST call get_all_media_analysis to get scene data for every clip
2. Read the scenes array — each scene has {startTime, endTime, description}
3. Score scenes by interest: faces > action > speech > landscape > static
4. Allocate more time to high-interest scenes, less to low-interest
5. Use update_clip_bounds with new_start=scene.startTime, new_end=scene.endTime
6. NEVER split time equally — weighted allocation based on content quality
7. After trimming all clips, call get_timeline_info to verify total duration
</content-aware-editing>

<short-form-storytelling>
For YouTube Shorts, Reels, hackathon win stories, or social-first edits:
1. Shape the cut around a clear story arc: hook -> build -> proof/demo -> payoff -> CTA
2. Put the strongest visual proof early; do not waste the first 2 seconds on setup
3. Keep on-screen text punchy (roughly 2-6 words per beat) and grounded in available footage/memory
4. If script + captions are requested, prefer:
   generate_intro_script_from_timeline -> preview_caption_fit -> apply_script_as_captions
4a. If snapshot.subtitles.count === 0, NEVER call update_subtitle or delete_subtitle first.
    Create captions with apply_script_as_captions or add_subtitle before any subtitle updates.
5. Avoid inventing unseen scenes or outcomes not supported by media memory/tool results
6. For exact target-duration requests, empty timeline gaps do NOT count as usable duration
7. Never satisfy a duration target by only moving clips later on the timeline
8. Prefer, in order: restore source bounds, extend still images, slow clips moderately, duplicate clips, then reposition
</short-form-storytelling>

<error-recovery>
If a tool call fails:
1. Read the error message carefully — it usually tells you exactly what's wrong
2. Common fixes:
   - "clip not found" → call get_timeline_info to get current clip IDs
   - "time out of range" → check sourceStart/sourceEnd values in the snapshot
   - "Subtitle X not found. Valid range: 1-0" → there are no subtitles yet; use apply_script_as_captions or add_subtitle first
   - "invalid argument" → re-check the tool's parameter schema
3. Try an alternative approach — don't repeat the exact same call
4. If you fail 2 times on the same operation, skip it and move to the next
</error-recovery>

<rules>
1. Execute ONE tool per step. Never batch.
1a. Bedrock constraint: emit at most ONE toolUse block in each assistant response.
2. NEVER ask the user for permission — you are autonomous.
3. Prefer fewer, larger operations over many small ones.
4. Budget: ${config.maxSteps} steps max, $${config.maxCostUsd.toFixed(2)} cost cap.
5. Treat edits as DELTA operations — only modify what needs changing.
6. After mutations, the system auto-verifies timeline state for you.
7. If you detect the timeline is already correct, STOP and summarize.
8. For multi-clip edits, process clips in order: clip_1 → clip_2 → clip_3.
</rules>

<timestamp-arithmetic>
- split_clip: time_in_clip is RELATIVE to clip start (0 to clip.duration)
- update_clip_bounds: new_start/new_end are SOURCE FILE positions (not timeline)
  Keep first X seconds: new_end = sourceStart + X
  Trim last Y seconds: new_end = sourceEnd - Y
  Keep a scene window: new_start = scene.startTime, new_end = scene.endTime
- set_playhead_position: time is TIMELINE position (0 to totalDuration)
</timestamp-arithmetic>

<response-format>
When done, ALWAYS end with:
" Completed: [what you did]. Timeline: [duration]s, [N] clips."
Include specific numbers (e.g. "trimmed 3 clips from 45s to 28s total").
</response-format>`;
}

/**
 * Resolve aliases in tool args to actual UUIDs before execution.
 */
function resolveToolAliases(
  toolCall: { name: string; args: Record<string, unknown> },
  aliasMap: AliasMap,
): { name: string; args: Record<string, unknown> } {
  const resolvedArgs = { ...toolCall.args };

  for (const [key, value] of Object.entries(resolvedArgs)) {
    if (typeof value === 'string' && value.startsWith('clip_')) {
      const resolved = resolveAlias(value, aliasMap);
      if (resolved) {
        resolvedArgs[key] = resolved;
      }
    }
    if (Array.isArray(value)) {
      resolvedArgs[key] = value.map((v: unknown) => {
        if (typeof v === 'string' && v.startsWith('clip_')) {
          return resolveAlias(v, aliasMap) || v;
        }
        return v;
      });
    }
  }

  return { name: toolCall.name, args: resolvedArgs };
}

function getTargetDurationSeconds(
  normalizedIntent: AgentLoopInput['normalizedIntent'],
  userMessage: string,
): number | undefined {
  const rawTarget = Number(normalizedIntent?.constraints?.target_duration);
  const unit = String(normalizedIntent?.constraints?.target_duration_unit || '').toLowerCase();
  if (Number.isFinite(rawTarget) && rawTarget > 0) {
    return unit.startsWith('min') ? rawTarget * 60 : rawTarget;
  }

  const match = String(userMessage || '').match(
    /\b(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)\b/i,
  );
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return match[2].toLowerCase().startsWith('min') ? value * 60 : value;
}

function buildSignalTextForClip(clip: { id: string; name: string; path?: string }): string {
  const memoryEntries = useAiMemoryStore.getState().getCompletedEntries();
  const memory =
    memoryEntries.find((entry) => entry.clipId === clip.id) ||
    memoryEntries.find((entry) => entry.filePath === clip.path);
  return [clip.name, memory?.summary || '', memory?.analysis || '', ...(memory?.tags || [])]
    .join(' ')
    .toLowerCase();
}

function scoreStorySignal(signal: string): number {
  const addIf = (pattern: RegExp, points: number) => (pattern.test(signal) ? points : 0);
  return (
    addIf(/\b(winner|won|award|announcement|reveal|first place|second place|third place)\b/, 10) +
    addIf(/\b(demo|judges|pitch|present)\b/, 8) +
    addIf(/\b(team|workspace|build|prototype|hackathon)\b/, 4)
  );
}

/**
 * Execute local verification after a mutating tool call.
 * This avoids a second tool round-trip while still giving the loop
 * a concrete snapshot of the new timeline state.
 */
function verifyAfterMutation(input: AgentLoopInput): AgentVerification {
  try {
    const state = useProjectStore.getState();
    const clips = state.clips
      .slice()
      .sort((a, b) => a.startTime - b.startTime)
      .map((clip) => ({
        id: clip.id,
        name: clip.name,
        path: clip.path,
        startTime: clip.startTime,
        duration: clip.duration,
        endTime: clip.startTime + clip.duration,
      }));

    if (clips.length === 0) {
      return {
        verified: true,
        method: 'timeline_check',
        details:
          'Mutation completed; local verification snapshot unavailable because timeline is empty.',
        snapshot: {
          totalDuration: 0,
          clipCount: 0,
          gapCount: 0,
          totalGapDuration: 0,
        },
      };
    }

    let gapCount = 0;
    let totalGapDuration = 0;
    for (let i = 1; i < clips.length; i++) {
      const gap = clips[i].startTime - clips[i - 1].endTime;
      if (gap > 0.05) {
        gapCount += 1;
        totalGapDuration += gap;
      }
    }

    const totalDuration = Number(Math.max(...clips.map((clip) => clip.endTime), 0).toFixed(2));
    const targetDuration = getTargetDurationSeconds(input.normalizedIntent, input.userMessage);
    const durationDelta =
      targetDuration !== undefined
        ? Number((totalDuration - targetDuration).toFixed(2))
        : undefined;
    const rankedSignals = clips.map((clip, index) => ({
      index,
      clipName: clip.name,
      score: scoreStorySignal(buildSignalTextForClip(clip)),
    }));
    const strongest = [...rankedSignals].sort((a, b) => b.score - a.score)[0];
    const strongestSignalEarly = strongest ? strongest.index <= 1 : true;

    const withinDuration = targetDuration === undefined || Math.abs(durationDelta || 0) <= 0.75;
    const verified = gapCount === 0 && withinDuration;

    const detailParts = [
      `Timeline ${totalDuration}s`,
      `${clips.length} clip(s)`,
      gapCount > 0
        ? `${gapCount} gap(s) totalling ${Number(totalGapDuration.toFixed(2))}s`
        : 'no gaps',
    ];
    if (targetDuration !== undefined) {
      detailParts.push(`target ${targetDuration}s`);
      detailParts.push(
        Math.abs(durationDelta || 0) <= 0.75
          ? 'duration within tolerance'
          : `duration delta ${durationDelta}s`,
      );
    }
    if (strongest) {
      detailParts.push(
        strongestSignalEarly
          ? `strongest story signal is early (${strongest.clipName})`
          : `strongest story signal is late (${strongest.clipName})`,
      );
    }

    return {
      verified,
      method: 'timeline_check',
      details: detailParts.join('; '),
      discrepancy:
        gapCount > 0
          ? 'timeline_contains_gaps'
          : !withinDuration
            ? 'duration_target_not_met'
            : !strongestSignalEarly
              ? 'story_signal_is_late'
              : undefined,
      snapshot: {
        totalDuration,
        clipCount: clips.length,
        gapCount,
        totalGapDuration: Number(totalGapDuration.toFixed(2)),
        targetDuration,
        durationDelta,
        firstClipName: clips[0]?.name,
        strongestSignalEarly,
      },
    };
  } catch (err) {
    return {
      verified: false,
      method: 'timeline_check',
      details: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Extract text content from a Bedrock response.
 */
function extractTextFromResponse(response: any): string {
  const content = response?.output?.message?.content || [];
  return content
    .filter((c: any) => c?.text)
    .map((c: any) => c.text)
    .join('\n')
    .trim();
}

/**
 * Extract tool use blocks from a Bedrock response.
 */
function extractToolUsesFromResponse(response: any): any[] {
  const content = response?.output?.message?.content || [];
  return content.filter((c: any) => c?.toolUse).map((c: any) => c.toolUse);
}

function buildAssistantToolReplyContent(content: any[], selectedToolUseId: string): any[] {
  const filtered = (content || []).filter((part: any) => {
    if (part?.text) return true;
    return part?.toolUse?.toolUseId === selectedToolUseId;
  });

  if (filtered.length > 0) {
    return filtered;
  }

  const selectedToolUse = (content || []).find(
    (part: any) => part?.toolUse?.toolUseId === selectedToolUseId,
  );
  return selectedToolUse ? [selectedToolUse] : [];
}

function selectRecentHistoryWindow(
  history: Array<{ role: string; content: unknown[] }>,
  maxMessages: number,
): Array<{ role: string; content: unknown[] }> {
  const recent = history.slice(-Math.max(0, maxMessages));
  const firstUserIndex = recent.findIndex((message) => message.role === 'user');
  if (firstUserIndex === -1) {
    return [];
  }
  return recent.slice(firstUserIndex);
}

function deriveStepToolNames(input: {
  allToolNames: string[];
  steps: AgentStep[];
  userMessage: string;
  normalizedIntent?: AgentLoopInput['normalizedIntent'];
}): Set<string> {
  const next = new Set(input.allToolNames);
  const successfulSteps = input.steps.filter((step) => step.result?.success && step.toolCall?.name);
  const successfulToolNames = new Set(
    successfulSteps
      .map((step) => step.toolCall?.name)
      .filter((name): name is string => Boolean(name)),
  );
  const hasSuccessfulRead = successfulSteps.some((step) =>
    isReadOnlyTool(step.toolCall?.name || ''),
  );
  const targetDuration = getTargetDurationSeconds(input.normalizedIntent, input.userMessage);
  const lastVerification = [...input.steps]
    .reverse()
    .find((step) => step.verification)?.verification;
  const durationSatisfied =
    targetDuration === undefined
      ? false
      : Boolean(
          lastVerification?.snapshot &&
          (lastVerification.snapshot.gapCount || 0) === 0 &&
          Math.abs(lastVerification.snapshot.durationDelta || 0) <= 0.75,
        );
  const storySignalEarly = lastVerification?.snapshot?.strongestSignalEarly === true;
  const wantsScript =
    input.normalizedIntent?.goals?.includes('script_generation') === true ||
    /\b(script|voiceover|caption|subtitle|hook|cta)\b/i.test(input.userMessage);

  if (!hasSuccessfulRead) {
    return new Set(
      input.allToolNames.filter((name) => isReadOnlyTool(name) || name === 'ask_clarification'),
    );
  }

  if (successfulToolNames.has('generate_intro_script_from_timeline')) {
    next.delete('generate_intro_script_from_timeline');
  }

  if (successfulToolNames.has('preview_caption_fit')) {
    next.delete('preview_caption_fit');
  }

  if (successfulToolNames.has('apply_script_as_captions')) {
    next.delete('apply_script_as_captions');
    next.delete('preview_caption_fit');
    next.delete('generate_intro_script_from_timeline');
  } else if (wantsScript && successfulToolNames.has('generate_intro_script_from_timeline')) {
    next.add('apply_script_as_captions');
    next.add('preview_caption_fit');
  }

  if (durationSatisfied && storySignalEarly) {
    next.delete('set_clip_speed');
    next.delete('copy_clips');
    next.delete('paste_clips');
    next.delete('update_clip_bounds');
    next.delete('move_clip');
  }

  if (next.size === 0) {
    input.allToolNames.forEach((name) => {
      if (isReadOnlyTool(name)) next.add(name);
    });
  }

  return next;
}

/**
 * The main agentic execution loop.
 *
 * This is the equivalent of Kilocode's `SessionPrompt.loop()` but adapted
 * for the Bedrock Converse API and video editing domain.
 */
export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  if (!isBedrockConfigured()) {
    throw new Error('AWS credentials not configured');
  }

  const config: AgentLoopConfig = {
    ...DEFAULT_AGENT_LOOP_CONFIG,
    ...(input.config || {}),
  };

  const loopId = uuidv4();
  const costGuard = createCostGuard(config);

  const loopState: AgentLoopState = {
    id: loopId,
    status: 'running',
    steps: [],
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    startedAt: Date.now(),
    config,
    goalDescription: input.userMessage,
  };

  const selectedToolSet = selectToolsForRequest({
    message: input.userMessage,
    mode: 'agentic',
    normalizedIntent: input.normalizedIntent,
  });
  const toolSet = selectedToolSet.tools;
  const toolNames = selectedToolSet.toolNames;

  const { snapshot: aliasedSnapshot, aliasMap } = buildAliasedSnapshotForPlanning(toolNames);

  const snapshotContext = formatSnapshotForPrompt(aliasedSnapshot, 'planning', 3400);
  const capabilityContext = formatCapabilityMatrixForPrompt(toolNames, 2400);

  const systemPrompt = buildAgenticSystemPrompt(config);

  // Build initial context message
  const dynamicContext = `<ai-project-snapshot>
${snapshotContext}
</ai-project-snapshot>
<tool-capability-matrix>
${capabilityContext}
</tool-capability-matrix>
${input.memoryContext || ''}
${input.channelContext || ''}
<instruction>
Work step-by-step. Execute ONE tool, see the result, then decide next action.
When the goal is fully achieved, respond with a summary (no tool calls).
</instruction>`;

  // Message history for the conversation loop
  const messages: any[] = [
    ...selectRecentHistoryWindow(input.history, 6),
    {
      role: 'user',
      content: [{ text: `${dynamicContext}\n\nTask: ${input.userMessage}` }],
    },
  ];

  let stepNumber = 0;
  let finalSummary = '';

  // ===== THE AGENTIC LOOP =====
  while (stepNumber < config.maxSteps) {
    // Check abort signal
    if (input.abortSignal?.aborted) {
      loopState.status = 'cancelled';
      break;
    }

    // Cost guard check
    const costDecision = evaluateCostGuard(costGuard, config);
    if (costDecision.action === 'block') {
      loopState.status = 'cost_limit';
      loopState.error = costDecision.reason;
      break;
    }

    // Doom loop detection
    if (
      config.enableDoomLoopDetection &&
      detectDoomLoop(loopState.steps, config.doomLoopThreshold)
    ) {
      loopState.status = 'failed';
      loopState.error = 'Doom loop detected: same tool call repeated. Stopping to prevent waste.';
      break;
    }

    stepNumber++;
    let step = createStep(stepNumber);
    input.callbacks.onStepStart(step, loopState);

    // Compress older steps if needed (saves tokens)
    if (stepNumber > config.compressContextAfterSteps && loopState.steps.length > 3) {
      const { compressed } = compressStepHistory(loopState.steps, 3);
      const compressedContext = formatCompressedStepsForContext(compressed);
      if (compressedContext) {
        // Inject a compact summary of older steps
        const summaryMsg = messages.find((m: any) => m.role === 'user' && m._compressed);
        if (summaryMsg) {
          summaryMsg.content = [{ text: compressedContext }];
        } else {
          messages.splice(Math.max(0, messages.length - 4), 0, {
            role: 'user',
            content: [{ text: compressedContext }],
            _compressed: true,
          });
        }
      }
    }

    // Wait for rate-limit slot
    await waitForSlot();

    const stepToolNames = deriveStepToolNames({
      allToolNames: toolNames,
      steps: loopState.steps,
      userMessage: input.userMessage,
      normalizedIntent: input.normalizedIntent,
    });
    const stepToolSet = toolSet.filter((tool: any) => stepToolNames.has(tool?.toolSpec?.name));

    // Call Bedrock
    const routingDecision = routeBedrockModel({
      intent: 'plan',
      message: input.userMessage,
      degraded: costDecision.action === 'warn',
    });

    let response;
    try {
      response = await withRetryOn429(() =>
        converseBedrock({
          modelId: routingDecision.modelId,
          messages: messages,
          system: [{ text: systemPrompt }],
          toolConfig: { tools: stepToolSet },
          inferenceConfig: {
            maxTokens: AGENTIC_MAX_TOKENS,
            temperature: 0.2,
          },
        }),
      );
      recordRoutingModelOutcome(routingDecision.modelId, 'success');
    } catch (error) {
      recordRoutingModelOutcome(routingDecision.modelId, 'failure');
      step = updateStepStatus(step, 'failed');
      step = setStepResult(step, {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
      loopState.steps.push(step);
      input.callbacks.onStepComplete(step, loopState);
      loopState.status = 'failed';
      loopState.error = `Bedrock API call failed: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }

    // Track tokens
    const inputTokens = response.usage?.inputTokens || 0;
    const outputTokens = response.usage?.outputTokens || 0;
    if (response.usage) {
      recordUsage({
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
        totalTokenCount: response.usage.totalTokens,
      });
    }
    const stepCostReport = recordStepCost(costGuard, stepNumber, inputTokens, outputTokens);
    step = setStepCost(step, inputTokens, outputTokens, stepCostReport.costUsd);
    input.callbacks.onCostUpdate(costGuard.totalCostUsd, loopState);

    // Extract AI's reasoning (text) and tool calls
    const thought = extractTextFromResponse(response);
    step = setStepThought(step, thought);

    // Check if the model wants to call a tool
    if (response.stopReason === 'tool_use') {
      const toolUses = extractToolUsesFromResponse(response);

      if (toolUses.length > 0) {
        // Take only the first tool use (agentic = one at a time)
        const toolUse = toolUses[0];
        const toolCall = {
          name: toolUse.name,
          args: toolUse.input || {},
          toolUseId: toolUse.toolUseId,
        };
        step = setStepToolCall(step, toolCall);
        input.callbacks.onStepStart(step, loopState); // Update UI with tool info

        // Resolve aliases to real UUIDs
        const resolvedCall = resolveToolAliases(toolCall, aliasMap);

        // Execute the tool
        let toolResult: AgentToolResult;
        try {
          const executionResult = await ToolExecutor.executeToolCallWithLifecycle(
            { name: resolvedCall.name, args: resolvedCall.args } as FunctionCall,
            0,
            1,
          );

          toolResult = {
            success: executionResult.result.success,
            output:
              typeof executionResult.result.message === 'string'
                ? executionResult.result.message
                : JSON.stringify(executionResult.result),
            error: executionResult.result.success
              ? undefined
              : String(executionResult.result.error || ''),
            adjustments: executionResult.result.adjustments,
          };
        } catch (err) {
          toolResult = {
            success: false,
            output: '',
            error: err instanceof Error ? err.message : String(err),
          };
        }

        step = setStepResult(step, toolResult);

        // Verify after mutations
        if (config.verifyAfterMutation && !isReadOnlyTool(toolCall.name) && toolResult.success) {
          step = updateStepStatus(step, 'verifying');
          const verification = verifyAfterMutation(input);
          step = setStepVerification(step, verification);
        }

        step = updateStepStatus(step, toolResult.success ? 'completed' : 'failed');
        loopState.steps.push(step);
        input.callbacks.onStepComplete(step, loopState);

        // Add assistant response to conversation history
        messages.push({
          role: 'assistant',
          content: buildAssistantToolReplyContent(
            response.output?.message?.content || [],
            toolUse.toolUseId,
          ),
        });

        // Build enriched tool result for the AI — include verification + budget hints
        const resultPayload: Record<string, unknown> = {
          success: toolResult.success,
          message: toolResult.output.slice(0, 2000),
        };

        // Include error info if failed
        if (toolResult.error) {
          resultPayload.error = toolResult.error;
          resultPayload.hint = toolResult.error.includes('not found')
            ? 'Call get_timeline_info to get current clip IDs.'
            : toolResult.error.includes('out of range')
              ? 'Check sourceStart/sourceEnd values from the snapshot.'
              : 'Review the error and try an alternative approach.';
        }

        // Include verification data if available
        if (step.verification) {
          resultPayload.verification = {
            verified: step.verification.verified,
            details: step.verification.details?.slice(0, 500),
            discrepancy: step.verification.discrepancy,
            snapshot: step.verification.snapshot,
          };
        }

        // Budget countdown to help AI pace itself
        const remainingSteps = config.maxSteps - stepNumber;
        const remainingBudget = config.maxCostUsd - costGuard.totalCostUsd;
        resultPayload.budget = {
          stepsRemaining: remainingSteps,
          costRemainingUsd: Number(remainingBudget.toFixed(4)),
        };

        const toolResultContent = [
          {
            toolResult: {
              toolUseId: toolUse.toolUseId,
              content: [{ json: resultPayload }],
            },
          },
        ];
        messages.push({
          role: 'user',
          content: toolResultContent,
        });

        // Trim message history if getting too long (keep last 10 exchanges)
        if (messages.length > 20) {
          const keptStart = messages.slice(0, 2); // Keep initial context
          const keptEnd = messages.slice(-10); // Keep recent exchanges
          messages.length = 0;
          messages.push(...keptStart, ...keptEnd);
        }

        // Continue the loop — LLM will see the tool result and decide next
        continue;
      }
    }

    // stopReason is "end_turn" or no tool calls — AI thinks it's done
    finalSummary = thought;
    step = updateStepStatus(step, 'completed');
    loopState.steps.push(step);
    input.callbacks.onStepComplete(step, loopState);

    // Exit the loop — goal achieved
    loopState.status = 'completed';
    break;
  }

  // Check if we hit the step limit
  if (stepNumber >= config.maxSteps && loopState.status === 'running') {
    loopState.status = 'step_limit';
    loopState.error = `Reached maximum step limit (${config.maxSteps})`;
  }

  // Complete the loop
  loopState.completedAt = Date.now();
  loopState.totalDurationMs = loopState.completedAt - loopState.startedAt;
  loopState.totalCostUsd = costGuard.totalCostUsd;
  loopState.totalInputTokens = costGuard.totalInputTokens;
  loopState.totalOutputTokens = costGuard.totalOutputTokens;
  loopState.finalSummary = finalSummary || generateFallbackSummary(loopState);

  input.callbacks.onLoopComplete(loopState);

  return {
    state: loopState,
    steps: loopState.steps,
    finalSummary: loopState.finalSummary,
    totalCostUsd: loopState.totalCostUsd,
    totalSteps: loopState.steps.length,
    success: loopState.status === 'completed',
  };
}

/**
 * Generate a fallback summary when the loop exits without the AI providing one.
 */
function generateFallbackSummary(state: AgentLoopState): string {
  const completedSteps = state.steps.filter((s) => s.status === 'completed');
  const failedSteps = state.steps.filter((s) => s.status === 'failed');
  const toolsUsed = completedSteps.filter((s) => s.toolCall).map((s) => s.toolCall!.name);

  const parts: string[] = [];

  if (state.status === 'completed') {
    parts.push(` Task completed in ${completedSteps.length} step(s).`);
  } else if (state.status === 'cost_limit') {
    parts.push(`️ Stopped: cost budget reached ($${state.totalCostUsd.toFixed(4)}).`);
    parts.push(`Completed ${completedSteps.length} of ${state.steps.length} steps.`);
  } else if (state.status === 'step_limit') {
    parts.push(`️ Stopped: step limit reached (${state.config.maxSteps}).`);
    parts.push(`Completed ${completedSteps.length} steps.`);
  } else if (state.status === 'cancelled') {
    parts.push(` Task cancelled after ${completedSteps.length} step(s).`);
  } else if (state.status === 'failed') {
    parts.push(` Task failed: ${state.error || 'unknown error'}`);
  }

  if (toolsUsed.length > 0) {
    const uniqueTools = [...new Set(toolsUsed)];
    parts.push(`Tools used: ${uniqueTools.join(', ')}`);
  }

  if (failedSteps.length > 0) {
    parts.push(`${failedSteps.length} step(s) had errors.`);
  }

  parts.push(
    `Cost: $${state.totalCostUsd.toFixed(4)} | Duration: ${(state.totalDurationMs / 1000).toFixed(1)}s`,
  );

  return parts.join('\n');
}
