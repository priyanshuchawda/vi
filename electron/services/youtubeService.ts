/**
 * YouTube Data API v3 Client
 * Fetches channel and video data for analysis
 */

interface ChannelMetadata {
  channel_id: string;
  title: string;
  description: string;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  thumbnail_url?: string;
  published_at: string;
  country?: string;
  upload_playlist_id: string;
}

interface VideoData {
  video_id: string;
  title: string;
  description: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string;
  duration: string;
  tags: string[];
  thumbnail_url: string;
}

export class YouTubeService {
  private apiKey: string;
  private baseUrl = 'https://www.googleapis.com/youtube/v3';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Extract channel ID from various YouTube URL formats
   */
  async extractChannelId(url: string): Promise<string | null> {
    // Direct channel ID format
    const channelIdMatch = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
    if (channelIdMatch) {
      return channelIdMatch[1];
    }

    // Handle @username format
    const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
    if (handleMatch) {
      const handle = handleMatch[1];
      return this.resolveHandleToChannelId(handle);
    }

    // Handle /c/ format
    const customMatch = url.match(/youtube\.com\/c\/([a-zA-Z0-9_-]+)/);
    if (customMatch) {
      const customName = customMatch[1];
      return this.resolveCustomUrlToChannelId(customName);
    }

    // Handle /user/ format
    const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_-]+)/);
    if (userMatch) {
      const username = userMatch[1];
      return this.resolveUsernameToChannelId(username);
    }

    return null;
  }

  /**
   * Resolve @handle to channel ID using search API
   */
  private async resolveHandleToChannelId(handle: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/search?part=snippet&q=@${handle}&type=channel&maxResults=1&key=${this.apiKey}`,
      );
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        return data.items[0].snippet.channelId;
      }
      return null;
    } catch (error) {
      console.error('Error resolving handle:', error);
      return null;
    }
  }

  /**
   * Resolve custom URL to channel ID
   */
  private async resolveCustomUrlToChannelId(customName: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/search?part=snippet&q=${customName}&type=channel&maxResults=1&key=${this.apiKey}`,
      );
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        return data.items[0].snippet.channelId;
      }
      return null;
    } catch (error) {
      console.error('Error resolving custom URL:', error);
      return null;
    }
  }

  /**
   * Resolve username to channel ID
   */
  private async resolveUsernameToChannelId(username: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/channels?part=id&forUsername=${username}&key=${this.apiKey}`,
      );
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        return data.items[0].id;
      }
      return null;
    } catch (error) {
      console.error('Error resolving username:', error);
      return null;
    }
  }

  /**
   * Get channel metadata
   */
  async getChannelMetadata(channelId: string): Promise<ChannelMetadata | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${this.apiKey}`,
      );
      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        return null;
      }

      const channel = data.items[0];
      const snippet = channel.snippet || {};
      const statistics = channel.statistics || {};
      const contentDetails = channel.contentDetails || {};

      return {
        channel_id: channelId,
        title: snippet.title || '',
        description: snippet.description || '',
        subscriber_count: parseInt(statistics.subscriberCount || '0'),
        video_count: parseInt(statistics.videoCount || '0'),
        view_count: parseInt(statistics.viewCount || '0'),
        thumbnail_url: snippet.thumbnails?.high?.url,
        published_at: snippet.publishedAt || '',
        country: snippet.country,
        upload_playlist_id: contentDetails.relatedPlaylists?.uploads || '',
      };
    } catch (error) {
      console.error('Error fetching channel metadata:', error);
      return null;
    }
  }

  /**
   * Get video IDs from uploads playlist
   */
  async getVideoIds(playlistId: string, maxResults: number = 50): Promise<string[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${this.apiKey}`,
      );
      const data = await response.json();

      if (!data.items) {
        return [];
      }

      return data.items.map((item: any) => item.contentDetails.videoId);
    } catch (error) {
      console.error('Error fetching video IDs:', error);
      return [];
    }
  }

  /**
   * Get detailed video data
   */
  async getVideoDetails(videoIds: string[]): Promise<VideoData[]> {
    try {
      // YouTube API allows max 50 IDs per request
      const chunks = [];
      for (let i = 0; i < videoIds.length; i += 50) {
        chunks.push(videoIds.slice(i, i + 50));
      }

      const allVideos: VideoData[] = [];

      for (const chunk of chunks) {
        const response = await fetch(
          `${this.baseUrl}/videos?part=snippet,statistics,contentDetails&id=${chunk.join(',')}&key=${this.apiKey}`,
        );
        const data = await response.json();

        if (data.items) {
          const videos = data.items.map((video: any) => ({
            video_id: video.id,
            title: video.snippet?.title || '',
            description: video.snippet?.description || '',
            view_count: parseInt(video.statistics?.viewCount || '0'),
            like_count: parseInt(video.statistics?.likeCount || '0'),
            comment_count: parseInt(video.statistics?.commentCount || '0'),
            published_at: video.snippet?.publishedAt || '',
            duration: video.contentDetails?.duration || '',
            tags: video.snippet?.tags || [],
            thumbnail_url: video.snippet?.thumbnails?.high?.url || '',
          }));

          allVideos.push(...videos);
        }
      }

      return allVideos;
    } catch (error) {
      console.error('Error fetching video details:', error);
      return [];
    }
  }

  /**
   * Get top performing videos by views
   */
  getTopVideos(videos: VideoData[], limit: number = 5): VideoData[] {
    return [...videos].sort((a, b) => b.view_count - a.view_count).slice(0, limit);
  }

  /**
   * Get most recent videos
   */
  getRecentVideos(videos: VideoData[], limit: number = 5): VideoData[] {
    return [...videos]
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .slice(0, limit);
  }
}
