import { useEffect } from 'react';

export type SidebarTab = 'project' | 'media' | 'text' | 'settings' | 'memory';

interface SidebarNavProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
}

interface NavItem {
  id: SidebarTab;
  label: string;
  icon: React.ReactElement;
  shortcut: string;
}

const navItems: NavItem[] = [
  {
    id: 'project',
    label: 'PROJECT',
    shortcut: 'Ctrl+1',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    id: 'media',
    label: 'MEDIA',
    shortcut: 'Ctrl+2',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'text',
    label: 'TEXT',
    shortcut: 'Ctrl+3',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'SETTINGS',
    shortcut: 'Ctrl+4',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'memory',
    label: 'MEMORY',
    shortcut: 'Ctrl+5',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

const SidebarNav = ({ activeTab, onTabChange }: SidebarNavProps) => {
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
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTabChange]);

  return (
    <div className="flex flex-col border-b border-border-primary bg-bg-secondary">
      <div
        className="flex overflow-x-auto custom-scrollbar stagger-children"
        role="tablist"
        aria-label="File panel tabs"
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`
                flex-none min-w-[66px] flex flex-col items-center justify-center py-2 px-1 gap-1
                transition-all duration-200 relative group
                ${isActive
                  ? 'text-accent bg-accent/10 scale-105'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated hover:scale-105 active:scale-95'
                }
              `}
              title={`${item.label} (${item.shortcut})`}
            >
              {/* Icon */}
              <div className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                {item.icon}
              </div>

              {/* Label */}
              <span className={`text-[9px] font-bold tracking-wider transition-all duration-200 ${isActive ? 'text-accent' : ''}`}>
                {item.label}
              </span>

              {/* Active indicator line */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent shadow-lg shadow-accent/50 animate-expand" />
              )}

              {/* Tooltip hint on hover */}
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-bg-elevated/95 backdrop-blur-sm border border-border-primary rounded text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 shadow-lg">
                {item.shortcut}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SidebarNav;
