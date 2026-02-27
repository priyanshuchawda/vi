/**
 * Gemini AI Analysis Service
 * Analyzes YouTube channels and generates insights
 */

import { GoogleGenAI } from '@google/genai';

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

export class GeminiAnalysisService {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-flash-lite-latest') {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /**
   * Analyze YouTube channel with top and recent videos
   */
  async analyzeChannel(
    channelMetadata: ChannelMetadata,
    topVideos: VideoData[],
    recentVideos: VideoData[]
  ): Promise<AnalysisResult | null> {
    try {
      const prompt = this.buildAnalysisPrompt(channelMetadata, topVideos, recentVideos);
      const response = await this.callGemini(prompt);
      return this.parseStructuredResponse(response);
    } catch (error) {
      console.error('Gemini analysis error:', error);
      return null;
    }
  }

  /**
   * Build analysis prompt with structured prompt strategy
   * Following Gemini best practices: XML tags, grounding, clear output format
   */
  private buildAnalysisPrompt(
    channel: ChannelMetadata,
    topVideos: VideoData[],
    recentVideos: VideoData[]
  ): string {
    const avgViews = channel.view_count / Math.max(channel.video_count, 1);

    const topVideosFormatted = topVideos
      .map((v, i) => 
        `${i + 1}. "${v.title}" - ${v.view_count.toLocaleString()} views, ${v.like_count.toLocaleString()} likes`
      )
      .join('\n');

    const recentVideosFormatted = recentVideos
      .map((v, i) => 
        `${i + 1}. "${v.title}" - ${v.view_count.toLocaleString()} views, ${v.like_count.toLocaleString()} likes`
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

<example>
For a gaming channel with 50K subscribers, high engagement on tutorial videos, and declining views on gameplay content:
{
  "channel_summary": "Gaming channel focused on tutorials and guides with strong educational content. Recent shift toward gameplay content showing weaker performance compared to tutorial videos.",
  "content_strengths": ["Tutorial videos consistently outperform with 2x average views", "High engagement rates indicate loyal audience", "Clear niche in educational gaming content"],
  "weaknesses": ["Gameplay videos underperforming by 60% vs channel average", "Inconsistent content strategy mixing high and low performers"],
  "growth_suggestions": ["Double down on tutorial format which drives 2x engagement", "Create tutorial series to encourage binge-watching", "Add timestamps in tutorial videos for better retention"],
  "editing_style_recommendations": ["Use chapter markers for tutorial segments", "Add on-screen text callouts for key tips", "Implement before/after comparison graphics"],
  "audience_insights": ["Audience values learning over entertainment", "Strong preference for structured educational content"]
}
</example>

Based on the channel data provided above, generate your analysis:`;
  }

  /**
   * Call Gemini API with proper system instruction
   */
  private async callGemini(prompt: string): Promise<string> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: 1.0,
          maxOutputTokens: 2000,
          systemInstruction: `<role>
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
        }
      });

      return response.text || '';
    } catch (error) {
      console.error('Gemini API call failed:', error);
      throw error;
    }
  }

  /**
   * Parse structured JSON response from Gemini
   */
  private parseStructuredResponse(response: string): AnalysisResult | null {
    try {
      // Remove markdown code blocks if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      // Validate structure
      if (!parsed.channel_summary || 
          !Array.isArray(parsed.content_strengths) ||
          !Array.isArray(parsed.weaknesses) ||
          !Array.isArray(parsed.growth_suggestions) ||
          !Array.isArray(parsed.editing_style_recommendations) ||
          !Array.isArray(parsed.audience_insights)) {
        throw new Error('Invalid response structure');
      }

      return {
        channel_summary: parsed.channel_summary,
        content_strengths: parsed.content_strengths,
        weaknesses: parsed.weaknesses,
        growth_suggestions: parsed.growth_suggestions,
        editing_style_recommendations: parsed.editing_style_recommendations,
        audience_insights: parsed.audience_insights
      };
    } catch (error) {
      console.error('Failed to parse Gemini response:', error);
      console.error('Raw response:', response);
      return null;
    }
  }
}
