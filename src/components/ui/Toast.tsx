import { useEffect } from 'react';
import clsx from 'clsx';
import { useProjectStore } from '../../stores/useProjectStore';

const Toast = () => {
  const { notification, setNotification } = useProjectStore();

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [notification, setNotification]);

  if (!notification) return null;

  const getStyles = () => {
    switch (notification.type) {
      case 'success':
        return {
          bg: 'bg-bg-elevated',
          border: 'border-accent',
          iconBg: 'bg-accent/20',
          iconColor: 'text-accent',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          ),
        };
      case 'error':
        return {
          bg: 'bg-bg-elevated',
          border: 'border-red-500',
          iconBg: 'bg-red-500/20',
          iconColor: 'text-red-500',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          ),
        };
      case 'warning':
        return {
          bg: 'bg-bg-elevated',
          border: 'border-warning',
          iconBg: 'bg-warning/20',
          iconColor: 'text-warning',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
          ),
        };
      default: // info
        return {
          bg: 'bg-bg-elevated',
          border: 'border-blue-500',
          iconBg: 'bg-blue-500/20',
          iconColor: 'text-blue-500',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          ),
        };
    }
  };

  const styles = getStyles();

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div 
        className={clsx(
          "px-4 py-3 rounded-lg shadow-2xl border-2 flex items-center gap-3 min-w-[320px] backdrop-blur-sm",
          styles.bg,
          styles.border
        )}
      >
        <div className={clsx("p-1.5 rounded-full", styles.iconBg)}>
          <div className={styles.iconColor}>
            {styles.icon}
          </div>
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm text-text-primary">{notification.message}</p>
        </div>
        <button 
          onClick={() => setNotification(null)}
          className="text-text-muted hover:text-text-primary transition-colors p-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Toast;
