import { useState, useEffect } from 'react';
import type { TextProperties } from '../../stores/useProjectStore';

interface TextEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (textProps: TextProperties, duration: number) => void;
  initialText?: TextProperties;
  initialDuration?: number;
}

const TextEditor = ({ isOpen, onClose, onSave, initialText, initialDuration = 5 }: TextEditorProps) => {
  const [text, setText] = useState(initialText?.text || '');
  const [duration, setDuration] = useState(initialDuration);
  const [fontSize, setFontSize] = useState(initialText?.fontSize || 48);
  const [fontFamily, setFontFamily] = useState(initialText?.fontFamily || 'Arial');
  const [color, setColor] = useState(initialText?.color || '#ffffff');
  const [backgroundColor, setBackgroundColor] = useState(initialText?.backgroundColor || '');
  const [position, setPosition] = useState<'top' | 'center' | 'bottom' | 'custom'>(initialText?.position || 'center');
  const [align, setAlign] = useState<'left' | 'center' | 'right'>(initialText?.align || 'center');
  const [bold, setBold] = useState(initialText?.bold || false);
  const [italic, setItalic] = useState(initialText?.italic || false);
  const [outline, setOutline] = useState(initialText?.outline || false);
  const [outlineColor, setOutlineColor] = useState(initialText?.outlineColor || '#000000');

  useEffect(() => {
    if (initialText) {
      setText(initialText.text);
      setFontSize(initialText.fontSize);
      setFontFamily(initialText.fontFamily);
      setColor(initialText.color);
      setBackgroundColor(initialText.backgroundColor || '');
      setPosition(initialText.position);
      setAlign(initialText.align);
      setBold(initialText.bold || false);
      setItalic(initialText.italic || false);
      setOutline(initialText.outline || false);
      setOutlineColor(initialText.outlineColor || '#000000');
    }
  }, [initialText]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!text.trim()) {
      alert('Please enter some text');
      return;
    }

    const textProps: TextProperties = {
      text,
      fontSize,
      fontFamily,
      color,
      backgroundColor: backgroundColor || undefined,
      position,
      align,
      bold,
      italic,
      outline,
      outlineColor,
    };

    onSave(textProps, duration);
    onClose();
  };

  const getPreviewStyle = () => {
    let positionStyle: React.CSSProperties = {};
    
    switch (position) {
      case 'top':
        positionStyle = { top: '10%', left: '50%', transform: 'translateX(-50%)' };
        break;
      case 'bottom':
        positionStyle = { bottom: '10%', left: '50%', transform: 'translateX(-50%)' };
        break;
      case 'center':
        positionStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
        break;
    }

    return {
      fontSize: `${fontSize}px`,
      fontFamily,
      color,
      backgroundColor: backgroundColor || 'transparent',
      fontWeight: bold ? 'bold' : 'normal',
      fontStyle: italic ? 'italic' : 'normal',
      textAlign: align,
      ...(outline && {
        textShadow: `
          -2px -2px 0 ${outlineColor},
          2px -2px 0 ${outlineColor},
          -2px 2px 0 ${outlineColor},
          2px 2px 0 ${outlineColor}
        `,
      }),
      ...positionStyle,
    };
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div className="bg-bg-elevated border border-border-primary rounded-lg shadow-2xl w-[90%] max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Text Editor
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Left: Editor */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Text Content</label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter your text here..."
                  className="w-full h-32 px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Duration (seconds)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    min="0.1"
                    step="0.5"
                    className="w-full px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Font Size</label>
                  <input
                    type="number"
                    value={fontSize}
                    onChange={(e) => setFontSize(Math.max(12, parseInt(e.target.value) || 48))}
                    min="12"
                    max="200"
                    className="w-full px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Font Family</label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="Arial">Arial</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Courier New">Courier New</option>
                  <option value="Verdana">Verdana</option>
                  <option value="Impact">Impact</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Text Color</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-12 h-10 rounded border border-border-primary cursor-pointer"
                    />
                    <input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="flex-1 px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Background</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={backgroundColor || '#000000'}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="w-12 h-10 rounded border border-border-primary cursor-pointer"
                    />
                    <input
                      type="text"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      placeholder="Transparent"
                      className="flex-1 px-3 py-2 bg-bg-surface border border-border-primary rounded text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Position</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['top', 'center', 'bottom'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setPosition(pos)}
                      className={`px-3 py-2 rounded border text-sm font-medium capitalize transition ${
                        position === pos
                          ? 'bg-accent text-bg-primary border-accent'
                          : 'bg-bg-surface text-text-secondary border-border-primary hover:border-accent'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Alignment</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['left', 'center', 'right'] as const).map((al) => (
                    <button
                      key={al}
                      onClick={() => setAlign(al)}
                      className={`px-3 py-2 rounded border text-sm font-medium capitalize transition ${
                        align === al
                          ? 'bg-accent text-bg-primary border-accent'
                          : 'bg-bg-surface text-text-secondary border-border-primary hover:border-accent'
                      }`}
                    >
                      {al}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bold}
                    onChange={(e) => setBold(e.target.checked)}
                    className="w-4 h-4 text-accent rounded focus:ring-accent"
                  />
                  <span className="text-sm text-text-primary">Bold</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={italic}
                    onChange={(e) => setItalic(e.target.checked)}
                    className="w-4 h-4 text-accent rounded focus:ring-accent"
                  />
                  <span className="text-sm text-text-primary">Italic</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={outline}
                    onChange={(e) => setOutline(e.target.checked)}
                    className="w-4 h-4 text-accent rounded focus:ring-accent"
                  />
                  <span className="text-sm text-text-primary">Text Outline</span>
                </label>
                {outline && (
                  <div className="ml-6">
                    <label className="block text-xs text-text-muted mb-1">Outline Color</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={outlineColor}
                        onChange={(e) => setOutlineColor(e.target.value)}
                        className="w-10 h-8 rounded border border-border-primary cursor-pointer"
                      />
                      <input
                        type="text"
                        value={outlineColor}
                        onChange={(e) => setOutlineColor(e.target.value)}
                        className="flex-1 px-2 py-1 bg-bg-surface border border-border-primary rounded text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Preview */}
            <div className="space-y-4">
              <label className="block text-sm font-medium text-text-secondary">Preview</label>
              <div className="relative w-full aspect-video bg-bg-primary rounded border border-border-primary overflow-hidden">
                {text && (
                  <div className="absolute inset-0 flex items-center justify-center p-4">
                    <div
                      style={getPreviewStyle()}
                      className="absolute max-w-[90%] px-4 py-2 rounded"
                    >
                      {text}
                    </div>
                  </div>
                )}
                {!text && (
                  <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
                    Enter text to see preview
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-primary flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-bg-surface hover:bg-bg-primary text-text-primary border border-border-primary rounded font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-bg-primary rounded font-bold transition"
          >
            Save Text
          </button>
        </div>
      </div>
    </div>
  );
};

export default TextEditor;
