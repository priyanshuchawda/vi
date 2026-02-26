import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useAiMemoryStore } from '../../stores/useAiMemoryStore';
import { queueMediaAnalysis } from '../../lib/aiMemoryService';
import clsx from 'clsx';

const MediaTab = () => {
  const { clips, addClip, setActiveClip, activeClipId, defaultImageDuration } = useProjectStore();
  const { isAnalyzing, analyzingCount, entries: memoryEntries } = useAiMemoryStore();
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio' | 'image' | 'text'>('all');

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
            thumbnail = `file://${path}`;
            // Use the user-configured default image duration
            const imageDuration = defaultImageDuration;
            addClip({
              path,
              name,
              duration: imageDuration,
              sourceDuration: imageDuration,
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
            sourceDuration: duration,
            thumbnail,
            waveform,
            mediaType
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
            mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
            mkv: 'video/x-matroska', webm: 'video/webm',
            mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
            flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
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

  const filteredClips = clips.filter(clip =>
    filterType === 'all' || clip.mediaType === filterType
  );

  const mediaTypeCount = {
    all: clips.length,
    video: clips.filter(c => c.mediaType === 'video').length,
    audio: clips.filter(c => c.mediaType === 'audio').length,
    image: clips.filter(c => c.mediaType === 'image').length,
    text: clips.filter(c => c.mediaType === 'text').length,
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-secondary relative">
      {isImporting && (
        <div className="absolute inset-0 z-50 bg-bg-secondary/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mb-3"></div>
          <div className="text-sm font-medium text-accent animate-pulse mb-2">Importing media...</div>
          {importStatus && (
            <div className="text-xs text-text-secondary max-w-[200px] text-center truncate">
              {importStatus}
            </div>
          )}
        </div>
      )}

      {/* Header with Import Button */}
      <div className="p-4 border-b border-border-primary">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-bold text-text-primary">Media Library</h3>
          {/* AI Memory Status Indicator */}
          {isAnalyzing && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20" title={`AI is analyzing ${analyzingCount} file(s)...`}>
              <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-[10px] font-medium text-purple-300"> {analyzingCount}</span>
            </div>
          )}
          {!isAnalyzing && memoryEntries.filter(e => e.status === 'completed').length > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20" title={`AI has analyzed ${memoryEntries.filter(e => e.status === 'completed').length} file(s)`}>
              <span className="text-[10px] font-medium text-emerald-300"> {memoryEntries.filter(e => e.status === 'completed').length}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-text-muted mb-3">Import and manage your media files</p>

        <button
          onClick={handleImport}
          className="w-full bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-accent/30"
          title="Import media files"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Import Media
        </button>
      </div>

      {/* Filter Tabs */}
      {clips.length > 0 && (
        <div className="px-4 pt-3 pb-2 border-b border-border-primary">
          <div className="flex gap-1 text-[10px] font-bold">
            {(['all', 'video', 'audio', 'image', 'text'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={clsx(
                  'flex-1 px-2 py-1.5 rounded transition-all uppercase tracking-wide',
                  filterType === type
                    ? 'bg-accent text-white'
                    : 'bg-bg-elevated text-text-muted hover:text-text-primary hover:bg-bg-surface'
                )}
              >
                {type} ({mediaTypeCount[type]})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Media Grid */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredClips.length === 0 ? (
          <div className="text-center text-text-muted text-sm mt-10">
            <svg className="w-12 h-12 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
            <p className="mb-1">
              {filterType === 'all' ? 'No files imported' : `No ${filterType} files`}
            </p>
            <p className="text-xs text-text-muted/60">
              {filterType === 'all'
                ? 'Click Import Media to add files'
                : `Switch to "All" or import ${filterType} files`
              }
            </p>
          </div>
        ) : (
          filteredClips.map((clip) => (
            <div
              key={clip.id}
              onClick={() => setActiveClip(clip.id)}
              className={clsx(
                "p-2 bg-bg-elevated rounded hover:bg-bg-surface cursor-pointer flex items-center space-x-3 group border border-transparent hover:border-border-primary transition-all",
                activeClipId === clip.id ? "border-accent ring-1 ring-accent-dim" : ""
              )}
            >
              <div className="w-16 h-9 bg-bg-primary rounded overflow-hidden flex-shrink-0 relative">
                {clip.thumbnail ? (
                  <img src={clip.thumbnail} alt={clip.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">
                    {clip.mediaType === 'audio' && (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    )}
                    {clip.mediaType === 'image' && (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                    {clip.mediaType === 'video' && (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                    {clip.mediaType === 'text' && (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    )}
                  </div>
                )}
                {/* Media type badge */}
                <div className="absolute top-0.5 right-0.5 px-1 py-0.5 bg-bg-primary/90 rounded text-[8px] font-bold uppercase tracking-wide">
                  {clip.mediaType === 'audio' && <span title="Audio"></span>}
                  {clip.mediaType === 'image' && <span title="Image"></span>}
                  {clip.mediaType === 'video' && <span title="Video"></span>}
                  {clip.mediaType === 'text' && <span title="Text"></span>}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate text-text-primary group-hover:text-accent transition-colors">
                  {clip.name}
                </div>
                <div className="text-xs text-text-secondary">
                  {(typeof clip.duration === 'number' ? clip.duration : 0).toFixed(1)}s · {clip.mediaType || 'video'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MediaTab;
