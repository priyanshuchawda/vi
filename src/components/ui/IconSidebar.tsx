import { useEffect, useState } from 'react';
import clsx from 'clsx';

export type SidebarTab = 'project' | 'media' | 'text' | 'settings' | 'memory' | 'youtube';

interface IconSidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
}

interface NavItem {
  id: SidebarTab;
  label: string;
  icon: React.ReactElement;
  tooltip: string;
  shortcut: string;
}

const navItems: NavItem[] = [
  {
    id: 'project',
    label: 'Project',
    tooltip: 'Project (Ctrl+1)',
    shortcut: 'Ctrl+1',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    ),
  },
  {
    id: 'media',
    label: 'Media',
    tooltip: 'Media Library (Ctrl+2)',
    shortcut: 'Ctrl+2',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: 'text',
    label: 'Text',
    tooltip: 'Text Editor (Ctrl+3)',
    shortcut: 'Ctrl+3',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Settings (Ctrl+4)',
    shortcut: 'Ctrl+4',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
  {
    id: 'memory',
    label: 'Memory',
    tooltip: 'AI Memory (Ctrl+5)',
    shortcut: 'Ctrl+5',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    ),
  },
  {
    id: 'youtube',
    label: 'YouTube',
    tooltip: 'YouTube Upload (Ctrl+6)',
    shortcut: 'Ctrl+6',
    icon: (
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
];

const IconSidebar = ({ activeTab, onTabChange }: IconSidebarProps) => {
  const [hoveredTab, setHoveredTab] = useState<SidebarTab | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            onTabChange('project');
            break;
          case '2':
            e.preventDefault();
            onTabChange('media');
            break;
          case '3':
            e.preventDefault();
            onTabChange('text');
            break;
          case '4':
            e.preventDefault();
            onTabChange('settings');
            break;
          case '5':
            e.preventDefault();
            onTabChange('memory');
            break;
          case '6':
            e.preventDefault();
            onTabChange('youtube');
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTabChange]);

  return (
    <div className="w-16 bg-bg-secondary flex flex-col items-center py-4 gap-2 border-r border-border-primary/60 relative">
      {/* Logo/Brand */}
      <div className="mb-6 p-2">
        <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center">
          <svg
            className="w-5 h-5 text-accent"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex flex-col gap-1.5 w-full px-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            onMouseEnter={() => setHoveredTab(item.id)}
            onMouseLeave={() => setHoveredTab(null)}
            className={clsx(
              'group relative w-full h-12 rounded-lg flex items-center justify-center transition-all duration-200',
              activeTab === item.id
                ? 'bg-accent/15 text-accent shadow-[0_0_16px_rgba(139,92,246,0.25)]'
                : 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-hover',
            )}
            title={item.tooltip}
          >
            {item.icon}

            {/* Tooltip */}
            {hoveredTab === item.id && activeTab !== item.id && (
              <div className="absolute left-full ml-3 px-3 py-2 bg-bg-elevated text-text-primary text-xs whitespace-nowrap rounded-lg shadow-elevated border border-border-primary z-50 pointer-events-none">
                {item.label}
                <kbd className="ml-2 text-[10px] opacity-60 font-mono">{item.shortcut}</kbd>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Actions - User Profile */}
      <div className="px-2">
        <button
          className="w-12 h-12 rounded-lg bg-bg-hover/50 hover:bg-bg-hover flex items-center justify-center text-text-secondary/60 hover:text-text-primary transition-all"
          title="User Profile"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default IconSidebar;
