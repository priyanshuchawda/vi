import { GoogleGenAI, MediaResolution } from '@google/genai';
import type { MediaAttachment } from '../types/chat';
import { MAX_INLINE_SIZE } from '../types/chat';
import { getMemoryForChat } from './geminiMemoryService';
import { useProjectStore } from '../stores/useProjectStore';
import { allVideoEditingTools } from './videoEditingTools';

// Initialize Gemini AI client
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
  console.error('⚠️ VITE_GEMINI_API_KEY not found in environment variables');
}

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Cache management
let currentCache: string | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_SECONDS = 3600; // 1 hour
const MIN_TOKENS_FOR_CACHE = 1024; // Minimum for gemini-2.5-flash-lite

// Chat history format for Gemini
export interface GeminiChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType?: string } }>;
}

/**
 * Get channel analysis context from localStorage if available
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
 * Get timeline state context for Gemini to understand current project state
 */
function getTimelineStateContext(): string {
  try {
    const state = useProjectStore.getState();
    
    if (state.clips.length === 0) {
      return '\n\n=== TIMELINE STATE ===\nTimeline is empty. No clips have been added yet.\n===========================\n';
    }

    // Build concise timeline representation
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

/**
 * Convert a file to base64 string
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data:...;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file to Gemini File API for files > 20MB
 */
async function uploadToFileApi(file: File): Promise<{ uri: string; mimeType: string }> {
  if (!ai) throw new Error('Gemini AI not initialized');

  console.log(`📤 Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) to Gemini File API...`);

  const uploaded = await ai.files.upload({
    file: file,
    config: { mimeType: file.type },
  });

  if (!uploaded.uri || !uploaded.mimeType) {
    throw new Error('File upload failed: no URI returned');
  }

  console.log(`✅ File uploaded: ${uploaded.uri}`);
  return { uri: uploaded.uri, mimeType: uploaded.mimeType };
}

/**
 * Build multimodal parts from media attachments
 */
async function buildMediaParts(attachments: MediaAttachment[]): Promise<Array<{ inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType?: string } }>> {
  const parts: Array<{ inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType?: string } }> = [];

  for (const attachment of attachments) {
    if (attachment.file.size <= MAX_INLINE_SIZE) {
      // Use inline data for smaller files
      const base64Data = attachment.base64Data || await fileToBase64(attachment.file);
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: base64Data,
        },
      });
    } else {
      // Use File API for larger files
      if (attachment.uploadedUri) {
        // Already uploaded
        parts.push({
          fileData: {
            fileUri: attachment.uploadedUri,
            mimeType: attachment.uploadedMimeType || attachment.mimeType,
          },
        });
      } else {
        // Upload it now
        const uploaded = await uploadToFileApi(attachment.file);
        parts.push({
          fileData: {
            fileUri: uploaded.uri,
            mimeType: uploaded.mimeType,
          },
        });
      }
    }
  }

  return parts;
}

/**
 * Creates a chat session with Gemini and sends messages with history
 */
export async function sendMessageWithHistory(
  message: string,
  history: GeminiChatMessage[] = [],
  attachments?: MediaAttachment[]
): Promise<string> {
  if (!ai) {
    throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file');
  }

  try {
    const channelContext = getChannelAnalysisContext();
    const memoryContext = getMemoryForChat();
    const timelineContext = getTimelineStateContext();
    const currentDate = new Date().toISOString().split('T')[0];

    // Create a chat session with history
    const chat = ai.chats.create({
      model: 'gemini-2.5-flash-lite',
      history: history,
      config: {
        // Use HIGH resolution for images (users may ask detailed questions like "read this text")
        // Use MEDIUM for videos in chat (better quality than analysis, but not max)
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        systemInstruction: `<role>
You are Gemini, a helpful AI assistant integrated into QuickCut, a professional video editing application.
You are precise, knowledgeable, and focused on helping users with their video editing projects.
</role>

<instructions>
1. Help users with video editing questions, provide tips, and assist with their projects
2. When users share media files (images, videos, audio, documents), analyze them thoroughly:
   - For images: Describe content, composition, colors, and suggest editing tips
   - For videos: Analyze content, pacing, and suggest improvements
   - For audio: Describe audio content, quality, and suggest enhancements
   - For documents/PDFs: Summarize content and extract relevant information
3. For time-sensitive user queries requiring up-to-date information, remember that the current date is ${currentDate}
4. Your knowledge cutoff date is January 2025
5. When providing answers, be concise yet comprehensive
6. If asked about something outside your knowledge, clearly state the limitation
</instructions>

<constraints>
- Verbosity: Medium (balanced between concise and comprehensive)
- Tone: Friendly and professional
- Focus: Video editing workflow and creative assistance
</constraints>

<grounding>
You are strictly grounded to:
1. The conversation history provided
2. Any media files or documents the user shares
3. The user's YouTube channel context (if available below)
4. The user's project memory (if available below)
5. The current timeline state (if available below)
Do not speculate or assume information not present in these sources.
</grounding>

<video-editing-tools>
You have access to video editing tools that let you manipulate the timeline directly:

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
</video-editing-tools>${channelContext}${memoryContext}${timelineContext}`,
      },
    });

    // Build message parts
    if (attachments && attachments.length > 0) {
      const mediaParts = await buildMediaParts(attachments);
      const allParts = [
        ...mediaParts,
        { text: message },
      ];

      const response = await chat.sendMessage({ message: allParts });
      return response.text || '';
    }

    // Text-only message
    const response = await chat.sendMessage({
      message: message,
    });

    return response.text || '';
  } catch (error) {
    console.error('Gemini API error:', error);
    if (error instanceof Error) {
      throw new Error(`Gemini API error: ${error.message}`);
    }
    throw new Error('Failed to communicate with Gemini API');
  }
}

