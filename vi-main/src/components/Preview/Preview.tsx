import { useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { getActiveSubtitle } from '../../lib/srtParser';

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const Preview = () => {
  const {
    clips,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    getTotalDuration,
    getClipAtTime,
    getActiveClips,
    subtitles,
    subtitleStyle
  } = useProjectStore();

  // Get the primary video clip at current playhead position (for display)
  const currentVideoClip = getClipAtTime(currentTime);

  // Get ALL active clips at current time (for audio playback)
  const activeClips = getActiveClips(currentTime);

  // Filter for audio-containing clips (audio files or videos with audio)
  // We exclude the main video clip if it's currently being displayed, as the <video> element handles its audio
  const backgroundAudioClips = activeClips.filter(clip =>
    (clip.mediaType === 'audio' || (clip.mediaType === 'video' && clip.id !== currentVideoClip?.id)) &&
    !clip.muted
  );

  const totalDuration = getTotalDuration();

  // Get all text clips that should be visible at current time
  const activeTextClips = clips.filter(clip =>
    clip.mediaType === 'text' &&
    currentTime >= clip.startTime &&
    currentTime < clip.startTime + clip.duration
  );

  // Get active subtitle
  const activeSubtitle = getActiveSubtitle(subtitles, currentTime);

  // Calculate progressive word display for real-time effect
  const getProgressiveSubtitleText = (subtitle: typeof activeSubtitle): string => {
    if (!subtitle) return '';
    
    // If instant mode, return full text immediately
    if (subtitleStyle.displayMode === 'instant') {
      return subtitle.text;
    }
    
    // Progressive mode: show words over time
    const words = subtitle.text.split(' ');
    const subtitleDuration = subtitle.endTime - subtitle.startTime;
    const timeInSubtitle = currentTime - subtitle.startTime;
    const progressRatio = Math.min(timeInSubtitle / subtitleDuration, 1);
    
    // Show words progressively based on time
    const wordsToShow = Math.ceil(words.length * progressRatio);
    return words.slice(0, Math.max(1, wordsToShow)).join(' ');
  };

  const displayedSubtitleText = activeSubtitle ? getProgressiveSubtitleText(activeSubtitle) : '';

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const isSeeking = useRef(false);

  const animationFrameRef = useRef<number | null>(null);



  // Sync Play/Pause and handle timeline playback
  useEffect(() => {
    if (isPlaying) {
      if (clips.length === 0) {
        setIsPlaying(false);
        return;
      }

      // Start playback loop
      // Start playback loop


      const startTime = Date.now();
      const initialTime = currentTime;

      const loop = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        const newTime = initialTime + elapsed;

        if (newTime >= totalDuration) {
          setCurrentTime(0); // Loop back or stop
          setIsPlaying(false);
        } else {
          setCurrentTime(newTime);
          animationFrameRef.current = requestAnimationFrame(loop);
        }
      };

      animationFrameRef.current = requestAnimationFrame(loop);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }
  }, [isPlaying, totalDuration]); // Only re-run on play/pause or duration change (not currentTime!)

  // SYNC MEDIA ELEMENTS
  // This effect runs whenever currentTime changes to sync all media
  useEffect(() => {
    // 1. Sync Main Video
    if (currentVideoClip && videoRef.current) {
      const timeInClip = currentTime - currentVideoClip.startTime;
      const sourceTime = currentVideoClip.start + timeInClip;

      // Only seek if significantly off (to allow smooth playback)
      if (Math.abs(videoRef.current.currentTime - sourceTime) > 0.2) {
        videoRef.current.currentTime = sourceTime;
      }

      if (isPlaying && videoRef.current.paused) {
        videoRef.current.play().catch(e => e.name !== 'AbortError' && console.log(e));
      } else if (!isPlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }

      videoRef.current.volume = currentVideoClip.muted ? 0 : (currentVideoClip.volume ?? 1);
    }

    // 2. Sync Background Audio Clips
    backgroundAudioClips.forEach(clip => {
      const audioEl = audioRefs.current.get(clip.id);

      // If we don't have a ref but should, we rely on the render to create it
      // The render loop below creates <audio> tags with refs callback
      if (audioEl) {
        const timeInClip = currentTime - clip.startTime;
        const sourceTime = clip.start + timeInClip;

        if (Math.abs(audioEl.currentTime - sourceTime) > 0.2) {
          audioEl.currentTime = sourceTime;
        }

        if (isPlaying && audioEl.paused) {
          audioEl.play().catch(e => e.name !== 'AbortError' && console.log(e));
        } else if (!isPlaying && !audioEl.paused) {
          audioEl.pause();
        }

        audioEl.volume = clip.muted ? 0 : (clip.volume ?? 1);
      }
    });

    // 3. Pause audio clips that are no longer active
    audioRefs.current.forEach((audioEl, id) => {
      if (!backgroundAudioClips.find(c => c.id === id)) {
        audioEl.pause();
      }
    });

  }, [currentTime, isPlaying, currentVideoClip, backgroundAudioClips]); // Re-run on every frame update

  // Helper to manage audio refs
  const setAudioRef = (id: string, el: HTMLAudioElement | null) => {
    if (el) {
      audioRefs.current.set(id, el);
    } else {
      audioRefs.current.delete(id);
    }
  };

  // UI Handlers
  const togglePlay = () => {
    if (clips.length === 0) return;
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
  };

  const handleSeekStart = () => {
    isSeeking.current = true;
    // Optionally pause while seeking
  };

  const handleSeekEnd = () => {
    isSeeking.current = false;
  };

  // Empty timeline state
  if (clips.length === 0) {
    return (
      <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-text-secondary">
          <div className="text-center space-y-6">
            <div className="w-32 h-32 mx-auto bg-gradient-to-br from-accent/5 to-accent/10 rounded-3xl flex items-center justify-center backdrop-blur-sm">
              <svg className="w-16 h-16 text-accent/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <div className="text-xl font-semibold text-text-primary mb-2">Ready to Create</div>
              <div className="text-sm text-text-muted">Import media files to begin editing</div>
            </div>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="h-20 bg-bg-elevated/50 backdrop-blur-sm flex items-center px-8 gap-6 border-t border-white/5">
          <button disabled className="text-text-muted opacity-20 cursor-not-allowed">
            <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
          </button>
          <div className="flex items-center gap-3 bg-bg-primary/50 px-4 py-2 rounded-xl">
            <div className="text-sm font-mono text-text-muted">0:00:00</div>
            <span className="text-xs text-text-muted/50">/</span>
            <div className="text-sm font-mono text-text-muted">0:00:00</div>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="0"
            disabled
            className="flex-1 h-1.5 bg-white/5 rounded-full appearance-none cursor-not-allowed opacity-30"
          />
        </div>
      </div>
    );
  }

  // Display Logic
  // Prioritize: Video -> Image -> Audio (visualizer) -> Blank
  const displayMediaType = currentVideoClip?.mediaType || 'blank';

  return (
    <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden">
      {/* Media Display Area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">

        {/* Main Video Element */}
        {currentVideoClip && displayMediaType === 'video' && (
          <video
            ref={videoRef}
            src={`file://${currentVideoClip.path}`}
            className="max-h-full max-w-full rounded-xl shadow-2xl ring-1 ring-white/10"
            onClick={togglePlay}
          />
        )}

        {/* Image Display */}
        {currentVideoClip && displayMediaType === 'image' && (
          <img
            src={`file://${currentVideoClip.path}`}
            alt={currentVideoClip.name}
            className="max-h-full max-w-full rounded-xl shadow-2xl object-contain cursor-pointer ring-1 ring-white/10"
            style={{ objectFit: 'contain' }}
            onClick={togglePlay}
          />
        )}

        {/* Audio Visualizer */}
        {currentVideoClip && displayMediaType === 'audio' && (
          <div className="flex flex-col items-center justify-center space-y-8 p-8">
            <div className="w-56 h-56 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent rounded-full flex items-center justify-center shadow-2xl animate-pulse ring-4 ring-accent/10">
              <svg className="w-28 h-28 text-accent/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-text-primary mb-2">{currentVideoClip.name}</div>
              <div className="text-sm text-text-muted bg-bg-elevated/50 px-4 py-1.5 rounded-full">Audio Track</div>
            </div>
          </div>
        )}

        {/* Hidden Audio Elements for Multi-track Mixing */}
        {backgroundAudioClips.map(clip => (
          <audio
            key={clip.id}
            ref={(el) => setAudioRef(clip.id, el)}
            src={`file://${clip.path}`}
            preload="auto"
          />
        ))}

        {/* Use the main clip as audio source if it's audio type (to ensure it plays) 
            We need to make sure we don't double play if it's already in backgroundAudioClips.
            Our filter logic: backgroundAudioClips includes:
            - Audio clips
            - Video clips NOT currentVideoClip
            So if currentVideoClip is AUDIO, it IS in backgroundAudioClips?
            Wait: (clip.mediaType === 'audio' || ...)
            Yes. So reliable playback is handled by the loop above.
        */}

        {!currentVideoClip && (
          <div className="text-center text-text-muted">
            <div className="mb-2">No clip at current position</div>
          </div>
        )}

        {/* Text Overlays */}
        {activeTextClips.map(textClip => {
          const textProps = textClip.textProperties;
          if (!textProps) return null;

          let positionStyle: React.CSSProperties = {};

          switch (textProps.position) {
            case 'top':
              positionStyle = { top: '10%', left: '50%', transform: 'translateX(-50%)' };
              break;
            case 'bottom':
              positionStyle = { bottom: '10%', left: '50%', transform: 'translateX(-50%)' };
              break;
            case 'center':
              positionStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
              break;
            case 'custom':
              positionStyle = {
                top: `${textProps.y ?? 50}%`,
                left: `${textProps.x ?? 50}%`,
                transform: 'translate(-50%, -50%)'
              };
              break;
          }

          const textStyle: React.CSSProperties = {
            fontSize: `${textProps.fontSize}px`,
            fontFamily: textProps.fontFamily,
            color: textProps.color,
            backgroundColor: textProps.backgroundColor || 'transparent',
            fontWeight: textProps.bold ? 'bold' : 'normal',
            fontStyle: textProps.italic ? 'italic' : 'normal',
            textAlign: textProps.align,
            padding: '8px 16px',
            borderRadius: '4px',
            maxWidth: '90%',
            whiteSpace: 'pre-wrap', // Preserve line breaks
            wordWrap: 'break-word',
            ...(textProps.outline && {
              textShadow: `
                -2px -2px 0 ${textProps.outlineColor},
                2px -2px 0 ${textProps.outlineColor},
                -2px 2px 0 ${textProps.outlineColor},
                2px 2px 0 ${textProps.outlineColor}
              `,
            }),
            ...positionStyle,
          };

          return (
            <div
              key={textClip.id}
              className="absolute pointer-events-none z-10"
              style={textStyle}
            >
              {textProps.text}
            </div>
          );
        })}

        {/* Subtitles - Real-time progressive display */}
        {displayedSubtitleText && (
          <div
            className="absolute left-1/2 -translate-x-1/2 px-4 py-2 rounded z-20 max-w-[80%] text-center transition-all duration-100"
            style={{
              [subtitleStyle.position]: '5%',
              fontSize: `${subtitleStyle.fontSize}px`,
              fontFamily: subtitleStyle.fontFamily,
              color: subtitleStyle.color,
              backgroundColor: subtitleStyle.backgroundColor,
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
            }}
          >
            {displayedSubtitleText}
          </div>
        )}
      </div>

      {/* Transport Controls */}
      <div className="h-20 bg-bg-elevated/50 backdrop-blur-sm flex items-center px-8 gap-6 border-t border-white/5">
        <button
          onClick={togglePlay}
          disabled={clips.length === 0}
          className="w-11 h-11 flex items-center justify-center text-white bg-accent hover:bg-accent-hover focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed disabled:bg-bg-surface transition-all rounded-xl shadow-lg shadow-accent/20 hover:shadow-accent/30"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          {isPlaying ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"></path></svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
          )}
        </button>

        <div className="flex items-center gap-3 bg-bg-primary/50 px-4 py-2.5 rounded-xl backdrop-blur-sm ring-1 ring-white/5">
          <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm font-mono text-accent font-semibold min-w-[84px]">
            {formatTime(currentTime)}
          </div>
          <span className="text-xs text-text-muted/50">/</span>
          <div className="text-sm font-mono text-text-secondary/80 min-w-[84px]">
            {formatTime(totalDuration)}
          </div>
        </div>

        {/* Scrubber */}
        <input
          type="range"
          min="0"
          max={Number.isFinite(totalDuration) ? totalDuration : 0}
          step="0.01"
          value={currentTime}
          onChange={handleSeek}
          onMouseDown={handleSeekStart}
          onMouseUp={handleSeekEnd}
          disabled={clips.length === 0}
          className="flex-1 h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
        />
      </div>
    </div>
  );
};

export default Preview;
