/**
 * YouTube Upload Service
 * Handles video uploads to YouTube with metadata and progress tracking
 */

import { google, youtube_v3 } from 'googleapis';
import * as fs from 'fs';
import { getAuthenticatedClient, refreshTokenIfNeeded } from './youtubeAuthService.js';

export interface VideoMetadata {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus: 'public' | 'private' | 'unlisted';
  madeForKids?: boolean;
}

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  videoId?: string;
  error?: string;
}

/**
 * Upload video to YouTube
 */
export async function uploadVideo(
  filePath: string,
  metadata: VideoMetadata,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  try {
    // Ensure token is valid
    await refreshTokenIfNeeded();

    const auth = getAuthenticatedClient();
    if (!auth) {
      throw new Error('Not authenticated. Please login first.');
    }

    // Create YouTube API client
    const youtube = google.youtube({
      version: 'v3',
      auth,
    });

    // Get file stats
    const fileStats = fs.statSync(filePath);
    const totalBytes = fileStats.size;

    // Prepare video metadata
    const videoResource: youtube_v3.Schema$Video = {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags || [],
        categoryId: metadata.categoryId || '22', // 22 = People & Blogs
      },
      status: {
        privacyStatus: metadata.privacyStatus,
        selfDeclaredMadeForKids: metadata.madeForKids || false,
      },
    };

    console.log('Starting YouTube upload:', metadata.title);

    // Upload video with progress tracking
    const response = await youtube.videos.insert(
      {
        part: ['snippet', 'status'],
        requestBody: videoResource,
        media: {
          body: fs.createReadStream(filePath),
        },
      },
      {
        onUploadProgress: (evt: { bytesRead: number }) => {
          const bytesUploaded = evt.bytesRead;
          const percentage = Math.round((bytesUploaded / totalBytes) * 100);

          if (onProgress) {
            onProgress({
              bytesUploaded,
              totalBytes,
              percentage,
              status: 'uploading',
            });
          }

          console.log(`Upload progress: ${percentage}%`);
        },
      }
    );

    const videoId = response.data.id;
    if (!videoId) {
      throw new Error('Upload failed: No video ID returned');
    }

    console.log('Upload successful! Video ID:', videoId);

    // Notify completion
    if (onProgress) {
      onProgress({
        bytesUploaded: totalBytes,
        totalBytes,
        percentage: 100,
        status: 'completed',
        videoId,
      });
    }

    return videoId;
  } catch (error: any) {
    console.error('Error uploading video:', error);

    if (onProgress) {
      onProgress({
        bytesUploaded: 0,
        totalBytes: 0,
        percentage: 0,
        status: 'failed',
        error: error.message || 'Upload failed',
      });
    }

    throw error;
  }
}

/**
 * Get video categories for a specific region
 */
export async function getVideoCategories(regionCode: string = 'US'): Promise<any[]> {
  try {
    await refreshTokenIfNeeded();

    const auth = getAuthenticatedClient();
    if (!auth) {
      throw new Error('Not authenticated');
    }

    const youtube = google.youtube({
      version: 'v3',
      auth,
    });

    const response = await youtube.videoCategories.list({
      part: ['snippet'],
      regionCode,
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Error fetching video categories:', error);
    return [];
  }
}

/**
 * Delete video from YouTube
 */
export async function deleteVideo(videoId: string): Promise<boolean> {
  try {
    await refreshTokenIfNeeded();

    const auth = getAuthenticatedClient();
    if (!auth) {
      throw new Error('Not authenticated');
    }

    const youtube = google.youtube({
      version: 'v3',
      auth,
    });

    await youtube.videos.delete({
      id: videoId,
    });

    console.log('Video deleted:', videoId);
    return true;
  } catch (error) {
    console.error('Error deleting video:', error);
    return false;
  }
}

/**
 * Get video info by ID
 */
export async function getVideoInfo(videoId: string): Promise<youtube_v3.Schema$Video | null> {
  try {
    await refreshTokenIfNeeded();

    const auth = getAuthenticatedClient();
    if (!auth) {
      throw new Error('Not authenticated');
    }

    const youtube = google.youtube({
      version: 'v3',
      auth,
    });

    const response = await youtube.videos.list({
      part: ['snippet', 'status', 'statistics'],
      id: [videoId],
    });

    return response.data.items?.[0] || null;
  } catch (error) {
    console.error('Error fetching video info:', error);
    return null;
  }
}

/**
 * Get user's uploaded videos
 */
export async function getUserVideos(maxResults: number = 10): Promise<youtube_v3.Schema$Video[]> {
  try {
    await refreshTokenIfNeeded();

    const auth = getAuthenticatedClient();
    if (!auth) {
      throw new Error('Not authenticated');
    }

    const youtube = google.youtube({
      version: 'v3',
      auth,
    });

    // First, get the user's channel ID
    const channelResponse = await youtube.channels.list({
      part: ['contentDetails'],
      mine: true,
    });

    const uploadsPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return [];
    }

    // Get videos from uploads playlist
    const playlistResponse = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId: uploadsPlaylistId,
      maxResults,
    });

    const videoIds = playlistResponse.data.items
      ?.map((item: youtube_v3.Schema$PlaylistItem) => item.snippet?.resourceId?.videoId)
      .filter(Boolean) as string[];

    if (videoIds.length === 0) {
      return [];
    }

    // Get full video details
    const videosResponse = await youtube.videos.list({
      part: ['snippet', 'status', 'statistics'],
      id: videoIds,
    });

    return videosResponse.data.items || [];
  } catch (error) {
    console.error('Error fetching user videos:', error);
    return [];
  }
}
