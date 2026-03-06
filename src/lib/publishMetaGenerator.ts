/**
 * Publish Metadata Generator
 *
 * Uses Bedrock (Nova) to generate YouTube title, description, and tags
 * from the current project context: clip names, channel rules, AI memory,
 * and recent chat context.
 *
 * Falls back to safe heuristic values if Bedrock is unavailable.
 */

import { converseBedrock, MODEL_ID, isBedrockConfigured } from './bedrockGateway';
import type { PublishMeta } from '../stores/usePublishStore';

export interface PublishGenerationContext {
  clipNames: string[];
  totalDurationSec: number;
  channelRules: string;
  memorySnippets: string[];
  recentChatSummary: string;
}

/**
 * Calls Bedrock to generate YouTube metadata JSON.
 * Gracefully falls back to heuristics on any error.
 */
export async function generatePublishMeta(ctx: PublishGenerationContext): Promise<PublishMeta> {
  const clipsLine =
    ctx.clipNames.length > 0
      ? `Clips in project: ${ctx.clipNames.slice(0, 12).join(', ')}`
      : 'No clips yet.';

  const durationLine =
    ctx.totalDurationSec > 0
      ? `Total duration: ~${Math.round(ctx.totalDurationSec)}s (${Math.round(ctx.totalDurationSec / 60)}min)`
      : '';

  const memoryLine =
    ctx.memorySnippets.length > 0
      ? `Creator notes: ${ctx.memorySnippets.slice(0, 6).join('; ')}`
      : '';

  const contextBlock = [
    clipsLine,
    durationLine,
    memoryLine,
    ctx.channelRules ? `Channel context:\n${ctx.channelRules.slice(0, 800)}` : '',
    ctx.recentChatSummary ? `Recent editing context: ${ctx.recentChatSummary.slice(0, 400)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = `You are a YouTube SEO expert. Generate YouTube video metadata as JSON.

${contextBlock}

Return ONLY valid JSON with these exact fields (no markdown, no explanation):
{
  "title": "Engaging YouTube title under 70 characters that hooks the viewer",
  "description": "Full YouTube description in 3 paragraphs: (1) what viewers will learn/see, (2) key moments or highlights, (3) call to action with relevant keywords woven in naturally",
  "tags": "tag1, tag2, tag3, tag4, tag5, tag6, tag7, tag8 (8-12 comma-separated lowercase tags matching the channel niche)",
  "privacyStatus": "private"
}

Rules:
- Match the channel's style, tone, and audience from the context
- Title must create curiosity or promise clear value
- Tags must reflect real search terms for this niche
- Always set privacyStatus to "private" so the creator can review before publishing`;

  try {
    if (!isBedrockConfigured()) {
      return buildFallback(ctx.clipNames);
    }

    const response = await converseBedrock({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 600, temperature: 0.7 },
    });

    const rawText = response.output?.message?.content?.[0]?.text ?? '';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return buildFallback(ctx.clipNames);

    const parsed = JSON.parse(jsonMatch[0]) as Partial<PublishMeta>;
    return {
      title: sanitizeString(parsed.title) || buildFallbackTitle(ctx.clipNames),
      description: sanitizeString(parsed.description) || '',
      tags: sanitizeString(parsed.tags) || '',
      privacyStatus: isValidPrivacyStatus(parsed.privacyStatus) ? parsed.privacyStatus : 'private',
    };
  } catch {
    return buildFallback(ctx.clipNames);
  }
}

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Strip non-printable ASCII control characters (keep tab \x09, LF \x0A, CR \x0D)
  // eslint-disable-next-line no-control-regex
  return value.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function isValidPrivacyStatus(value: unknown): value is 'public' | 'private' | 'unlisted' {
  return value === 'public' || value === 'private' || value === 'unlisted';
}

function buildFallbackTitle(clipNames: string[]): string {
  return clipNames.length > 0 ? clipNames[0] : 'My Video';
}

function buildFallback(clipNames: string[]): PublishMeta {
  return {
    title: buildFallbackTitle(clipNames),
    description: '',
    tags: '',
    privacyStatus: 'private',
  };
}
