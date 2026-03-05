import { useRef, useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import { getActiveSubtitle } from '../../lib/srtParser';
import { toMediaUrl } from '../../lib/mediaUrl';

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
    subtitleStyle,
  } = useProjectStore(
    useShallow((state) => ({
      clips: state.clips,
      isPlaying: state.isPlaying,
      setIsPlaying: state.setIsPlaying,
      currentTime: state.currentTime,
      setCurrentTime: state.setCurrentTime,
      getTotalDuration: state.getTotalDuration,
      getClipAtTime: state.getClipAtTime,
      getActiveClips: state.getActiveClips,
      subtitles: state.subtitles,
      subtitleStyle: state.subtitleStyle,
    })),
  );

  // Get the primary video clip at current playhead position (for display)
  const currentVideoClip = getClipAtTime(currentTime);

  // Get ALL active clips at current time (for audio playback)
  const activeClips = getActiveClips(currentTime);

  // Filter for audio-containing clips (audio files or videos with audio)
  // We exclude the main video clip if it's currently being displayed, as the <video> element handles its audio
  const backgroundAudioClips = activeClips.filter(
    (clip) =>
      (clip.mediaType === 'audio' ||
        (clip.mediaType === 'video' && clip.id !== currentVideoClip?.id)) &&
      !clip.muted,
  );

  const totalDuration = getTotalDuration();

  // Get all text clips that should be visible at current time
  const activeTextClips = clips.filter(
    (clip) =>
      clip.mediaType === 'text' &&
      currentTime >= clip.startTime &&
      currentTime < clip.startTime + clip.duration,
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
  const mediaAreaRef = useRef<HTMLDivElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const isSeeking = useRef(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const handleFullscreen = () => setIsFullscreen((f) => !f);

  // ESC exits fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const currentTimeRef = useRef(currentTime);
  const clipsLengthRef = useRef(clips.length);
  const lastVideoClipIdRef = useRef<string | null>(null);

  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    clipsLengthRef.current = clips.length;
  }, [clips.length]);

  // Sync Play/Pause and handle timeline playback
  useEffect(() => {
    if (isPlaying) {
      if (clipsLengthRef.current === 0) {
        setIsPlaying(false);
        return;
      }

      // Start playback loop
      // Start playback loop

      let lastFrameTime = Date.now();

      const loop = () => {
        const now = Date.now();
        const elapsed = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        const newTime = currentTimeRef.current + elapsed;

        if (newTime >= totalDuration) {
          currentTimeRef.current = 0;
          setCurrentTime(0); // Loop back or stop
          setIsPlaying(false);
        } else {
          currentTimeRef.current = newTime;
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
    return undefined;
  }, [isPlaying, totalDuration, setCurrentTime, setIsPlaying]); // Only re-run on play/pause or duration change (not currentTime!)

  // SYNC MEDIA ELEMENTS
  // This effect runs whenever currentTime changes to sync all media
  useEffect(() => {
    // 1. Sync Main Video
    if (currentVideoClip && videoRef.current) {
      const timeInClip = currentTime - currentVideoClip.startTime;
      const sourceTime = currentVideoClip.start + timeInClip;
      const drift = Math.abs(videoRef.current.currentTime - sourceTime);
      const clipChanged = lastVideoClipIdRef.current !== currentVideoClip.id;
      if (clipChanged) {
        lastVideoClipIdRef.current = currentVideoClip.id;
      }
      const shouldHardSync = !isPlaying || isSeeking.current || clipChanged;

      // Never force-seek during normal playback; only hard-sync on clip switches, explicit seeks, or pause.
      if (shouldHardSync && drift > 0.05) {
        videoRef.current.currentTime = sourceTime;
      }

      if (isPlaying && videoRef.current.paused) {
        videoRef.current.play().catch((e) => e.name !== 'AbortError' && console.log(e));
      } else if (!isPlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }

      videoRef.current.volume = currentVideoClip.muted ? 0 : (currentVideoClip.volume ?? 1);
    } else if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      lastVideoClipIdRef.current = null;
    }

    // 2. Sync Background Audio Clips
    backgroundAudioClips.forEach((clip) => {
      const audioEl = audioRefs.current.get(clip.id);

      // If we don't have a ref but should, we rely on the render to create it
      // The render loop below creates <audio> tags with refs callback
      if (audioEl) {
        const timeInClip = currentTime - clip.startTime;
        const sourceTime = clip.start + timeInClip;
        const drift = Math.abs(audioEl.currentTime - sourceTime);
        const shouldHardSync = !isPlaying || isSeeking.current;

        if ((shouldHardSync && drift > 0.05) || (!shouldHardSync && drift > 1)) {
          audioEl.currentTime = sourceTime;
        }

        if (isPlaying && audioEl.paused) {
          audioEl.play().catch((e) => e.name !== 'AbortError' && console.log(e));
        } else if (!isPlaying && !audioEl.paused) {
          audioEl.pause();
        }

        audioEl.volume = clip.muted ? 0 : (clip.volume ?? 1);
      }
    });

    // 3. Pause audio clips that are no longer active
    audioRefs.current.forEach((audioEl, id) => {
      if (!backgroundAudioClips.find((c) => c.id === id)) {
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
      <div className="w-full h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-text-secondary">
          <div className="text-center space-y-4">
            <div className="w-24 h-24 mx-auto bg-white/5 rounded-2xl flex items-center justify-center">
              <svg className="w-12 h-12 text-white/20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div>
              <div className="text-base font-medium text-text-secondary mb-1">No media added</div>
              <div className="text-xs text-text-muted">Upload a video to start editing</div>
            </div>
          </div>
        </div>

        {/* Transport Controls - empty state */}
        <div className="bg-bg-secondary border-t border-white/5 flex flex-col opacity-40 pointer-events-none">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium">
              Edit with AI
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-text-secondary text-xs font-medium">
              Split
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="w-9 h-9 rounded-full border-2 border-white/20" />
            <div className="text-xs font-mono text-text-muted">0:00:00 / 0:00:00</div>
            <div className="flex-1 h-1.5 bg-white/10 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  // Display Logic
  // Prioritize: Video -> Image -> Audio (visualizer) -> Blank
  const displayMediaType = currentVideoClip?.mediaType || 'blank';

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Media Display Area */}
      <div
        ref={mediaAreaRef}
        className={
          isFullscreen
            ? 'fixed inset-0 z-[9999] bg-black flex items-center justify-center'
            : 'preview-media-area flex-1 flex items-center justify-center relative overflow-hidden bg-bg-primary'
        }
      >
        {/* Main Video Element */}
        {currentVideoClip && displayMediaType === 'video' && (
          <video
            ref={videoRef}
            src={toMediaUrl(currentVideoClip.path)}
            className="max-h-full max-w-full rounded-xl shadow-2xl ring-1 ring-white/10"
            preload="auto"
            playsInline
            onClick={togglePlay}
          />
        )}

        {/* Image Display */}
        {currentVideoClip && displayMediaType === 'image' && (
          <img
            src={toMediaUrl(currentVideoClip.path)}
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
              <svg
                className="w-28 h-28 text-accent/70"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-text-primary mb-2">
                {currentVideoClip.name}
              </div>
              <div className="text-sm text-text-muted bg-bg-elevated/50 px-4 py-1.5 rounded-full">
                Audio Track
              </div>
            </div>
          </div>
        )}

        {/* Hidden Audio Elements for Multi-track Mixing */}
        {backgroundAudioClips.map((clip) => (
          <audio
            key={clip.id}
            ref={(el) => setAudioRef(clip.id, el)}
            src={toMediaUrl(clip.path)}
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
          <div className="flex flex-col items-center justify-center gap-4 text-center select-none">
            <div className="w-16 h-16 rounded-2xl bg-bg-elevated flex items-center justify-center border border-white/6">
              <svg className="w-8 h-8 text-text-muted/50" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text-muted">No media loaded</p>
              <p className="text-[11px] text-text-muted/50 mt-0.5">
                Import clips to the timeline to begin
              </p>
            </div>
          </div>
        )}

        {/* Text Overlays */}
        {activeTextClips.map((textClip) => {
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
                transform: 'translate(-50%, -50%)',
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
            <div key={textClip.id} className="absolute pointer-events-none z-10" style={textStyle}>
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
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {displayedSubtitleText}
          </div>
        )}

        {/* Resolution badge + Fullscreen button */}
        {currentVideoClip && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 z-30">
            {!isFullscreen && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/50 backdrop-blur-sm border border-white/8">
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="text-[9px] font-medium text-text-secondary tracking-wide">
                  1080p · 30fps
                </span>
              </div>
            )}
            <button
              onClick={handleFullscreen}
              className="flex items-center justify-center w-6 h-6 rounded-md bg-black/50 backdrop-blur-sm border border-white/8 text-white hover:bg-black/70 transition-colors"
              title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 9L4 4m0 0v4m0-4h4M15 9l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4M15 15l5 5m0 0v-4m0 4h-4"
                  />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5"
                  />
                </svg>
              )}
            </button>
          </div>
        )}
        {/* Exit button in fullscreen even with no clip */}
        {isFullscreen && !currentVideoClip && (
          <button
            onClick={handleFullscreen}
            className="absolute top-2 right-2 z-30 flex items-center justify-center w-6 h-6 rounded-md bg-black/50 backdrop-blur-sm border border-white/8 text-white hover:bg-black/70 transition-colors"
            title="Exit Fullscreen (Esc)"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 9L4 4m0 0v4m0-4h4M15 9l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4M15 15l5 5m0 0v-4m0 4h-4"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Transport Controls */}
      <div className="bg-bg-secondary panel-border-t flex flex-col">
        {/* Playback controls row */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          {/* Skip back */}
          <button
            onClick={() => setCurrentTime(Math.max(0, currentTime - 5))}
            disabled={clips.length === 0}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-25 transition-colors rounded-md hover:bg-white/5"
            title="Skip back 5s"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            disabled={clips.length === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/18 border border-white/15 hover:border-white/30 text-white disabled:opacity-25 transition-all shadow-sm"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Skip forward */}
          <button
            onClick={() => setCurrentTime(Math.min(totalDuration, currentTime + 5))}
            disabled={clips.length === 0}
            className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-25 transition-colors rounded-md hover:bg-white/5"
            title="Skip forward 5s"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zm2-12v8l5.78-4L8 6zm7-2h2v12h-2z" />
            </svg>
          </button>

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
            className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent disabled:opacity-25 disabled:cursor-not-allowed"
            style={{ accentColor: '#3b82f6' }}
          />

          {/* Time display */}
          <div className="text-[10px] font-mono text-text-muted whitespace-nowrap shrink-0 tabular-nums">
            <span className="text-text-secondary">{formatTime(currentTime)}</span>
            <span className="text-text-muted/50 mx-0.5">/</span>
            <span>{formatTime(totalDuration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Preview;
