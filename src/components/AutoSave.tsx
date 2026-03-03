import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/useProjectStore';

/**
 * Auto-save component that triggers automatic project saving
 * at regular intervals when enabled
 */
const AutoSave = () => {
  const { autoSaveEnabled, autoSaveInterval, hasUnsavedChanges, projectPath, autoSave } =
    useProjectStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only set up auto-save if enabled and there's a project path
    if (autoSaveEnabled && projectPath && autoSaveInterval > 0) {
      intervalRef.current = setInterval(() => {
        // Check if there are unsaved changes before auto-saving
        const state = useProjectStore.getState();
        if (state.hasUnsavedChanges && state.projectPath) {
          console.log('Auto-saving...');
          autoSave();
        }
      }, autoSaveInterval * 1000); // Convert seconds to milliseconds
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoSaveEnabled, autoSaveInterval, projectPath, autoSave]);

  // Also save before unload if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';

        // Attempt to save before closing
        autoSave();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, autoSave]);

  // This component doesn't render anything
  return null;
};

export default AutoSave;
