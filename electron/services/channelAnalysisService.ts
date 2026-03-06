/**
 * Channel Analysis Orchestration Service
 * Coordinates YouTube data fetching, AI analysis (Bedrock), and caching
 */

import { YouTubeService } from './youtubeService.js';
import { AIAnalysisService, AnalysisResult } from './aiAnalysisService.js';
import { analysisCacheService } from './cacheService.js';

export interface AnalysisResponse {
  success: boolean;
  data?: {
    channel: {
      id: string;
      title: string;
      description: string;
      subscriber_count: number;
      video_count: number;
      view_count: number;
      thumbnail_url?: string;
      published_at: string;
    };
    analysis: AnalysisResult;
    meta: {
      analyzed_at: string;
      videos_analyzed: number;
      freshness: string;
      cache_hit: boolean;
    };
  };
  error?: string;
  error_code?: string;
}

type AnalysisPayload = NonNullable<AnalysisResponse['data']>;

function isAnalysisPayload(value: unknown): value is AnalysisPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const typed = value as { channel?: unknown; analysis?: unknown; meta?: unknown };
  return (
    typeof typed.channel === 'object' &&
    typed.channel !== null &&
    typeof typed.analysis === 'object' &&
    typed.analysis !== null &&
    typeof typed.meta === 'object' &&
    typed.meta !== null
  );
}

export class ChannelAnalysisService {
  private youtubeService: YouTubeService;
  private aiService: AIAnalysisService;

  constructor(
    youtubeApiKey: string,
    awsRegion: string = 'us-east-1',
    awsAccessKeyId: string = '',
    awsSecretAccessKey: string = '',
    bedrockModelId?: string,
    awsSessionToken?: string,
  ) {
    this.youtubeService = new YouTubeService(youtubeApiKey);
    this.aiService = new AIAnalysisService(
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      bedrockModelId,
      awsSessionToken,
    );
  }

  /**
   * Analyze a YouTube channel from URL
   * Uses cache to prevent redundant API calls
   */
  async analyzeChannel(channelUrl: string): Promise<AnalysisResponse> {
    try {
      // Step 1: Extract channel ID
      console.log('[Analysis] Extracting channel ID from URL...');
      const channelId = await this.youtubeService.extractChannelId(channelUrl);

      if (!channelId) {
        return {
          success: false,
          error: 'Invalid YouTube channel URL',
          error_code: 'INVALID_URL',
        };
      }

      console.log(`[Analysis] Channel ID: ${channelId}`);

      // Step 2: Check cache first
      const cachedAnalysis = analysisCacheService.getChannelAnalysis(channelId);
      if (isAnalysisPayload(cachedAnalysis)) {
        console.log('[Analysis] Cache hit! Returning cached analysis');
        return {
          success: true,
          data: {
            ...cachedAnalysis,
            meta: {
              ...cachedAnalysis.meta,
              cache_hit: true,
            },
          },
        };
      }

      // Step 3: Fetch channel metadata
      console.log('[Analysis] Fetching channel metadata...');
      const channelMetadata = await this.youtubeService.getChannelMetadata(channelId);

      if (!channelMetadata) {
        return {
          success: false,
          error: 'Channel not found or API error',
          error_code: 'CHANNEL_NOT_FOUND',
        };
      }

      console.log(`[Analysis] Channel: ${channelMetadata.title}`);

      // Step 4: Fetch video list
      console.log('[Analysis] Fetching videos from uploads playlist...');
      const videoIds = await this.youtubeService.getVideoIds(
        channelMetadata.upload_playlist_id,
        50,
      );

      if (videoIds.length === 0) {
        return {
          success: false,
          error: 'No videos found on channel',
          error_code: 'NO_VIDEOS',
        };
      }

      console.log(`[Analysis] Found ${videoIds.length} videos`);

      // Step 5: Get detailed video data
      console.log('[Analysis] Fetching detailed video data...');
      const allVideos = await this.youtubeService.getVideoDetails(videoIds);

      if (allVideos.length === 0) {
        return {
          success: false,
          error: 'Failed to fetch video details',
          error_code: 'VIDEO_FETCH_ERROR',
        };
      }

      // Step 6: Sort and select top 5 by views + latest 5
      const topVideos = this.youtubeService.getTopVideos(allVideos, 5);
      const recentVideos = this.youtubeService.getRecentVideos(allVideos, 5);

      console.log(
        `[Analysis] Top videos: ${topVideos.length}, Recent videos: ${recentVideos.length}`,
      );

      // Step 7: Call AI for analysis
      console.log('[Analysis] Calling AI for analysis...');
      const analysisResult = await this.aiService.analyzeChannel(
        channelMetadata,
        topVideos,
        recentVideos,
      );

      if (!analysisResult) {
        return {
          success: false,
          error: 'AI analysis failed',
          error_code: 'ANALYSIS_FAILED',
        };
      }

      console.log('[Analysis] AI analysis completed successfully');

      // Step 8: Build response
      const response: AnalysisResponse = {
        success: true,
        data: {
          channel: {
            id: channelMetadata.channel_id,
            title: channelMetadata.title,
            description: channelMetadata.description.substring(0, 500),
            subscriber_count: channelMetadata.subscriber_count,
            video_count: channelMetadata.video_count,
            view_count: channelMetadata.view_count,
            thumbnail_url: channelMetadata.thumbnail_url,
            published_at: channelMetadata.published_at,
          },
          analysis: analysisResult,
          meta: {
            analyzed_at: new Date().toISOString(),
            videos_analyzed: topVideos.length + recentVideos.length,
            freshness: 'fresh',
            cache_hit: false,
          },
        },
      };

      // Step 9: Cache the result
      console.log('[Analysis] Caching analysis result...');
      analysisCacheService.setChannelAnalysis(channelId, response.data);

      return response;
    } catch (error) {
      console.error('[Analysis] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        error_code: 'INTERNAL_ERROR',
      };
    }
  }

  /**
   * Link analysis to a user
   */
  async linkAnalysisToUser(userId: string, channelUrl: string): Promise<boolean> {
    try {
      const channelId = await this.youtubeService.extractChannelId(channelUrl);
      if (!channelId) {
        return false;
      }

      return analysisCacheService.linkUserToChannel(userId, channelId);
    } catch (error) {
      console.error('Error linking analysis to user:', error);
      return false;
    }
  }

  /**
   * Get analysis for a user
   */
  getUserAnalysis(userId: string): unknown | null {
    return analysisCacheService.getUserAnalysis(userId);
  }
}
