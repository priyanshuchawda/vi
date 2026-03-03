import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  videoId?: string;
  error?: string;
}

const PublishPanel = () => {
  const exportedVideoPath = useProjectStore((state) => state.exportedVideoPath);
  const setNotification = useProjectStore((state) => state.setNotification);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isElectronAvailable, setIsElectronAvailable] = useState(false);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'public' | 'private' | 'unlisted'>('unlisted');
  const [categoryId, setCategoryId] = useState('22'); // Default: People & Blogs
  const [madeForKids, setMadeForKids] = useState(false);

  const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Unknown error';
  };

  const checkAuthStatus = useCallback(async () => {
    if (!window.electronAPI?.youtube) return;
    
    try {
      const authenticated = await window.electronAPI.youtube.isAuthenticated();
      setIsAuthenticated(authenticated);
    } catch (error: unknown) {
      setNotification({ 
        type: 'error', 
        message: `Auth check failed: ${getErrorMessage(error)}` 
      });
      setIsAuthenticated(false);
    }
  }, [setNotification]);

  // Check Electron API and authentication status on mount
  useEffect(() => {
    const checkElectronAndAuth = async () => {
      const available = !!(window.electronAPI?.youtube);
      setIsElectronAvailable(available);
      if (available) {
        await checkAuthStatus();
      }
    };
    checkElectronAndAuth();
  }, [checkAuthStatus]);

  const handleAuthenticate = async () => {
    if (!window.electronAPI?.youtube) {
      setNotification({ type: 'error', message: 'YouTube upload is not available' });
      return;
    }

    setIsAuthenticating(true);
    try {
      const success = await window.electronAPI.youtube.authenticate();
      setIsAuthenticated(success);
      if (success) {
        setNotification({ type: 'success', message: 'Successfully authenticated with YouTube!' });
      } else {
        setNotification({ type: 'warning', message: 'Authentication was cancelled' });
      }
    } catch (error: unknown) {
      setNotification({ 
        type: 'error', 
        message: `Authentication failed: ${getErrorMessage(error)}` 
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    if (!window.electronAPI?.youtube) return;

    try {
      await window.electronAPI.youtube.logout();
      setIsAuthenticated(false);
      setNotification({ type: 'success', message: 'Logged out successfully' });
    } catch (error: unknown) {
      setNotification({ 
        type: 'error', 
        message: `Logout failed: ${getErrorMessage(error)}` 
      });
    }
  };

  const handleUpload = async () => {
    if (!exportedVideoPath) {
      setNotification({ type: 'warning', message: 'Please export your video first' });
      return;
    }

    if (!title.trim()) {
      setNotification({ type: 'warning', message: 'Please enter a video title' });
      return;
    }

    if (!window.electronAPI?.youtube) {
      setNotification({ type: 'error', message: 'YouTube upload is not available' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(null);
    setVideoUrl('');

    const metadata = {
      title: title.trim(),
      description: description.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(t => t),
      categoryId,
      privacyStatus,
      madeForKids,
    };

    try {
      const result = await window.electronAPI.youtube.uploadVideo(
        exportedVideoPath,
        metadata,
        (progress: UploadProgress) => {
          setUploadProgress(progress);
        }
      );

      if (result.videoId) {
        const url = `https://www.youtube.com/watch?v=${result.videoId}`;
        setVideoUrl(url);
        setNotification({ type: 'success', message: 'Video uploaded successfully!' });
      } else {
        setNotification({ type: 'error', message: 'Upload failed: No video ID returned' });
      }
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      setNotification({ 
        type: 'error', 
        message: `Upload failed: ${errorMessage}` 
      });
      setUploadProgress({
        bytesUploaded: 0,
        totalBytes: 0,
        percentage: 0,
        status: 'failed',
        error: errorMessage,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Show not available message if not in Electron
  if (!isElectronAvailable) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="flex flex-col items-center text-center space-y-4 max-w-xs">
            <div className="p-4 bg-gradient-to-br from-accent/10 to-accent/5 rounded-2xl">
              <svg className="w-12 h-12 text-accent/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-text-primary">YouTube Upload Unavailable</h3>
              <p className="text-xs text-text-muted leading-relaxed">This feature is only available in the desktop app</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
        <div className="space-y-4 pb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-1 bg-gradient-to-b from-accent to-accent/50 rounded-full"></div>
            <h3 className="text-sm font-semibold text-text-primary">YouTube Upload</h3>
          </div>
          
          {/* Authentication Section */}
          <div className="bg-gradient-to-br from-bg-secondary to-bg-elevated rounded-xl p-4 space-y-3 border border-white/5 shadow-lg transition-all duration-300 hover:border-white/10">
            <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              <span className="text-sm text-text-primary font-medium">
                {isAuthenticated ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            {isAuthenticated ? (
              <button
                onClick={handleLogout}
                className="px-4 py-1.5 text-xs bg-bg-primary text-text-primary rounded-lg hover:bg-bg-elevated transition-all duration-200 hover:scale-105 active:scale-95 border border-white/5"
              >
                Logout
              </button>
            ) : (
              <button
                onClick={handleAuthenticate}
                disabled={isAuthenticating}
                className="px-4 py-1.5 text-xs bg-gradient-to-r from-accent to-accent-hover text-white rounded-lg hover:shadow-lg hover:shadow-accent/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 font-medium"
              >
                {isAuthenticating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Authenticating...
                  </span>
                ) : 'Connect YouTube'}
              </button>
            )}
          </div>
            
            {!isAuthenticated && (
              <p className="text-xs text-text-muted leading-relaxed">
                Connect your YouTube account to upload videos directly from QuickCut
              </p>
            )}
          </div>

          {/* Upload Form */}
          {isAuthenticated && (
            <>
              {/* Video Path */}
              <div className="bg-gradient-to-br from-bg-secondary to-bg-elevated rounded-xl p-4 space-y-2 border border-white/5 shadow-lg">
                <label className="text-xs font-semibold text-text-primary">Video File</label>
                <div className="text-xs text-text-secondary break-all font-mono bg-bg-primary/50 p-2 rounded-lg">
                  {exportedVideoPath || 'No video exported yet'}
                </div>
                {!exportedVideoPath && (
                  <div className="flex items-center gap-2 p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                    <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-xs text-yellow-500">
                      Export your video first from the Export tab
                    </p>
                  </div>
                )}
              </div>

              {/* Title */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-primary flex items-center gap-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter video title"
                  maxLength={100}
                  className="w-full px-4 py-2.5 bg-bg-secondary text-text-primary text-sm rounded-xl border border-white/5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200 placeholder:text-text-muted/50"
                />
                <p className="text-xs text-text-muted flex justify-between items-center">
                  <span className="opacity-0">.</span>
                  <span className={title.length >= 90 ? 'text-yellow-500' : ''}>{title.length}/100</span>
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-primary">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter video description"
                  rows={4}
                  maxLength={5000}
                  className="w-full px-4 py-2.5 bg-bg-secondary text-text-primary text-sm rounded-xl border border-white/5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200 resize-none custom-scrollbar placeholder:text-text-muted/50"
                />
                <p className="text-xs text-text-muted flex justify-between items-center">
                  <span className="opacity-0">.</span>
                  <span>{description.length}/5000</span>
                </p>
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-primary">Tags</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="tag1, tag2, tag3"
                  className="w-full px-4 py-2.5 bg-bg-secondary text-text-primary text-sm rounded-xl border border-white/5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200 placeholder:text-text-muted/50"
                />
                <p className="text-xs text-text-muted">Separate tags with commas</p>
              </div>

              {/* Privacy Status */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-primary">Privacy</label>
                <select
                  value={privacyStatus}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'public' || value === 'private' || value === 'unlisted') {
                      setPrivacyStatus(value);
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-bg-secondary text-text-primary text-sm rounded-xl border border-white/5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200 cursor-pointer"
                >
                  <option value="private">🔒 Private</option>
                  <option value="unlisted">🔗 Unlisted</option>
                  <option value="public">🌍 Public</option>
                </select>
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-primary">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-bg-secondary text-text-primary text-sm rounded-xl border border-white/5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200 cursor-pointer"
                >
                <option value="1">Film & Animation</option>
                <option value="2">Autos & Vehicles</option>
                <option value="10">Music</option>
                <option value="15">Pets & Animals</option>
                <option value="17">Sports</option>
                <option value="19">Travel & Events</option>
                <option value="20">Gaming</option>
                <option value="22">People & Blogs</option>
                <option value="23">Comedy</option>
                <option value="24">Entertainment</option>
                <option value="25">News & Politics</option>
                <option value="26">Howto & Style</option>
                <option value="27">Education</option>
                <option value="28">Science & Technology</option>
              </select>
            </div>

              {/* Made for Kids */}
              <div className="flex items-center gap-3 p-3 bg-bg-secondary/50 rounded-xl border border-white/5">
                <input
                  type="checkbox"
                  id="madeForKids"
                  checked={madeForKids}
                  onChange={(e) => setMadeForKids(e.target.checked)}
                  className="w-4 h-4 bg-bg-primary border border-white/10 rounded cursor-pointer accent-accent"
                />
                <label htmlFor="madeForKids" className="text-xs text-text-primary cursor-pointer flex-1">
                  Made for kids
                </label>
              </div>

              {/* Upload Progress */}
              {uploadProgress && (
                <div className="bg-gradient-to-br from-bg-secondary to-bg-elevated rounded-xl p-4 space-y-3 border border-white/5 shadow-lg">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-primary font-semibold flex items-center gap-2">
                      {uploadProgress.status === 'uploading' && (
                        <>
                          <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Uploading...
                        </>
                      )}
                      {uploadProgress.status === 'processing' && 'Processing...'}
                      {uploadProgress.status === 'completed' && '✓ Completed!'}
                      {uploadProgress.status === 'failed' && '✗ Failed'}
                    </span>
                    <span className="text-text-primary font-mono font-semibold">
                      {uploadProgress.percentage}%
                    </span>
                  </div>
                  <div className="w-full bg-bg-primary rounded-full h-2.5 overflow-hidden shadow-inner">
                    <div
                      className={`h-full transition-all duration-300 ${
                        uploadProgress.status === 'failed'
                          ? 'bg-gradient-to-r from-red-500 to-red-600'
                          : uploadProgress.status === 'completed'
                          ? 'bg-gradient-to-r from-green-500 to-green-600'
                          : 'bg-gradient-to-r from-accent to-accent-hover'
                      }`}
                      style={{ width: `${uploadProgress.percentage}%` }}
                    />
                  </div>
                {uploadProgress.totalBytes > 0 && (
                  <p className="text-xs text-text-muted">
                    {formatBytes(uploadProgress.bytesUploaded)} / {formatBytes(uploadProgress.totalBytes)}
                  </p>
                )}
                  {uploadProgress.error && (
                    <div className="flex items-start gap-2 p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                      <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-red-400">{uploadProgress.error}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Video URL */}
              {videoUrl && (
                <div className="bg-gradient-to-br from-green-500/10 to-green-500/5 rounded-xl p-4 space-y-2 border border-green-500/20 shadow-lg">
                  <p className="text-xs font-semibold text-green-500 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Video Published!
                  </p>
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:text-accent-hover transition-colors break-all flex items-center gap-1 group"
                  >
                    <span>{videoUrl}</span>
                    <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={!exportedVideoPath || !title.trim() || isUploading}
                className="w-full px-6 py-3 bg-gradient-to-r from-accent to-accent-hover text-white rounded-xl hover:shadow-lg hover:shadow-accent/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-semibold hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {isUploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                    </svg>
                    Upload to YouTube
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PublishPanel;
