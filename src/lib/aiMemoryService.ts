/**
 * AI Memory Service — AWS Bedrock (Amazon Nova Lite v1)
 *
 * Background analysis of imported media files.
 * When a user imports files into the video editor, this service:
 * 1. Receives the file info (path, type, thumbnail, etc.)
 * 2. Sends it to Bedrock for analysis using inline bytes
 * 3. Parses the structured response with Zod validation
 * 4. Stores the analysis in the AiMemoryStore
 *
 * The analysis runs in parallel with the normal import flow.
 */

import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockClient, MODEL_ID, isBedrockConfigured } from "./bedrockClient";
import { useAiMemoryStore } from "../stores/useAiMemoryStore";
import type { AudioInfo, SceneInfo, VisualInfo } from "../types/aiMemory";
import { MediaAnalysisSchema } from "./schemas/mediaAnalysis";
import { waitForSlot } from "./rateLimiter";
import { recordUsage } from "./tokenTracker";

// Queue management for background analysis
let analysisQueue: AnalysisTask[] = [];
let isProcessingQueue = false;
const MAX_CONCURRENT = 1;
let activeAnalyses = 0;

/**
 * Options for analyzing specific segments of a video
 */
interface VideoClipOptions {
  startTime?: number;
  endTime?: number;
  fps?: number;
}

interface AnalysisTask {
  entryId: string;
  filePath: string;
  fileName: string;
  mediaType: "video" | "audio" | "image" | "document";
  mimeType: string;
  fileSize: number;
  duration?: number;
  thumbnailDataUrl?: string;
  clipOptions?: VideoClipOptions;
}

/**
 * Get the appropriate analysis prompt based on media type
 * Nova Lite doesn't have responseSchema — we add JSON instructions to the prompt
 */
function getAnalysisPrompt(mediaType: string, fileName: string): string {
  const baseInstruction = `<role>
You are a specialized media analysis AI for QuickCut, a professional video editing application.
You analyze media files to extract detailed, structured information for video editors.
</role>

<task>
Analyze the provided ${mediaType} file named "${fileName}" and provide a comprehensive analysis.
</task>

<constraints>
1. Base your analysis strictly on the actual content of the file
2. Be accurate and factual - do not speculate or assume
3. Provide specific, actionable insights relevant to video editing
4. Keep the summary concise (1-2 sentences)
5. Provide 5-10 relevant tags for quick reference
</constraints>

<output_format>
You MUST respond with ONLY valid JSON (no markdown, no code blocks, no extra text).
Use this exact structure:
{
  "summary": "1-2 sentence summary",
  "tags": ["tag1", "tag2", ...],
  "analysis": "Detailed paragraph about content, quality, pacing, etc.",
  "scenes": [{"startTime": 0, "endTime": 5, "description": "Scene description"}],
  "audioInfo": {"hasSpeech": true, "hasMusic": false, "languages": ["English"], "mood": "happy", "transcriptSummary": "..."},
  "visualInfo": {"dominantColors": ["blue", "green"], "style": "cinematic", "subjects": ["person"], "composition": "...", "quality": "high"}
}
The "scenes", "audioInfo", and "visualInfo" fields are optional — include them only if relevant.
</output_format>`;

  if (mediaType === "video") {
    return (
      baseInstruction +
      `

<analysis_focus>
- Identify key scenes with approximate timestamps
- Analyze both visual and audio aspects
- Note dominant colors, composition style, and quality
- Detect speech, music, and overall mood
- Provide actionable insights for video editing
</analysis_focus>`
    );
  }

  if (mediaType === "audio") {
    return (
      baseInstruction +
      `

<analysis_focus>
- Describe what you hear (speech, music, sound effects)
- Identify languages and speakers if applicable
- Assess audio quality and mood
- Note any background sounds or music
- Provide insights relevant to audio editing
</analysis_focus>`
    );
  }

  if (mediaType === "image") {
    return (
      baseInstruction +
      `

<analysis_focus>
- Describe composition, colors, and style
- Identify main subjects and elements
- Assess image quality and resolution
- Note lighting and artistic choices
- Provide insights for photo/video editing
</analysis_focus>`
    );
  }

  // Document
  return (
    baseInstruction +
    `

<analysis_focus>
- Summarize the document's content and purpose
- Extract key information and themes
- Identify document type and structure
- Note any production-relevant details
</analysis_focus>`
  );
}

