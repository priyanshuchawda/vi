import { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  items: Array<{
    label: string;
    onClick: () => void;
    disabled?: boolean;
    icon?: React.ReactNode;
  }>;
}

const ContextMenu = ({ x, y, onClose, items }: ContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed bg-gradient-to-br from-bg-elevated to-bg-secondary border border-border-primary rounded-lg shadow-2xl py-1 z-50 min-w-[160px] animate-scale-in backdrop-blur-sm"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
          className="w-full px-3 py-2 text-left text-sm flex items-center space-x-2 hover:bg-accent/10 hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 hover:scale-[1.02] active:scale-95 rounded-md mx-1 first:mt-1 last:mb-1"
          style={{ 
            animationDelay: `${index * 0.03}s`,
            animationFillMode: 'both'
          }}
        >
          {item.icon && <span className="w-4 h-4 transition-transform duration-150 group-hover:scale-110">{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
