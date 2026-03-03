import { z } from 'zod';

/**
 * Zod schema for scene information
 */
const SceneSchema = z.object({
  startTime: z.number().min(0).describe('Start time in seconds'),
  endTime: z.number().positive().describe('End time in seconds'),
  description: z.string().describe('Description of the scene'),
  keyElements: z.array(z.string()).optional().describe('Key elements in the scene'),
});

/**
 * Zod schema for audio information
 */
const AudioInfoSchema = z.object({
  hasSpeech: z.boolean().describe('Whether speech is present'),
  hasMusic: z.boolean().describe('Whether music is present'),
  languages: z.array(z.string()).describe('Languages detected in speech'),
  mood: z.string().describe('Overall mood of the audio'),
  transcriptSummary: z.string().optional().describe('Brief summary of speech content if present'),
});

/**
 * Zod schema for visual information
 */
const VisualInfoSchema = z.object({
  dominantColors: z.array(z.string()).describe('Dominant colors in the visuals'),
  style: z.string().describe('Visual style (e.g., cinematic, documentary, vlog)'),
  subjects: z.array(z.string()).optional().describe('Main subjects visible in the content'),
  composition: z.string().optional().describe('Description of shot composition and camera work'),
  quality: z.string().describe('Overall quality assessment'),
});

/**
 * Main schema for media analysis response
 */
export const MediaAnalysisSchema = z.object({
  summary: z.string().min(10).describe('A 1-2 sentence summary describing the content'),

  tags: z.array(z.string()).min(1).max(10).describe('5-10 relevant tags for quick reference'),

  analysis: z
    .string()
    .min(20)
    .describe(
      'A detailed paragraph (3-5 sentences) describing the content, style, quality, pacing, and notable elements',
    ),

  scenes: z.array(SceneSchema).optional().describe('Array of scene breakdowns with timestamps'),

  audioInfo: AudioInfoSchema.optional().describe('Audio analysis information'),

  visualInfo: VisualInfoSchema.optional().describe('Visual analysis information'),
});

/**
 * TypeScript type inferred from the Zod schema
 */
export type MediaAnalysis = z.infer<typeof MediaAnalysisSchema>;

/**
 * Export individual component types
 */
export type Scene = z.infer<typeof SceneSchema>;
export type AudioInfo = z.infer<typeof AudioInfoSchema>;
export type VisualInfo = z.infer<typeof VisualInfoSchema>;

/**
 * Helper function to safely parse and validate media analysis response
 */
export function parseMediaAnalysis(data: unknown): MediaAnalysis {
  return MediaAnalysisSchema.parse(data);
}

/**
 * Helper function for safe parsing that returns errors instead of throwing
 */
export function safeParseMediaAnalysis(data: unknown) {
  return MediaAnalysisSchema.safeParse(data);
}
