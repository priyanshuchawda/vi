import { useEffect } from 'react';
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
  const { togglePanel } = useChatStore();
  const { hasCompletedOnboarding, completeOnboarding, skipOnboarding } = useOnboardingStore();
  const { profile, createProfile, setYouTubeChannel } = useProfileStore();

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
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden">
      <Toast />
      <AutoSave />
      <ChatPanel />
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - File Panel */}
        <div className="w-1/4 min-w-[250px] border-r border-[#262626] flex flex-col bg-bg-secondary">
          <FilePanel />
        </div>

        {/* Main Preview Area */}
        <div className="flex-1 bg-bg-primary flex flex-col border-r border-[#262626]">
          <Preview />
        </div>

        {/* Right Panel with Subtitles & Edit by Text */}
        <RightPanel />
      </div>

      {/* Toolbar */}
      <div className="h-12 border-y border-[#262626] bg-bg-elevated flex items-center px-4 shadow-lg">
        <Toolbar />
      </div>

      {/* Timeline Area */}
      <div className="h-1/3 min-h-[200px] bg-bg-secondary flex flex-col border-t border-[#262626]">
        <Timeline />
      </div>
    </div>
  );
}

export default App;