/**
 * Get or create a cache for system instructions and channel context
 */
async function getOrCreateCache(systemInstruction: string): Promise<string | null> {
  if (!ai) return null;

  try {
    // Check if current cache is still valid
    if (currentCache && Date.now() < cacheExpiry) {
      console.log('✅ Using existing cache:', currentCache);
      return currentCache;
    }

    // Use accurate token counting API instead of rough estimate
    console.log('🔢 Counting tokens for cache...');
    const tokenCount = await ai.models.countTokens({
      model: 'gemini-2.5-flash-lite',
      contents: [{ role: 'user', parts: [{ text: systemInstruction }] }],
    });
    
    const actualTokens = tokenCount.totalTokens;

    // Only create cache if content is large enough
    if (!actualTokens || actualTokens < MIN_TOKENS_FOR_CACHE) {
      console.log(`⚠️ Content too small for caching (${actualTokens} tokens, min ${MIN_TOKENS_FOR_CACHE})`);
      return null;
    }

    console.log(`📦 Creating new cache (${actualTokens} tokens)...`);

    // Create a new cache with system instruction
    // Note: contents must have at least one item for cache creation
    const cache = await ai.caches.create({
      model: 'gemini-2.5-flash-lite',
      config: {
        displayName: `quickcut-chat-${Date.now()}`,
        systemInstruction: systemInstruction,
        contents: [
          // Add a dummy content to satisfy the API requirement
          { role: 'user', parts: [{ text: 'Initialize cache' }] }
        ],
        ttl: `${CACHE_TTL_SECONDS}s`,
      },
    });

    // Store cache reference and expiry time
    const cacheName = cache.name || null;
    if (!cacheName) {
      console.error('Cache created but no name returned');
      return null;
    }

    currentCache = cacheName;
    cacheExpiry = Date.now() + (CACHE_TTL_SECONDS * 1000);

    console.log('✅ Cache created:', cacheName, 'Expires:', new Date(cacheExpiry).toLocaleTimeString());

    return cacheName;
  } catch (error) {
    console.error('Failed to create cache:', error);
    return null;
  }
}

/**
 * Clear the current cache
 */
export async function clearCache(): Promise<void> {
  if (!ai || !currentCache) return;

  try {
    await ai.caches.delete({ name: currentCache });
    console.log('🗑️ Cache deleted:', currentCache);
  } catch (error) {
    console.error('Failed to delete cache:', error);
  } finally {
    currentCache = null;
    cacheExpiry = 0;
  }
}

/**
 * Get cache statistics
 */
export function getCacheInfo(): { active: boolean; expiresAt: number | null; cacheName: string | null } {
  return {
    active: currentCache !== null && Date.now() < cacheExpiry,
    expiresAt: cacheExpiry || null,
    cacheName: currentCache,
  };
}

export interface StreamChunk {
  type: 'text' | 'metadata' | 'cache' | 'upload_progress' | 'tool_plan';
  text?: string;
  tokens?: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
  cacheHit?: boolean;
  uploadProgress?: {
    fileName: string;
    progress: number;
  };
  functionCalls?: any[];
  modelContent?: any;
}

/**
 * Sends a message with streaming response, token metadata, context caching, and multimodal support
 */
