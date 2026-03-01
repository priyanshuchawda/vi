import { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { useChatStore } from '../../stores/useChatStore';
import { ProfileModal } from '../ui/ProfileModal';

interface ToolbarProps {
  onToggleFilePanel?: () => void;
  onToggleRightPanel?: () => void;
  isFilePanelOpen?: boolean;
  isRightPanelOpen?: boolean;
}

const Toolbar = ({ 
  onToggleFilePanel, 
  onToggleRightPanel,
  isFilePanelOpen = false,
  isRightPanelOpen = false
}: ToolbarProps = {}) => {
  const [showProfileModal, setShowProfileModal] = useState(false);
  const { activeClipId, currentTime, removeClip, splitClip, clips, setNotification, selectedClipIds, mergeSelectedClips, copyClips, pasteClips, saveProject, loadProject, undo, redo, exportFormat, exportResolution, subtitles, subtitleStyle, setExportedVideoPath } = useProjectStore();
  const { profile } = useProfileStore();
  const { togglePanel, isOpen: isChatOpen } = useChatStore();
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
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName || '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
      const isInChatPanel = Boolean(target?.closest('[data-chat-panel="true"]'));
      const hasTextSelection = Boolean(window.getSelection()?.toString().trim());

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedClipIds.length > 0 && !isTyping && !isInChatPanel && !hasTextSelection) {
        e.preventDefault();
        copyClips();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !isTyping && !isInChatPanel) {
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
        setExportedVideoPath(outputPath); // Save the exported video path
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
    <div className="flex flex-col items-center gap-3 w-full h-full justify-between py-2">
      {/* Top Section: Primary Tools */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* AI Chat Toggle */}
        <button 
          onClick={togglePanel}
          className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 group relative ${
            isChatOpen 
              ? 'bg-gradient-to-br from-accent to-accent-hover text-white shadow-lg shadow-accent/30 scale-105' 
              : 'text-text-muted hover:text-accent hover:bg-accent/10 hover:scale-110 active:scale-95'
          }`}
          title="AI Copilot (Ctrl+K)"
        >
          <svg className={`w-5 h-5 transition-transform duration-200 ${isChatOpen ? 'scale-110' : 'group-hover:scale-110'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <div className="absolute left-full ml-3 px-3 py-2 bg-bg-elevated/95 backdrop-blur-sm text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg border border-white/10 transition-opacity duration-200">
            <span className="text-text-primary font-medium">AI Copilot</span>
            <kbd className="ml-2">Ctrl+K</kbd>
          </div>
        </button>

        <div className="w-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

        {/* Media Library Toggle */}
        {onToggleFilePanel && (
          <button 
            onClick={onToggleFilePanel}
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 group relative ${
              isFilePanelOpen 
                ? 'bg-gradient-to-br from-accent to-accent-hover text-white shadow-lg shadow-accent/30 scale-105' 
                : 'text-text-muted hover:text-accent hover:bg-accent/10 hover:scale-110 active:scale-95'
            }`}
            title="Media Library"
          >
            <svg className={`w-5 h-5 transition-transform duration-200 ${isFilePanelOpen ? 'scale-110' : 'group-hover:scale-110'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <div className="absolute left-full ml-3 px-3 py-2 bg-bg-elevated/95 backdrop-blur-sm text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg border border-white/10 transition-opacity duration-200">
              <span className="text-text-primary font-medium">Media Library</span>
            </div>
          </button>
        )}

        {/* Tools Panel Toggle */}
        {onToggleRightPanel && (
          <button 
            onClick={onToggleRightPanel}
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-200 group relative ${
              isRightPanelOpen 
                ? 'bg-gradient-to-br from-accent to-accent-hover text-white shadow-lg shadow-accent/30 scale-105' 
                : 'text-text-muted hover:text-accent hover:bg-accent/10 hover:scale-110 active:scale-95'
            }`}
            title="Tools Panel"
          >
            <svg className={`w-5 h-5 transition-transform duration-200 ${isRightPanelOpen ? 'scale-110' : 'group-hover:scale-110'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <div className="absolute left-full ml-3 px-3 py-2 bg-bg-elevated/95 backdrop-blur-sm text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg border border-white/10 transition-opacity duration-200">
              <span className="text-text-primary font-medium">Tools Panel</span>
            </div>
          </button>
        )}

        <div className="w-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
      </div>

      {/* Middle Section: Export Progress */}
      {isExporting && (
        <div className="flex flex-col items-center gap-2 w-full px-2 animate-fade-in">
          <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-gradient-to-r from-accent to-accent-hover transition-all duration-300 shadow-lg shadow-accent/50"
              style={{ width: `${Math.max(0, Math.min(100, exportProgress))}%` }}
            />
          </div>
          <div className="text-[10px] text-accent font-bold animate-pulse-glow">{Math.round(exportProgress)}%</div>
        </div>
      )}

      {/* Bottom Section: Export & Profile */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Profile */}
        <button
          onClick={() => setShowProfileModal(true)}
          className="w-11 h-11 flex items-center justify-center hover:bg-accent/10 rounded-xl transition-all duration-200 group relative hover:scale-110 active:scale-95"
          title="Profile"
        >
          {profile && profile.channelAnalysis ? (
            <div className="relative">
              <svg className="w-5 h-5 text-accent transition-transform duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-gradient-to-br from-green-400 to-green-600 rounded-full border-2 border-bg-secondary shadow-lg shadow-green-500/50"></div>
            </div>
          ) : (
            <svg className="w-5 h-5 text-text-muted group-hover:text-accent transition-all duration-200 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          )}
          <div className="absolute left-full ml-3 px-3 py-2 bg-bg-elevated/95 backdrop-blur-sm text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg border border-white/10 transition-opacity duration-200">
            <span className="text-text-primary font-medium">Profile</span>
          </div>
        </button>

        <div className="w-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent my-1"></div>

        {/* Export Button */}
        <button 
          onClick={handleExportProject}
          disabled={clips.length === 0 || isExporting}
          className="w-11 h-11 flex items-center justify-center bg-gradient-to-br from-accent to-accent-hover hover:from-accent-hover hover:to-accent text-white rounded-xl transition-all duration-200 disabled:opacity-30 disabled:from-bg-surface disabled:to-bg-surface disabled:text-text-muted shadow-lg shadow-accent/30 hover:shadow-accent/50 group relative hover:scale-110 active:scale-95 disabled:hover:scale-100 disabled:shadow-none" 
          title="Export Project"
        >
          <svg className="w-5 h-5 transition-transform duration-200 group-hover:scale-110 group-hover:translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <div className="absolute left-full ml-3 px-3 py-2 bg-bg-elevated/95 backdrop-blur-sm text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-lg border border-white/10 transition-opacity duration-200">
            <div className="text-text-primary font-medium">Export</div>
            <div className="text-text-muted text-[10px] mt-0.5">{exportFormat.toUpperCase()} @ {exportResolution === 'original' ? 'Original' : exportResolution}</div>
          </div>
        </button>
      </div>

      {/* Profile Modal */}
      <ProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} />
    </div>
  );
};

export default Toolbar;
