/**
 * AI Memory System Types
 *
 * When users import media files (video, audio, image) into the video editor,
 * AI automatically analyzes them in the background and stores the analysis
 * in memory. This gives AI persistent context about the user's media
 * for personalized, context-aware assistance.
 */

export type MediaAnalysisStatus = 'pending' | 'analyzing' | 'completed' | 'failed';

export interface MediaAnalysisEntry {
  /** Unique ID for this memory entry */
  id: string;
  /** File path or identifier */
  filePath: string;
  /** Original file name */
  fileName: string;
  /** Media type */
  mediaType: 'video' | 'audio' | 'image' | 'document';
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
  /** Duration in seconds (for video/audio) */
  duration?: number;
  /** Thumbnail data URL if available */
  thumbnail?: string;
  /** Current analysis status */
  status: MediaAnalysisStatus;
  /** AI's analysis/description of the media */
  analysis: string;
  /** Key tags/labels extracted by AI */
  tags: string[];
  /** Content summary (shorter version of analysis) */
  summary: string;
  /** Detected scenes/segments for video */
  scenes?: SceneInfo[];
  /** Audio characteristics (for audio/video with audio) */
  audioInfo?: AudioInfo;
  /** Visual characteristics (for image/video) */
  visualInfo?: VisualInfo;
  /** Timestamp when analysis was created */
  createdAt: number;
  /** Timestamp when analysis was last updated */
  updatedAt: number;
  /** Error message if analysis failed */
  error?: string;
  /** Clip ID if this file is associated with a clip in the timeline */
  clipId?: string;
}

export interface SceneInfo {
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Description of the scene */
  description: string;
}

export interface AudioInfo {
  /** Whether the media has speech */
  hasSpeech: boolean;
  /** Whether the media has music */
  hasMusic: boolean;
  /** Detected language(s) of speech */
  languages?: string[];
  /** Overall audio mood/tone */
  mood?: string;
  /** Brief transcript summary if speech detected */
  transcriptSummary?: string;
}

export interface VisualInfo {
  /** Primary colors detected */
  dominantColors?: string[];
  /** Overall visual style description */
  style?: string;
  /** Detected objects/subjects */
  subjects?: string[];
  /** Overall composition notes */
  composition?: string;
  /** Quality assessment */
  quality?: string;
}

/**
 * The full memory context that gets injected into AI's system prompt
 */
export interface AiMemoryContext {
  /** Total number of media files analyzed */
  totalFiles: number;
  /** Summary of all media in the project */
  projectSummary: string;
  /** Individual file analyses */
  entries: MediaAnalysisEntry[];
}