/** Bedrock-compatible media format from MIME type */
function getMediaFormat(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
  };
  return map[mimeType] || mimeType.split("/")[1] || "jpeg";
}

// Max size for inline bytes in Bedrock: 25MB
const MAX_INLINE_SIZE = 25 * 1024 * 1024;

/**
 * Read a file as base64 from disk via Electron IPC
 */
async function readFileAsBase64(filePath: string): Promise<string | null> {
  try {
    if (window.electronAPI && window.electronAPI.readFileAsBase64) {
      const base64 = await window.electronAPI.readFileAsBase64(filePath);
      return base64;
    }
    return null;
  } catch (error) {
    console.error("Error reading file for analysis:", error);
    return null;
  }
}

/** Convert base64 to Uint8Array for Bedrock */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parse the JSON analysis response with Zod validation
 */
function parseAnalysisResponse(responseText: string): {
  summary: string;
  tags: string[];
  analysis: string;
  scenes?: SceneInfo[];
  audioInfo?: AudioInfo;
  visualInfo?: VisualInfo;
} {
  try {
    // Clean the response — remove markdown code blocks if present
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);

    // Validate with Zod schema for runtime type safety
    const result = MediaAnalysisSchema.safeParse(parsed);

    if (!result.success) {
      console.warn("Schema validation failed:", result.error.format());
      return {
        summary: parsed.summary || "No summary available",
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : [],
        analysis: parsed.analysis || "No detailed analysis available",
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes : undefined,
        audioInfo: parsed.audioInfo || undefined,
        visualInfo: parsed.visualInfo || undefined,
      };
    }

    return result.data;
  } catch (error) {
    console.error("Failed to parse analysis response:", error);
    return {
      summary: "Analysis parsing failed",
      tags: [],
      analysis: responseText.slice(0, 500),
    };
  }
}

/** Sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Analyze a single media file using Bedrock Nova Lite
 *
 * Strategy:
 * - Images: Send as inline bytes via { image: { format, source: { bytes } } }
 * - Videos < 25MB: Send as inline bytes via { video: { format, source: { bytes } } }
 * - Videos > 25MB: Log warning, attempt anyway (may fail — user should clip first)
 * - Audio: Nova Lite doesn't support audio inline — use thumbnail or metadata-only
 * - Retry transient errors with exponential backoff
 */
