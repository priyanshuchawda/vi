import SidebarNav, { type SidebarTab } from '../ui/SidebarNav';
import ProjectTab from './ProjectTab';
import MediaTab from './MediaTab';
import TextTab from './TextTab';
import SettingsTab from './SettingsTab';
import AIMemoryPanel from '../AIMemory/AIMemoryPanel';
import { useProjectStore } from '../../stores/useProjectStore';

const FilePanel = () => {
  const { activeSidebarTab, setActiveSidebarTab } = useProjectStore();

  const handleTabChange = (tab: SidebarTab) => {
    setActiveSidebarTab(tab);
  };

  const renderActiveTab = () => {
    switch (activeSidebarTab) {
      case 'project':
        return <ProjectTab />;
      case 'media':
        return <MediaTab />;
      case 'text':
        return <TextTab />;
      case 'settings':
        return <SettingsTab />;
      case 'memory':
        return <AIMemoryPanel />;
      default:
        return <MediaTab />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-secondary">
      <SidebarNav activeTab={activeSidebarTab} onTabChange={handleTabChange} />
      {renderActiveTab()}
    </div>
  );
};

export default FilePanel;
