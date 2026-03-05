import { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { useShallow } from 'zustand/react/shallow';
import { ProfileModal } from '../ui/ProfileModal';
import type { SidebarTab } from '../ui/SidebarNav';

interface ToolbarProps {
  onToggleFilePanel?: () => void;
  onToggleRightPanel?: () => void;
  isFilePanelOpen?: boolean;
  isRightPanelOpen?: boolean;
  activeTab?: SidebarTab;
  onTabChange?: (tab: SidebarTab) => void;
}

const Toolbar = ({
  onToggleRightPanel,
  isRightPanelOpen = false,
  activeTab = 'media',
  onTabChange,
}: ToolbarProps = {}) => {
  const [showProfileModal, setShowProfileModal] = useState(false);
  const {
    activeClipId,
    currentTime,
    removeClip,
    splitClip,
    clips,
    setNotification,
    selectedClipIds,
    mergeSelectedClips,
    copyClips,
    pasteClips,
    saveProject,
    loadProject,
    undo,
    redo,
    exportFormat,
    exportResolution,
    subtitles,
    subtitleStyle,
    setExportedVideoPath,
  } = useProjectStore(
    useShallow((state) => ({
      activeClipId: state.activeClipId,
      currentTime: state.currentTime,
      removeClip: state.removeClip,
      splitClip: state.splitClip,
      clips: state.clips,
      setNotification: state.setNotification,
      selectedClipIds: state.selectedClipIds,
      mergeSelectedClips: state.mergeSelectedClips,
      copyClips: state.copyClips,
      pasteClips: state.pasteClips,
      saveProject: state.saveProject,
      loadProject: state.loadProject,
      undo: state.undo,
      redo: state.redo,
      exportFormat: state.exportFormat,
      exportResolution: state.exportResolution,
      subtitles: state.subtitles,
      subtitleStyle: state.subtitleStyle,
      setExportedVideoPath: state.setExportedVideoPath,
    })),
  );
  const profile = useProfileStore((state) => state.profile);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [showResolutionMenu, setShowResolutionMenu] = useState(false);

  useEffect(() => {
    let unsubscribeExportProgress: (() => void) | undefined;
    if (window.electronAPI && window.electronAPI.onExportProgress) {
      unsubscribeExportProgress = window.electronAPI.onExportProgress((percent) => {
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
        splitClip(activeClipId, currentTime);
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveProject();
      }
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        loadProject();
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        activeClipId &&
        !isExporting &&
        !isTyping
      ) {
        e.preventDefault();
        removeClip(activeClipId);
      }
      if (e.key === 'm' && selectedClipIds.length >= 2 && !isExporting && !isTyping) {
        e.preventDefault();
        mergeSelectedClips();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'c' &&
        selectedClipIds.length > 0 &&
        !isTyping &&
        !isInChatPanel &&
        !hasTextSelection
      ) {
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
      if (
        ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) &&
        !isTyping
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribeExportProgress?.();
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [
    activeClipId,
    copyClips,
    currentTime,
    isExporting,
    loadProject,
    mergeSelectedClips,
    pasteClips,
    redo,
    removeClip,
    saveProject,
    selectedClipIds,
    showFormatMenu,
    showResolutionMenu,
    splitClip,
    undo,
  ]);

  const runExport = async (clipsToExport: typeof clips) => {
    const outputPath = await window.electronAPI.saveFile(exportFormat);
    if (outputPath) {
      setIsExporting(true);
      setExportProgress(0);
      try {
        const resolution = exportResolution === 'original' ? undefined : exportResolution;
        await window.electronAPI.exportVideo(
          clipsToExport,
          outputPath,
          exportFormat,
          resolution,
          subtitles,
          subtitleStyle,
        );
        setExportedVideoPath(outputPath); // Save the exported video path
        setNotification({
          type: 'success',
          message: `Export Complete! (${exportFormat.toUpperCase()} @ ${exportResolution})`,
        });
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

  const tabItems: { id: SidebarTab; label: string; icon: React.ReactElement }[] = [
    {
      id: 'media',
      label: 'Media',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      id: 'text',
      label: 'Text',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      ),
    },
    {
      id: 'project',
      label: 'Project',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      ),
    },
    {
      id: 'memory',
      label: 'Memory',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col items-center gap-0 w-full h-full justify-between pb-2 pt-1">
      {/* Top: Tab Navigation */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        {/* Divider */}
        <div className="w-8 h-px bg-white/8 my-1.5" />

        {/* Tab Icons */}
        {tabItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange?.(item.id)}
              className={`w-full flex flex-col items-center justify-center py-2.5 px-1 gap-1 transition-all duration-150 relative group ${
                isActive ? 'text-accent' : 'text-text-muted hover:text-text-primary'
              }`}
              title={item.label}
            >
              {/* Active background */}
              {isActive && (
                <div className="absolute inset-x-1.5 inset-y-0.5 bg-accent/8 rounded-lg" />
              )}
              {/* Hover background */}
              {!isActive && (
                <div className="absolute inset-x-1.5 inset-y-0.5 bg-white/0 group-hover:bg-white/4 rounded-lg transition-colors" />
              )}
              {/* Left border indicator */}
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r-full" />
              )}
              <div
                className={`relative z-10 transition-transform duration-150 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`}
              >
                {item.icon}
              </div>
              <span
                className={`text-[9px] font-medium leading-none relative z-10 tracking-wide ${isActive ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'}`}
              >
                {item.label}
              </span>
            </button>
          );
        })}

        <div className="w-8 h-px bg-white/8 mt-1.5" />
      </div>

      {/* Middle: Export Progress */}
      {isExporting && (
        <div className="flex flex-col items-center gap-2 w-full px-2 animate-fade-in">
          <div className="w-full h-0.5 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, exportProgress))}%` }}
            />
          </div>
          <div className="text-[9px] text-accent font-bold">{Math.round(exportProgress)}%</div>
        </div>
      )}

      {/* Bottom: Settings + Profile + Export */}
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Tools Panel Toggle */}
        <button
          onClick={onToggleRightPanel}
          className={`w-full flex flex-col items-center justify-center py-2.5 px-1 gap-1 transition-all duration-150 relative group ${
            isRightPanelOpen ? 'text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
          title="Tools Panel"
        >
          {isRightPanelOpen && (
            <div className="absolute inset-x-1.5 inset-y-0.5 bg-accent/8 rounded-lg" />
          )}
          {!isRightPanelOpen && (
            <div className="absolute inset-x-1.5 inset-y-0.5 bg-white/0 group-hover:bg-white/4 rounded-lg transition-colors" />
          )}
          {isRightPanelOpen && (
            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r-full" />
          )}
          <svg
            className="w-5 h-5 relative z-10"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
            />
          </svg>
          <span
            className={`text-[9px] font-medium leading-none relative z-10 tracking-wide ${
              isRightPanelOpen ? 'text-accent' : 'text-text-muted group-hover:text-text-secondary'
            }`}
          >
            Tools
          </span>
        </button>

        <div className="w-8 h-px bg-white/8 my-0.5" />

        {/* Settings */}
        <button
          onClick={() => onTabChange?.('settings')}
          className={`w-full flex flex-col items-center justify-center py-2.5 px-1 gap-1 transition-all duration-150 relative group ${
            activeTab === 'settings' ? 'text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
          title="Settings"
        >
          {activeTab === 'settings' && (
            <div className="absolute inset-x-1.5 inset-y-0.5 bg-accent/8 rounded-lg" />
          )}
          {activeTab !== 'settings' && (
            <div className="absolute inset-x-1.5 inset-y-0.5 bg-white/0 group-hover:bg-white/4 rounded-lg transition-colors" />
          )}
          {activeTab === 'settings' && (
            <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r-full" />
          )}
          <svg
            className="w-4.5 h-4.5 relative z-10"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span
            className={`text-[9px] font-medium leading-none relative z-10 ${activeTab === 'settings' ? 'text-accent' : 'text-text-muted'}`}
          >
            Settings
          </span>
        </button>

        <div className="w-8 h-px bg-white/8 my-0.5" />

        {/* Profile */}
        <button
          onClick={() => setShowProfileModal(true)}
          className="w-9 h-9 flex items-center justify-center hover:bg-white/5 rounded-lg transition-all duration-150 relative group"
          title="Profile"
        >
          <svg
            className="w-4.5 h-4.5 text-text-muted group-hover:text-text-primary transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          {profile?.channelAnalysis && (
            <div className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-accent rounded-full border border-bg-secondary" />
          )}
        </button>

        {/* Export */}
        <button
          onClick={handleExportProject}
          disabled={clips.length === 0 || isExporting}
          className="w-full flex flex-col items-center justify-center gap-1 py-2 px-1 bg-accent hover:bg-accent-hover text-white rounded-lg transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed shadow-lg shadow-accent/20 btn-glow group"
          title="Export Project"
        >
          <svg
            className="w-4 h-4 group-hover:translate-y-0.5 transition-transform duration-150"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          <span className="text-[9px] font-semibold leading-none">Export</span>
        </button>
      </div>

      {/* Profile Modal */}
      <ProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} />
    </div>
  );
};

export default Toolbar;