export async function* sendMessageWithHistoryStream(
  message: string,
  history: GeminiChatMessage[] = [],
  attachments?: MediaAttachment[]
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!ai) {
    throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file');
  }

  try {
    const channelContext = getChannelAnalysisContext();
    const memoryContext = getMemoryForChat();
    const timelineContext = getTimelineStateContext();
    const currentDate = new Date().toISOString().split('T')[0];
    
    const systemInstruction = `<role>
You are Gemini, a helpful AI assistant integrated into QuickCut, a professional video editing application.
You are precise, knowledgeable, and focused on helping users with their video editing projects.
</role>

<instructions>
1. Help users with video editing questions, provide tips, and assist with their projects
2. When users share media files (images, videos, audio, documents), analyze them thoroughly:
   - For images: Describe content, composition, colors, and suggest editing tips
   - For videos: Analyze content, pacing, and suggest improvements
   - For audio: Describe audio content, quality, and suggest enhancements
   - For documents/PDFs: Summarize content and extract relevant information
3. For time-sensitive user queries requiring up-to-date information, remember that the current date is ${currentDate}
4. Your knowledge cutoff date is January 2025
5. When providing answers, be concise yet comprehensive
6. If asked about something outside your knowledge, clearly state the limitation
</instructions>

<constraints>
- Verbosity: Medium (balanced between concise and comprehensive)
- Tone: Friendly and professional
- Focus: Video editing workflow and creative assistance
</constraints>

<grounding>
You are strictly grounded to:
1. The conversation history provided
2. Any media files or documents the user shares
3. The user's YouTube channel context (if available below)
4. The user's project memory (if available below)
5. The current timeline state (if available below)
Do not speculate or assume information not present in these sources.
</grounding>

<video-editing-tools>
You have access to video editing tools that let you manipulate the timeline directly:

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
</video-editing-tools>${channelContext}${memoryContext}${timelineContext}`;

    // Try to get or create a cache for the system instruction
    const cacheName = await getOrCreateCache(systemInstruction);

    // Build multimodal parts if attachments exist
    let messageParts: string | Array<{ text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType?: string } }> = message;

    if (attachments && attachments.length > 0) {
      // Yield upload progress for each file
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        yield {
          type: 'upload_progress',
          uploadProgress: {
            fileName: attachment.name,
            progress: ((i + 1) / attachments.length) * 100,
          },
        };
      }

      const mediaParts = await buildMediaParts(attachments);
      messageParts = [
        ...mediaParts,
        { text: message },
      ];
    }

    const chat = ai.chats.create({
      model: 'gemini-2.5-flash-lite',
      history: history,
      config: cacheName ? {
        cachedContent: cacheName,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        tools: [{
          functionDeclarations: allVideoEditingTools
        }],
      } : {
        systemInstruction: systemInstruction,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        tools: [{
          functionDeclarations: allVideoEditingTools
        }],
      },
    });

    // Use sendMessage instead of sendMessageStream to check for function calls first
    const response = await chat.sendMessage({
      message: messageParts,
    });

    // Check if response contains function calls
    if (response.functionCalls && response.functionCalls.length > 0) {
      // AI wants to execute tools - yield tool_plan chunk
      yield {
        type: 'tool_plan',
        functionCalls: response.functionCalls,
        modelContent: response.candidates?.[0]?.content,
      };
      return; // Stop here - wait for user approval
    }

    // No function calls - yield text response
    if (response.text) {
      yield { type: 'text', text: response.text };
    }

    // Yield token metadata
    if (response.usageMetadata) {
      const metadata = response.usageMetadata;
      const cachedTokens = metadata.cachedContentTokenCount || 0;

      yield {
        type: 'metadata',
        tokens: {
          promptTokens: metadata.promptTokenCount || 0,
          responseTokens: metadata.candidatesTokenCount || 0,
          totalTokens: metadata.totalTokenCount || 0,
          cachedTokens: cachedTokens,
        },
        cacheHit: cachedTokens > 0,
      };

      // Log cache performance
      if (cachedTokens > 0) {
        console.log(`💰 Cache hit! Saved ${cachedTokens} tokens`);
      }
    }
  } catch (error) {
    console.error('Gemini API streaming error:', error);
    if (error instanceof Error) {
      throw new Error(`Gemini API error: ${error.message}`);
    }
    throw new Error('Failed to communicate with Gemini API');
  }
}

/**
 * Convert our chat message format to Gemini format (supports multimodal history)
 */
