import { useProjectStore } from '../../stores/useProjectStore';

const ProjectTab = () => {
  const { saveProject, loadProject, newProject, hasUnsavedChanges, lastSaved, clips } =
    useProjectStore();

  const totalClips = clips.length;
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-text-primary mb-1">Project Management</h3>
        <p className="text-xs text-text-muted">Save, load, and manage your project</p>
      </div>

      {/* Project Stats */}
      <div className="bg-bg-elevated rounded-lg p-3 border border-border-primary">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Total Clips</span>
            <span className="text-sm font-bold text-text-primary">{totalClips}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted">Total Duration</span>
            <span className="text-sm font-bold text-text-primary">
              {Math.floor(totalDuration / 60)}:{(totalDuration % 60).toFixed(0).padStart(2, '0')}
            </span>
          </div>
          {lastSaved && (
            <div className="pt-2 border-t border-border-primary">
              <div className="flex items-center gap-2 text-xs">
                {hasUnsavedChanges ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                    <span className="text-yellow-500 font-medium">Unsaved changes</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3 h-3 text-accent"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-accent font-medium">All changes saved</span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-text-muted mt-1">
                Last saved: {new Date(lastSaved).toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={newProject}
          className="w-full bg-bg-elevated hover:bg-bg-surface text-text-primary border border-border-primary hover:border-accent px-4 py-3 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          title="New Project (Ctrl+N)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>

        <button
          onClick={saveProject}
          className="w-full bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
          title="Save Project (Ctrl+S)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
            />
          </svg>
          Save Project
        </button>

        <button
          onClick={loadProject}
          className="w-full bg-bg-elevated hover:bg-bg-surface text-text-primary border border-border-primary hover:border-accent px-4 py-3 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          title="Load Project (Ctrl+O)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          Load Project
        </button>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="bg-bg-elevated rounded-lg p-3 border border-border-primary">
        <h4 className="text-xs font-bold text-text-primary mb-2">Keyboard Shortcuts</h4>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-text-muted">New Project</span>
            <kbd className="px-2 py-0.5 bg-bg-primary border border-border-primary rounded text-text-muted font-mono text-[10px]">
              Ctrl+N
            </kbd>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-text-muted">Save Project</span>
            <kbd className="px-2 py-0.5 bg-bg-primary border border-border-primary rounded text-text-muted font-mono text-[10px]">
              Ctrl+S
            </kbd>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-text-muted">Load Project</span>
            <kbd className="px-2 py-0.5 bg-bg-primary border border-border-primary rounded text-text-muted font-mono text-[10px]">
              Ctrl+O
            </kbd>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-text-muted">Undo</span>
            <kbd className="px-2 py-0.5 bg-bg-primary border border-border-primary rounded text-text-muted font-mono text-[10px]">
              Ctrl+Z
            </kbd>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-text-muted">Redo</span>
            <kbd className="px-2 py-0.5 bg-bg-primary border border-border-primary rounded text-text-muted font-mono text-[10px]">
              Ctrl+Y
            </kbd>
          </div>
        </div>
      </div>

      {/* Help Text */}
      {clips.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <p className="text-xs text-text-muted">No project loaded</p>
            <p className="text-[10px] text-text-muted/60 mt-1">
              Import media or load a project to get started
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectTab;
