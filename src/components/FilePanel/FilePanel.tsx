import { type SidebarTab } from '../ui/SidebarNav';
import ProjectTab from './ProjectTab';
import MediaTab from './MediaTab';

import SettingsTab from './SettingsTab';
import AIMemoryPanel from '../AIMemory/AIMemoryPanel';

interface FilePanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  activeTab?: SidebarTab;
  onTabChange?: (tab: SidebarTab) => void;
}

const tabLabels: Record<SidebarTab, string> = {
  media: 'Media',
  project: 'Project',
  settings: 'Settings',
  memory: 'Memory',
};

const FilePanel = ({ isOpen = true, onClose, activeTab = 'media' }: FilePanelProps) => {
  if (!isOpen) return null;

  const label = tabLabels[activeTab] ?? 'Media';

  return (
    <div className="w-64 bg-bg-secondary border-r border-white/5 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"
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

      {/* Tab Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'project' && <ProjectTab />}
        {activeTab === 'media' && <MediaTab />}

        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'memory' && <AIMemoryPanel />}
      </div>
    </div>
  );
};

export default FilePanel;
