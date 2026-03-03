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
          bg: 'bg-gradient-to-br from-bg-elevated to-bg-secondary',
          border: 'border-accent',
          iconBg: 'bg-gradient-to-br from-accent/30 to-accent/10',
          iconColor: 'text-accent',
          ringColor: 'ring-accent/20',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M5 13l4 4L19 7"
              ></path>
            </svg>
          ),
        };
      case 'error':
        return {
          bg: 'bg-gradient-to-br from-bg-elevated to-bg-secondary',
          border: 'border-red-500',
          iconBg: 'bg-gradient-to-br from-red-500/30 to-red-500/10',
          iconColor: 'text-red-500',
          ringColor: 'ring-red-500/20',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M6 18L18 6M6 6l12 12"
              ></path>
            </svg>
          ),
        };
      case 'warning':
        return {
          bg: 'bg-gradient-to-br from-bg-elevated to-bg-secondary',
          border: 'border-warning',
          iconBg: 'bg-gradient-to-br from-warning/30 to-warning/10',
          iconColor: 'text-warning',
          ringColor: 'ring-warning/20',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              ></path>
            </svg>
          ),
        };
      default: // info
        return {
          bg: 'bg-gradient-to-br from-bg-elevated to-bg-secondary',
          border: 'border-blue-500',
          iconBg: 'bg-gradient-to-br from-blue-500/30 to-blue-500/10',
          iconColor: 'text-blue-500',
          ringColor: 'ring-blue-500/20',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
          ),
        };
    }
  };

  const styles = getStyles();

  return (
    <div
      className="fixed bottom-6 right-6 z-50 animate-scale-in"
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={clsx(
          'px-5 py-4 rounded-xl shadow-2xl border-2 flex items-center gap-4 min-w-[340px] backdrop-blur-xl ring-4 transition-all duration-300 hover:scale-105',
          styles.bg,
          styles.border,
          styles.ringColor,
        )}
      >
        <div
          className={clsx('p-2 rounded-lg transition-all duration-200', styles.iconBg)}
          aria-hidden="true"
        >
          <div className={styles.iconColor}>{styles.icon}</div>
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm text-text-primary leading-tight">
            {notification.message}
          </p>
        </div>
        <button
          onClick={() => setNotification(null)}
          className="text-text-muted hover:text-text-primary transition-all duration-200 p-1.5 hover:bg-white/5 rounded-lg hover:scale-110 active:scale-95"
          aria-label="Dismiss notification"
          type="button"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M6 18L18 6M6 6l12 12"
            ></path>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default Toast;
