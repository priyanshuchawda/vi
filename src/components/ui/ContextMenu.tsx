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
      className="fixed bg-bg-elevated border border-border-primary rounded shadow-lg py-1 z-50 min-w-[160px]"
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
          className="w-full px-3 py-2 text-left text-sm flex items-center space-x-2 hover:bg-bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {item.icon && <span className="w-4 h-4">{item.icon}</span>}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
