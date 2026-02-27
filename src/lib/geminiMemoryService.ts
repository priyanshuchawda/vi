/**
 * Gemini Memory Service
 * 
 * This service handles the background analysis of imported media files.
 * When a user imports files into the video editor, this service:
 * 1. Receives the file info (path, type, thumbnail, etc.)
 * 2. Sends it to Gemini for analysis (using inline data for small files, File API for large)
 * 3. Parses the structured response
 * 4. Stores the analysis in the GeminiMemoryStore
 * 
 * The analysis runs in parallel with the normal import flow, so it doesn't
 * block the user from working with their files.
 */

import { GoogleGenAI, MediaResolution, Type } from '@google/genai';
import { useGeminiMemoryStore } from '../stores/useGeminiMemoryStore';
import type { AudioInfo, SceneInfo, VisualInfo } from '../types/geminiMemory';
import { MediaAnalysisSchema } from './schemas/mediaAnalysis';

// Re-use the same API key as geminiService
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Log initialization status
console.log('[Gemini Memory Service] Initialization:', {
  apiKeyPresent: !!apiKey,
  apiKeyLength: apiKey?.length || 0,
  apiKeyPrefix: apiKey?.substring(0, 10) + '...',
  clientCreated: !!ai
});

// Queue management for background analysis
let analysisQueue: AnalysisTask[] = [];
let isProcessingQueue = false;
const MAX_CONCURRENT = 2; // Max concurrent analyses
let activeAnalyses = 0;

/**
 * Options for analyzing specific segments of a video
 * Allows token savings by only analyzing the relevant portion
 */
interface VideoClipOptions {
    startTime?: number;  // in seconds
    endTime?: number;    // in seconds
    fps?: number;        // custom frame rate (default is 1 FPS)
}

interface AnalysisTask {
    entryId: string;
    filePath: string;
    fileName: string;
    mediaType: 'video' | 'audio' | 'image' | 'document';
    mimeType: string;
    fileSize: number;
    duration?: number;
    thumbnailDataUrl?: string; // base64 thumbnail for images/video frames
    clipOptions?: VideoClipOptions; // Optional video clipping for token optimization
}

/**
 * Get the appropriate analysis prompt based on media type
 * Using structured output API, so no need to explain JSON format in prompt
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
</constraints>`;

    if (mediaType === 'video') {
        return baseInstruction + `

<analysis_focus>
- Identify key scenes with approximate timestamps
- Analyze both visual and audio aspects
- Note dominant colors, composition style, and quality
- Detect speech, music, and overall mood
- Provide actionable insights for video editing
</analysis_focus>`;
    }

    if (mediaType === 'audio') {
        return baseInstruction + `

<analysis_focus>
- Describe what you hear (speech, music, sound effects)
- Identify languages and speakers if applicable
- Assess audio quality and mood
- Note any background sounds or music
- Provide insights relevant to audio editing
</analysis_focus>`;
    }

    if (mediaType === 'image') {
        return baseInstruction + `

<analysis_focus>
- Describe composition, colors, and style
- Identify main subjects and elements
- Assess image quality and resolution
- Note lighting and artistic choices
- Provide insights for photo/video editing
</analysis_focus>`;
    }

    // Document
    return baseInstruction + `

<analysis_focus>
- Summarize the document's content and purpose
- Extract key information and themes
- Identify document type and structure
- Note any production-relevant details
</analysis_focus>`;
}

// Threshold for using inline data vs File API
// Per docs: File API recommended for files > 100MB, but videos often fail with inline
// Use File API for all videos regardless of size, and for other files > 10MB
const MAX_INLINE_FOR_ANALYSIS = 10 * 1024 * 1024; // 10MB

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
        console.error('Error reading file for Gemini analysis:', error);
        return null;
    }
}

/**
 * Upload a file to the Gemini File API from a local path (via Electron)
 * This is recommended for videos and large files per the Gemini docs.
 * After upload, polls until the file reaches ACTIVE state (videos need processing time).
 */
