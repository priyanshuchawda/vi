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
      <div className="flex items-center justify-between p-3 border-b border-white/5">
        <h3 className="text-sm font-bold text-text-primary">Media Library</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary transition"
            title="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Sidebar Navigation */}
      <SidebarNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'project' && <ProjectTab />}
        {activeTab === 'media' && <MediaTab />}
        {activeTab === 'text' && <TextTab />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'memory' && <AIMemoryPanel />}
      </div>
    </div>
  );
};

export default FilePanel;

