import { useState } from 'react';
import SidebarNav, { type SidebarTab } from '../ui/SidebarNav';
import ProjectTab from './ProjectTab';
import MediaTab from './MediaTab';
import TextTab from './TextTab';
import SettingsTab from './SettingsTab';
import AIMemoryPanel from '../AIMemory/AIMemoryPanel';

interface FilePanelProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const FilePanel = ({ isOpen = true, onClose }: FilePanelProps) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('media');

  if (!isOpen) return null;

  return (
    <div className="w-72 bg-bg-elevated border-r border-white/5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/5 animate-slide-up">
        <div className="flex items-center gap-2">
          <div className="h-6 w-1 bg-gradient-to-b from-accent to-accent/50 rounded-full"></div>
          <h3 className="text-sm font-bold text-text-primary">Media Library</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded-lg transition-all duration-200 hover:scale-110 active:scale-95"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Sidebar Navigation */}
      <div
        className="animate-fade-in"
        style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
      >
        <SidebarNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full animate-scale-in">
          {activeTab === 'project' && <ProjectTab />}
          {activeTab === 'media' && <MediaTab />}
          {activeTab === 'text' && <TextTab />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'memory' && <AIMemoryPanel />}
        </div>
      </div>
    </div>
  );
};

export default FilePanel;