async function uploadFileToGeminiAPI(filePath: string, mimeType: string, fileName: string): Promise<{ uri: string; mimeType: string } | null> {
    if (!ai) return null;

    try {
        // Read file as base64 first (we need the raw bytes to upload)
        const base64Data = await readFileAsBase64(filePath);
        if (!base64Data) {
            console.warn(`⚠️ Cannot read file for upload: ${fileName}`);
            return null;
        }

        // Convert base64 to Blob for File API upload
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });
        const file = new File([blob], fileName, { type: mimeType });

        console.log(`📤 Uploading "${fileName}" (${(file.size / 1024 / 1024).toFixed(1)} MB) to Gemini File API...`);

        const uploaded = await ai.files.upload({
            file: file,
            config: { mimeType },
        });

        if (!uploaded.uri || !uploaded.mimeType || !uploaded.name) {
            throw new Error('File upload failed: no URI or name returned');
        }

        console.log(`✅ File uploaded to Gemini: ${uploaded.uri} (name: ${uploaded.name})`);

        // Poll for ACTIVE state — videos need server-side processing after upload
        // The file transitions: PROCESSING -> ACTIVE (or FAILED)
        const MAX_POLL_TIME_MS = 120_000; // 2 minutes max wait
        const POLL_INTERVAL_MS = 2_000;   // Check every 2 seconds
        const startTime = Date.now();

        let fileState = uploaded.state ?? 'PROCESSING';

        if (fileState !== 'ACTIVE') {
            console.log(`⏳ Waiting for "${fileName}" to finish processing (state: ${fileState})...`);
        }

        while (fileState !== 'ACTIVE' && (Date.now() - startTime) < MAX_POLL_TIME_MS) {
            await sleep(POLL_INTERVAL_MS);

            try {
                const fileInfo = await ai.files.get({ name: uploaded.name });
                fileState = fileInfo.state ?? 'PROCESSING';

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
                console.log(`⏳ File "${fileName}" state: ${fileState} (${elapsed}s elapsed)`);

                if (fileState === 'FAILED') {
                    throw new Error(`File processing failed on Gemini servers for "${fileName}"`);
                }
            } catch (pollError) {
                // If polling itself fails, log but continue — the file might still become ACTIVE
                console.warn(`⚠️ Poll error for "${fileName}":`, pollError);
            }
        }

        if (fileState !== 'ACTIVE') {
            throw new Error(`File "${fileName}" did not reach ACTIVE state within ${MAX_POLL_TIME_MS / 1000}s (last state: ${fileState})`);
        }

        console.log(`✅ File "${fileName}" is ACTIVE and ready for analysis`);
        return { uri: uploaded.uri, mimeType: uploaded.mimeType };
    } catch (error) {
        console.error(`❌ File API upload failed for "${fileName}":`, error);
        return null;
    }
}

/**
 * Parse the JSON analysis response from Gemini with Zod validation
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
        // Parse JSON
        const parsed = JSON.parse(responseText);
        
        // Validate with Zod schema for runtime type safety
        const result = MediaAnalysisSchema.safeParse(parsed);
        
        if (!result.success) {
            console.warn('Schema validation failed:', result.error.format());
            // Fall back to manual parsing if validation fails
            return {
                summary: parsed.summary || 'No summary available',
                tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : [],
                analysis: parsed.analysis || 'No detailed analysis available',
                scenes: Array.isArray(parsed.scenes) ? parsed.scenes : undefined,
                audioInfo: parsed.audioInfo || undefined,
                visualInfo: parsed.visualInfo || undefined,
            };
        }
        
        // Return validated data with type safety
        return result.data;
    } catch (error) {
        console.error('Failed to parse Gemini analysis response:', error);
        // This should rarely happen with structured output
        return {
            summary: 'Analysis parsing failed',
            tags: [],
            analysis: responseText.slice(0, 500),
        };
    }
}

/**
 * Sleep for exponential backoff
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Analyze a single media file using Gemini
 * 
 * Strategy (per Gemini docs):
 * - Videos: Always use File API (inline data causes 500 errors for video)
 * - Audio > 10MB: Use File API
 * - Images/small audio: Use inline data (base64)
 * - Retry transient errors (500, 503) with exponential backoff
 */
