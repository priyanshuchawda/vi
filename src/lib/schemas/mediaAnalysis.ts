import { z } from 'zod';

/**
 * Zod schema for scene information
 */
const SceneSchema = z.object({
  startTime: z.number().min(0).describe('Start time in seconds'),
  endTime: z.number().positive().describe('End time in seconds'),
  description: z.string().describe('Description of the scene'),
  keyElements: z.array(z.string()).optional().describe('Key elements in the scene'),
  energyLevel: z.enum(['low', 'medium', 'high']).optional().describe('Scene energy level'),
  recommendedUse: z
    .string()
    .optional()
    .describe('Suggested edit use such as hook, b-roll, payoff, or transition'),
  storyRole: z
    .enum(['hook', 'setup', 'behind_the_scenes', 'proof', 'payoff', 'cta_support'])
    .optional()
    .describe('Generic story role this moment serves'),
  hookPotential: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe('Hook potential for short-form openings'),
  editValue: z.string().optional().describe('Why this moment is useful in an edit'),
  searchHints: z
    .array(z.string())
    .optional()
    .describe('Short phrases that help later retrieval of this moment'),
});

/**
 * Zod schema for audio information
 */
const AudioInfoSchema = z.object({
  hasSpeech: z.boolean().describe('Whether speech is present'),
  hasMusic: z.boolean().describe('Whether music is present'),
  languages: z.array(z.string()).optional().describe('Languages detected in speech'),
  mood: z.string().optional().describe('Overall mood of the audio'),
  transcriptSummary: z.string().optional().describe('Brief summary of speech content if present'),
  confidenceNotes: z
    .string()
    .optional()
    .describe('Notes about audio certainty, for example when speech is not clearly audible'),
});

/**
 * Zod schema for visual information
 */
const VisualInfoSchema = z.object({
  dominantColors: z.array(z.string()).optional().describe('Dominant colors in the visuals'),
  style: z.string().optional().describe('Visual style (e.g., cinematic, documentary, vlog)'),
  subjects: z.array(z.string()).optional().describe('Main subjects visible in the content'),
  composition: z.string().optional().describe('Description of shot composition and camera work'),
  quality: z.string().optional().describe('Overall quality assessment'),
  visibleTextHighlights: z
    .array(z.string())
    .optional()
    .describe('Important visible text such as team names, winners, certificates, or UI labels'),
});

const EditorialInsightsSchema = z.object({
  shortFormPotential: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe('Suitability for shorts, reels, and social-first edits'),
  pacing: z
    .enum(['slow', 'steady', 'fast', 'mixed'])
    .optional()
    .describe('Overall pacing impression'),
  storyRole: z
    .enum(['hook', 'setup', 'behind_the_scenes', 'proof', 'payoff', 'cta_support'])
    .optional()
    .describe('Primary narrative role this asset can serve'),
  evidenceStrength: z
    .enum(['low', 'medium', 'high'])
    .optional()
    .describe('How strong the asset is as proof of a claim or result'),
  memoryAnchors: z
    .array(z.string())
    .optional()
    .describe('Short factual points the agent should remember about this asset'),
  hookMoments: z
    .array(z.string())
    .optional()
    .describe('Strongest hook-worthy moments grounded in the footage'),
  bestFor: z
    .array(z.string())
    .optional()
    .describe('Generic editing goals this asset supports well'),
  avoidFor: z
    .array(z.string())
    .optional()
    .describe('Cases where this asset is weak or should stay secondary'),
  recommendedUses: z
    .array(z.string())
    .optional()
    .describe('Suggested editorial uses such as hook, scenic b-roll, proof, payoff, CTA'),
  overlayIdeas: z
    .array(z.string())
    .optional()
    .describe('Short on-screen text ideas supported by the visuals or speech'),
  cautions: z
    .array(z.string())
    .optional()
    .describe('Limitations or caution notes relevant to editing decisions'),
});

/**
 * Main schema for media analysis response
 */
export const MediaAnalysisSchema = z.object({
  summary: z.string().min(1).describe('A 1-2 sentence summary describing the content'),

  tags: z.array(z.string()).max(10).describe('5-10 relevant tags for quick reference'),

  analysis: z
    .string()
    .min(1)
    .describe(
      'A detailed paragraph (3-5 sentences) describing the content, style, quality, pacing, and notable elements',
    ),

  scenes: z.array(SceneSchema).optional().describe('Array of scene breakdowns with timestamps'),

  audioInfo: AudioInfoSchema.optional().describe('Audio analysis information'),

  visualInfo: VisualInfoSchema.optional().describe('Visual analysis information'),

  editorialInsights: EditorialInsightsSchema.optional().describe('Editing-focused guidance'),
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
export type EditorialInsights = z.infer<typeof EditorialInsightsSchema>;

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
