/**
 * AI Analysis Service — AWS Bedrock (Amazon Nova Lite v1)
 * Analyzes YouTube channels and generates insights.
 * Runs in Electron main process (Node.js context).
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';

interface ChannelMetadata {
  channel_id: string;
  title: string;
  description: string;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  published_at: string;
  country?: string;
}

interface VideoData {
  video_id: string;
  title: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string;
  duration: string;
  tags: string[];
}

export interface AnalysisResult {
  channel_summary: string;
  content_strengths: string[];
  weaknesses: string[];
  growth_suggestions: string[];
  editing_style_recommendations: string[];
  audience_insights: string[];
}

type BedrockSendClient = {
  send(command: unknown): Promise<ConverseCommandOutput>;
};

interface AIAnalysisServiceOptions {
  client?: BedrockSendClient;
  maxTransportRetries?: number;
  retryBaseDelayMs?: number;
}

const RETRYABLE_ERROR_NAMES = new Set([
  'InternalServerException',
  'ServiceUnavailableException',
  'ThrottlingException',
  'ModelNotReadyException',
]);

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ETIMEDOUT',
  'TimeoutError',
]);

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return '';
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

function isRetryableBedrockError(error: unknown): boolean {
  const name = getErrorName(error);
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  if (RETRYABLE_ERROR_NAMES.has(name) || RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  return (
    message.includes('socket hang up') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('connection reset') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate exceeded')
  );
}

function isExpiredAwsTokenError(error: unknown): boolean {
  const combined = `${getErrorName(error)} ${getErrorMessage(error)}`.toLowerCase();
  return (
    combined.includes('expiredtoken') ||
    combined.includes('expired token') ||
    combined.includes('security token included in the request is expired')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AIAnalysisService {
  private client: BedrockSendClient;
  private modelId: string;
  private maxTransportRetries: number;
  private retryBaseDelayMs: number;

  constructor(
    region: string = 'us-east-1',
    accessKeyId: string = '',
    secretAccessKey: string = '',
    modelId: string = 'amazon.nova-lite-v1:0',
    sessionToken?: string,
    options: AIAnalysisServiceOptions = {},
  ) {
    this.client =
      options.client ??
      new BedrockRuntimeClient({
        region,
        maxAttempts: 4,
        retryMode: 'adaptive',
        requestHandler: new NodeHttpHandler({
          connectionTimeout: 5_000,
          requestTimeout: 30_000,
          socketTimeout: 30_000,
        }),
        credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
      });
    this.modelId = modelId;
    this.maxTransportRetries = options.maxTransportRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  }

  /**
   * Analyze YouTube channel with top and recent videos
   */
  async analyzeChannel(
    channelMetadata: ChannelMetadata,
    topVideos: VideoData[],
    recentVideos: VideoData[],
  ): Promise<AnalysisResult | null> {
    try {
      const prompt = this.buildAnalysisPrompt(channelMetadata, topVideos, recentVideos);
      const response = await this.callBedrock(prompt);
      return this.parseStructuredResponse(response);
    } catch (error) {
      console.error('AI analysis error:', error);
      return null;
    }
  }

  /**
   * Build analysis prompt with structured strategy
   */
  private buildAnalysisPrompt(
    channel: ChannelMetadata,
    topVideos: VideoData[],
    recentVideos: VideoData[],
  ): string {
    const avgViews = channel.view_count / Math.max(channel.video_count, 1);

    const topVideosFormatted = topVideos
      .map(
        (v, i) =>
          `${i + 1}. "${v.title}" - ${v.view_count.toLocaleString()} views, ${v.like_count.toLocaleString()} likes`,
      )
      .join('\n');

    const recentVideosFormatted = recentVideos
      .map(
        (v, i) =>
          `${i + 1}. "${v.title}" - ${v.view_count.toLocaleString()} views, ${v.like_count.toLocaleString()} likes`,
      )
      .join('\n');

    return `<role>
You are a YouTube strategy advisor specializing in content analysis and actionable recommendations for video creators.
</role>

<context>
Channel Name: ${channel.title}
Subscribers: ${channel.subscriber_count.toLocaleString()}
Total Videos: ${channel.video_count}
Total Views: ${channel.view_count.toLocaleString()}
Average Views per Video: ${Math.round(avgViews).toLocaleString()}
Active Since: ${channel.published_at}
${channel.country ? `Country: ${channel.country}` : ''}

Top 5 Performing Videos (By Views):
${topVideosFormatted}

Latest 5 Videos:
${recentVideosFormatted}
</context>

<constraints>
1. Base ALL recommendations strictly on the data provided in the context above
2. Do NOT use external knowledge or assumptions about the channel
3. Be specific and actionable - avoid generic advice like "post consistently"
4. Focus on editing and content creation advice relevant to a video editor application
5. Consider the channel's current size and realistic growth opportunities
6. Keep each point concise (1-2 sentences maximum)
</constraints>

<task>
Analyze this YouTube channel data and provide structured insights covering:
- channel_summary: 2-3 sentence overview of the channel's focus and content strategy
- content_strengths: 3-5 specific strengths based on the data
- weaknesses: 2-3 areas for improvement based on performance patterns
- growth_suggestions: 3-5 actionable growth strategies specific to this channel
- editing_style_recommendations: 3-5 specific video editing tips based on their niche and audience
- audience_insights: 2-3 insights about their target audience
</task>

<output_format>
Return ONLY a valid JSON object matching this exact structure. Do not include markdown code blocks or any additional text:
{
  "channel_summary": "string",
  "content_strengths": ["string", "string", "string"],
  "weaknesses": ["string", "string"],
  "growth_suggestions": ["string", "string", "string"],
  "editing_style_recommendations": ["string", "string", "string"],
  "audience_insights": ["string", "string"]
}
</output_format>

Based on the channel data provided above, generate your analysis:`;
  }

  /**
   * Call Bedrock Converse API
   */
  private async callBedrock(prompt: string): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxTransportRetries + 1; attempt += 1) {
      try {
        const response = await this.client.send(
          new ConverseCommand({
            modelId: this.modelId,
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            system: [
              {
                text: `<role>
You are a specialized AI assistant for YouTube channel analysis in a video editing application.
You are precise, analytical, and data-driven.
</role>

<instructions>
1. You are strictly grounded to the information provided in the user context
2. Base all insights on the actual data - never use external knowledge about channels
3. If the exact information is not in the provided data, state that it's not available
4. Return responses in valid JSON format only
5. Be specific and actionable in all recommendations
</instructions>

<constraints>
- Verbosity: Low to Medium
- Tone: Professional and analytical
- Output: Valid JSON only, no markdown code blocks
</constraints>`,
              },
            ],
            inferenceConfig: { maxTokens: 2000, temperature: 0.7 },
          }),
        );

        return response.output?.message?.content?.[0]?.text || '';
      } catch (error) {
        lastError = error;

        if (isExpiredAwsTokenError(error)) {
          throw new Error(
            'AWS credentials expired for YouTube channel analysis. Refresh them in Settings or .env and retry.',
          );
        }

        if (!isRetryableBedrockError(error) || attempt > this.maxTransportRetries) {
          console.error('Bedrock API call failed:', error);
          throw error;
        }

        const backoffMs = this.retryBaseDelayMs * 2 ** (attempt - 1);
        console.warn(
          `Retrying Bedrock channel analysis request (attempt ${attempt}/${this.maxTransportRetries + 1}) after ${backoffMs}ms`,
          getErrorMessage(error),
        );
        await sleep(backoffMs);
      }
    }

    console.error('Bedrock API call failed:', lastError);
    throw lastError instanceof Error ? lastError : new Error('Bedrock API call failed');
  }

  /**
   * Parse structured JSON response
   */
  private parseStructuredResponse(response: string): AnalysisResult | null {
    try {
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      if (
        !parsed.channel_summary ||
        !Array.isArray(parsed.content_strengths) ||
        !Array.isArray(parsed.weaknesses) ||
        !Array.isArray(parsed.growth_suggestions) ||
        !Array.isArray(parsed.editing_style_recommendations) ||
        !Array.isArray(parsed.audience_insights)
      ) {
        throw new Error('Invalid response structure');
      }

      return {
        channel_summary: parsed.channel_summary,
        content_strengths: parsed.content_strengths,
        weaknesses: parsed.weaknesses,
        growth_suggestions: parsed.growth_suggestions,
        editing_style_recommendations: parsed.editing_style_recommendations,
        audience_insights: parsed.audience_insights,
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      console.error('Raw response:', response);
      return null;
    }
  }
}
