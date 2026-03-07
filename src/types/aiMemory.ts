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
  /** Editing-focused insights derived from the analysis */
  editorialInsights?: EditorialInsights;
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
  /** Key visible or audible elements within the scene */
  keyElements?: string[];
  /** Energy/readiness level for short-form editing */
  energyLevel?: 'low' | 'medium' | 'high';
  /** Suggested editorial role for this scene */
  recommendedUse?: string;
  /** Generic story role for this moment */
  storyRole?: 'hook' | 'setup' | 'behind_the_scenes' | 'proof' | 'payoff' | 'cta_support';
  /** Whether this scene has hook potential for opening moments */
  hookPotential?: 'low' | 'medium' | 'high';
  /** Why this moment is useful in an edit */
  editValue?: string;
  /** Short phrases that help the agent find this moment later */
  searchHints?: string[];
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
  /** Confidence or uncertainty notes for audio observations */
  confidenceNotes?: string;
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
  /** Important on-screen text or labels visible in the asset */
  visibleTextHighlights?: string[];
}

export interface EditorialInsights {
  /** Suitability for reels/shorts/vlog montage work */
  shortFormPotential?: 'low' | 'medium' | 'high';
  /** Overall pacing impression */
  pacing?: 'slow' | 'steady' | 'fast' | 'mixed';
  /** Primary narrative role this asset can serve */
  storyRole?: 'hook' | 'setup' | 'behind_the_scenes' | 'proof' | 'payoff' | 'cta_support';
  /** How strong the visual proof is for claims like winning, shipping, demo, etc. */
  evidenceStrength?: 'low' | 'medium' | 'high';
  /** Short factual things the agent should remember about this asset */
  memoryAnchors?: string[];
  /** Strongest moments worth surfacing in edits */
  hookMoments?: string[];
  /** Generic edit goals this asset supports well */
  bestFor?: string[];
  /** Cases where this asset is weak or should be secondary */
  avoidFor?: string[];
  /** Suggested editorial uses like hook, b-roll, payoff, CTA */
  recommendedUses?: string[];
  /** Short on-screen text ideas grounded in the footage */
  overlayIdeas?: string[];
  /** Production limitations or caution notes */
  cautions?: string[];
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
