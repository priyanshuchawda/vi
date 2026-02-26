import { GoogleGenAI, MediaResolution } from '@google/genai';
import type { GeminiChatMessage } from './geminiService';
import { allVideoEditingTools } from './videoEditingTools';
import { getMemoryForChat } from './geminiMemoryService';
import { useProjectStore } from '../stores/useProjectStore';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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
 * Generate a complete execution plan by letting Gemini explore all needed operations
 * This function runs multiple rounds of tool calling to build a complete plan before execution
 */
export async function generateCompletePlan(
  message: string,
  history: GeminiChatMessage[],
  maxRounds: number = 10
): Promise<ExecutionPlan> {
  if (!ai) {
    throw new Error('Gemini API key not configured');
  }

  const operations: PlannedOperation[] = [];
  let currentRound = 0;
  const conversationHistory = [...history];

  // Build system instruction with context
  const channelContext = getChannelAnalysisContext();
  const memoryContext = getMemoryForChat();
  const timelineContext = getTimelineStateContext();
  const currentDate = new Date().toISOString().split('T')[0];

  const systemInstruction = buildSystemInstruction(currentDate, channelContext, memoryContext, timelineContext);

  // Planning loop - explore all needed operations
  while (currentRound < maxRounds) {
    currentRound++;

    const chat = ai.chats.create({
      model: 'gemini-2.5-flash-lite',
      history: conversationHistory,
      config: {
        systemInstruction: systemInstruction,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        tools: [{
          functionDeclarations: allVideoEditingTools
        }],
      },
    });

    // Send message (first round uses user message, subsequent rounds send empty to continue)
    // Empty message after function responses lets model continue without adding another user turn
    const response = await chat.sendMessage({
      message: currentRound === 1 ? message : '',
    });

    // Check if model wants to call functions
    if (response.functionCalls && response.functionCalls.length > 0) {
      // Collect all function calls from this round
      for (const functionCall of response.functionCalls) {
        if (!functionCall.name) continue; // Skip if no name
        
        const operation: PlannedOperation = {
          round: currentRound,
          functionCall: {
            name: functionCall.name,
            args: functionCall.args,
          },
          description: generateOperationDescription(functionCall),
          isReadOnly: isReadOnlyOperation(functionCall.name),
        };
        operations.push(operation);
      }

      // Simulate execution to get results for next round
      const simulatedResults = simulateFunctionExecution(response.functionCalls);

      // Add model's content and function responses to history
      conversationHistory.push(response.candidates?.[0]?.content as any);

      for (let i = 0; i < response.functionCalls.length; i++) {
        const functionCall = response.functionCalls[i];
        conversationHistory.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: functionCall.name,
              response: simulatedResults[i]
            }
          }] as any,
        });
      }
    } else {
      // No more function calls - planning complete
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
  originalHistory: GeminiChatMessage[],
  originalMessage: string,
  onProgress?: (current: number, total: number, operation: PlannedOperation) => void
): Promise<string> {
  if (!ai) {
    throw new Error('Gemini API key not configured');
  }

  const { ToolExecutor } = await import('./toolExecutor');
  const conversationHistory = [...originalHistory];

  // Add original user message
  conversationHistory.push({
    role: 'user',
    parts: [{ text: originalMessage }],
  });

  let currentRound = 1;
  const operationsByRound = groupOperationsByRound(plan.operations);
  let completedOperations = 0;

  // Execute operations round by round
  for (const [_round, roundOperations] of operationsByRound.entries()) {
    // Execute all operations in this round ONE BY ONE (not in parallel)
    const functionCalls = roundOperations.map(op => op.functionCall);
    
    // Execute each operation sequentially and track progress
    const results = await ToolExecutor.executeAll(
      functionCalls as any,
      (index, _total, _result) => {
        // ToolExecutor.executeAll passes 1-based index, convert to 0-based for array access
        const operationIndex = index - 1;
        
        // Safety check: ensure operation exists
        if (operationIndex >= 0 && operationIndex < roundOperations.length) {
          const currentOperation = roundOperations[operationIndex];
          completedOperations++;
          onProgress?.(completedOperations, plan.operations.length, currentOperation);
        } else {
          console.warn(`Operation index ${operationIndex} out of bounds for round operations (length: ${roundOperations.length})`);
        }
      }
    );

    // Check for any failed operations
    const failedOps = results.filter(r => !r.result.success);
    if (failedOps.length > 0) {
      const errorMessages = failedOps.map(op => `${op.name}: ${op.result.error || 'Unknown error'}`).join('\n');
      throw new Error(`Some operations failed:\n${errorMessages}`);
    }

    // Build model response with function calls
    const modelContent = {
      role: 'model',
      parts: functionCalls.map(fc => ({
        functionCall: fc
      }))
    };

    conversationHistory.push(modelContent as any);

    // Add function responses
    for (let i = 0; i < results.length; i++) {
      conversationHistory.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: results[i].name,
            response: results[i].result
          }
        }] as any,
      });
    }

    currentRound++;
  }

  // Get final response from Gemini without function calling
  const channelContext = getChannelAnalysisContext();
  const memoryContext = getMemoryForChat();
  const timelineContext = getTimelineStateContext();
  const currentDate = new Date().toISOString().split('T')[0];
  
  // Create a summary-focused system instruction WITHOUT tools
  const summaryInstruction = `<role>
You are Gemini, a helpful AI assistant in QuickCut video editor.
</role>

<task>
All requested editing operations have been completed successfully. 
Provide a friendly, concise summary of what was done.
Do NOT call any more functions - just summarize the results.
</task>

<format>
- Be specific about what operations were performed
- Mention clip names, durations, and changes made
- Keep it conversational and clear
- End with encouragement or next steps if appropriate
</format>${channelContext}${memoryContext}${timelineContext}`;

  // Create chat WITHOUT tools to prevent more function calls
  const chat = ai.chats.create({
    model: 'gemini-2.5-flash-lite',
    history: conversationHistory,
    config: {
      systemInstruction: summaryInstruction,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      // NO tools here - we don't want more function calls
    },
  });

  // Ask for a summary
  const response = await chat.sendMessage({ 
    message: 'Summarize what operations were completed.' 
  });
  return response.text || 'Operations completed successfully.';
}

