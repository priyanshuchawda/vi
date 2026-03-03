import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useShallow } from 'zustand/react/shallow';
import clsx from 'clsx';
import ContextMenu from '../ui/ContextMenu';

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const Timeline = () => {
  const { clips, activeClipId, currentTime, setCurrentTime, updateClip, selectedClipIds, toggleClipSelection, mergeSelectedClips, splitClip, removeClip, copyClips, pasteClips, setClipVolume, toggleClipMute, snapToGrid, setSnapToGrid, gridSize, getTotalDuration, moveClipToTime, setClipSpeed, undo, redo, canUndo, canRedo } = useProjectStore(
    useShallow((state) => ({
      clips: state.clips,
      activeClipId: state.activeClipId,
      currentTime: state.currentTime,
      setCurrentTime: state.setCurrentTime,
      updateClip: state.updateClip,
      selectedClipIds: state.selectedClipIds,
      toggleClipSelection: state.toggleClipSelection,
      mergeSelectedClips: state.mergeSelectedClips,
      splitClip: state.splitClip,
      removeClip: state.removeClip,
      copyClips: state.copyClips,
      pasteClips: state.pasteClips,
      setClipVolume: state.setClipVolume,
      toggleClipMute: state.toggleClipMute,
      snapToGrid: state.snapToGrid,
      setSnapToGrid: state.setSnapToGrid,
      gridSize: state.gridSize,
      getTotalDuration: state.getTotalDuration,
      moveClipToTime: state.moveClipToTime,
      setClipSpeed: state.setClipSpeed,
      undo: state.undo,
      redo: state.redo,
      canUndo: state.canUndo(),
      canRedo: state.canRedo(),
    })),
  );
  const [pixelsPerSecond, setPixelsPerSecond] = useState(10);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [speedInput, setSpeedInput] = useState<{ clipId: string; value: string } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDraggingPlayhead = useRef(false);
  const [showVolumeFor, setShowVolumeFor] = useState<string | null>(null);

  // Drag and drop state
  const [draggingClip, setDraggingClip] = useState<{ id: string; offsetX: number } | null>(null);

  // Trimming state
  const [trimming, setTrimming] = useState<{ id: string; type: 'start' | 'end'; initialX: number; initialValue: number } | null>(null);

  // Group clips by track
  const trackGroups = clips.reduce((acc, clip) => {
    const trackIndex = clip.trackIndex ?? 0;
    if (!acc[trackIndex]) acc[trackIndex] = [];
    acc[trackIndex].push(clip);
    return acc;
  }, {} as Record<number, typeof clips>);

  // Get all track indices sorted
  const trackIndices = Object.keys(trackGroups).map(Number).sort((a, b) => a - b);

  // Calculate total timeline duration using store method
  const totalDuration = getTotalDuration() || 10;

  const timelineWidth = Math.max(800, totalDuration * pixelsPerSecond);

  // Playhead dragging handlers
  const handlePlayheadDragStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    isDraggingPlayhead.current = true;
    handlePlayheadDrag(e);
  };

  const handlePlayheadDrag = (e: React.MouseEvent | MouseEvent) => {
    if (!timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, timelineWidth));
    const newTime = x / pixelsPerSecond;

    setCurrentTime(newTime);
  };

  const handlePlayheadDragEnd = () => {
    isDraggingPlayhead.current = false;
  };

  // Auto-scroll timeline to follow playhead
  useEffect(() => {
    if (timelineRef.current) {
      const container = timelineRef.current.parentElement;
      if (container) {
        const playheadX = currentTime * pixelsPerSecond;
        const containerWidth = container.clientWidth;
        const scrollLeft = container.scrollLeft;

        // Auto-scroll if playhead goes off screen
        if (playheadX < scrollLeft) {
          container.scrollLeft = playheadX - 50; // Keep some padding
        } else if (playheadX > scrollLeft + containerWidth - 100) {
          container.scrollLeft = playheadX - containerWidth + 100;
        }
      }
    }
  }, [currentTime, pixelsPerSecond]);

  // Attach global mouse listeners for playhead dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingPlayhead.current || !timelineRef.current) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, timelineWidth));
      const newTime = x / pixelsPerSecond;
      setCurrentTime(newTime);
    };

    const handleMouseUp = () => {
      if (isDraggingPlayhead.current) {
        handlePlayheadDragEnd();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [pixelsPerSecond, setCurrentTime, timelineWidth]);

  // Clip dragging handlers for repositioning
  const handleClipDragStart = (e: React.MouseEvent, clipId: string) => {
    if (trimming) return;

    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const clipElement = e.currentTarget as HTMLElement;
    const rect = clipElement.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;

    setDraggingClip({ id: clipId, offsetX });
    e.stopPropagation();
  };

  const handleClipDragEnd = () => {
    setDraggingClip(null);
  };

  // Attach clip drag listeners
  useEffect(() => {
    if (!draggingClip) return;
    const handleClipDrag = (e: MouseEvent) => {
      if (!timelineRef.current) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - draggingClip.offsetX;
      let newStartTime = Math.max(0, x / pixelsPerSecond);

      if (snapToGrid) {
        newStartTime = Math.round(newStartTime / gridSize) * gridSize;
      }

      moveClipToTime(draggingClip.id, newStartTime);
    };

    window.addEventListener('mousemove', handleClipDrag);
    window.addEventListener('mouseup', handleClipDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleClipDrag);
      window.removeEventListener('mouseup', handleClipDragEnd);
    };
  }, [draggingClip, gridSize, moveClipToTime, pixelsPerSecond, snapToGrid]);

  const startTrim = (e: React.MouseEvent, id: string, type: 'start' | 'end', initialValue: number) => {
    e.stopPropagation();
    setTrimming({ id, type, initialX: e.clientX, initialValue });

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - e.clientX;
      let deltaTime = deltaX / pixelsPerSecond;

      // Apply snap to grid
      if (snapToGrid) {
        deltaTime = Math.round(deltaTime / gridSize) * gridSize;
      }

      const clip = useProjectStore.getState().clips.find(c => c.id === id);
      if (!clip) return;

      if (type === 'start') {
        const newStart = Math.max(0, Math.min(clip.end - 0.1, initialValue + deltaTime));
        updateClip(id, { start: newStart });
      } else {
        const newEnd = Math.max(clip.start + 0.1, Math.min(clip.sourceDuration, initialValue + deltaTime));
        updateClip(id, { end: newEnd });
      }
    };

    const handleMouseUp = () => {
      setTrimming(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Timeline Header with Controls */}
      <div className="h-12 border-b border-white/5 flex items-center justify-between px-6 bg-bg-elevated/50 backdrop-blur-sm animate-slide-up">
        <div className="flex items-center gap-4">
          {/* Timeline Icon & Label */}
          <div className="flex items-center gap-2">
            <div className="animate-float">
              <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
            </div>
            <div className="text-xs font-semibold text-text-primary tracking-wide">
              Timeline
            </div>
          </div>
          
          <div className="h-4 w-px bg-border-primary"></div>
          
          {/* Timecode Display */}
          <div className="flex items-center gap-2 bg-bg-primary px-2 py-1 rounded">
            <svg className="w-3 h-3 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-mono font-bold text-accent">
              {formatTime(currentTime)}
            </span>
            <span className="text-[10px] text-text-muted">/</span>
            <span className="text-xs font-mono text-text-secondary">
              {formatTime(totalDuration)}
            </span>
          </div>
          
          <div className="h-4 w-px bg-border-primary"></div>
          
          {/* Edit Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
              title="Undo (Ctrl+Z)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
              title="Redo (Ctrl+Y)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
              </svg>
            </button>
            <div className="h-4 w-px bg-border-primary"></div>
            <button
              onClick={() => activeClipId && splitClip(activeClipId, currentTime)}
              disabled={!activeClipId}
              className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
              title="Split (S)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
              </svg>
            </button>
            <button
              onClick={() => {
                selectedClipIds.forEach(clipId => removeClip(clipId));
              }}
              disabled={selectedClipIds.length === 0}
              className="p-1.5 text-text-muted hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:bg-red-500/5 rounded-lg hover:scale-110 active:scale-95"
              title="Delete (Del)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <button
              onClick={mergeSelectedClips}
              disabled={selectedClipIds.length < 2}
              className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
              title="Merge"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
            <div className="h-4 w-px bg-border-primary"></div>
            <button
              onClick={copyClips}
              disabled={selectedClipIds.length === 0}
              className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
              title="Copy (Ctrl+C)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              onClick={pasteClips}
              className="p-1.5 text-text-muted hover:text-text-primary transition-all duration-200 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
              title="Paste (Ctrl+V)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </button>
          </div>
          
          {activeClipId && (() => {
            const activeClip = clips.find(c => c.id === activeClipId);
            if (!activeClip) return null;
            return (
              <>
                <div className="h-4 w-px bg-border-primary"></div>
                <div className="flex items-center gap-2 text-[10px] text-text-muted">
                  <span className="text-text-primary font-medium">{activeClip.name}</span>
                  <span>•</span>
                  {activeClip.mediaType === 'image' ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="0.1"
                        max="300"
                        step="0.1"
                        value={activeClip.duration.toFixed(1)}
                        onChange={(e) => {
                          const newDuration = parseFloat(e.target.value);
                          if (!isNaN(newDuration) && newDuration > 0) {
                            updateClip(activeClip.id, { 
                              duration: newDuration,
                              sourceDuration: newDuration,
                              end: activeClip.start + newDuration
                            });
                          }
                        }}
                        className="w-16 px-2 py-0.5 bg-bg-elevated border border-border-primary rounded text-[10px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                        title="Image duration (seconds)"
                      />
                      <span>s</span>
                      <svg className="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  ) : (
                    <span>{activeClip.duration.toFixed(2)}s</span>
                  )}
                </div>
              </>
            );
          })()}
        </div>
        
        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {/* Snap to Grid Toggle */}
          <button
            onClick={() => setSnapToGrid(!snapToGrid)}
            className={clsx(
              "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-all duration-200 hover:scale-105 active:scale-95",
              snapToGrid 
                ? "bg-gradient-to-r from-accent to-accent-hover text-white shadow-lg shadow-accent/30" 
                : "bg-bg-surface text-text-muted hover:bg-accent/10 hover:text-accent"
            )}
            title={snapToGrid ? `Snap enabled (${gridSize}s grid)` : "Enable snap to grid"}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            <span>{snapToGrid ? 'SNAP' : 'Snap'}</span>
          </button>
          
          <div className="h-4 w-px bg-border-primary"></div>
          
          {/* Zoom Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPixelsPerSecond(Math.max(1, pixelsPerSecond - 10))}
              className="p-1 hover:bg-accent/10 text-text-muted hover:text-accent rounded transition-all duration-200 hover:scale-110 active:scale-95"
              title="Zoom out"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
              </svg>
            </button>
            
            <div className="flex items-center gap-1.5 bg-bg-surface px-2 py-1 rounded">
              <svg className="w-3 h-3 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="range"
                min="1"
                max="100"
                value={pixelsPerSecond}
                onChange={(e) => setPixelsPerSecond(parseInt(e.target.value))}
                className="w-20 h-1 bg-bg-primary rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <span className="text-[10px] text-text-muted font-mono w-7 text-right">{pixelsPerSecond}px</span>
            </div>
            
            <button
              onClick={() => setPixelsPerSecond(Math.min(100, pixelsPerSecond + 10))}
              className="p-1 hover:bg-accent/10 text-text-muted hover:text-accent rounded transition-all duration-200 hover:scale-110 active:scale-95"
              title="Zoom in"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Time Ruler */}
      <div className="h-10 border-b border-white/5 bg-bg-elevated/30 overflow-x-auto flex items-end relative" ref={timelineRef}>
        <div style={{ width: `${timelineWidth}px`, height: '100%', position: 'relative' }}>
          {/* Time markers */}
          {Array.from({ length: Math.ceil(totalDuration) + 1 }, (_, second) => (
            <div
              key={second}
              className="absolute top-0 bottom-0 flex flex-col justify-end"
              style={{ left: `${second * pixelsPerSecond}px` }}
            >
              <div className="w-px h-3 bg-border-primary"></div>
              <div className="text-[9px] text-text-muted absolute top-0 left-0 transform -translate-x-1/2 pt-0.5">
                {second}s
              </div>
            </div>
          ))}

          {/* Sub-markers (every 0.5s when zoomed in) */}
          {pixelsPerSecond > 20 && Array.from({ length: Math.ceil(totalDuration * 2) + 1 }, (_, halfStep) => {
            if (halfStep % 2 === 0) return null; // Skip full seconds
            const markerTime = halfStep * 0.5;
            return (
              <div
                key={markerTime}
                className="absolute bottom-0"
                style={{ left: `${markerTime * pixelsPerSecond}px` }}
              >
                <div className="w-px h-1.5 bg-border-primary/50"></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Track Area */}
      <div className="flex-1 overflow-auto p-4 relative" style={{ scrollBehavior: 'smooth' }}>
        <div style={{ width: `${timelineWidth}px`, position: 'relative' }}>
          {/* Global Playhead Indicator */}
          <button
            type="button"
            className="absolute top-0 bottom-0 z-50 cursor-ew-resize group pointer-events-auto transition-all duration-150"
            style={{ left: `${currentTime * pixelsPerSecond}px` }}
            onMouseDown={handlePlayheadDragStart}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 1 : 0.1;
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setCurrentTime(Math.max(0, currentTime - step));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setCurrentTime(Math.min(totalDuration, currentTime + step));
              }
            }}
            aria-label="Playhead"
          >
            {/* Playhead triangle top */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[9px] border-t-accent drop-shadow-lg transition-transform duration-150 group-hover:scale-110"></div>

            {/* Playhead line */}
            <div className="w-0.5 h-full bg-accent shadow-[0_0_10px_rgba(29,185,84,0.5)] group-hover:shadow-[0_0_20px_rgba(29,185,84,0.8)] transition-all duration-200 group-hover:w-1"></div>

            {/* Grab handle at bottom */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-accent rounded-full border-2 border-bg-secondary opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg animate-pulse-glow"></div>

            {/* Time display */}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-accent text-white px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none shadow-lg animate-slide-up">
              {currentTime.toFixed(2)}s
            </div>
          </button>

          {/* Render each track */}
          {trackIndices.length === 0 ? (
            <div className="text-text-muted text-sm italic">Import videos to start editing</div>
          ) : (
            trackIndices.map((trackIndex) => {
              const trackClips = trackGroups[trackIndex];
              const isAudioTrack = trackIndex >= 10;
              const trackLabel = isAudioTrack
                ? `Audio ${trackIndex - 9}`
                : trackIndex === 0 ? 'Video' : `Video ${trackIndex + 1}`;

              return (
                <div key={trackIndex} className="mb-2">
                  {/* Track Label */}
                  <div className={clsx(
                    "text-xs font-medium px-2 py-1 mb-1 rounded flex items-center gap-2",
                    isAudioTrack ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"
                  )}>
                    {isAudioTrack ? (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                    {trackLabel}
                  </div>

                  {/* Track Content */}
                  <div className={clsx(
                    "flex h-24 items-center relative rounded",
                    isAudioTrack ? "bg-purple-500/5" : "bg-blue-500/5"
                  )} style={{ width: `${timelineWidth}px` }}>
                    {trackClips.map((clip) => {
                      const width = Math.max(20, clip.duration * pixelsPerSecond);
                      const position = clip.startTime * pixelsPerSecond; // Use absolute positioning
                      const isActive = activeClipId === clip.id;
                      const isSelected = selectedClipIds.includes(clip.id);
                      const isDragging = draggingClip?.id === clip.id;
                      const isTextClip = clip.mediaType === 'text';
                      const isVideoClip = clip.mediaType === 'video' || clip.mediaType === 'image';

                      // Background: thumbnail for video/image clips, waveform for audio, nothing for text
                      const bgStyle = (() => {
                        if (isTextClip) return {};
                        if (isVideoClip && clip.thumbnail) {
                          return {
                            backgroundImage: `url(${clip.thumbnail})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            backgroundRepeat: 'no-repeat',
                          };
                        }
                        if (clip.waveform) {
                          return {
                            backgroundImage: `url(${clip.waveform})`,
                            backgroundSize: `${clip.sourceDuration * pixelsPerSecond}px 200%`,
                            backgroundPosition: `-${clip.start * pixelsPerSecond}px center`,
                            backgroundRepeat: 'no-repeat',
                          };
                        }
                        return {};
                      })();

                      return (
                        <div
                          key={clip.id}
                          onMouseDown={(e) => handleClipDragStart(e, clip.id)}
                          onClick={(e) => {
                            if (!draggingClip) {
                              toggleClipSelection(clip.id, e.ctrlKey || e.metaKey);
                              setCurrentTime(clip.startTime);
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (!selectedClipIds.includes(clip.id)) {
                              toggleClipSelection(clip.id, false);
                            }
                            setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
                          }}
                          className={clsx(
                            "h-20 rounded border cursor-pointer select-none transition-all duration-200 flex flex-col justify-between absolute overflow-visible group animate-fade-in hover:scale-[1.02]",
                            isActive
                              ? "bg-accent/10 border-accent border-2 shadow-[0_0_20px_rgba(29,185,84,0.3)] z-20"
                              : isSelected
                                ? "bg-accent/5 border-accent shadow-[0_0_15px_rgba(29,185,84,0.2)] z-10"
                                : isTextClip
                                  ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20 hover:border-green-400"
                                  : isAudioTrack
                                    ? "bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20 hover:border-purple-400"
                                    : "bg-bg-elevated border-border-primary hover:bg-bg-surface hover:border-accent/50",
                            isDragging && "opacity-50 grayscale"
                          )}
                          style={{
                            width: `${width}px`,
                            minWidth: `${width}px`,
                            left: `${position}px`,
                            ...bgStyle,
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleClipSelection(clip.id, e.ctrlKey || e.metaKey);
                              setCurrentTime(clip.startTime);
                            }
                          }}
                          aria-label={`Clip ${clip.name}`}
                        >
                          {/* Dark overlay for video thumbnails so text stays readable */}
                          {isVideoClip && clip.thumbnail && (
                            <div className="absolute inset-0 bg-black/40 rounded pointer-events-none z-0" />
                          )}
                          {/* Trim Handles */}
                          <button
                            type="button"
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-accent/0 group-hover:bg-accent/20 hover:!bg-accent z-30 transition-all duration-200 rounded-l hover:w-3"
                            onMouseDown={(e) => startTrim(e, clip.id, 'start', clip.start)}
                            aria-label="Trim clip start"
                          />
                          <button
                            type="button"
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-accent/0 group-hover:bg-accent/20 hover:!bg-accent z-30 transition-all duration-200 rounded-r hover:w-3"
                            onMouseDown={(e) => startTrim(e, clip.id, 'end', clip.end)}
                            aria-label="Trim clip end"
                          />

                          {/* Volume/Mute Controls */}
                          <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 z-40">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleClipMute(clip.id);
                              }}
                              className={clsx(
                                "p-1 rounded backdrop-blur-sm transition-all duration-200 hover:scale-110 active:scale-95",
                                clip.muted ? "bg-red-500/80 text-white shadow-lg shadow-red-500/30" : "bg-bg-primary/80 text-text-primary hover:bg-bg-primary"
                              )}
                              title={clip.muted ? "Unmute" : "Mute"}
                            >
                              {clip.muted ? (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                </svg>
                              )}
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowVolumeFor(showVolumeFor === clip.id ? null : clip.id);
                              }}
                              className="p-1 rounded bg-bg-primary/80 backdrop-blur-sm text-text-primary hover:bg-bg-primary transition-all duration-200 hover:scale-110 active:scale-95"
                              title="Volume"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                              </svg>
                            </button>
                          </div>

                          {/* Volume Slider */}
                          {showVolumeFor === clip.id && (
                            <div
                              className="absolute -top-12 left-1/2 -translate-x-1/2 bg-bg-elevated border border-border-primary rounded-lg shadow-lg p-2 z-50 flex flex-col items-center gap-1 animate-scale-in"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              role="dialog"
                              aria-label="Volume control"
                            >
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={clip.volume ?? 1}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setClipVolume(clip.id, parseFloat(e.target.value));
                                }}
                                className="w-20 h-1 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
                              />
                              <div className="text-[9px] text-text-muted">{Math.round((clip.volume ?? 1) * 100)}%</div>
                            </div>
                          )}

                          <div className="p-2 overflow-hidden pointer-events-none relative z-10">
                            <div className={clsx(
                              "text-[10px] font-medium truncate flex items-center gap-1",
                              isActive ? "text-accent" : isVideoClip && clip.thumbnail ? "text-white" : "text-text-secondary"
                            )}>
                              {isTextClip && (
                                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              )}
                              {clip.name}
                            </div>
                          </div>

                          {/* Playhead for active clip (local) */}
                          {isActive && (
                            <div
                              className="absolute top-0 bottom-0 w-0.5 bg-accent z-20 shadow-[0_0_8px_rgba(245,158,11,0.5)] pointer-events-none"
                              style={{ left: `${currentTime * pixelsPerSecond}px` }}
                            />
                          )}

                          <div className="p-2 pt-0 z-10 text-right pointer-events-none">
                            <div className="text-[9px] text-text-muted">{clip.duration.toFixed(1)}s</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Set Speed',
              onClick: () => {
                const clip = clips.find(c => c.id === contextMenu.clipId);
                setSpeedInput({ clipId: contextMenu.clipId, value: String(clip?.speed ?? 1) });
              },
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            },
            {
              label: 'Split at Playhead',
              onClick: () => {
                if (activeClipId) {
                  splitClip(activeClipId, currentTime);
                }
              },
              disabled: !activeClipId || contextMenu.clipId !== activeClipId,
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                </svg>
              ),
            },
            {
              label: 'Merge Selected',
              onClick: () => {
                mergeSelectedClips();
              },
              disabled: selectedClipIds.length < 2,
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              ),
            },
            {
              label: 'Copy',
              onClick: () => {
                copyClips();
              },
              disabled: selectedClipIds.length === 0,
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              ),
            },
            {
              label: 'Delete',
              onClick: () => {
                if (selectedClipIds.length > 0) {
                  selectedClipIds.forEach(id => removeClip(id));
                } else if (contextMenu.clipId) {
                  removeClip(contextMenu.clipId);
                }
              },
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ),
            },
          ]}
        />
      )}
      {/* Speed input modal */}
      {speedInput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setSpeedInput(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
              e.preventDefault();
              setSpeedInput(null);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close speed dialog"
        >
          <div
            className="bg-gray-800 rounded-lg p-4 shadow-xl w-64"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Set clip speed"
          >
            <h3 className="text-white font-semibold mb-3">Set Clip Speed</h3>
            <div className="flex gap-2 mb-3">
              {[0.25, 0.5, 1, 1.5, 2, 4].map(preset => (
                <button
                  key={preset}
                  className="flex-1 text-xs py-1 rounded bg-gray-700 hover:bg-blue-600 text-white"
                  onClick={() => setSpeedInput(s => s ? { ...s, value: String(preset) } : s)}
                >
                  {preset}x
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0.25}
              max={8}
              step={0.25}
              value={speedInput.value}
              onChange={e => setSpeedInput(s => s ? { ...s, value: e.target.value } : s)}
              className="w-full bg-gray-700 text-white rounded px-2 py-1 text-sm mb-3"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
                onClick={() => {
                  const speed = parseFloat(speedInput.value);
                  if (!isNaN(speed) && speed >= 0.25 && speed <= 8) {
                    setClipSpeed(speedInput.clipId, speed);
                  }
                  setSpeedInput(null);
                }}
              >
                Apply
              </button>
              <button className="flex-1 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm" onClick={() => setSpeedInput(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Timeline;
