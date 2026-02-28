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
import type { ChannelAnalysisData } from './types/electron';

function App() {
  const { togglePanel, isOpen: isChatOpen } = useChatStore();
  const { hasCompletedOnboarding, completeOnboarding, skipOnboarding } = useOnboardingStore();
  const { profile, createProfile, setYouTubeChannel } = useProfileStore();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [isFilePanelOpen, setIsFilePanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);

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

      {/* CENTER: Main content area */}
      <div className="flex-1 flex flex-col h-screen">
        {/* Top section: Panels + Preview + AI Chat */}
        <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 240px)' }}>
          
          {/* LEFT: File Panel with smooth transition */}
          {isFilePanelOpen && (
            <div className="animate-slide-in">
              <FilePanel isOpen={isFilePanelOpen} onClose={() => setIsFilePanelOpen(false)} />
            </div>
          )}

          {/* CENTER: HERO PREVIEW - Dominant area with subtle gradient */}
          <div className="flex-1 bg-gradient-to-br from-bg-primary via-bg-secondary to-bg-primary flex flex-col p-6 relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-accent/[0.02] to-transparent pointer-events-none"></div>
            <Preview />
          </div>

          {/* RIGHT: AI Chat Panel - Native integration with smooth transition */}
          {isChatOpen && (
            <div 
              className="bg-gradient-to-b from-bg-secondary to-bg-elevated flex flex-col h-full shadow-2xl border-l border-white/5 animate-slide-in-right"
              style={{ width: isDesktop ? '420px' : '100%' }}
            >
              <ChatPanel />
            </div>
          )}

          {/* RIGHT: Tools Panel with smooth transition */}
          {isRightPanelOpen && !isChatOpen && (
            <div className="animate-slide-in-right">
              <RightPanel isOpen={isRightPanelOpen} onClose={() => setIsRightPanelOpen(false)} />
            </div>
          )}
        </div>

        {/* BOTTOM: Timeline - Fixed height, full width with premium styling */}
        <div 
          className="bg-gradient-to-b from-bg-secondary to-bg-elevated flex flex-col border-t border-white/5 shadow-2xl"
          style={{ height: '240px' }}
        >
          <Timeline />
        </div>
      </div>
    </div>
  );
}

export default App;