async function analyzeFile(task: AnalysisTask): Promise<void> {
    if (!ai) {
        console.error('❌ [Gemini Memory] AI client not initialized! API key missing or invalid.');
        console.error('Required env var: VITE_GEMINI_API_KEY');
        console.error('Current value:', import.meta.env.VITE_GEMINI_API_KEY ? 'Present' : 'Missing');
        useGeminiMemoryStore.getState().updateStatus(
            task.entryId,
            'failed',
            'Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your .env file'
        );
        return;
    }

    const store = useGeminiMemoryStore.getState();
    store.updateStatus(task.entryId, 'analyzing');

    console.log(`🚀 [Gemini Memory] Starting analysis for "${task.fileName}" (${(task.fileSize / 1024 / 1024).toFixed(2)} MB)`);

    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const prompt = getAnalysisPrompt(task.mediaType, task.fileName);

            // Build the content parts
            const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string; mimeType?: string } }> = [];

            // Determine whether to use File API or inline data
            const useFileAPI = task.mediaType === 'video' || task.mediaType === 'audio' || task.fileSize > MAX_INLINE_FOR_ANALYSIS;

            if (useFileAPI) {
                // Use File API for videos and large files (recommended by Gemini docs)
                console.log(`📁 Using File API for "${task.fileName}" (${task.mediaType}, ${(task.fileSize / 1024 / 1024).toFixed(1)} MB)...`);

                const uploaded = await uploadFileToGeminiAPI(task.filePath, task.mimeType, task.fileName);

                if (uploaded) {
                    // Create file data part with optional video metadata for clipping
                    const filePart: any = {
                        fileData: {
                            fileUri: uploaded.uri,
                            mimeType: uploaded.mimeType,
                        },
                    };

                    // Add video metadata for clipping if this is a video and options are provided
                    // This allows analyzing only specific segments (massive token savings!)
                    if (task.mediaType === 'video' && task.clipOptions) {
                        const { startTime, endTime, fps } = task.clipOptions;
                        filePart.videoMetadata = {};
                        
                        if (startTime !== undefined) {
                            filePart.videoMetadata.startOffset = `${startTime}s`;
                        }
                        if (endTime !== undefined) {
                            filePart.videoMetadata.endOffset = `${endTime}s`;
                        }
                        if (fps !== undefined) {
                            filePart.videoMetadata.fps = fps;
                        }

                        console.log(`✂️ Analyzing video clip from ${startTime || 0}s to ${endTime || 'end'} at ${fps || 1} FPS`);
                    }

                    parts.push(filePart);
                } else {
                    // Fallback: try inline if file API fails and file is small enough
                    if (task.fileSize <= MAX_INLINE_FOR_ANALYSIS) {
                        console.log(`↩️ Falling back to inline data for "${task.fileName}"...`);
                        const base64Data = await readFileAsBase64(task.filePath);
                        if (base64Data) {
                            parts.push({
                                inlineData: { mimeType: task.mimeType, data: base64Data },
                            });
                        }
                    } else {
                        console.warn(`❌ Cannot process "${task.fileName}": File API failed and file too large for inline`);
                    }
                }
            } else {
                // Use inline data for small images
                let base64Data: string | null = null;

                // For images, try thumbnail first
                if (task.thumbnailDataUrl) {
                    const base64Match = task.thumbnailDataUrl.match(/^data:[^;]+;base64,(.+)$/);
                    if (base64Match) {
                        base64Data = base64Match[1];
                    }
                }

                // Read from disk if no thumbnail
                if (!base64Data) {
                    base64Data = await readFileAsBase64(task.filePath);
                }

                if (base64Data) {
                    parts.push({
                        inlineData: { mimeType: task.mimeType, data: base64Data },
                    });
                }
            }

            // If no media parts were added, do metadata-only analysis
            if (parts.length === 0) {
                console.log(`📝 No file data available for "${task.fileName}", performing metadata-only analysis`);
            }

            parts.push({ text: prompt });

            console.log(`🧠 Analyzing ${task.mediaType}: "${task.fileName}" (attempt ${attempt}/${MAX_RETRIES})...`);

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts }],
                config: {
                    // Use LOW resolution for general transcription/analysis (67% token savings)
                    // Most video editing analysis doesn't need high-res frames
                    mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
                    
                    // Use structured output API for guaranteed valid JSON (no parsing errors!)
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            summary: {
                                type: Type.STRING,
                                description: 'A 1-2 sentence summary describing the content',
                            },
                            tags: {
                                type: Type.ARRAY,
                                description: '5-10 relevant tags for quick reference',
                                items: { type: Type.STRING },
                            },
                            analysis: {
                                type: Type.STRING,
                                description: 'A detailed paragraph (3-5 sentences) describing the content, style, quality, pacing, and notable elements',
                            },
                            scenes: {
                                type: Type.ARRAY,
                                description: 'Array of scene breakdowns with timestamps',
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        startTime: { type: Type.NUMBER, description: 'Start time in seconds' },
                                        endTime: { type: Type.NUMBER, description: 'End time in seconds' },
                                        description: { type: Type.STRING, description: 'Description of the scene' },
                                    },
                                    required: ['startTime', 'endTime', 'description'],
                                },
                            },
                            audioInfo: {
                                type: Type.OBJECT,
                                description: 'Audio analysis information',
                                properties: {
                                    hasSpeech: { type: Type.BOOLEAN, description: 'Whether speech is present' },
                                    hasMusic: { type: Type.BOOLEAN, description: 'Whether music is present' },
                                    languages: {
                                        type: Type.ARRAY,
                                        description: 'Languages detected in speech',
                                        items: { type: Type.STRING },
                                    },
                                    mood: {
                                        type: Type.STRING,
                                        description: 'Overall mood of the audio',
                                    },
                                    transcriptSummary: {
                                        type: Type.STRING,
                                        description: 'Brief summary of speech content if present',
                                    },
                                },
                            },
                            visualInfo: {
                                type: Type.OBJECT,
                                description: 'Visual analysis information',
                                properties: {
                                    dominantColors: {
                                        type: Type.ARRAY,
                                        description: 'Dominant colors in the visuals',
                                        items: { type: Type.STRING },
                                    },
                                    style: {
                                        type: Type.STRING,
                                        description: 'Visual style (e.g., cinematic, documentary, vlog)',
                                    },
                                    subjects: {
                                        type: Type.ARRAY,
                                        description: 'Main subjects visible in the content',
                                        items: { type: Type.STRING },
                                    },
                                    composition: {
                                        type: Type.STRING,
                                        description: 'Description of shot composition and camera work',
                                    },
                                    quality: {
                                        type: Type.STRING,
                                        description: 'Overall quality assessment',
                                    },
                                },
                            },
                        },
                        required: ['summary', 'tags', 'analysis'],
                    },
                    
                    systemInstruction: `<role>
You are a specialized media analysis AI for QuickCut, a professional video editing application.
</role>

<instructions>
1. Analyze the provided media file accurately and thoroughly
2. Extract structured information useful for video editors
3. Be specific and detail-oriented in your analysis
</instructions>

<constraints>
- Base analysis strictly on the actual content provided
- Do not speculate or assume information not present
- Verbosity: Medium (detailed but concise)
- Tone: Technical and precise
</constraints>

<grounding>
You are strictly grounded to the media file content provided. Do not use external knowledge about similar content. Analyze only what you directly observe in the file.
</grounding>`,
                },
            });

            const responseText = response.text || '';

            if (!responseText) {
                throw new Error('Empty response from Gemini');
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
                }
            );

            console.log(`✅ Analysis complete for "${task.fileName}": ${parsed.summary}`);
            // Note: The store's updateAnalysis() auto-saves to disk via Electron IPC
            return; // Success — exit retry loop

        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const errorMsg = lastError.message;

            // Check if this is a retryable error (500 Internal, 503 Unavailable)
            const isRetryable = errorMsg.includes('500') ||
                errorMsg.includes('INTERNAL') ||
                errorMsg.includes('503') ||
                errorMsg.includes('UNAVAILABLE') ||
                errorMsg.includes('overloaded');

            if (isRetryable && attempt < MAX_RETRIES) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000) + Math.random() * 1000;
                console.warn(`⚠️ Retryable error for "${task.fileName}" (attempt ${attempt}/${MAX_RETRIES}), retrying in ${(backoffMs / 1000).toFixed(1)}s...`, errorMsg);
                await sleep(backoffMs);
                continue;
            }

            // Non-retryable error or max retries reached
            console.error(`❌ Analysis failed for "${task.fileName}" after ${attempt} attempt(s):`, error);
            store.updateStatus(task.entryId, 'failed', errorMsg);
            return;
        }
    }

    // Should not reach here, but just in case
    if (lastError) {
        store.updateStatus(task.entryId, 'failed', lastError.message);
    }
}

