import { useState } from 'react';
import type { ReactNode } from 'react';
import CaptionsPanel from './CaptionsPanel';
import TranscriptionPanel from './TranscriptionPanel';
import AudioPanel from './AudioPanel';
import EffectsPanel from './EffectsPanel';
import ExportSettingsPanel from './ExportSettingsPanel';
import PublishPanel from './PublishPanel';

type PanelTab = 'captions' | 'transcript' | 'audio' | 'effects' | 'export' | 'publish';

interface RightPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  width?: number;
}

const RightPanel = ({ isOpen = true, onClose, width = 320 }: RightPanelProps) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('captions');

  if (!isOpen) return null;

  const tabs: { id: PanelTab; label: string; icon: ReactNode }[] = [
    {
      id: 'captions',
      label: 'Captions',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
      ),
    },
    {
      id: 'transcript',
      label: 'Transcript',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      id: 'audio',
      label: 'Audio',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
      ),
    },
    {
      id: 'effects',
      label: 'Effects',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
    {
      id: 'export',
      label: 'Export',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3 3m0 0l-3-3m3 3V10" />
        </svg>
      ),
    },
    {
      id: 'publish',
      label: 'Publish',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className="bg-gradient-to-b from-bg-elevated to-bg-secondary border-l border-white/5 flex flex-col h-full shadow-2xl"
      style={{ width: `${Math.max(240, width)}px` }}
    >
      {/* Header with tabs */}
      <div className="border-b border-white/5 bg-bg-secondary/80 backdrop-blur-xl">
        <div className="flex items-center justify-between p-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-1 bg-gradient-to-b from-accent to-accent/50 rounded-full"></div>
            <h3 className="text-sm font-bold text-text-primary">Tools</h3>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex px-1 py-1.5 gap-0.5" role="tablist" aria-label="Tool panels">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-label={tab.label}
              className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 px-1 rounded-lg transition-all duration-200 relative ${
                activeTab === tab.id
                  ? 'text-accent bg-gradient-to-b from-bg-elevated to-bg-surface shadow-lg scale-105'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated/50 hover:scale-105'
              }`}
              title={tab.label}
            >
              {activeTab === tab.id && (
                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent rounded-full"></div>
              )}
              <div className={`transition-all duration-200 ${activeTab === tab.id ? 'scale-110' : ''}`}>
                {tab.icon}
              </div>
              <span className={`text-[10px] font-medium transition-all duration-200 ${activeTab === tab.id ? 'font-semibold' : ''}`}>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'captions' && <CaptionsPanel />}
        {activeTab === 'transcript' && <TranscriptionPanel />}
        {activeTab === 'audio' && <AudioPanel />}
        {activeTab === 'effects' && <EffectsPanel />}
        {activeTab === 'export' && <ExportSettingsPanel />}
        {activeTab === 'publish' && <PublishPanel />}
      </div>
    </div>
  );
};

export default RightPanel;
