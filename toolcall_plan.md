# Gemini AI Video Editing Tool Calling - Complete Implementation Plan

**Project:** QuickCut Video Editor with AI-Powered Editing Assistance  
**Document Version:** 1.0  
**Date:** February 13, 2026  
**Status:** Planning Phase

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Gemini Function Calling Architecture](#gemini-function-calling-architecture)
4. [Video Editing Operations Available](#video-editing-operations-available)
5. [Implementation Strategy](#implementation-strategy)
6. [Detailed Implementation Steps](#detailed-implementation-steps)
7. [Tool Declarations Design](#tool-declarations-design)
8. [Execution Flow Diagram](#execution-flow-diagram)
9. [User Experience & Approval System](#user-experience--approval-system)
10. [Error Handling & Safety](#error-handling--safety)
11. [Testing Strategy](#testing-strategy)
12. [Future Enhancements](#future-enhancements)

---

## Executive Summary

### Vision
Enable Gemini AI to understand, plan, and execute video editing operations on behalf of the user. The AI will act as an intelligent assistant that can perform manual video editing tasks (cut, split, merge, move clips, adjust volume, etc.) based on natural language commands.

### Key Principles
1. **Safety First**: All AI actions require user approval before execution
2. **Transparency**: Always show what the AI plans to do before doing it
3. **Context Awareness**: AI has full visibility of timeline state and project memory
4. **Intelligent Planning**: AI can plan multi-step operations for complex requests
5. **Error Recovery**: Graceful handling of failures with helpful feedback

### Example User Interactions

**Simple Command:**
```
User: "Split the first clip at 10 seconds"
Gemini: "I'll split clip 'intro.mp4' at 10 seconds. This will create two clips."
[Execute Button] [Cancel Button]
→ User clicks Execute
→ Action performed, timeline updated
→ Gemini: "✓ Split complete! You now have 'intro.mp4 (1)' and 'intro.mp4 (2)'"
```

**Complex Multi-Step:**
```
User: "Clean up my timeline by removing all gaps and setting everything to 70% volume"
Gemini: "I'll help you optimize your timeline. Here's what I plan to do:
1. Move clip 'scene2.mp4' from 15s to 8s (closes 7s gap)
2. Move clip 'scene3.mp4' from 25s to 18s (closes 7s gap)  
3. Set volume to 0.7 for all 10 clips
[Execute All] [Cancel]"
→ User clicks Execute All
→ Gemini performs operations sequentially with progress updates
→ Gemini: "✓ Timeline optimized! Removed 2 gaps and adjusted volume for all clips."
```

---

## Current State Analysis

### What We Already Have ✅

#### 1. **Complete Video Editing Operations** ([src/stores/useProjectStore.ts](src/stores/useProjectStore.ts))
The Zustand store exposes ~50 operations including:
- **Clip CRUD**: `addClip`, `removeClip`, `updateClip`
- **Timeline Manipulation**: `moveClipToTime`, `splitClip`, `mergeSelectedClips`
- **Copy/Paste**: `copyClips`, `pasteClips`
- **Selection**: `toggleClipSelection`, `selectClips`
- **Audio**: `setClipVolume`, `toggleClipMute`
- **History**: `undo`, `redo`, `canUndo`, `canRedo`
- **Playback**: `setCurrentTime`, `setIsPlaying`, `getClipAtTime`
- **Export**: Export format/resolution configuration
- **Transcription**: `transcribeCurrentClip`, `applyTranscriptEdits`

#### 2. **Sophisticated Gemini Integration** ([src/lib/geminiService.ts](src/lib/geminiService.ts))
- Using **Gemini 3 Flash Preview** model
- Multi-turn chat with streaming responses
- Context caching (1 hour TTL)
- Multimodal support (images, video, audio, PDFs)
- File API integration for large files (>20MB)
- System instructions with channel/memory context
- Token counting and cost tracking

#### 3. **Gemini Memory System** ([src/lib/geminiMemoryService.ts](src/lib/geminiMemoryService.ts))
- Automatic media analysis when files imported
- Structured outputs using Zod schemas
- Queue-based processing (2 concurrent max)
- Project-specific memory storage
- File API integration for large videos

#### 4. **Chat Interface** ([src/components/Chat/ChatPanel.tsx](src/components/Chat/ChatPanel.tsx))
- Real-time streaming chat
- File attachments (drag-drop, picker)
- Memory context awareness
- Token counter and cost tracking
- Message history management

### What We Need to Build 🔨

#### 1. **Function Declarations** 
Define ~15-20 video editing tools as Gemini function declarations with proper schemas

#### 2. **Timeline State Serialization**
Convert current project state to concise text for Gemini's context

#### 3. **Function Call Handler**
Detect and process function calls from Gemini responses

#### 4. **Tool Executor/Router**
Map function names to store methods and execute them safely

#### 5. **Approval UI**
Show AI's plan to user and get confirmation before execution

#### 6. **Feedback Loop**
Send execution results back to Gemini for confirmation/error handling

#### 7. **Safety Guards**
Validation, rate limiting, error recovery mechanisms

---

## Gemini Function Calling Architecture

### How Function Calling Works (per `/gemini_documentations/gemini_function_Calling.md`)

#### **4-Step Process:**

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. DEFINE FUNCTION DECLARATIONS                                 │
│    - Create JSON schemas describing each tool                   │
│    - Include name, description, parameters, required fields     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. SEND TO MODEL WITH TOOLS                                     │
│    - Include function declarations in `config.tools`            │
│    - Model analyzes prompt + context + available tools          │
│    - Decides: respond with text OR call function(s)             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. EXECUTE FUNCTION (YOUR RESPONSIBILITY)                       │
│    - Check response for `response.functionCalls`                │
│    - Extract function name and arguments                        │
│    - Execute the actual function in your application            │
│    - Capture the result                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. SEND RESULT BACK TO MODEL                                    │
│    - Create functionResponse part with result                   │
│    - Append to conversation history                             │
│    - Model generates user-friendly response                     │
└─────────────────────────────────────────────────────────────────┘
```

### Function Declaration Schema (per Gemini docs)

**Example from documentation:**
```javascript
const setLightValuesFunctionDeclaration = {
  name: 'set_light_values',
  description: 'Sets the brightness and color temperature of a light.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      brightness: {
        type: Type.NUMBER,
        description: 'Light level from 0 to 100. Zero is off and 100 is full brightness',
      },
      color_temp: {
        type: Type.STRING,
        enum: ['daylight', 'cool', 'warm'],
        description: 'Color temperature of the light fixture.',
      },
    },
    required: ['brightness', 'color_temp'],
  },
};
```

### Function Calling Modes (per docs)

From `/gemini_documentations/gemini_function_Calling.md`:

1. **AUTO** (Default): Model decides whether to respond with text or function call
2. **ANY**: Force model to always call a function (guarantees function call)
3. **NONE**: Disable function calling temporarily
4. **VALIDATED** (Preview): Model can call functions or respond naturally, ensures schema adherence

**For our use case:** We'll use **AUTO mode** (default) because:
- Users will chat normally ("What can I do?") AND give commands ("Split this clip")
- Model should intelligently choose when to use tools vs. respond with advice
- Most flexible for conversational AI assistant

### Key Features We'll Use

#### **Parallel Function Calling**
Execute multiple independent operations at once:
```
User: "Set all clips to 50% volume and mute the background music track"
→ Gemini calls: setClipVolume() × 10 clips + toggleClipMute() × 1 clip
→ We execute all in parallel (or sequentially with progress)
```

#### **Compositional (Sequential) Function Calling**
Chain dependent operations:
```
User: "Find clips longer than 30 seconds and split them in half"
→ Gemini calls: getClips() with duration filter
→ We return matching clip IDs
→ Gemini calls: splitClip() for each, calculating midpoint
→ We execute splits sequentially
```

#### **Manual Function Calling Mode**
We'll use **manual mode** to implement approval system:
```javascript
config: {
  tools: [{ functionDeclarations: [...] }],
  // No automatic execution - we handle it
}
```

Then check response:
```javascript
if (response.functionCalls && response.functionCalls.length > 0) {
  // Show approval UI to user
  // User clicks "Execute"
  // Then we execute and send results back
}
```

### Thought Signatures (Gemini 3+ Models)

From docs: "Gemini 3 models use internal 'thinking' to reason through requests."

**Important:** When manually managing conversation history:
- Always send `thought_signature` back in original Part
- Don't merge Parts containing signatures
- **The Google GenAI SDK handles this automatically** ✓

Since we're using the SDK, we don't need to manage thought signatures manually.

---

## Video Editing Operations Available

### Complete List from useProjectStore

Here are all operations we can expose to Gemini:

| Category | Operation | Parameters | Description |
|----------|-----------|------------|-------------|
| **Clip Management** | `addClip` | clip object | Add new clip to timeline |
| | `removeClip` | clipId: string | Remove clip from timeline |
| | `updateClip` | clipId, updates | Update clip properties |
| | `setActiveClip` | clipId: string | Set as active/selected clip |
| **Splitting & Merging** | `splitClip` | clipId, time: number | Split clip at time position |
| | `mergeSelectedClips` | (uses selection) | Merge 2+ selected clips |
| **Timeline** | `moveClipToTime` | clipId, startTime, trackIndex? | Move clip to new position |
| | `reorderClips` | startIndex, endIndex | Change clip order |
| | `getTotalDuration` | - | Get total timeline duration |
| | `getClipAtTime` | time: number | Find clip at timeline position |
| | `getActiveClips` | time: number | Get all clips active at time |
| **Selection** | `toggleClipSelection` | clipId, multiSelect | Toggle clip selection |
| | `selectClips` | clipIds: string[] | Select multiple clips |
| **Copy/Paste** | `copyClips` | (uses selection) | Copy selected clips |
| | `pasteClips` | - | Paste copied clips |
| **Audio** | `setClipVolume` | clipId, volume: 0-1 | Set clip volume |
| | `toggleClipMute` | clipId | Mute/unmute clip |
| **History** | `undo` | - | Undo last action |
| | `redo` | - | Redo last undone action |
| | `canUndo` | - | Check if undo available |
| | `canRedo` | - | Check if redo available |
| **Playback** | `setCurrentTime` | time: number | Set playhead position |
| | `setIsPlaying` | playing: boolean | Play/pause timeline |
| **Export** | `setExportFormat` | format: mp4/mov/avi/webm | Set export format |
| | `setExportResolution` | resolution: string | Set export resolution |
| **Timeline Settings** | `setSnapToGrid` | enabled: boolean | Enable/disable snap to grid |
| | `setGridSize` | size: number | Set grid size in seconds |
| **Transcription** | `transcribeCurrentClip` | - | Transcribe active clip |
| | `transcribeTimeline` | - | Transcribe entire timeline |
| | `applyTranscriptEdits` | deletionRanges | Apply transcript-based edits |
| | `clearTranscription` | - | Clear transcription data |
| **Project** | `saveProject` | - | Save project to disk |
| | `loadProject` | - | Load project from disk |
| | `newProject` | - | Create new project |

### Which Operations to Expose as Tools?

**Phase 1 - Core Editing Tools (~15 tools):**
1. ✅ `get_timeline_info` - Get clips, duration, selections (read-only)
2. ✅ `split_clip` - Split at position
3. ✅ `delete_clips` - Remove one or multiple clips
4. ✅ `move_clip` - Change position/track
5. ✅ `merge_clips` - Merge multiple clips
6. ✅ `copy_paste_clips` - Copy and paste operations
7. ✅ `set_volume` - Adjust clip volume
8. ✅ `toggle_mute` - Mute/unmute clip
9. ✅ `select_clips` - Select clips by ID or criteria
10. ✅ `undo_action` - Undo last change
11. ✅ `redo_action` - Redo last undo
12. ✅ `set_playhead` - Move playhead position
13. ✅ `update_clip_bounds` - Trim start/end of clip
14. ✅ `reorder_clips` - Change clip order
15. ✅ `get_clip_details` - Get detailed info about specific clip

**Phase 2 - Advanced Tools:**
- Transcription operations
- Export configuration
- Timeline settings (snap, grid)
- Multi-track operations
- Subtitle management

---

## Implementation Strategy

### Design Philosophy

1. **Progressive Enhancement**: Start with core tools, add more based on usage
2. **Manual Approval**: User always reviews AI's plan before execution
3. **Atomic Operations**: Each tool does one thing well
4. **Intelligent Defaults**: AI suggests sensible parameters when ambiguous
5. **Conversational**: AI explains what it's doing in plain language

### Technology Stack

- **Function Calling SDK**: `@google/genai` (already integrated)
- **Schema Validation**: TypeScript types + runtime validation
- **State Management**: Existing Zustand stores (useProjectStore)
- **UI Framework**: React + existing component patterns
- **Type Safety**: Type.OBJECT, Type.STRING, Type.NUMBER from `@google/genai`

### Architecture Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INPUT                              │
│   "Split the second clip at 15 seconds and lower volume to 50%" │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   GEMINI SERVICE (Enhanced)                     │
│  • Receives message with timeline context                       │
│  • Has access to 15 function declarations                       │
│  • Analyzes request and plans operations                        │
│  • Returns function calls OR text response                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    (If function calls detected)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      CHAT PANEL (Enhanced)                      │
│  • Detects "tool_plan" chunk in stream                          │
│  • Displays approval UI with operation details                  │
│  • User clicks [Execute All] or [Cancel]                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                      (If user approves)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     TOOL EXECUTOR MODULE                        │
│  • Validates all function calls                                 │
│  • Maps function names → store methods                          │
│  • Executes operations sequentially                             │
│  • Collects results & errors                                    │
│  • Shows progress in UI                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     PROJECT STORE (Existing)                    │
│  • Performs actual video editing operations                     │
│  • Updates timeline state                                       │
│  • Records to history (undo/redo)                               │
│  • Triggers re-renders                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   FEEDBACK LOOP TO GEMINI                       │
│  • Send execution results back to Gemini                        │
│  • Gemini generates confirmation message                        │
│  • "✓ Split complete! Clip volume set to 50%"                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                   (User sees final response)
```

---

## Detailed Implementation Steps

### Step 1: Create Function Declarations

**File:** `src/lib/videoEditingTools.ts` (NEW)

**What:** Define all video editing tools as Gemini function declarations

**Why:** Gemini needs structured schemas to understand what operations are available

**Example Structure:**
```typescript
import { Type } from '@google/genai';

export const splitClipDeclaration = {
  name: 'split_clip',
  description: 'Splits a video clip at a specific time position into two separate clips. Use this when the user wants to cut a clip into parts.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      clip_id: {
        type: Type.STRING,
        description: 'The unique ID of the clip to split. Get this from get_timeline_info.',
      },
      time_in_clip: {
        type: Type.NUMBER,
        description: 'Position in seconds within the clip where to split (relative to clip start, not timeline).',
      },
    },
    required: ['clip_id', 'time_in_clip'],
  },
};

export const setVolumeDeclaration = {
  name: 'set_clip_volume',
  description: 'Sets the volume level for one or more clips. Volume ranges from 0.0 (silent) to 1.0 (full volume).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      clip_ids: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Array of clip IDs to adjust volume for. Use ["all"] to affect all clips.',
      },
      volume: {
        type: Type.NUMBER,
        description: 'Volume level from 0.0 to 1.0. Examples: 0.0 = muted, 0.5 = 50%, 1.0 = 100%',
      },
    },
    required: ['clip_ids', 'volume'],
  },
};

// ... 13 more declarations
```

**All Tools to Define:**
1. `get_timeline_info` - Returns clip list, selections, duration
2. `split_clip` - Split clip at position
3. `delete_clips` - Remove clips by ID
4. `move_clip` - Move clip to new time/track
5. `merge_clips` - Merge multiple clips
6. `copy_clips` - Copy clips to clipboard
7. `paste_clips` - Paste from clipboard
8. `set_clip_volume` - Set volume level
9. `toggle_clip_mute` - Mute/unmute
10. `select_clips` - Select by ID or all
11. `undo_action` - Undo last change
12. `redo_action` - Redo last undo
13. `set_playhead_position` - Move playhead
14. `update_clip_bounds` - Trim start/end
15. `get_clip_details` - Get detailed clip info

**Export:**
```typescript
export const allVideoEditingTools = [
  splitClipDeclaration,
  setVolumeDeclaration,
  // ... all others
];
```

### Step 2: Timeline State Serialization

**File:** `src/lib/geminiService.ts` (MODIFY)

**What:** Add function to serialize current timeline state into text

**Why:** Gemini needs to understand the current state to make intelligent decisions

**Function to Add:**
```typescript
function getTimelineStateContext(): string {
  // Access store without hooks (direct access)
  const state = useProjectStore.getState();
  
  if (state.clips.length === 0) {
    return '\n\n=== TIMELINE STATE ===\nTimeline is empty. No clips have been added yet.\n';
  }

  // Build concise timeline representation
  const clipSummaries = state.clips
    .sort((a, b) => a.startTime - b.startTime)
    .map((clip, index) => {
      const selectedMark = state.selectedClipIds.includes(clip.id) ? '✓' : ' ';
      const mutedMark = clip.muted ? '🔇' : '';
      const volumePct = Math.round((clip.volume || 1) * 100);
      
      return `${index + 1}. [${selectedMark}] ${clip.name}
     ID: ${clip.id}
     Timeline: ${clip.startTime.toFixed(1)}s → ${(clip.startTime + clip.duration).toFixed(1)}s (duration: ${clip.duration.toFixed(1)}s)
     Source: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s of ${clip.sourceDuration.toFixed(1)}s
     Track: ${clip.trackIndex || 0}
     Volume: ${volumePct}% ${mutedMark}`;
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
}
```

**Integration Point:**
Add to system instruction dynamically:
```typescript
const timelineContext = getTimelineStateContext();
systemInstruction = `${baseSystemInstruction}${channelContext}${memoryContext}${timelineContext}`;
```

### Step 3: Enhanced System Instructions

**File:** `src/lib/geminiService.ts` (MODIFY)

**What:** Update system instruction to document available tools and when to use them

**Add to System Instruction:**
```typescript
<video-editing-tools>
You have access to video editing tools that let you manipulate the timeline:

AVAILABLE TOOLS:
1. get_timeline_info: Get current state of timeline (clips, selections, duration)
2. split_clip: Split a clip into two parts at a specific time
3. delete_clips: Remove one or more clips from timeline
4. move_clip: Move a clip to a different position or track
5. merge_clips: Combine multiple clips into one
6. copy_clips + paste_clips: Duplicate clips
7. set_clip_volume: Adjust volume (0.0 to 1.0)
8. toggle_clip_mute: Mute or unmute clips
9. select_clips: Select specific clips for operations
10. undo_action / redo_action: Undo/redo editing history
11. set_playhead_position: Move the playhead
12. update_clip_bounds: Trim start/end of a clip
13. get_clip_details: Get detailed information about a clip

WHEN TO USE TOOLS:
- User asks to perform editing operations ("split this", "move clip", "adjust volume")
- User requests timeline modifications ("clean up gaps", "remove silence")
- User wants to preview or understand timeline state ("show my clips", "what's selected?")

HOW TO USE TOOLS:
1. Understand user's intent
2. Get timeline state first if needed (use get_timeline_info)
3. Plan operations step by step
4. Call appropriate tools with correct parameters
5. Explain what you're doing in plain language

IMPORTANT RULES:
- Always reference clips by their ID, not just by name (multiple clips can have same name)
- For time-based operations, clarify if time is relative to clip start or timeline position
- When multiple clips match a description, ask user to clarify or select all matches
- Explain your plan before executing - don't just silently call tools
- If an operation seems destructive (delete, overwrite), be extra clear about what will happen

EXAMPLES:
User: "Split the intro clip at 10 seconds"
You: "I'll split the 'intro.mp4' clip at 10 seconds. This will create two separate clips."
→ Call: split_clip(clip_id="abc123", time_in_clip=10)

User: "Make everything quieter"
You: "I'll set all clips to 50% volume (0.5). This affects all 5 clips in your timeline."
→ Call: set_clip_volume(clip_ids=["all"], volume=0.5)

User: "What's on my timeline?"
→ Call: get_timeline_info()
→ Respond with formatted clip list and summary
</video-editing-tools>
```

### Step 4: Function Call Handler in geminiService

**File:** `src/lib/geminiService.ts` (MODIFY)

**What:** Modify `sendMessageWithHistoryStream()` to:
1. Include tools in chat config
2. Detect function calls in response
3. Yield special "tool_plan" chunks to UI

**Modifications:**

**A) Import tools:**
```typescript
import { allVideoEditingTools } from './videoEditingTools';
```

**B) Add tools to chat config:**
```typescript
const chat = ai.chats.create({
  model: 'gemini-3-flash-preview',
  history: history,
  config: {
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
    systemInstruction: `...existing...${timelineContext}`,
    tools: [{
      functionDeclarations: allVideoEditingTools
    }],
    // Note: Default mode is AUTO (model decides when to use tools)
  },
});
```

**C) After sending message, check for function calls:**
```typescript
const response = await chat.sendMessage({ message: allParts });

// Check if response contains function calls
if (response.functionCalls && response.functionCalls.length > 0) {
  // Yield special chunk for UI to handle
  yield {
    type: 'tool_plan',
    functionCalls: response.functionCalls,
    modelContent: response.candidates[0].content, // Save for conversation history
  };
  return; // Stop here - wait for user approval
}

// Otherwise, yield text response as normal
if (response.text) {
  yield { type: 'text', text: response.text };
}
```

**D) Add function to execute tools and continue conversation:**
```typescript
export async function* sendToolResultsToGemini(
  originalHistory: GeminiChatMessage[],
  modelContent: any,
  toolResults: Array<{ name: string; result: any }>
): AsyncGenerator<StreamChunk> {
  if (!ai) throw new Error('Gemini API not configured');

  // Build conversation with tool responses
  const contents = [...originalHistory];
  
  // Add model's content (contains function calls)
  contents.push(modelContent);
  
  // Add tool responses
  for (const toolResult of toolResults) {
    contents.push({
      role: 'user',
      parts: [{
        functionResponse: {
          name: toolResult.name,
          response: { result: toolResult.result }
        }
      }]
    });
  }

  const timelineContext = getTimelineStateContext();
  const channelContext = getChannelAnalysisContext();
  const memoryContext = getMemoryForChat();

  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    history: contents,
    config: {
      systemInstruction: `...${timelineContext}...`,
      tools: [{ functionDeclarations: allVideoEditingTools }],
    },
  });

  // Get final response from model
  const response = await chat.sendMessage({ message: 'Continue' });
  
  if (response.text) {
    yield { type: 'text', text: response.text };
  }
  
  // Include token metadata
  if (response.usageMetadata) {
    yield {
      type: 'metadata',
      tokens: {
        inputTokens: response.usageMetadata.promptTokenCount,
        outputTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount,
      }
    };
  }
}
```

### Step 5: Tool Executor Module

**File:** `src/lib/toolExecutor.ts` (NEW)

**What:** Maps function names to actual store operations and executes them

**Complete Implementation:**
```typescript
import { useProjectStore } from '../stores/useProjectStore';
import type { Clip } from '../stores/useProjectStore';

interface FunctionCall {
  name: string;
  args: Record<string, any>;
}

interface ToolResult {
  name: string;
  result: {
    success: boolean;
    message: string;
    data?: any;
    error?: string;
  };
}

export class ToolExecutor {
  
  /**
   * Validate a function call before execution
   */
  private static validateFunctionCall(call: FunctionCall): { valid: boolean; error?: string } {
    const state = useProjectStore.getState();
    
    switch (call.name) {
      case 'split_clip': {
        const { clip_id, time_in_clip } = call.args;
        const clip = state.clips.find(c => c.id === clip_id);
        if (!clip) return { valid: false, error: `Clip ${clip_id} not found` };
        if (time_in_clip <= 0 || time_in_clip >= clip.duration) {
          return { valid: false, error: `Split time must be between 0 and ${clip.duration}` };
        }
        return { valid: true };
      }
      
      case 'set_clip_volume': {
        const { volume } = call.args;
        if (volume < 0 || volume > 1) {
          return { valid: false, error: 'Volume must be between 0.0 and 1.0' };
        }
        return { valid: true };
      }
      
      case 'delete_clips': {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: 'Must provide at least one clip ID' };
        }
        // Check all clips exist
        const missing = clip_ids.filter(id => !state.clips.find(c => c.id === id));
        if (missing.length > 0) {
          return { valid: false, error: `Clips not found: ${missing.join(', ')}` };
        }
        return { valid: true };
      }
      
      // Add validation for other tools...
      
      default:
        return { valid: true }; // Allow by default
    }
  }
  
  /**
   * Execute a single function call
   */
  private static executeSingle(call: FunctionCall): ToolResult {
    const store = useProjectStore.getState();
    
    try {
      switch (call.name) {
        
        case 'get_timeline_info': {
          const clips = store.clips.map(c => ({
            id: c.id,
            name: c.name,
            startTime: c.startTime,
            duration: c.duration,
            trackIndex: c.trackIndex,
            selected: store.selectedClipIds.includes(c.id),
          }));
          return {
            name: call.name,
            result: {
              success: true,
              message: `Retrieved ${clips.length} clips`,
              data: {
                clips,
                totalDuration: store.getTotalDuration(),
                selectedCount: store.selectedClipIds.length,
                currentTime: store.currentTime,
              }
            }
          };
        }
        
        case 'split_clip': {
          const { clip_id, time_in_clip } = call.args;
          const clip = store.clips.find(c => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);
          
          store.splitClip(clip_id, time_in_clip);
          
          return {
            name: call.name,
            result: {
              success: true,
              message: `Split "${clip.name}" at ${time_in_clip.toFixed(1)}s`,
            }
          };
        }
        
        case 'delete_clips': {
          const { clip_ids } = call.args;
          const clips = clip_ids.map((id: string) => store.clips.find(c => c.id === id)?.name);
          
          clip_ids.forEach((id: string) => store.removeClip(id));
          
          return {
            name: call.name,
            result: {
              success: true,
              message: `Deleted ${clip_ids.length} clip(s): ${clips.join(', ')}`,
            }
          };
        }
        
        case 'move_clip': {
          const { clip_id, start_time, track_index } = call.args;
          const clip = store.clips.find(c => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);
          
          store.moveClipToTime(clip_id, start_time, track_index);
          
          return {
            name: call.name,
            result: {
              success: true,
              message: `Moved "${clip.name}" to ${start_time.toFixed(1)}s`,
            }
          };
        }
        
        case 'set_clip_volume': {
          const { clip_ids, volume } = call.args;
          
          // Handle "all" keyword
          const targetIds = clip_ids.includes('all') 
            ? store.clips.map(c => c.id)
            : clip_ids;
          
          targetIds.forEach((id: string) => store.setClipVolume(id, volume));
          
          return {
            name: call.name,
            result: {
              success: true,
              message: `Set volume to ${Math.round(volume * 100)}% for ${targetIds.length} clip(s)`,
            }
          };
        }
        
        case 'toggle_clip_mute': {
          const { clip_ids } = call.args;
          clip_ids.forEach((id: string) => store.toggleClipMute(id));
          
          return {
            name: call.name,
            result: {
              success: true,
              message: `Toggled mute for ${clip_ids.length} clip(s)`,
            }
          };
        }
        
        case 'undo_action': {
          if (!store.canUndo()) throw new Error('Nothing to undo');
          store.undo();
          return {
            name: call.name,
            result: { success: true, message: 'Undid last action' }
          };
        }
        
        case 'redo_action': {
          if (!store.canRedo()) throw new Error('Nothing to redo');
          store.redo();
          return {
            name: call.name,
            result: { success: true, message: 'Redid last action' }
          };
        }
        
        case 'select_clips': {
          const { clip_ids } = call.args;
          const targetIds = clip_ids.includes('all')
            ? store.clips.map(c => c.id)
            : clip_ids;
          
          store.selectClips(targetIds);
          return {
            name: call.name,
            result: { success: true, message: `Selected ${targetIds.length} clip(s)` }
          };
        }
        
        case 'merge_clips': {
          const { clip_ids } = call.args;
          store.selectClips(clip_ids);
          store.mergeSelectedClips();
          
          return {
            name: call.name,
            result: { success: true, message: `Merged ${clip_ids.length} clips` }
          };
        }
        
        // ... implement other tools
        
        default:
          throw new Error(`Unknown function: ${call.name}`);
      }
      
    } catch (error) {
      return {
        name: call.name,
        result: {
          success: false,
          message: 'Execution failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }
  
  /**
   * Execute multiple function calls sequentially
   */
  static async executeAll(
    calls: FunctionCall[],
    onProgress?: (index: number, total: number, result: ToolResult) => void
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      
      // Validate first
      const validation = this.validateFunctionCall(call);
      if (!validation.valid) {
        const result: ToolResult = {
          name: call.name,
          result: {
            success: false,
            message: 'Validation failed',
            error: validation.error
          }
        };
        results.push(result);
        onProgress?.(i + 1, calls.length, result);
        continue;
      }
      
      // Execute
      const result = this.executeSingle(call);
      results.push(result);
      
      // Progress callback
      onProgress?.(i + 1, calls.length, result);
      
      // Small delay for UI updates
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    return results;
  }
}
```

### Step 6: Approval UI in ChatPanel

**File:** `src/components/Chat/ChatPanel.tsx` (MODIFY)

**What:** Add UI to show AI's plan and get user approval

**State to Add:**
```typescript
const [pendingToolCalls, setPendingToolCalls] = useState<{
  functionCalls: any[];
  modelContent: any;
  history: any[];
} | null>(null);
const [isExecutingTools, setIsExecutingTools] = useState(false);
const [toolExecutionProgress, setToolExecutionProgress] = useState<{
  current: number;
  total: number;
  message: string;
} | null>(null);
```

**Handle tool_plan chunks:**
```typescript
for await (const chunk of sendMessageWithHistoryStream(...)) {
  if (chunk.type === 'tool_plan') {
    // AI wants to execute tools - show approval UI
    setPendingToolCalls({
      functionCalls: chunk.functionCalls,
      modelContent: chunk.modelContent,
      history: geminiHistory,
    });
    setIsTyping(false);
    return; // Stop here
  }
  // ... handle other chunks
}
```

**Approval UI Component:**
```tsx
{pendingToolCalls && (
  <div className="border-2 border-accent-blue rounded-lg p-4 bg-bg-secondary">
    <div className="flex items-start gap-3">
      <div className="text-2xl">🤖</div>
      <div className="flex-1">
        <h3 className="font-semibold text-text-primary mb-2">
          AI Video Editing Plan
        </h3>
        <p className="text-text-secondary text-sm mb-3">
          Gemini suggests the following operations:
        </p>
        
        <div className="space-y-2 mb-4">
          {pendingToolCalls.functionCalls.map((call, i) => (
            <div key={i} className="bg-bg-primary rounded p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-accent-blue font-mono text-sm">
                  {i + 1}. {call.name}
                </span>
              </div>
              <div className="text-xs text-text-muted font-mono">
                {JSON.stringify(call.args, null, 2)}
              </div>
              {/* Human-readable description */}
              <div className="text-sm text-text-secondary mt-2">
                {getToolDescription(call)}
              </div>
            </div>
          ))}
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={handleExecuteTools}
            disabled={isExecutingTools}
            className="px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {isExecutingTools ? 'Executing...' : `Execute All (${pendingToolCalls.functionCalls.length})`}
          </button>
          <button
            onClick={() => setPendingToolCalls(null)}
            disabled={isExecutingTools}
            className="px-4 py-2 border border-border-primary rounded-lg hover:bg-bg-secondary"
          >
            Cancel
          </button>
        </div>
        
        {toolExecutionProgress && (
          <div className="mt-3">
            <div className="text-sm text-text-secondary mb-1">
              Progress: {toolExecutionProgress.current} / {toolExecutionProgress.total}
            </div>
            <div className="w-full bg-bg-primary rounded-full h-2">
              <div 
                className="bg-accent-blue h-2 rounded-full transition-all"
                style={{ width: `${(toolExecutionProgress.current / toolExecutionProgress.total) * 100}%` }}
              />
            </div>
            <div className="text-xs text-text-muted mt-1">
              {toolExecutionProgress.message}
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
)}
```

**Execute Handler:**
```typescript
const handleExecuteTools = async () => {
  if (!pendingToolCalls) return;
  
  setIsExecutingTools(true);
  setIsTyping(true);
  
  try {
    // Execute all tools with progress
    const results = await ToolExecutor.executeAll(
      pendingToolCalls.functionCalls,
      (current, total, result) => {
        setToolExecutionProgress({
          current,
          total,
          message: result.result.message
        });
      }
    );
    
    // Clear progress
    setToolExecutionProgress(null);
    
    // Send results back to Gemini for final response
    const { sendToolResultsToGemini } = await import('../../lib/geminiService');
    
    let fullResponse = '';
    let isFirstChunk = true;
    
    for await (const chunk of sendToolResultsToGemini(
      pendingToolCalls.history,
      pendingToolCalls.modelContent,
      results
    )) {
      if (chunk.type === 'text') {
        fullResponse += chunk.text;
        if (isFirstChunk) {
          addMessage('assistant', fullResponse);
          isFirstChunk = false;
        } else {
          updateLastMessage(fullResponse);
        }
      }
    }
    
  } catch (error) {
    console.error('Tool execution error:', error);
    addMessage('assistant', '⚠️ Error executing operations: ' + (error as Error).message);
  } finally {
    setIsExecutingTools(false);
    setIsTyping(false);
    setPendingToolCalls(null);
  }
};
```

### Step 7: Helper Functions

**File:** `src/components/Chat/ChatPanel.tsx` (MODIFY)

**Add human-readable descriptions for tool calls:**
```typescript
function getToolDescription(call: { name: string; args: any }): string {
  const state = useProjectStore.getState();
  
  switch (call.name) {
    case 'split_clip': {
      const clip = state.clips.find(c => c.id === call.args.clip_id);
      return `Split "${clip?.name || 'clip'}" at ${call.args.time_in_clip}s`;
    }
    case 'set_clip_volume': {
      const clipCount = call.args.clip_ids.includes('all') 
        ? state.clips.length 
        : call.args.clip_ids.length;
      const volumePct = Math.round(call.args.volume * 100);
      return `Set volume to ${volumePct}% for ${clipCount} clip(s)`;
    }
    case 'delete_clips': {
      return `Delete ${call.args.clip_ids.length} clip(s)`;
    }
    case 'move_clip': {
      const clip = state.clips.find(c => c.id === call.args.clip_id);
      return `Move "${clip?.name || 'clip'}" to ${call.args.start_time}s`;
    }
    // ... etc
    default:
      return `Execute ${call.name}`;
  }
}
```

---

## Execution Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ USER TYPES: "Split the first clip at 10 seconds"                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ChatPanel.handleSendMessage()                                    │
│  • Add user message to chat                                      │
│  • Call sendMessageWithHistoryStream()                           │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ geminiService.sendMessageWithHistoryStream()                     │
│  • Serialize timeline state → getTimelineStateContext()          │
│  • Add to system instruction                                     │
│  • Create chat with tools: allVideoEditingTools                  │
│  • Send message to Gemini                                        │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ GEMINI 3 FLASH MODEL                                             │
│  • Analyzes request + timeline state + available tools           │
│  • Decides: "User wants to split clip, I should use split_clip"  │
│  • Returns: functionCall with name="split_clip", args={...}      │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ geminiService detects functionCalls in response                  │
│  • Yield chunk: { type: 'tool_plan', functionCalls: [...] }     │
│  • Return (stop streaming)                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ChatPanel receives 'tool_plan' chunk                             │
│  • Set pendingToolCalls state                                    │
│  • Render approval UI                                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
                   ┌──────────┴───────────┐
                   │                      │
         ┌─────────▼────────┐   ┌────────▼─────────┐
         │ USER CLICKS      │   │ USER CLICKS      │
         │ "Execute All"    │   │ "Cancel"         │
         └─────────┬────────┘   └────────┬─────────┘
                   │                      │
                   │                      ▼
                   │            (Clear pendingToolCalls, done)
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ ChatPanel.handleExecuteTools()                                   │
│  • Set isExecutingTools = true                                   │
│  • Call ToolExecutor.executeAll()                                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ToolExecutor.executeAll()                                        │
│  • For each function call:                                       │
│    1. Validate parameters                                        │
│    2. Map to store method                                        │
│    3. Execute (e.g., store.splitClip())                          │
│    4. Collect result                                             │
│    5. Call onProgress() callback                                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ useProjectStore operations execute                               │
│  • Timeline updated                                              │
│  • History recorded (undo/redo)                                  │
│  • UI re-renders (Timeline, Preview update)                      │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ToolExecutor returns results array                               │
│  [{name: "split_clip", result: {success: true, message: "..."}}] │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ChatPanel.handleExecuteTools() continues                         │
│  • Call sendToolResultsToGemini()                                │
│  • Pass: history, modelContent, results                          │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ geminiService.sendToolResultsToGemini()                          │
│  • Build conversation:                                           │
│    - Original history                                            │
│    - Model's content (with function calls)                       │
│    - User's parts (function responses)                           │
│  • Send to Gemini to generate final response                     │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ GEMINI receives function results                                 │
│  • Sees: split_clip succeeded                                    │
│  • Generates friendly response:                                  │
│    "✓ Split complete! I've split the clip into two parts..."     │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ ChatPanel streams final response                                 │
│  • Display Gemini's confirmation message                         │
│  • Clear pendingToolCalls                                        │
│  • Set isExecutingTools = false                                  │
│  • Done!                                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## User Experience & Approval System

### Design Principles

1. **Transparency**: Always show what AI plans to do
2. **Control**: User must approve before any action
3. **Clarity**: Use plain language, not technical jargon
4. **Progress**: Show real-time feedback during execution
5. **Reversibility**: Can undo AI actions just like manual edits

### Approval UI Design

```
┌────────────────────────────────────────────────────────┐
│ 🤖 AI Video Editing Plan                              │
├────────────────────────────────────────────────────────┤
│ Gemini suggests the following operations:             │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 1. split_clip                                      │ │
│ │    Split "intro.mp4" at 10.0 seconds              │ │
│ │    { clip_id: "abc123", time_in_clip: 10 }        │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ 2. set_clip_volume                                 │ │
│ │    Set volume to 50% for 2 clips                  │ │
│ │    { clip_ids: ["abc124", "abc125"], volume: 0.5} │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ [Execute All (2)]  [Cancel]                           │
│                                                        │
│ Progress: 1 / 2                                       │
│ ████████████████░░░░ 50%                             │
│ Split "intro.mp4" at 10.0s - Success                 │
└────────────────────────────────────────────────────────┘
```

### Progressive Disclosure

**Simple operations:** Show brief description
```
"Split clip at 10 seconds"
```

**Complex operations:** Show step-by-step plan
```
"I'll optimize your timeline by:
1. Removing 3 gaps (total 12s saved)
2. Adjusting volume for 8 clips
3. Re-aligning clips to start at 0s"
```

### Error Handling in UI

**Validation Error (before execution):**
```
⚠️ Cannot execute plan:
• Clip "intro.mp4" not found
• Volume 1.5 is out of range (must be 0.0-1.0)

[Fix Issues] [Cancel]
```

**Execution Error (during operation):**
```
❌ Operation 2 of 5 failed:
"set_clip_volume" - Clip abc123 is locked

Completed: 1 operation
Failed: 1 operation  
Remaining: 3 operations

[Continue] [Undo All] [Cancel]
```

### Success Feedback

**Immediate UI updates:**
- Timeline re-renders with changes
- Visual indicators (flash/highlight modified clips)
- Notification toast: "✓ 2 operations completed"

**AI confirmation message:**
```
✓ All done! I've split your intro clip at 10 seconds 
and set the volume to 50% for the background clips. 
You can undo these changes anytime.
```

---

## Error Handling & Safety

### Validation Layers

#### **Layer 1: Schema Validation (Gemini)**
Gemini enforces parameter types via function declarations:
- `Type.NUMBER` → must be numeric
- `Type.STRING` → must be string
- `required: ['clip_id']` → must be provided
- `enum: ['all']` → must be from list

#### **Layer 2: Pre-Execution Validation (ToolExecutor)**
Before executing, check:
- Clip IDs exist in timeline
- Time values are within valid ranges
- Volume is 0.0-1.0
- Sufficient clips for merge (>= 2)
- Clips not locked
- Undo/redo history available

#### **Layer 3: Runtime Validation (useProjectStore)**
Store methods have built-in checks:
- Prevent splitting beyond clip bounds
- Prevent negative times
- Handle edge cases (empty timeline, etc.)

### Error Recovery Strategies

#### **Graceful Degradation**
If some operations fail in a batch:
- Execute successful ones
- Report failures with details
- Offer to continue or undo
- Don't leave timeline in inconsistent state

#### **Undo Safety Net**
All AI operations go through history system:
- User can undo with Ctrl+Z or undo() function
- Can undo entire AI action sequence
- Add "Undo AI Action" quick button in approval UI

#### **Rate Limiting**
Prevent runaway AI:
- Max 20 function calls per request
- Max 5 deep (compositional chains)
- Timeout after 30 seconds
- User must re-approve for additional operations

### Safety Guards

#### **Destructive Operation Warnings**
For operations like `delete_clips`, AI should:
- Explicitly mention deletion
- Show what will be lost
- Require clear user approval
- Offer alternative (e.g., "Move to trash bin")

#### **Ambiguity Handling**
When unclear, AI should ask:
```
User: "Delete the video"
AI: "I found 3 video clips on your timeline:
1. intro.mp4
2. main_content.mp4
3. outro.mp4

Which one would you like to delete, or should I delete all of them?"
```

#### **Constraint Checking**
Before executing complex operations, verify:
- Timeline won't have overlaps
- Clips won't extend beyond source duration
- Operations are physically possible

---

## Testing Strategy

### Phase 1: Unit Tests

**Test ToolExecutor:**
```typescript
describe('ToolExecutor', () => {
  test('validates clip_id exists', () => {
    const result = ToolExecutor.validateFunctionCall({
      name: 'split_clip',
      args: { clip_id: 'nonexistent', time_in_clip: 5 }
    });
    expect(result.valid).toBe(false);
  });
  
  test('executes split_clip successfully', async () => {
    // Setup: add clip to store
    const clipId = 'test-123';
    useProjectStore.getState().addClip({ name: 'test', duration: 20, ... });
    
    // Execute
    const result = ToolExecutor.executeSingle({
      name: 'split_clip',
      args: { clip_id: clipId, time_in_clip: 10 }
    });
    
    expect(result.result.success).toBe(true);
    expect(useProjectStore.getState().clips.length).toBe(2);
  });
});
```

### Phase 2: Integration Tests

**Test Gemini → Executor Flow:**
```typescript
describe('Function Calling Integration', () => {
  test('Gemini suggests split, user executes', async () => {
    // Mock Gemini response with function call
    const mockResponse = {
      functionCalls: [{
        name: 'split_clip',
        args: { clip_id: 'abc123', time_in_clip: 10 }
      }]
    };
    
    // Execute
    const results = await ToolExecutor.executeAll(mockResponse.functionCalls);
    
    // Verify
    expect(results[0].result.success).toBe(true);
  });
});
```

### Phase 3: End-to-End Tests

**Real Gemini API Tests:**
```typescript
describe('E2E Function Calling', () => {
  test('User asks to split clip, AI executes', async () => {
    // Setup timeline with test clip
    const store = useProjectStore.getState();
    store.addClip({ name: 'test.mp4', duration: 30, ... });
    
    // Send message to real Gemini
    const stream = sendMessageWithHistoryStream(
      "Split the test.mp4 clip at 15 seconds",
      []
    );
    
    // Collect response
    let toolPlan = null;
    for await (const chunk of stream) {
      if (chunk.type === 'tool_plan') {
        toolPlan = chunk;
        break;
      }
    }
    
    // Verify AI suggested split_clip
    expect(toolPlan).toBeTruthy();
    expect(toolPlan.functionCalls[0].name).toBe('split_clip');
    expect(toolPlan.functionCalls[0].args.time_in_clip).toBeCloseTo(15);
  });
});
```

### Phase 4: Manual Testing Scenarios

**Simple Operations:**
1. ✅ "Split the first clip at 10 seconds"
2. ✅ "Delete the last clip"
3. ✅ "Move clip 2 to 5 seconds"
4. ✅ "Set volume to 50%"
5. ✅ "Mute the background music"

**Complex Operations:**
6. ✅ "Remove all gaps in the timeline"
7. ✅ "Make all clips the same volume"
8. ✅ "Split every clip longer than 20 seconds in half"
9. ✅ "Merge all clips on track 1"
10. ✅ "Rearrange clips by duration (shortest to longest)"

**Error Handling:**
11. ✅ Invalid clip ID → AI asks for clarification
12. ✅ Out of range time → AI suggests valid range
13. ✅ Ambiguous request → AI asks follow-up questions
14. ✅ Locked clip → AI explains can't modify
15. ✅ Empty timeline → AI explains no clips to work with

**Conversational:**
16. ✅ "What's on my timeline?" → AI uses get_timeline_info
17. ✅ "Can you help me organize this?" → AI asks what kind of organization
18. ✅ "Undo that" → AI calls undo_action
19. ✅ "Do it again" → AI calls redo_action or repeats last operation

---

## Future Enhancements

### Phase 2 Features

**Advanced Tools:**
- Transcription-based operations ("Delete all pauses longer than 2s")
- Smart gap detection and removal
- Clip organization by content (group similar clips)
- Batch operations with filters
- Timeline analysis and suggestions

**Multi-Modal Understanding:**
- User uploads reference video: "Make my edit match this style"
- Screenshot: "Apply this text style to all titles"
- Audio file: "Replace background music with this"

**Intelligent Suggestions:**
- AI proactively suggests optimizations
- "I notice several gaps - want me to close them?"
- "This clip seems dark - should I boost brightness?"

### Phase 3 Features

**Autonomous Editing:**
- "Edit this raw footage into a 60-second highlight reel"
- AI plans entire edit: select best moments, add transitions, music
- Multi-step approval: review shot selection, then transitions, then final

**Learning User Preferences:**
- Track editing patterns and preferences
- Suggest operations user frequently does
- Adapt suggestions based on feedback

**Collaborative Editing:**
- "Continue the edit John started"
- AI understands project history and intent
- Maintains consistent style across sessions

---

## References

### Gemini Documentation Files Used

1. **`/gemini_documentations/gemini_function_Calling.md`**
   - Complete guide to function calling
   - Step-by-step workflow
   - Parallel and compositional calling
   - Function declaration schemas
   - Best practices and limitations

2. **`/gemini_documentations/gemini_structure.md`**
   - Structured outputs (different from function calling)
   - JSON schema support
   - Zod integration for TypeScript
   - Streaming structured outputs

3. **`/gemini_documentations/gemini_docs.md`**
   - SDK migration guides
   - Code examples for JavaScript/TypeScript
   - Auto vs manual function calling
   - Type definitions

### Key Gemini API Concepts

**Function Calling Flow:**
```
Define → Send → Execute → Respond
```

**Function Declaration Structure:**
```javascript
{
  name: string,
  description: string,
  parameters: {
    type: Type.OBJECT,
    properties: { ... },
    required: string[]
  }
}
```

**Function Calling Modes:**
- AUTO: Model decides
- ANY: Force function call
- NONE: Disable functions
- VALIDATED: Function call or text with schema validation

**SDK Features:**
- Automatic function calling (Python only)
- TypeScript type safety via `Type` enum
- Streaming responses
- Multi-turn conversations with history
- Thought signatures (handled automatically by SDK)

---

## Conclusion

This plan provides a complete roadmap for enabling Gemini AI to control video editing operations in QuickCut. The implementation follows Gemini's official function calling patterns, leverages existing codebase infrastructure, and prioritizes user control through an approval-based system.

**Key Takeaways:**

1. **All prerequisites exist**: Video operations, Gemini integration, UI framework
2. **Clean architecture**: Separate concerns (declarations, execution, UI, feedback)
3. **Safety first**: Validation, approval, undo capabilities
4. **Extensible**: Easy to add more tools as needed
5. **User-friendly**: Transparent, controllable, conversational

**Next Step:** Begin implementation with Step 1 (Create Function Declarations)

---

**Document End**
