import { useProjectStore } from '../../stores/useProjectStore';
import CollapsibleSection from './CollapsibleSection';

const AudioPanel = () => {
  const { clips, updateClip } = useProjectStore();

  // Filter clips that have audio
  const audioClips = clips.filter(
    (clip) => clip.mediaType === 'audio' || clip.mediaType === 'video',
  );

  const handleVolumeChange = (clipId: string, volume: number) => {
    updateClip(clipId, { volume });
  };

  const handleMuteToggle = (clipId: string, currentMuted: boolean) => {
    updateClip(clipId, { muted: !currentMuted });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-border-primary sticky top-0 bg-bg-elevated z-10">
        <div className="flex items-center gap-2 mb-1">
          <svg
            className="w-5 h-5 text-accent"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
          <h3 className="text-sm font-bold text-text-primary">Audio Mixing</h3>
        </div>
        <p className="text-xs text-text-muted">Control volume and mix audio tracks</p>
      </div>

      <div className="p-4 space-y-4">
        {audioClips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg
              className="w-16 h-16 text-text-muted opacity-20 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
              />
            </svg>
            <p className="text-xs text-text-muted mb-1">No audio clips</p>
            <p className="text-[10px] text-text-muted/60">Import media with audio to mix tracks</p>
          </div>
        ) : (
          <CollapsibleSection title="Audio Tracks" defaultOpen={true}>
            <div className="space-y-3">
              {audioClips.map((clip, index) => {
                const volume = clip.volume ?? 1;
                const isMuted = clip.muted ?? false;

                return (
                  <div
                    key={clip.id}
                    className="bg-bg-secondary rounded-lg p-3 border border-border-primary hover:border-accent/30 transition"
                  >
                    {/* Clip Header */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-shrink-0">
                        {clip.mediaType === 'audio' ? (
                          <div className="w-8 h-8 bg-accent/10 rounded flex items-center justify-center">
                            <svg
                              className="w-4 h-4 text-accent"
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
                          </div>
                        ) : (
                          <div className="w-8 h-8 bg-accent/10 rounded flex items-center justify-center">
                            <svg
                              className="w-4 h-4 text-accent"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">
                          {clip.name}
                        </p>
                        <p className="text-[10px] text-text-muted">Track {index + 1}</p>
                      </div>
                      <button
                        onClick={() => handleMuteToggle(clip.id, isMuted)}
                        className={`p-1.5 rounded transition ${
                          isMuted
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-bg-elevated hover:bg-bg-surface text-text-muted hover:text-text-primary'
                        }`}
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted ? (
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                              clipRule="evenodd"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                            />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Volume Control */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">Volume</span>
                        <span className="text-accent font-bold">{Math.round(volume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={volume}
                        onChange={(e) => handleVolumeChange(clip.id, parseFloat(e.target.value))}
                        disabled={isMuted}
                        className="w-full h-2 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: `linear-gradient(to right, #1DB954 0%, #1DB954 ${volume * 100}%, #181818 ${volume * 100}%, #181818 100%)`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Audio Tips */}
        <div className="bg-bg-secondary rounded-lg p-3 border border-border-primary">
          <h4 className="text-xs font-bold text-text-primary mb-2 flex items-center gap-2">
            <span></span>
            <span>Audio Tips</span>
          </h4>
          <ul className="space-y-1.5 text-xs text-text-muted">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Adjust volume per clip for perfect mixing</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Mute tracks temporarily during editing</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Use timeline for precise audio cuts</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AudioPanel;
