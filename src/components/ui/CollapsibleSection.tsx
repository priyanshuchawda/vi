import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { getStoredString, setStoredString, storageKeys } from '../../lib/storage';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  badge?: string | number;
  children: ReactNode;
  storageKey?: string;
}

const CollapsibleSection = ({ 
  title, 
  defaultOpen = true, 
  badge,
  children,
  storageKey 
}: CollapsibleSectionProps) => {
  const [isOpen, setIsOpen] = useState(() => {
    if (storageKey) {
      const saved = getStoredString(storageKeys.uiCollapse(storageKey));
      return saved !== null ? saved === 'true' : defaultOpen;
    }
    return defaultOpen;
  });

  useEffect(() => {
    if (storageKey) {
      setStoredString(storageKeys.uiCollapse(storageKey), String(isOpen));
    }
  }, [isOpen, storageKey]);

  return (
    <div className="border-b border-border-primary last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-surface transition-colors group"
      >
        <div className="flex items-center gap-2">
          <svg 
            className={`w-4 h-4 text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
          <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
            {title}
          </h3>
          {badge !== undefined && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent/20 text-accent rounded">
              {badge}
            </span>
          )}
        </div>
        <svg 
          className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      <div 
        className={`overflow-hidden transition-all duration-200 ${
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="pb-3">
          {children}
        </div>
      </div>
    </div>
  );
};

export default CollapsibleSection;