/**
 * Simulate function execution to get mock results for planning
 * Returns realistic mock data so the model can plan subsequent operations
 */
function simulateFunctionExecution(functionCalls: any[]): any[] {
  const state = useProjectStore.getState();
  
  return functionCalls.map(fc => {
    // For read-only functions, return actual current state
    if (fc.name === 'get_timeline_info') {
      const totalDuration = state.getTotalDuration();
      const clipCount = state.clips.length;
      return { 
        success: true, 
        data: {
          totalDuration: totalDuration,
          clipCount: clipCount,
          clips: state.clips.map((clip: any) => ({
            id: clip.id,
            name: clip.name,
            startTime: clip.startTime,
            duration: clip.duration,
            endTime: clip.startTime + clip.duration
          }))
        }
      };
    } else if (fc.name === 'get_clip_details') {
      const clip = state.clips.find((c: any) => c.id === fc.args.clip_id);
      if (clip) {
        return {
          success: true,
          data: {
            id: clip.id,
            name: clip.name,
            duration: clip.duration,
            startTime: clip.startTime,
            volume: clip.volume || 1,
            muted: clip.muted || false
          }
        };
      }
      return { success: false, error: 'Clip not found' };
    } else {
      // For state-changing functions, return optimistic success 
      return { 
        success: true, 
        message: `Successfully executed ${fc.name.replace(/_/g, ' ')}`,
        details: fc.args
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
    'search_clips_by_content'
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

/**
 * Build system instruction with context
 */
function buildSystemInstruction(
  _currentDate: string,
  channelContext: string,
  memoryContext: string,
  timelineContext: string
): string {
  return `<role>
You are Gemini, a professional video editing assistant integrated into QuickCut.
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

3. THINK STEP-BY-STEP
   - Break complex tasks into logical steps
   - Execute ALL steps needed to reach the goal
   - Continue until the task is 100% complete

4. MULTI-ROUND EXECUTION
   - Call tools multiple times if needed
   - Each round builds on the previous one
   - Keep going until the final goal is achieved

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

Example 3: "Make a 15 second video from these 2 clips, each should be equal length"
Step-by-step thinking:
1. Target: 15 seconds total, 2 clips of 7.5 seconds each
2. Check current clips → get_timeline_info
3. If clip 1 is longer than 7.5s → update_clip_bounds (to 7.5s)
4. If clip 2 is longer than 7.5s → update_clip_bounds (to 7.5s)
5. Verify total duration is 15s
6. Each clip is 7.5s → task complete
</detailed-examples>

<constraints>
- ALWAYS complete the full task, never stop halfway
- Be mathematically precise with durations and splits
- Verify your operations will achieve the user's exact goal
- If user says "X seconds", deliver exactly X seconds
- If user says "split into N parts", create exactly N parts
</constraints>

<grounding>
You have access to:
1. Current timeline state (clips, durations, positions)
2. User's YouTube channel context (if available)
3. User's project memory (analyzed media files)
4. Conversation history

Base all decisions on actual timeline state, not assumptions.
</grounding>

<available-tools>
Information: get_timeline_info, get_clip_details
Editing: split_clip, delete_clips, move_clip, merge_clips
Audio: set_clip_volume, toggle_clip_mute
Management: select_clips, copy_clips, paste_clips
History: undo_action, redo_action
Playback: set_playhead_position
Trimming: update_clip_bounds
</available-tools>${channelContext}${memoryContext}${timelineContext}`;
}

/**
 * Get channel analysis context from localStorage
 */
function getChannelAnalysisContext(): string {
  try {
    const onboardingData = localStorage.getItem('onboarding-storage');
    if (!onboardingData) return '';

    const parsed = JSON.parse(onboardingData);
    const analysisData = parsed?.state?.analysisData;

    if (!analysisData) return '';

    const { channel, analysis } = analysisData;

    return `\n\n=== USER'S YOUTUBE CHANNEL CONTEXT ===
Channel: ${channel.title}
Subscribers: ${channel.subscriber_count.toLocaleString()}
Videos: ${channel.video_count}

Channel Summary: ${analysis.channel_summary}

Content Strengths:
${analysis.content_strengths.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Editing Style Recommendations:
${analysis.editing_style_recommendations.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Growth Opportunities:
${analysis.growth_suggestions.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

Use this context to provide personalized advice tailored to their channel and content style.
===================================`;
  } catch (error) {
    console.error('Error loading channel analysis context:', error);
    return '';
  }
}

/**
 * Get timeline state context
 */
function getTimelineStateContext(): string {
  try {
    const state = useProjectStore.getState();
    
    if (state.clips.length === 0) {
      return '\n\n=== TIMELINE STATE ===\nTimeline is empty. No clips have been added yet.\n===========================\n';
    }

    const clipSummaries = state.clips
      .sort((a, b) => a.startTime - b.startTime)
      .map((clip, index) => {
        const selectedMark = state.selectedClipIds.includes(clip.id) ? '✓' : ' ';
        const mutedMark = clip.muted ? '🔇' : '';
        const volumePct = Math.round((clip.volume || 1) * 100);
        const trackLabel = (clip.trackIndex ?? 0) < 10 ? `Video ${clip.trackIndex ?? 0}` : `Audio ${(clip.trackIndex ?? 10) - 10}`;
        
        return `${index + 1}. [${selectedMark}] ${clip.name}
   ID: ${clip.id}
   Timeline: ${clip.startTime.toFixed(1)}s → ${(clip.startTime + clip.duration).toFixed(1)}s (duration: ${clip.duration.toFixed(1)}s)
   Source: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s of ${clip.sourceDuration.toFixed(1)}s total
   Track: ${trackLabel}
   Volume: ${volumePct}% ${mutedMark}
   Type: ${clip.mediaType || 'video'}`;
      })
      .join('\n\n');

    const totalDuration = state.getTotalDuration();
    const selectedCount = state.selectedClipIds.length;

    return `\n\n=== TIMELINE STATE ===
Total Clips: ${state.clips.length}
Total Duration: ${totalDuration.toFixed(1)} seconds
Selected Clips: ${selectedCount}
Current Playhead: ${state.currentTime.toFixed(1)}s
Playing: ${state.isPlaying ? 'Yes' : 'No'}

CLIPS (in timeline order):
${clipSummaries}

EDITING HISTORY:
Can Undo: ${state.canUndo() ? 'Yes' : 'No'}
Can Redo: ${state.canRedo() ? 'Yes' : 'No'}
===========================\n`;
  } catch (error) {
    console.error('Error loading timeline state context:', error);
    return '';
  }
}
