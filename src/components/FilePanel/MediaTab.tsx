import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useAiMemoryStore } from '../../stores/useAiMemoryStore';
import { queueMediaAnalysis } from '../../lib/aiMemoryService';
import { toMediaUrl } from '../../lib/mediaUrl';
import clsx from 'clsx';

const MediaTab = ({
  filterType: initialFilterType = 'all',
}: {
  filterType?: 'all' | 'video' | 'audio' | 'image' | 'text';
}) => {
  const { clips, mediaAssets, addClip, setActiveClip, activeClipId, defaultImageDuration } =
    useProjectStore();
  const { isAnalyzing, analyzingCount } = useAiMemoryStore();
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'image' | 'text'>(
    initialFilterType === 'all' ? 'all' : initialFilterType,
  );

  const handleImport = async () => {
    if (!window.electronAPI) {
      alert('Electron API not found!');
      return;
    }

    try {
      const filePaths = await window.electronAPI.openFile();

      if (filePaths && filePaths.length > 0) {
        setIsImporting(true);
        for (let i = 0; i < filePaths.length; i++) {
          const path = filePaths[i];
          const fileName = path.split('/').pop() || 'Unknown';
          setImportStatus(`Processing ${i + 1}/${filePaths.length}: ${fileName}`);

          const name = path.split('/').pop() || 'Unknown';
          let duration = 10; // Default
          let thumbnail = undefined;
          let waveform = undefined;
          let mediaType: 'video' | 'audio' | 'image' = 'video';

          // Detect media type from extension
          const ext = path.split('.').pop()?.toLowerCase() || '';
          const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'];
          const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

          if (audioExts.includes(ext)) {
            mediaType = 'audio';
          } else if (imageExts.includes(ext)) {
            mediaType = 'image';
          }

          try {
            const metadata = await window.electronAPI.getMetadata(path);
            if (metadata && metadata.duration) {
              const parsedDuration = parseFloat(String(metadata.duration));
              if (!isNaN(parsedDuration) && parsedDuration > 0) {
                duration = parsedDuration;
              }
            }
            if (metadata.isImage) {
              mediaType = 'image';
            } else if (metadata.hasVideo) {
              mediaType = 'video';
            } else if (metadata.hasAudio) {
              mediaType = 'audio';
            }
          } catch (error) {
            console.warn('Failed to get metadata for', path, error);
          }

          // For images, store directly without conversion
          if (mediaType === 'image') {
            thumbnail = toMediaUrl(path);
            // Use the user-configured default image duration
            const imageDuration = defaultImageDuration;
            addClip({
              path,
              name,
              duration: imageDuration,
              assetDuration: imageDuration,
              sourceDuration: 300,
              thumbnail,
              waveform: undefined,
              mediaType: 'image',
            });

            // Queue for background AI analysis
            // Get file size for proper API selection
            let fileSize = 0;
            try {
              if (window.electronAPI.getFileSize) {
                fileSize = await window.electronAPI.getFileSize(path);
              }
            } catch (error) {
              console.warn('Failed to get file size:', error);
            }

            queueMediaAnalysis({
              filePath: path,
              fileName: name,
              mediaType: 'image',
              mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
              fileSize,
              duration: imageDuration,
              thumbnailDataUrl: thumbnail,
            });

            continue;
          }

          // For video/audio, generate thumbnail
          setImportStatus(`Generating thumbnail ${i + 1}/${filePaths.length}: ${name}`);
          try {
            const thumb = await window.electronAPI.getThumbnail(path);
            if (thumb) {
              thumbnail = thumb;
            }
          } catch (error) {
            console.warn('Failed to get thumbnail for', path, error);
          }

          // Generate waveform for audio/video files
          setImportStatus(`Generating waveform ${i + 1}/${filePaths.length}: ${name}`);
          try {
            const wave = await window.electronAPI.getWaveform(path);
            if (wave) {
              waveform = wave;
            }
          } catch (error) {
            console.warn('Failed to get waveform for', path, error);
          }

          addClip({
            path,
            name,
            duration,
            assetDuration: duration,
            sourceDuration: duration,
            thumbnail,
            waveform,
            mediaType,
          });

          // Queue for background AI analysis in parallel
          // Get file size for proper API selection (File API vs inline)
          let fileSize = 0;
          try {
            if (window.electronAPI.getFileSize) {
              fileSize = await window.electronAPI.getFileSize(path);
            }
          } catch (error) {
            console.warn('Failed to get file size:', error);
          }

          const mimeMap: Record<string, string> = {
            mp4: 'video/mp4',
            mov: 'video/quicktime',
            avi: 'video/x-msvideo',
            mkv: 'video/x-matroska',
            webm: 'video/webm',
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            aac: 'audio/aac',
            flac: 'audio/flac',
            ogg: 'audio/ogg',
            m4a: 'audio/mp4',
          };
          queueMediaAnalysis({
            filePath: path,
            fileName: name,
            mediaType,
            mimeType: mimeMap[ext] || `${mediaType}/${ext}`,
            fileSize,
            duration,
            thumbnailDataUrl: thumbnail,
          });
        }
      }
    } catch (e) {
      console.error('Error during import:', e);
      alert('Error during import: ' + e);
    } finally {
      setIsImporting(false);
      setImportStatus('');
    }
  };

  const filteredAssets = mediaAssets.filter(
    (asset) => filterType === 'all' || asset.mediaType === filterType,
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-secondary relative">
      {isImporting && (
        <div className="absolute inset-0 z-50 bg-bg-secondary/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3"></div>
          <div className="text-sm font-medium text-accent animate-pulse mb-2">
            Importing media...
          </div>
          {importStatus && (
            <div className="text-xs text-text-secondary max-w-[200px] text-center truncate">
              {importStatus}
            </div>
          )}
        </div>
      )}

      {/* Upload Button */}
      <div className="px-3 py-3 border-b border-white/5">
        <button
          onClick={handleImport}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          title="Upload media files"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Upload Media
        </button>
        {isAnalyzing && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-purple-300">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            Analyzing {analyzingCount} file{analyzingCount !== 1 ? 's' : ''}...
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      {mediaAssets.length > 0 && (
        <div className="px-3 pb-2 border-b border-white/5">
          <div className="flex gap-1 flex-wrap">
            {(['all', 'video', 'audio', 'image'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={clsx(
                  'px-2.5 py-1 rounded-full text-[10px] font-medium transition-all capitalize',
                  filterType === type
                    ? 'bg-white/20 text-white'
                    : 'bg-white/5 text-text-muted hover:bg-white/10 hover:text-text-primary',
                )}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Media Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredAssets.length === 0 && mediaAssets.length > 0 ? (
          <div className="text-center text-text-muted text-sm mt-10">
            <p className="text-xs opacity-60">
              No {filterType === 'all' ? 'files' : filterType + ' files'} found
            </p>
          </div>
        ) : mediaAssets.length === 0 ? null : (
          <div className="grid grid-cols-2 gap-1.5">
            {filteredAssets.map((asset) => {
              const timelineClip = clips.find((clip) => clip.path === asset.path);
              const isActive =
                clips.find((clip) => clip.id === activeClipId)?.path === asset.path ||
                activeClipId === timelineClip?.id;

              return (
                <button
                  type="button"
                  key={asset.id}
                  onClick={() => {
                    if (timelineClip) {
                      setActiveClip(timelineClip.id);
                      return;
                    }

                    const beforeIds = new Set(clips.map((clip) => clip.id));
                    addClip({
                      path: asset.path,
                      name: asset.name,
                      duration: asset.assetDuration ?? asset.duration,
                      assetDuration: asset.assetDuration ?? asset.duration,
                      sourceDuration: asset.sourceDuration,
                      thumbnail: asset.thumbnail,
                      waveform: asset.waveform,
                      mediaType: asset.mediaType,
                    });

                    const insertedClip = useProjectStore
                      .getState()
                      .clips.find((clip) => !beforeIds.has(clip.id) && clip.path === asset.path);
                    if (insertedClip) {
                      setActiveClip(insertedClip.id);
                    }
                  }}
                  className={clsx(
                    'relative aspect-video bg-bg-elevated rounded-lg overflow-hidden cursor-pointer border-2 transition-all group text-left',
                    isActive ? 'border-blue-500' : 'border-transparent hover:border-white/20',
                  )}
                  title={asset.name}
                >
                  {asset.thumbnail ? (
                    <img
                      src={asset.thumbnail}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted/40">
                      {asset.mediaType === 'audio' && (
                        <svg
                          className="w-6 h-6"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                          />
                        </svg>
                      )}
                      {asset.mediaType !== 'audio' && (
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </div>
                  )}
                  {/* Duration badge */}
                  <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white font-medium">
                    {(typeof asset.assetDuration === 'number'
                      ? asset.assetDuration
                      : typeof asset.sourceDuration === 'number'
                        ? asset.sourceDuration
                        : asset.duration
                    ).toFixed(0)}
                    s
                  </div>
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaTab;
