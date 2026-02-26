import { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { ProfileModal } from '../ui/ProfileModal';
import type { ExportFormat, ExportResolution } from '../../stores/useProjectStore';

const Toolbar = () => {
  const [showProfileModal, setShowProfileModal] = useState(false);
  const { activeClipId, currentTime, removeClip, splitClip, clips, setNotification, selectedClipIds, mergeSelectedClips, copyClips, pasteClips, saveProject, loadProject, undo, redo, canUndo, canRedo, exportFormat, exportResolution, setExportFormat, setExportResolution, subtitles, subtitleStyle } = useProjectStore();
  const { profile } = useProfileStore();
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [showResolutionMenu, setShowResolutionMenu] = useState(false);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onExportProgress) {
      window.electronAPI.onExportProgress((percent) => {
        setExportProgress(percent);
      });
    }

    // Close format menu on click outside
    const handleClickOutside = (e: MouseEvent) => {
      if (showFormatMenu && !(e.target as Element).closest('.format-menu-container')) {
        setShowFormatMenu(false);
      }
      if (showResolutionMenu && !(e.target as Element).closest('.resolution-menu-container')) {
        setShowResolutionMenu(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip all shortcuts when focus is inside an input/textarea/contenteditable
      const tag = (e.target as HTMLElement).tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      // Space bar for play/pause - prevent if typing in input
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        const { isPlaying, setIsPlaying } = useProjectStore.getState();
        setIsPlaying(!isPlaying);
        return;
      }
      if (e.key === 's' && !e.ctrlKey && activeClipId && !isExporting && !isTyping) {
        e.preventDefault();
        handleSplit();
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveProject();
      }
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        loadProject();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeClipId && !isExporting && !isTyping) {
        e.preventDefault();
        handleDelete();
      }
      if (e.key === 'm' && selectedClipIds.length >= 2 && !isExporting && !isTyping) {
        e.preventDefault();
        mergeSelectedClips();
      }
      if (e.ctrlKey && e.key === 'c' && selectedClipIds.length > 0 && !isTyping) {
        e.preventDefault();
        copyClips();
      }
      if (e.ctrlKey && e.key === 'v' && !isTyping) {
        e.preventDefault();
        pasteClips();
      }
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        undo();
      }
      if (((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) && !isTyping) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeClipId, selectedClipIds, isExporting, undo, redo, showFormatMenu, showResolutionMenu]);

  const handleSplit = () => {
    if (activeClipId) {
      splitClip(activeClipId, currentTime);
    }
  };

  const handleDelete = () => {
    if (activeClipId) {
      removeClip(activeClipId);
    }
  };

  const runExport = async (clipsToExport: any[]) => {
    const outputPath = await window.electronAPI.saveFile(exportFormat);
    if (outputPath) {
      setIsExporting(true);
      setExportProgress(0);
      try {
        const resolution = exportResolution === 'original' ? undefined : exportResolution;
        await window.electronAPI.exportVideo(clipsToExport, outputPath, exportFormat, resolution, subtitles, subtitleStyle);
        setNotification({ type: 'success', message: `Export Complete! (${exportFormat.toUpperCase()} @ ${exportResolution})` });
      } catch (error) {
        console.error(error);
        setNotification({ type: 'error', message: 'Export Failed. See console.' });
      } finally {
        setIsExporting(false);
        setExportProgress(0);
      }
    }
  };

  const handleExportProject = () => {
    if (clips.length === 0) return;
    runExport(clips);
  };

  return (
    <div className="flex items-center justify-between w-full px-3 gap-4">
      {/* Left: Project & Edit Tools */}
      <div className="flex items-center gap-1.5">
        {/* Undo/Redo Group */}
        <div className="flex items-center gap-0.5 px-1">
          <button 
            onClick={undo}
            disabled={!canUndo() || isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 p-2 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all" 
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
          </button>
          <button 
            onClick={redo}
            disabled={!canRedo() || isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 p-2 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-all" 
            title="Redo (Ctrl+Y)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"></path></svg>
          </button>
        </div>
        
        <div className="w-px h-5 bg-border-primary mx-1"></div>
        
        {/* Edit Tools Group */}
        <div className="flex items-center gap-0.5 px-1">
          <button 
            onClick={handleSplit}
            disabled={!activeClipId || isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all group" 
            title="Split Clip"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"></path></svg>
          </button>
          <button 
            onClick={handleDelete}
            disabled={!activeClipId || isExporting}
            className="text-text-muted hover:text-red-400 hover:bg-red-500/10 p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
            title="Delete Clip"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
          <button 
            onClick={mergeSelectedClips}
            disabled={selectedClipIds.length < 2 || isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
            title="Merge Selected Clips"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
          </button>
        </div>
        
        <div className="w-px h-5 bg-border-primary mx-1"></div>
        
        {/* Copy/Paste Group */}
        <div className="flex items-center gap-0.5 px-1">
          <button 
            onClick={copyClips}
            disabled={selectedClipIds.length === 0 || isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
            title="Copy"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
          </button>
          <button 
            onClick={pasteClips}
            disabled={isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 p-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
            title="Paste"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
          </button>
        </div>
      </div>
      
      {/* Center: Export Progress */}
      <div className="flex-1 flex justify-center px-4">
         {isExporting && (
             <div className="flex items-center gap-3 w-64">
                <div className="text-xs text-accent font-medium whitespace-nowrap">Exporting {Math.round(exportProgress)}%</div>
                <div className="h-2 bg-bg-elevated rounded-full flex-1 overflow-hidden border border-border-primary">
                  <div 
                    className="h-full bg-accent transition-all duration-300 shadow-lg shadow-accent/50"
                    style={{ width: `${Math.max(0, Math.min(100, exportProgress))}%` }}
                  />
                </div>
             </div>
         )}
      </div>

      {/* Right: Export Controls - Prominent Section */}
      <div className="flex items-center gap-2">
        {/* Profile Icon - Enhanced Visibility */}
        <button
          onClick={() => setShowProfileModal(true)}
          className="flex items-center gap-2 bg-bg-elevated hover:bg-accent/10 border border-border-primary hover:border-accent/30 px-3 py-1.5 rounded-lg transition-all relative group"
          title="User Profile & YouTube Channel"
        >
          {profile && profile.channelAnalysis ? (
            <>
              <div className="relative">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-bg-elevated animate-pulse"></div>
              </div>
              <span className="text-xs font-medium text-text-secondary">Profile</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-text-muted group-hover:text-accent transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs font-medium text-text-muted group-hover:text-accent transition-colors">Profile</span>
            </>
          )}
        </button>

        <div className="w-px h-5 bg-border-primary"></div>

        {/* Export Controls */}
        <div className="flex items-center gap-2 bg-accent/5 border border-accent/20 rounded-lg px-3 py-1">
        {/* Resolution Selector */}
        <div className="relative resolution-menu-container">
          <button
            onClick={() => setShowResolutionMenu(!showResolutionMenu)}
            disabled={isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 text-xs font-medium transition px-2 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            title="Export resolution"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-[11px]">{exportResolution === 'original' ? 'Original' : exportResolution}</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showResolutionMenu && (
            <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-primary rounded shadow-xl py-1 z-50 min-w-[120px]"
            >
              {([{ label: 'Original', value: 'original' }, { label: '1080p', value: '1920x1080' }, { label: '720p', value: '1280x720' }, { label: '480p', value: '854x480' }] as { label: string; value: ExportResolution }[]).map((res) => (
                <button
                  key={res.value}
                  onClick={() => {
                    setExportResolution(res.value);
                    setShowResolutionMenu(false);
                    setNotification({ type: 'success', message: `Resolution: ${res.label}` });
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-between text-text-secondary"
                >
                  <span>{res.label}</span>
                  {exportResolution === res.value && (
                    <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Export Format Selector */}
        <div className="relative format-menu-container">
          <button
            onClick={() => setShowFormatMenu(!showFormatMenu)}
            disabled={isExporting}
            className="text-text-muted hover:text-accent hover:bg-accent/10 text-xs font-medium uppercase transition px-2 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            title="Export format"
          >
            <span className="text-[11px]">{exportFormat.toUpperCase()}</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showFormatMenu && (
            <div className="absolute bottom-full right-0 mb-2 bg-bg-elevated border border-border-primary rounded shadow-xl py-1 z-50 min-w-[100px]">
              {(['mp4', 'mov', 'avi', 'webm'] as ExportFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => {
                    setExportFormat(format);
                    setShowFormatMenu(false);
                    setNotification({ type: 'success', message: `Export format: ${format.toUpperCase()}` });
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent/10 hover:text-accent transition-colors flex items-center justify-between text-text-secondary"
                >
                  <span>{format.toUpperCase()}</span>
                  {exportFormat === format && (
                    <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        
        <div className="w-px h-5 bg-border-primary"></div>

        <button 
          onClick={handleExportProject}
          disabled={clips.length === 0 || isExporting}
          className="bg-accent hover:bg-accent-hover text-white px-4 py-1.5 rounded text-xs font-bold transition disabled:opacity-50 disabled:bg-bg-surface disabled:text-text-muted shadow-lg shadow-accent/20" 
          title="Export entire timeline"
        >
           Export Project
        </button>
        </div>
      </div>

      {/* Profile Modal */}
      <ProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} />
    </div>
  );
};

export default Toolbar;