async function analyzeFile(task: AnalysisTask): Promise<void> {
  if (!isBedrockConfigured()) {
    console.error("❌ [AI Memory] Bedrock client not configured!");
    useAiMemoryStore
      .getState()
      .updateStatus(
        task.entryId,
        "failed",
        "AWS credentials not configured. Please add VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY to your .env file",
      );
    return;
  }

  const store = useAiMemoryStore.getState();
  store.updateStatus(task.entryId, "analyzing");

  console.log(
    `🚀 [AI Memory] Starting analysis for "${task.fileName}" (${(task.fileSize / 1024 / 1024).toFixed(2)} MB)`,
  );

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const prompt = getAnalysisPrompt(task.mediaType, task.fileName);

      // Build Bedrock content blocks
      const content: Array<Record<string, any>> = [];

      if (task.mediaType === "image") {
        // Images: always inline bytes
        let base64Data: string | null = null;

        if (task.thumbnailDataUrl) {
          const base64Match = task.thumbnailDataUrl.match(
            /^data:[^;]+;base64,(.+)$/,
          );
          if (base64Match) {
            base64Data = base64Match[1];
          }
        }

        if (!base64Data) {
          base64Data = await readFileAsBase64(task.filePath);
        }

        if (base64Data) {
          const bytes = base64ToUint8Array(base64Data);
          const format = getMediaFormat(task.mimeType);
          content.push({
            image: { format, source: { bytes } },
          });
        }
      } else if (task.mediaType === "video") {
        // Videos: inline bytes (< 25MB recommended)
        if (task.fileSize > MAX_INLINE_SIZE) {
          console.warn(
            `⚠️ Video "${task.fileName}" is ${(task.fileSize / 1024 / 1024).toFixed(1)}MB — exceeds 25MB inline limit. Consider clipping.`,
          );
        }

        const base64Data = await readFileAsBase64(task.filePath);
        if (base64Data) {
          const bytes = base64ToUint8Array(base64Data);
          const format = getMediaFormat(task.mimeType);
          content.push({
            video: { format, source: { bytes } },
          });
        }
      } else if (task.mediaType === "audio") {
        // Audio: Nova Lite doesn't support audio inline
        // If we have a thumbnail, send it as an image for visual context
        if (task.thumbnailDataUrl) {
          const base64Match = task.thumbnailDataUrl.match(
            /^data:[^;]+;base64,(.+)$/,
          );
          if (base64Match) {
            const bytes = base64ToUint8Array(base64Match[1]);
            content.push({
              image: { format: "jpeg", source: { bytes } },
            });
          }
        }
        // Otherwise, metadata-only analysis
      }

      // If no media parts were added, do metadata-only analysis
      if (content.length === 0) {
        console.log(
          `📝 No file data available for "${task.fileName}", performing metadata-only analysis`,
        );
      }

      // Add the text prompt
      content.push({ text: prompt });

      console.log(
        `🧠 Analyzing ${task.mediaType}: "${task.fileName}" (attempt ${attempt}/${MAX_RETRIES})...`,
      );

      // Use shared rate limiter
      await waitForSlot();

      const systemPrompt = `<role>
You are a specialized media analysis AI for QuickCut, a professional video editing application.
</role>

<instructions>
1. Analyze the provided media file accurately and thoroughly
2. Extract structured information useful for video editors
3. Be specific and detail-oriented in your analysis
4. You MUST respond with ONLY valid JSON — no markdown, no extra text
</instructions>

<constraints>
- Base analysis strictly on the actual content provided
- Do not speculate or assume information not present
- Verbosity: Medium (detailed but concise)
- Tone: Technical and precise
</constraints>`;

      const response = await bedrockClient.send(
        new ConverseCommand({
          modelId: MODEL_ID,
          messages: [
            {
              role: "user",
              content: content as any,
            },
          ],
          system: [{ text: systemPrompt }],
          inferenceConfig: { maxTokens: 4096, temperature: 0.3 },
        }),
      );

      // Record token usage
      if (response.usage) {
        recordUsage({
          promptTokenCount: response.usage.inputTokens,
          candidatesTokenCount: response.usage.outputTokens,
          totalTokenCount: response.usage.totalTokens,
        });
      }

      const responseText = response.output?.message?.content?.[0]?.text || "";

      if (!responseText) {
        throw new Error("Empty response from Bedrock");
      }

      const parsed = parseAnalysisResponse(responseText);

      // Store the analysis
      store.updateAnalysis(
        task.entryId,
        parsed.analysis,
        parsed.tags,
        parsed.summary,
        {
          scenes: parsed.scenes,
          audioInfo: parsed.audioInfo,
          visualInfo: parsed.visualInfo,
        },
      );

      console.log(
        `✅ Analysis complete for "${task.fileName}": ${parsed.summary}`,
      );
      return; // Success — exit retry loop
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message;

      // Check if this is a retryable error
      const isRetryable =
        errorMsg.includes("500") ||
        errorMsg.includes("InternalServerException") ||
        errorMsg.includes("503") ||
        errorMsg.includes("ServiceUnavailableException") ||
        errorMsg.includes("ThrottlingException") ||
        errorMsg.includes("overloaded");

      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs =
          Math.min(1000 * Math.pow(2, attempt - 1), 10000) +
          Math.random() * 1000;
        console.warn(
          `⚠️ Retryable error for "${task.fileName}" (attempt ${attempt}/${MAX_RETRIES}), retrying in ${(backoffMs / 1000).toFixed(1)}s...`,
          errorMsg,
        );
        await sleep(backoffMs);
        continue;
      }

      console.error(
        `❌ Analysis failed for "${task.fileName}" after ${attempt} attempt(s):`,
        error,
      );
      store.updateStatus(task.entryId, "failed", errorMsg);
      return;
    }
  }

  if (lastError) {
    store.updateStatus(task.entryId, "failed", lastError.message);
  }
}

