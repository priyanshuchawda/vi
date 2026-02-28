import { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import type { TextProperties } from '../../stores/useProjectStore';
import TextEditor from '../ui/TextEditor';

const TextTab = () => {
  const { addClip, transcription } = useProjectStore();
  const [showTextEditor, setShowTextEditor] = useState(false);

  const hasTranscript = transcription?.words && transcription.words.length > 0;

  const handleAddText = (textProps: TextProperties, duration: number) => {
    addClip({
      path: '',
      name: `Text: ${textProps.text.substring(0, 20)}${textProps.text.length > 20 ? '...' : ''}`,
      duration,
      sourceDuration: duration,
      mediaType: 'text',
      textProperties: textProps,
    });
  };

  const openCaptionsPanel = () => {
    // Switch to right panel - this will be implemented when we enhance RightPanel
    // For now, just provide guidance
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-text-primary mb-1">Text & Content</h3>
        <p className="text-xs text-text-muted">Add text overlays and manage captions</p>
      </div>

      {/* Add Text/Title Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <h4 className="text-xs font-bold text-text-primary">Text Overlays</h4>
        </div>

        <button
          onClick={() => setShowTextEditor(true)}
          className="w-full bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          Add Text / Title
        </button>

        <div className="bg-bg-elevated rounded-lg p-3 border border-border-primary">
          <p className="text-xs text-text-muted leading-relaxed">
            Create custom text overlays with full control over font, size, color, position, and styling.
          </p>
        </div>
      </div>

      <div className="border-t border-border-primary"></div>

      {/* Captions & Transcription Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          <h4 className="text-xs font-bold text-text-primary">Captions & Transcription</h4>
        </div>

        {/* Status Card */}
        <div className={`rounded-lg p-3 border ${
          hasTranscript 
            ? 'bg-accent/10 border-accent/30' 
            : 'bg-bg-elevated border-border-primary'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {hasTranscript ? (
              <>
                <div className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-accent opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                </div>
                <span className="text-xs font-bold text-accent">Transcript Ready!</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-text-muted/30"></div>
                <span className="text-xs font-medium text-text-muted">No transcript</span>
              </>
            )}
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            {hasTranscript
              ? 'Your transcript is ready for editing. Open the right panel to edit by text or manage captions.'
              : 'Generate captions to create a transcript, then edit your video by selecting words to delete.'
            }
          </p>
        </div>

        {/* Quick Actions */}
        <div className="space-y-2">
          <button
            onClick={openCaptionsPanel}
            className="w-full bg-bg-elevated hover:bg-bg-surface text-text-primary border border-border-primary hover:border-accent px-4 py-2.5 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Open Captions Panel
            <span className="ml-auto text-xs text-text-muted">Alt+1</span>
          </button>

          {hasTranscript && (
            <button
              onClick={openCaptionsPanel}
              className="w-full bg-bg-elevated hover:bg-bg-surface text-text-primary border border-border-primary hover:border-accent px-4 py-2.5 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Open Text Editor
              <span className="ml-auto text-xs text-text-muted">Alt+2</span>
            </button>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="flex-1 flex items-end">
        <div className="w-full bg-bg-elevated rounded-lg p-3 border border-border-primary">
          <h4 className="text-xs font-bold text-text-primary mb-2">Text Features</h4>
          <ul className="space-y-1.5 text-xs text-text-muted">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Add custom text overlays with full styling control</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Generate AI-powered captions from your video</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Edit video by selecting words in the transcript</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>Export captions as SRT files</span>
            </li>
          </ul>
        </div>
      </div>

      <TextEditor
        isOpen={showTextEditor}
        onClose={() => setShowTextEditor(false)}
        onSave={handleAddText}
      />
    </div>
  );
};

export default TextTab;