export function convertToGeminiHistory(messages: Array<{ role: string; content: string; attachments?: MediaAttachment[] }>): GeminiChatMessage[] {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => {
      const parts: GeminiChatMessage['parts'] = [];

      // Add media parts from attachments (for user messages with media)
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (attachment.base64Data) {
            parts.push({
              inlineData: {
                mimeType: attachment.mimeType,
                data: attachment.base64Data,
              },
            });
          } else if (attachment.uploadedUri) {
            parts.push({
              fileData: {
                fileUri: attachment.uploadedUri,
                mimeType: attachment.uploadedMimeType || attachment.mimeType,
              },
            });
          }
        }
      }

      // Add text part
      parts.push({ text: msg.content });

      return {
        role: msg.role === 'user' ? 'user' : 'model' as const,
        parts,
      };
    });
}

/**
 * Send tool execution results back to Gemini and get final response
 * 
 * This is called after user approves and tools are executed. It sends the
 * results back to Gemini so it can generate a user-friendly confirmation message.
 */
export async function* sendToolResultsToGemini(
  originalHistory: GeminiChatMessage[],
  modelContent: any,
  toolResults: Array<{ name: string; result: any }>
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!ai) {
    throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file');
  }

  try {
    // Build conversation with tool responses
    const contents: GeminiChatMessage[] = [...originalHistory];
    
    // Add model's content (contains function calls)
    if (modelContent) {
      contents.push(modelContent);
    }
    
    // Add tool responses as function response parts
    for (const toolResult of toolResults) {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolResult.name,
            response: toolResult.result
          }
        }] as any
      });
    }

    // Get updated context
    const channelContext = getChannelAnalysisContext();
    const memoryContext = getMemoryForChat();
    const timelineContext = getTimelineStateContext();
    const currentDate = new Date().toISOString().split('T')[0];

    const systemInstruction = `<role>
You are Gemini, a helpful AI assistant integrated into QuickCut, a professional video editing application.
You are precise, knowledgeable, and focused on helping users with their video editing projects.
</role>

<instructions>
1. Help users with video editing questions, provide tips, and assist with their projects
2. When users share media files (images, videos, audio, documents), analyze them thoroughly:
   - For images: Describe content, composition, colors, and suggest editing tips
   - For videos: Analyze content, pacing, and suggest improvements
   - For audio: Describe audio content, quality, and suggest enhancements
   - For documents/PDFs: Summarize content and extract relevant information
3. For time-sensitive user queries requiring up-to-date information, remember that the current date is ${currentDate}
4. Your knowledge cutoff date is January 2025
5. When providing answers, be concise yet comprehensive
6. If asked about something outside your knowledge, clearly state the limitation
</instructions>

<constraints>
- Verbosity: Medium (balanced between concise and comprehensive)
- Tone: Friendly and professional
- Focus: Video editing workflow and creative assistance
</constraints>

<grounding>
You are strictly grounded to:
1. The conversation history provided
2. Any media files or documents the user shares
3. The user's YouTube channel context (if available below)
4. The user's project memory (if available below)
5. The current timeline state (if available below)
Do not speculate or assume information not present in these sources.
</grounding>

<video-editing-tools>
You have access to video editing tools that let you manipulate the timeline directly:

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
</video-editing-tools>${channelContext}${memoryContext}${timelineContext}`;

    const chat = ai.chats.create({
      model: 'gemini-2.5-flash-lite',
      history: contents,
      config: {
        systemInstruction: systemInstruction,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
        tools: [{
          functionDeclarations: allVideoEditingTools
        }],
      },
    });

    // Get final response from model by sending a proper message
    // (not empty string which would create invalid conversation flow)
    const response = await chat.sendMessage({ 
      message: 'All operations have been completed. Please provide a summary.' 
    });
    
    if (response.text) {
      yield { type: 'text', text: response.text };
    }
    
    // Include token metadata
    if (response.usageMetadata) {
      const metadata = response.usageMetadata;
      yield {
        type: 'metadata',
        tokens: {
          promptTokens: metadata.promptTokenCount || 0,
          responseTokens: metadata.candidatesTokenCount || 0,
          totalTokens: metadata.totalTokenCount || 0,
          cachedTokens: metadata.cachedContentTokenCount || 0,
        },
      };
    }
  } catch (error) {
    console.error('Error sending tool results to Gemini:', error);
    if (error instanceof Error) {
      throw new Error(`Gemini API error: ${error.message}`);
    }
    throw new Error('Failed to communicate with Gemini API');
  }
}