/**
 * Memory is now saved with project files, not separately to disk
 */
export function saveMemoryToDisk(): void {
    console.log('[Memory Service] Memory is saved with project file');
}

/**
 * Process the analysis queue
 */
async function processQueue(): Promise<void> {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    const store = useGeminiMemoryStore.getState();

    while (analysisQueue.length > 0 && activeAnalyses < MAX_CONCURRENT) {
        const task = analysisQueue.shift();
        if (!task) break;

        activeAnalyses++;
        store.setAnalyzingCount(activeAnalyses);
        store.setAnalyzing(true);

        // Run analysis in background (don't await - let it run concurrently)
        analyzeFile(task).finally(() => {
            activeAnalyses--;
            const currentStore = useGeminiMemoryStore.getState();
            currentStore.setAnalyzingCount(activeAnalyses);

            if (activeAnalyses === 0 && analysisQueue.length === 0) {
                currentStore.setAnalyzing(false);
            }

            // Process next in queue
            if (analysisQueue.length > 0) {
                isProcessingQueue = false;
                processQueue();
            }
        });
    }

    isProcessingQueue = false;
}

/**
 * Queue a media file for background Gemini analysis
 * This is the main entry point called when files are imported
 */
export function queueMediaAnalysis(params: {
    filePath: string;
    fileName: string;
    mediaType: 'video' | 'audio' | 'image';
    mimeType: string;
    fileSize: number;
    duration?: number;
    thumbnailDataUrl?: string;
    clipId?: string;
}): string {
    const store = useGeminiMemoryStore.getState();

    // Check if this file has already been analyzed
    const existing = store.getEntryByFilePath(params.filePath);
    if (existing && existing.status === 'completed') {
        console.log(`ℹ️ "${params.fileName}" already analyzed, skipping`);
        // Link clip ID if provided
        if (params.clipId && !existing.clipId) {
            store.linkClipId(existing.id, params.clipId);
        }
        return existing.id;
    }

    // Determine mime type from extension if not provided
    let mimeType = params.mimeType;
    if (!mimeType) {
        const ext = params.fileName.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
            mp4: 'video/mp4',
            mov: 'video/quicktime',
            avi: 'video/x-msvideo',
            webm: 'video/webm',
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            aac: 'audio/aac',
            flac: 'audio/flac',
            ogg: 'audio/ogg',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            bmp: 'image/bmp',
        };
        mimeType = mimeMap[ext] || 'application/octet-stream';
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

    console.log(`📋 Queued "${params.fileName}" for Gemini analysis (${analysisQueue.length} in queue)`);

    // Start processing
    processQueue();

    return entryId;
}

/**
 * Retry analysis for a failed entry
 */
export function retryAnalysis(entryId: string): void {
    const store = useGeminiMemoryStore.getState();
    const entry = store.entries.find((e) => e.id === entryId);
    if (!entry) return;

    store.updateStatus(entryId, 'pending');

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
 * Get the memory context string for injecting into Gemini chat prompts
 */
export function getMemoryForChat(): string {
    return useGeminiMemoryStore.getState().getMemoryContextString();
}

/**
 * Check if Gemini Memory service is available
 */
export function isMemoryServiceAvailable(): boolean {
    return ai !== null;
}
