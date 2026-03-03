import { useEffect, useState } from 'react';
import FilePanel from './components/FilePanel/FilePanel';
import Preview from './components/Preview/Preview';
import Timeline from './components/Timeline/Timeline';
import Toolbar from './components/Toolbar/Toolbar';
import Toast from './components/ui/Toast';
import AutoSave from './components/AutoSave';
import RightPanel from './components/ui/RightPanel';
import ChatPanel from './components/Chat/ChatPanel';
import { OnboardingWizard } from './components/Onboarding';
import { useChatStore } from './stores/useChatStore';
import { useOnboardingStore } from './stores/useOnboardingStore';
import { useProfileStore } from './stores/useProfileStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChannelAnalysisData } from './types/electron';

function App() {
  const { togglePanel, isOpen: isChatOpen, panelWidth, setPanelWidth } = useChatStore(
    useShallow((state) => ({
      togglePanel: state.togglePanel,
      isOpen: state.isOpen,
      panelWidth: state.panelWidth,
      setPanelWidth: state.setPanelWidth,
    })),
  );
  const { hasCompletedOnboarding, completeOnboarding, skipOnboarding } = useOnboardingStore(
    useShallow((state) => ({
      hasCompletedOnboarding: state.hasCompletedOnboarding,
      completeOnboarding: state.completeOnboarding,
      skipOnboarding: state.skipOnboarding,
    })),
  );
  const { profile, createProfile, setYouTubeChannel } = useProfileStore(
    useShallow((state) => ({
      profile: state.profile,
      createProfile: state.createProfile,
      setYouTubeChannel: state.setYouTubeChannel,
    })),
  );
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [isFilePanelOpen, setIsFilePanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isResizingSidePanel, setIsResizingSidePanel] = useState(false);
  const timelineHeight = isDesktop ? 180 : 160;
  const effectiveSidePanelWidth = isDesktop ? Math.max(panelWidth, 260) : window.innerWidth;
  const isSidePanelVisible = isChatOpen || isRightPanelOpen;

  // Keyboard shortcut for chat (Ctrl+K / Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        togglePanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePanel]);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isResizingSidePanel || !isDesktop) return;

    const handleMouseMove = (e: MouseEvent) => {
      const nextWidth = window.innerWidth - e.clientX;
      setPanelWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidePanel(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizingSidePanel, isDesktop, setPanelWidth]);

  const handleOnboardingComplete = (analysisData?: ChannelAnalysisData) => {
    const userId = crypto.randomUUID();
    completeOnboarding(userId, analysisData);
    
    // Create or update profile with the analysis data
    if (!profile) {
      createProfile(userId);
    }
    
    // If analysis data is available, save it to profile
    if (analysisData) {
      // Extract YouTube URL from the analysis data if available
      const channelId = analysisData.channel.id;
      const youtubeUrl = `https://www.youtube.com/channel/${channelId}`;
      setYouTubeChannel(youtubeUrl, analysisData);
    }
    
    // Link analysis to user if provided
    if (analysisData && window.electronAPI) {
      window.electronAPI.linkAnalysisToUser(userId, analysisData.channel.id);
    }
  };

  const handleOnboardingSkip = () => {
    skipOnboarding();
  };

  // Show onboarding if not completed
  if (!hasCompletedOnboarding) {
    return (
      <OnboardingWizard 
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
      />
    );
  }

  // Main Editor UI
  return (
    <div className="relative h-screen bg-bg-primary text-text-primary overflow-hidden flex">
      <Toast />
      <AutoSave />

      {/* LEFT: Vertical Icon Toolbar - 64px fixed width with premium styling */}
      <div className="w-16 bg-gradient-to-b from-bg-secondary via-bg-secondary to-bg-elevated border-r border-white/5 flex flex-col items-center py-4 gap-2 z-20 shadow-2xl">
        <Toolbar 
          onToggleFilePanel={() => setIsFilePanelOpen(!isFilePanelOpen)}
          onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
          isFilePanelOpen={isFilePanelOpen}
          isRightPanelOpen={isRightPanelOpen}
        />
      </div>

      {/* CENTER + RIGHT: Main content and full-height side panel */}
      <div className="flex-1 flex h-screen min-w-0">
        {/* CENTER: Editor column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top section: File panel + Preview */}
          <div className="flex-1 flex overflow-hidden" style={{ height: `calc(100vh - ${timelineHeight}px)` }}>
            {/* LEFT: File Panel with smooth transition */}
            {isFilePanelOpen && (
              <div className="animate-slide-in">
                <FilePanel isOpen={isFilePanelOpen} onClose={() => setIsFilePanelOpen(false)} />
              </div>
            )}

            {/* CENTER: HERO PREVIEW - Dominant area with subtle gradient */}
            <div className="flex-1 bg-gradient-to-br from-bg-primary via-bg-secondary to-bg-primary flex flex-col p-6 relative min-w-0">
              <div className="absolute inset-0 bg-gradient-to-tr from-accent/[0.02] to-transparent pointer-events-none"></div>
              <Preview />
            </div>
          </div>

          {/* BOTTOM: Timeline only in center column */}
          <div
            className="bg-gradient-to-b from-bg-secondary to-bg-elevated flex flex-col border-t border-white/5 shadow-2xl"
            style={{ height: `${timelineHeight}px` }}
          >
            <Timeline />
          </div>
        </div>

        {/* RIGHT: Full-height side panel (Chat or Tools) */}
        {isSidePanelVisible && (
          <div
            className={`relative h-full animate-slide-in-right ${isDesktop ? 'border-l border-white/5' : ''}`}
            style={{ width: isDesktop ? `${effectiveSidePanelWidth}px` : '100%' }}
          >
            {isDesktop && (
              <button
                type="button"
                aria-label="Resize side panel"
                onMouseDown={() => setIsResizingSidePanel(true)}
                className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize z-30 group"
                title="Drag to resize"
              >
                <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-white/10 group-hover:bg-accent/70 transition-colors" />
              </button>
            )}
            {isChatOpen ? (
              <div className="bg-gradient-to-b from-bg-secondary to-bg-elevated flex flex-col h-full shadow-2xl">
                <ChatPanel />
              </div>
            ) : (
              <RightPanel
                isOpen={isRightPanelOpen}
                onClose={() => setIsRightPanelOpen(false)}
                width={effectiveSidePanelWidth}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
