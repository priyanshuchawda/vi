import { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { MediaAttachment } from '../../types/chat';
import {
  ALL_SUPPORTED_MIME_TYPES,
  getMediaType,
  formatFileSize,
  MAX_FILE_API_SIZE,
} from '../../types/chat';

interface ChatInputProps {
  onSendMessage: (message: string, attachments?: MediaAttachment[]) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSendMessage, disabled }: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<MediaAttachment[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [message]);

  const processFile = useCallback((file: File): MediaAttachment | null => {
    const mediaType = getMediaType(file.type);
    if (!mediaType) {
      console.warn(`Unsupported file type: ${file.type}`);
      return null;
    }

    if (file.size > MAX_FILE_API_SIZE) {
      console.warn(`File too large: ${file.name} (${formatFileSize(file.size)})`);
      return null;
    }

    const attachment: MediaAttachment = {
      id: uuidv4(),
      file,
      type: mediaType,
      mimeType: file.type,
      name: file.name,
      size: file.size,
    };

    // Create preview URL for images and videos
    if (mediaType === 'image' || mediaType === 'video') {
      attachment.previewUrl = URL.createObjectURL(file);
    }

    return attachment;
  }, []);

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files) return;

      const newAttachments: MediaAttachment[] = [];
      const errors: string[] = [];

      Array.from(files).forEach((file) => {
        const attachment = processFile(file);
        if (attachment) {
          newAttachments.push(attachment);
        } else {
          if (file.size > MAX_FILE_API_SIZE) {
            errors.push(`${file.name} is too large (max 2GB)`);
          } else {
            errors.push(`${file.name} is not a supported format`);
          }
        }
      });

      if (errors.length > 0) {
        console.warn('File import errors:', errors);
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [processFile],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      // Revoke object URLs for removed attachments
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return updated;
    });
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
    };
  }, []);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false when leaving the drop zone entirely
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect],
  );

  const handleSubmit = () => {
    const trimmedMessage = message.trim();
    if ((trimmedMessage || attachments.length > 0) && !disabled) {
      const msg = trimmedMessage || (attachments.length > 0 ? 'Analyze this file' : '');
      onSendMessage(msg, attachments.length > 0 ? attachments : undefined);
      setMessage('');
      setAttachments([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const getTypeIcon = (type: MediaAttachment['type']) => {
    switch (type) {
      case 'image':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        );
      case 'video':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        );
      case 'audio':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
            />
          </svg>
        );
      case 'document':
        return (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        );
    }
  };

  const getTypeColor = (type: MediaAttachment['type']) => {
    switch (type) {
      case 'image':
        return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'video':
        return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
      case 'audio':
        return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'document':
        return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
    }
  };

  return (
    <div
      ref={dropZoneRef}
      className={`border-t border-border-primary bg-bg-elevated transition-all ${isDragging ? 'bg-accent/5 border-accent/30' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="px-4 py-3 flex items-center justify-center gap-2 text-accent text-sm border-b border-accent/20 bg-accent/5">
          <svg
            className="w-5 h-5 animate-bounce"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <span className="font-medium">Drop files here</span>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="px-4 pt-3 pb-1">
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={`relative group flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg border text-xs ${getTypeColor(attachment.type)}`}
              >
                {/* Preview thumbnail for images */}
                {attachment.type === 'image' && attachment.previewUrl ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="w-8 h-8 rounded object-cover"
                  />
                ) : (
                  <span className="flex-shrink-0">{getTypeIcon(attachment.type)}</span>
                )}

                <div className="flex flex-col min-w-0 max-w-[100px]">
                  <span className="truncate font-medium text-[10px]">{attachment.name}</span>
                  <span className="text-[9px] opacity-60">{formatFileSize(attachment.size)}</span>
                </div>

                {/* Remove button */}
                <button
                  onClick={() => removeAttachment(attachment.id)}
                  className="p-0.5 rounded-full hover:bg-white/10 transition opacity-50 hover:opacity-100"
                  title="Remove"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 pt-2">
        <div className="flex items-end gap-2">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-2 text-text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all flex-shrink-0"
            title="Attach media (images, videos, audio, PDFs)"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALL_SUPPORTED_MIME_TYPES.join(',')}
            onChange={(e) => handleFileSelect(e.target.files)}
            className="hidden"
          />

          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                attachments.length > 0 ? 'Add a message about the file...' : 'Ask me anything...'
              }
              disabled={disabled}
              rows={1}
              className="w-full px-3.5 py-2.5 bg-bg-surface border border-border-primary rounded-lg text-[13px] leading-6 text-text-primary placeholder-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed custom-scrollbar"
              style={{ maxHeight: '120px' }}
            />
            <div className="absolute bottom-2 right-2 text-[10px] text-text-muted opacity-50">
              <kbd className="px-1.5 py-0.5">Enter</kbd> to send
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={(!message.trim() && attachments.length === 0) || disabled}
            className="p-2.5 bg-accent hover:bg-accent-hover disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-all flex items-center justify-center shadow-lg shadow-accent/20 disabled:shadow-none"
            title="Send message (Enter)"
          >
            <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>

        {/* Supported formats hint */}
        {attachments.length === 0 && (
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-text-muted/40">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>Supports images, videos, audio, PDFs — drop or attach</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
