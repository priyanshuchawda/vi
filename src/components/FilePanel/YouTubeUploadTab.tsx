import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import type {
  YouTubeVideoMetadata,
  YouTubeUploadProgress,
  YouTubeVideo,
} from '../../types/electron';
import {
  isYouTubeAvailable,
  useYouTubeAuthStatus,
  useYouTubeAuthenticate,
  useYouTubeLogout,
  useYouTubeUpload,
} from '../../lib/youtubeQueries';
import clsx from 'clsx';

const YouTubeUploadTab = () => {
  const clips = useProjectStore((state) => state.clips);
  const [uploadProgress, setUploadProgress] = useState<YouTubeUploadProgress | null>(null);
  const [recentVideos, setRecentVideos] = useState<YouTubeVideo[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const youtubeAvailable = isYouTubeAvailable();
  const authStatusQuery = useYouTubeAuthStatus();
  const authenticateMutation = useYouTubeAuthenticate();
  const logoutMutation = useYouTubeLogout();
  const uploadMutation = useYouTubeUpload();
  const isAuthenticated = authStatusQuery.data ?? false;
  const isAuthenticating = authenticateMutation.isPending;
  const isUploading = uploadMutation.isPending;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'public' | 'private' | 'unlisted'>('private');
  const [madeForKids, setMadeForKids] = useState(false);
  const [exportedVideoPath, setExportedVideoPath] = useState<string>('');

  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Unknown error';
  };

  const loadRecentVideos = useCallback(async () => {
    if (!youtubeAvailable) return;

    setLoadingVideos(true);
    try {
      // Current preload API does not expose list-videos yet.
      setRecentVideos([]);
    } catch (error) {
      console.error('Error loading recent videos:', error);
    } finally {
      setLoadingVideos(false);
    }
  }, [youtubeAvailable]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadRecentVideos();
    }
  }, [isAuthenticated, loadRecentVideos]);

  const handleLogin = async () => {
    if (!youtubeAvailable) {
      alert('Electron API not available');
      return;
    }

    try {
      const success = await authenticateMutation.mutateAsync();
      if (success) {
        await authStatusQuery.refetch();
      } else {
        alert('Authentication failed');
      }
    } catch (error: unknown) {
      alert(`Error: ${getErrorMessage(error)}`);
    }
  };

  const handleLogout = async () => {
    if (!youtubeAvailable) return;

    try {
      const success = await logoutMutation.mutateAsync();
      if (success) {
        await authStatusQuery.refetch();
        setRecentVideos([]);
      }
    } catch (error: unknown) {
      alert(`Logout failed: ${getErrorMessage(error)}`);
    }
  };

  const handleUpload = async () => {
    if (!youtubeAvailable) {
      alert('Electron API not available');
      return;
    }

    if (clips.length === 0) {
      alert('No clips to export. Please add some media to your timeline first.');
      return;
    }

    if (!title.trim()) {
      alert('Please enter a title for your video');
      return;
    }

    try {
      let videoPath = exportedVideoPath;

      // If video not exported yet, export it first
      if (!videoPath) {
        const outputPath = await window.electronAPI.saveFile('mp4');
        if (!outputPath) return;

        setUploadProgress({
          bytesUploaded: 0,
          totalBytes: 0,
          percentage: 0,
          status: 'uploading',
        });

        // Export the video
        await window.electronAPI.exportVideo(clips, outputPath, 'mp4', undefined, [], {});
        videoPath = outputPath;
        setExportedVideoPath(outputPath);
      } else {
        setUploadProgress(null);
      }

      const metadata: YouTubeVideoMetadata = {
        title: title.trim(),
        description: description.trim(),
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        privacyStatus,
        madeForKids,
      };

      const result = await uploadMutation.mutateAsync({
        filePath: videoPath,
        metadata,
        onProgress: (progress: YouTubeUploadProgress) => {
          setUploadProgress(progress);
        },
      });
      if (result.success) {
        // Show success message with video link
        const videoUrl = `https://www.youtube.com/watch?v=${result.videoId}`;
        const openVideo = confirm(
          `✅ Upload Successful!\n\nYour video has been uploaded to YouTube.\n\nVideo ID: ${result.videoId}\n\nClick OK to open it in your browser, or Cancel to continue editing.`,
        );

        if (openVideo) {
          window.open(videoUrl, '_blank');
        }

        // Reset form
        setTitle('');
        setDescription('');
        setTags('');
        setExportedVideoPath('');
      } else {
        alert(`❌ Upload Failed\n\n${result.error}`);
      }
    } catch (error: unknown) {
      alert(`❌ Upload Error\n\n${getErrorMessage(error)}`);
    }
  };

  // Not authenticated view
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <svg className="w-16 h-16 mb-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
        <h2 className="text-xl font-bold mb-2 text-text-primary">Upload to YouTube</h2>
        <p className="text-text-muted mb-6 max-w-md">
          Connect your YouTube account to upload videos directly from QuickCut.
        </p>
        <button
          onClick={handleLogin}
          disabled={isAuthenticating}
          className={clsx(
            'px-6 py-3 bg-red-600 text-white rounded-lg font-medium',
            'hover:bg-red-700 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isAuthenticating ? 'Connecting...' : 'Connect YouTube Account'}
        </button>
      </div>
    );
  }

  // Authenticated view
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border-primary bg-bg-elevated">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-red-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
            <div>
              <h2 className="text-sm font-bold text-text-primary">YouTube Upload</h2>
              <p className="text-xs text-text-muted">Connected</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Upload Form */}
        <section>
          <h3 className="text-sm font-bold text-text-primary mb-3">Video Details</h3>
          <div className="space-y-3">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter video title"
                maxLength={100}
                className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
              <p className="text-xs text-text-muted mt-1">{title.length}/100 characters</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter video description"
                maxLength={5000}
                rows={4}
                className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none"
              />
              <p className="text-xs text-text-muted mt-1">{description.length}/5000 characters</p>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                Tags (comma separated)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tag1, tag2, tag3"
                className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
            </div>

            {/* Privacy Status */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Privacy</label>
              <select
                value={privacyStatus}
                onChange={(e) =>
                  setPrivacyStatus(e.target.value as 'public' | 'private' | 'unlisted')
                }
                className="w-full px-3 py-2 bg-bg-primary border border-border-primary rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </div>

            {/* Made for Kids */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="madeForKids"
                checked={madeForKids}
                onChange={(e) => setMadeForKids(e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              <label htmlFor="madeForKids" className="text-xs text-text-muted cursor-pointer">
                Made for kids
              </label>
            </div>
          </div>
        </section>

        {/* Upload Button */}
        <section>
          <h3 className="text-sm font-bold text-text-primary mb-3">Upload to YouTube</h3>
          {clips.length === 0 && (
            <p className="text-xs text-yellow-500 mb-2">
              ⚠️ Add media to your timeline first (MEDIA tab)
            </p>
          )}
          <button
            onClick={handleUpload}
            disabled={isUploading || clips.length === 0 || !title.trim()}
            className={clsx(
              'w-full px-4 py-3 bg-red-600 text-white rounded-lg font-medium',
              'hover:bg-red-700 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isUploading ? 'Uploading...' : 'Upload to YouTube'}
          </button>
          {!isUploading && clips.length > 0 && !title.trim() && (
            <p className="text-xs text-text-muted mt-2">Enter a title to enable upload</p>
          )}

          {/* Upload Progress */}
          {uploadProgress && (
            <div className="mt-4 p-4 bg-bg-elevated rounded-lg border-2 border-accent shadow-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {uploadProgress.status === 'completed' && <span className="text-2xl">✅</span>}
                  {uploadProgress.status === 'failed' && <span className="text-2xl">❌</span>}
                  {uploadProgress.status === 'uploading' && (
                    <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  )}
                  <span className="text-sm font-bold text-text-primary">
                    {uploadProgress.status === 'uploading' && 'Uploading to YouTube...'}
                    {uploadProgress.status === 'processing' && 'Processing...'}
                    {uploadProgress.status === 'completed' && 'Upload Complete!'}
                    {uploadProgress.status === 'failed' && 'Upload Failed'}
                  </span>
                </div>
                <span className="text-lg font-bold text-accent">{uploadProgress.percentage}%</span>
              </div>
              <div className="w-full h-3 bg-bg-primary rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full transition-all duration-500',
                    uploadProgress.status === 'completed'
                      ? 'bg-green-500'
                      : uploadProgress.status === 'failed'
                        ? 'bg-red-500'
                        : 'bg-accent',
                  )}
                  style={{ width: `${uploadProgress.percentage}%` }}
                />
              </div>
              {uploadProgress.bytesUploaded > 0 && (
                <p className="mt-2 text-xs text-text-muted">
                  {(uploadProgress.bytesUploaded / 1024 / 1024).toFixed(1)} MB /{' '}
                  {(uploadProgress.totalBytes / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
              {uploadProgress.error && (
                <p className="mt-3 text-sm text-red-500 font-medium">{uploadProgress.error}</p>
              )}
              {uploadProgress.videoId && (
                <a
                  href={`https://www.youtube.com/watch?v=${uploadProgress.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                  Watch on YouTube
                </a>
              )}
            </div>
          )}
        </section>

        {/* Recent Videos */}
        {recentVideos.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text-primary">Recent Uploads</h3>
              <button
                onClick={loadRecentVideos}
                disabled={loadingVideos}
                className="text-xs text-accent hover:underline"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2">
              {recentVideos.map((video) => (
                <a
                  key={video.id}
                  href={`https://www.youtube.com/watch?v=${video.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 bg-bg-elevated rounded-lg border border-border-primary hover:border-accent transition-colors"
                >
                  <div className="flex gap-3">
                    <img
                      src={video.snippet.thumbnails.default.url}
                      alt={video.snippet.title}
                      className="w-20 h-14 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium text-text-primary truncate">
                        {video.snippet.title}
                      </h4>
                      <p className="text-xs text-text-muted mt-1">{video.status.privacyStatus}</p>
                      {video.statistics && (
                        <p className="text-xs text-text-muted mt-1">
                          {parseInt(video.statistics.viewCount).toLocaleString()} views
                        </p>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default YouTubeUploadTab;