/**
 * Memory is now saved with project files, not separately to disk
 */
export function saveMemoryToDisk(): void {
  console.log("[Memory Service] Memory is saved with project file");
}

/**
 * Process the analysis queue — sequential with gap between tasks
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  const store = useAiMemoryStore.getState();

  while (analysisQueue.length > 0 && activeAnalyses < MAX_CONCURRENT) {
    const task = analysisQueue.shift();
    if (!task) break;

    activeAnalyses++;
    store.setAnalyzingCount(activeAnalyses);
    store.setAnalyzing(true);

    await analyzeFile(task).finally(() => {
      activeAnalyses--;
      const currentStore = useAiMemoryStore.getState();
      currentStore.setAnalyzingCount(activeAnalyses);

      if (activeAnalyses === 0 && analysisQueue.length === 0) {
        currentStore.setAnalyzing(false);
      }
    });

    // Wait between analyses to avoid rate limits
    if (analysisQueue.length > 0) {
      console.log(
        `⏳ [Rate limit] Waiting 5s before next analysis (${analysisQueue.length} remaining)...`,
      );
      await sleep(5000);
    }
  }

  isProcessingQueue = false;
}

/**
 * Queue a media file for background AI analysis
 * This is the main entry point called when files are imported
 */
export function queueMediaAnalysis(params: {
  filePath: string;
  fileName: string;
  mediaType: "video" | "audio" | "image";
  mimeType: string;
  fileSize: number;
  duration?: number;
  thumbnailDataUrl?: string;
  clipId?: string;
}): string {
  const store = useAiMemoryStore.getState();

  // Check if this file has already been analyzed
  const existing = store.getEntryByFilePath(params.filePath);
  if (existing && existing.status === "completed") {
    console.log(`ℹ️ "${params.fileName}" already analyzed, skipping`);
    if (params.clipId && !existing.clipId) {
      store.linkClipId(existing.id, params.clipId);
    }
    return existing.id;
  }

  // Determine mime type from extension if not provided
  let mimeType = params.mimeType;
  if (!mimeType) {
    const ext = params.fileName.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      webm: "video/webm",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      aac: "audio/aac",
      flac: "audio/flac",
      ogg: "audio/ogg",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };
    mimeType = mimeMap[ext] || "application/octet-stream";
  }

  // Add entry to store
  const entryId = store.addEntry({
    filePath: params.filePath,
    fileName: params.fileName,
    mediaType: params.mediaType,
    mimeType,
    fileSize: params.fileSize,
    duration: params.duration,
    thumbnail: params.thumbnailDataUrl,
    clipId: params.clipId,
  });

  // Queue for analysis
  analysisQueue.push({
    entryId,
    filePath: params.filePath,
    fileName: params.fileName,
    mediaType: params.mediaType,
    mimeType,
    fileSize: params.fileSize,
    duration: params.duration,
    thumbnailDataUrl: params.thumbnailDataUrl,
  });

  console.log(
    `📋 Queued "${params.fileName}" for AI analysis (${analysisQueue.length} in queue)`,
  );

  processQueue();

  return entryId;
}

/**
 * Retry analysis for a failed entry
 */
export function retryAnalysis(entryId: string): void {
  const store = useAiMemoryStore.getState();
  const entry = store.entries.find((e) => e.id === entryId);
  if (!entry) return;

  store.updateStatus(entryId, "pending");

  analysisQueue.push({
    entryId,
    filePath: entry.filePath,
    fileName: entry.fileName,
    mediaType: entry.mediaType,
    mimeType: entry.mimeType,
    fileSize: entry.fileSize,
    duration: entry.duration,
    thumbnailDataUrl: entry.thumbnail,
  });

  processQueue();
}

/**
 * Get the memory context string for injecting into AI chat prompts
 */
export function getMemoryForChat(): string {
  return useAiMemoryStore.getState().getMemoryContextString();
}

/**
 * Check if AI Memory service is available
 */
export function isMemoryServiceAvailable(): boolean {
  return isBedrockConfigured();
}
