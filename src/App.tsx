import { lazy, Suspense, useEffect, useRef, useState, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import Preview from './components/Preview/Preview';
import Timeline from './components/Timeline/Timeline';
import Toolbar from './components/Toolbar/Toolbar';
import Toast from './components/ui/Toast';
import AutoSave from './components/AutoSave';
import { useChatStore } from './stores/useChatStore';
import { usePublishStore } from './stores/usePublishStore';
import { useOnboardingStore } from './stores/useOnboardingStore';
import { useProjectStore } from './stores/useProjectStore';
import { useProfileStore } from './stores/useProfileStore';
import { useShallow } from 'zustand/react/shallow';
import type { ChannelAnalysisData } from './types/electron';
import type { SidebarTab } from './components/ui/SidebarNav';
import { AppLogo } from './components/ui/AppLogo';
import { requiresInitialSetup } from './lib/setupRequirements';

const FilePanel = lazy(() => import('./components/FilePanel/FilePanel'));
const RightPanel = lazy(() => import('./components/ui/RightPanel'));
const ChatPanel = lazy(() => import('./components/Chat/ChatPanel'));
const OnboardingWizard = lazy(() =>
  import('./components/Onboarding').then((module) => ({ default: module.OnboardingWizard })),
);

const panelFallback = <div className="h-full w-full animate-pulse bg-bg-secondary/50" />;

// Error boundary for ChatPanel — prevents a render crash from wiping the whole UI
class ChatErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(_err: Error, info: ErrorInfo) {
    console.error('[ChatPanel] Render error:', _err, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <p className="text-sm text-text-muted">Chat encountered an error.</p>
          <button
            className="px-3 py-1.5 text-xs rounded-md bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
const DESKTOP_TIMELINE_DEFAULT_HEIGHT = 250;
const MOBILE_TIMELINE_HEIGHT = 160;
const TIMELINE_MIN_HEIGHT = 140;

function App() {
  const {
    togglePanel,
    isOpen: isChatOpen,
    setIsOpen: setChatOpen,
    panelWidth,
    setPanelWidth,
  } = useChatStore(
    useShallow((state) => ({
      togglePanel: state.togglePanel,
      isOpen: state.isOpen,
      setIsOpen: state.setIsOpen,
      panelWidth: state.panelWidth,
      setPanelWidth: state.setPanelWidth,
    })),
  );
  const { isPublishPanelRequested, clearPublishRequest } = usePublishStore(
    useShallow((state) => ({
      isPublishPanelRequested: state.isPublishPanelRequested,
      clearPublishRequest: state.clearPublishRequest,
    })),
  );
  const {
    hasCompletedOnboarding,
    onboardingUserId,
    completeOnboarding,
    resetOnboarding,
    skipOnboarding,
  } = useOnboardingStore(
    useShallow((state) => ({
      hasCompletedOnboarding: state.hasCompletedOnboarding,
      onboardingUserId: state.userId,
      completeOnboarding: state.completeOnboarding,
      resetOnboarding: state.resetOnboarding,
      skipOnboarding: state.skipOnboarding,
    })),
  );
  const { profile, hydrateProfileFromCloud } = useProfileStore(
    useShallow((state) => ({
      profile: state.profile,
      hydrateProfileFromCloud: state.hydrateProfileFromCloud,
    })),
  );
  const { undo, redo, canUndo, canRedo, hasUnsavedChanges } = useProjectStore(
    useShallow((state) => ({
      undo: state.undo,
      redo: state.redo,
      canUndo: state.canUndo(),
      canRedo: state.canRedo(),
      hasUnsavedChanges: state.hasUnsavedChanges,
    })),
  );
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const [isFilePanelOpen, setIsFilePanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>('media');
  const [rightPanelInitialTab, setRightPanelInitialTab] = useState<string | undefined>(undefined);
  const [isResizingSidePanel, setIsResizingSidePanel] = useState(false);
  const [isResizingTimeline, setIsResizingTimeline] = useState(false);
  const [desktopTimelineHeight, setDesktopTimelineHeight] = useState(
    DESKTOP_TIMELINE_DEFAULT_HEIGHT,
  );
  const [setupState, setSetupState] = useState<'checking' | 'required' | 'ready'>('checking');
  const onboardingSessionStartedRef = useRef(false);
  const attemptedCloudProfileHydrationRef = useRef<string | null>(null);
  const timelineMaxHeight = Math.floor(window.innerHeight * (isDesktop ? 0.6 : 0.5));
  const timelineHeight = isDesktop
    ? Math.min(Math.max(desktopTimelineHeight, TIMELINE_MIN_HEIGHT), timelineMaxHeight)
    : MOBILE_TIMELINE_HEIGHT;
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

  // When the AI signals "publish intent", close the chat and open the Publish tab
  useEffect(() => {
    if (!isPublishPanelRequested) return;
    setChatOpen(false);
    setIsRightPanelOpen(true);
    setRightPanelInitialTab('publish');
    clearPublishRequest();
  }, [isPublishPanelRequested, setChatOpen, clearPublishRequest]);

  useEffect(() => {
    if (setupState !== 'ready') return;
    const idle = window.requestIdleCallback?.(() => {
      void import('./components/Chat/ChatPanel');
      void import('./components/ui/RightPanel');
      void import('./components/FilePanel/FilePanel');
    });
    return () => {
      if (idle && window.cancelIdleCallback) {
        window.cancelIdleCallback(idle);
      }
    };
  }, [setupState]);

  useEffect(() => {
    let isActive = true;

    const checkSetupRequirements = async () => {
      try {
        const knownUserId = profile?.userId ?? onboardingUserId;
        let effectiveProfile = profile;

        if (
          knownUserId &&
          !effectiveProfile?.userName?.trim() &&
          attemptedCloudProfileHydrationRef.current !== knownUserId
        ) {
          attemptedCloudProfileHydrationRef.current = knownUserId;
          const hydrated = await hydrateProfileFromCloud(knownUserId);
          if (!isActive) return;
          if (hydrated) {
            effectiveProfile = useProfileStore.getState().profile;
          }
        }

        const aiStatus = await window.electronAPI.aiConfig.getStatus();
        if (!isActive) return;

        const needsSetup = requiresInitialSetup(effectiveProfile, aiStatus);

        if (needsSetup) {
          onboardingSessionStartedRef.current = true;
          setSetupState('required');
          if (hasCompletedOnboarding) {
            resetOnboarding();
          }
          return;
        }

        if (onboardingSessionStartedRef.current && !hasCompletedOnboarding) {
          setSetupState('required');
          return;
        }

        setSetupState('ready');

        if (!hasCompletedOnboarding && effectiveProfile?.userId) {
          completeOnboarding(effectiveProfile.userId, effectiveProfile.channelAnalysis);
        }
      } catch (error) {
        console.warn('[App] Failed to verify setup requirements:', error);
        setSetupState(profile?.userName?.trim() ? 'ready' : 'required');
      }
    };

    void checkSetupRequirements();

    return () => {
      isActive = false;
    };
  }, [
    completeOnboarding,
    hasCompletedOnboarding,
    hydrateProfileFromCloud,
    onboardingUserId,
    profile,
    resetOnboarding,
  ]);

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

  useEffect(() => {
    if (!isResizingTimeline || !isDesktop) return;

    const handleMouseMove = (e: MouseEvent) => {
      const nextHeight = window.innerHeight - e.clientY;
      const clampedHeight = Math.min(Math.max(nextHeight, TIMELINE_MIN_HEIGHT), timelineMaxHeight);
      setDesktopTimelineHeight(clampedHeight);
    };

    const handleMouseUp = () => {
      setIsResizingTimeline(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizingTimeline, isDesktop, timelineMaxHeight]);

  const handleOnboardingComplete = (userId: string, analysisData?: ChannelAnalysisData) => {
    completeOnboarding(userId, analysisData);
  };

  const handleOnboardingSkip = () => {
    skipOnboarding();
  };

  if (setupState === 'checking') {
    return panelFallback;
  }

  if (setupState === 'required') {
    return (
      <Suspense fallback={panelFallback}>
        <OnboardingWizard onComplete={handleOnboardingComplete} onSkip={handleOnboardingSkip} />
      </Suspense>
    );
  }

  // Main Editor UI
  return (
    <div className="relative h-screen bg-bg-primary text-text-primary overflow-hidden flex flex-col">
      <Toast />
      <AutoSave />

      {/* TOP BAR */}
      <div className="h-11 flex-shrink-0 bg-bg-secondary panel-border-b flex items-center px-3 gap-0 z-30">
        {/* Brand */}
        <div
          className="flex items-center pr-4 mr-1"
          style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}
        >
          <AppLogo
            size={22}
            showWordmark
            className="gap-2.5"
            iconClassName="rounded-md"
            nameClassName="text-[12px]"
            wordmarkClassName="leading-none"
          />
        </div>

        {/* Project name + autosave */}
        <div className="flex items-center gap-2 px-3 flex-1 min-w-0">
          <span className="text-[12px] text-text-secondary truncate">Untitled Project</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasUnsavedChanges ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                <span className="text-[10px] text-text-muted">Unsaved</span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="text-[10px] text-text-muted">Saved</span>
              </>
            )}
          </div>
        </div>

        {/* Center: Undo / Redo — grouped pill */}
        <div className="flex items-center bg-bg-elevated rounded-lg overflow-hidden border border-white/5 mr-3">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-white/8 disabled:opacity-25 disabled:cursor-not-allowed transition-colors border-r border-white/5"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-white/8 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
              />
            </svg>
          </button>
        </div>

        {/* Right: AI Editor */}
        <div className="flex items-center gap-2">
          <button
            onClick={togglePanel}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              isChatOpen
                ? 'bg-accent text-white shadow-md shadow-accent/25'
                : 'bg-bg-elevated border border-white/8 text-text-secondary hover:text-text-primary hover:border-white/15'
            }`}
            title="AI Editor (Ctrl+K)"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            AI Editor
          </button>
        </div>
      </div>

      {/* BODY: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT: Vertical Icon Toolbar */}
        <div className="w-[62px] bg-bg-secondary panel-border-r flex flex-col items-center py-2 gap-1 z-20 flex-shrink-0">
          <Toolbar
            onToggleFilePanel={() => setIsFilePanelOpen(!isFilePanelOpen)}
            onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
            isFilePanelOpen={isFilePanelOpen}
            isRightPanelOpen={isRightPanelOpen}
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setIsFilePanelOpen(true);
            }}
          />
        </div>

        {/* CENTER + RIGHT: Main content and full-height side panel */}
        <div className="flex-1 flex h-full min-w-0">
          {/* CENTER: Editor column */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top section: File panel + Preview */}
            <div
              className="flex-1 flex overflow-hidden"
              style={{ height: `calc(100% - ${timelineHeight}px)` }}
            >
              {/* LEFT: File Panel with smooth transition */}
              {isFilePanelOpen && (
                <div className="animate-slide-in h-full">
                  <Suspense fallback={panelFallback}>
                    <FilePanel
                      isOpen={isFilePanelOpen}
                      onClose={() => setIsFilePanelOpen(false)}
                      activeTab={activeTab}
                      onTabChange={setActiveTab}
                    />
                  </Suspense>
                </div>
              )}

              {/* CENTER: HERO PREVIEW */}
              <div className="flex-1 bg-bg-primary flex flex-col relative min-w-0">
                <Preview />
              </div>
            </div>

            {/* BOTTOM: Timeline only in center column */}
            {isDesktop && (
              <button
                type="button"
                aria-label="Resize timeline height"
                onMouseDown={() => setIsResizingTimeline(true)}
                className="relative h-1.5 z-20 cursor-row-resize group flex-shrink-0"
                title="Drag to resize timeline"
              >
                <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] bg-white/10 group-hover:bg-accent/70 transition-colors" />
              </button>
            )}
            <div
              className="bg-bg-secondary flex flex-col panel-border-t flex-shrink-0"
              style={{ height: `${timelineHeight}px` }}
            >
              <Timeline />
            </div>
          </div>

          {/* RIGHT: Full-height side panel (Chat or Tools) */}
          {isSidePanelVisible && (
            <div
              className={`relative h-full animate-slide-in-right ${isDesktop ? 'panel-border-r' : ''}`}
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
                <div className="bg-bg-secondary flex flex-col h-full">
                  <ChatErrorBoundary>
                    <Suspense fallback={panelFallback}>
                      <ChatPanel />
                    </Suspense>
                  </ChatErrorBoundary>
                </div>
              ) : (
                <Suspense fallback={panelFallback}>
                  <RightPanel
                    isOpen={isRightPanelOpen}
                    onClose={() => setIsRightPanelOpen(false)}
                    width={effectiveSidePanelWidth}
                    initialTab={rightPanelInitialTab}
                    onInitialTabConsumed={() => setRightPanelInitialTab(undefined)}
                  />
                </Suspense>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
