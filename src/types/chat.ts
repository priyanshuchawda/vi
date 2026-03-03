export type MessageRole = 'user' | 'assistant' | 'system';
export type ChatTurnMode = 'ask' | 'plan' | 'edit';
export type AssistantArtifactType =
  | 'script_draft'
  | 'execution_plan'
  | 'caption_plan'
  | 'tool_execution_result';
export type ChatTurnStatus =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'retry'
  | 'completed'
  | 'error'
  | 'interrupted';

export type TurnPart =
  | { type: 'text'; text: string; role: 'user' | 'assistant'; timestamp: number }
  | {
      type: 'tool_call';
      name: string;
      args: Record<string, unknown>;
      state: 'pending' | 'running' | 'completed' | 'error';
      timestamp: number;
    }
  | {
      type: 'tool_result';
      name: string;
      success: boolean;
      message?: string;
      error?: string;
      timestamp: number;
    }
  | { type: 'step_start'; label: string; timestamp: number }
  | { type: 'step_finish'; label: string; success: boolean; timestamp: number }
  | { type: 'status'; from: ChatTurnStatus; to: ChatTurnStatus; timestamp: number }
  | { type: 'error'; message: string; timestamp: number };

export interface ChatTurn {
  id: string;
  userMessageId: string;
  mode: ChatTurnMode;
  status: ChatTurnStatus;
  parts: TurnPart[];
  startedAt: number;
  endedAt?: number;
  closeReason?: 'completed' | 'error' | 'interrupted';
  retryInfo?: {
    attempt: number;
    message: string;
    nextAt: number;
  };
}

export interface MediaAttachment {
  id: string;
  file: File;
  type: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  name: string;
  size: number;
  previewUrl?: string; // Object URL for preview
  base64Data?: string; // Base64 encoded data for inline sending
  uploadedUri?: string; // URI from AI File API upload
  uploadedMimeType?: string; // Mime type from AI File API
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  metadata?: {
    context?: string;
    error?: boolean;
    artifact?: {
      type: AssistantArtifactType;
      executable: boolean;
      nextActions?: string[];
    };
  };
  tokens?: TokenInfo;
  attachments?: MediaAttachment[];
}

export interface TokenInfo {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
  cachedTokens?: number; // Tokens served from cache
}

export interface SessionStats {
  messageCount: number;
  totalPromptTokens: number;
  totalResponseTokens: number;
  totalTokens: number;
  totalCachedTokens: number; // Total tokens served from cache
  estimatedCost: number;
  cachedSavings?: number; // Cost saved by caching
}

export interface ChatContext {
  currentClipId?: string;
  currentTime?: number;
  projectDuration?: number;
  clipCount?: number;
}

// Supported media types for AI
export const SUPPORTED_MEDIA_TYPES: Record<string, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
  video: [
    'video/mp4',
    'video/mpeg',
    'video/mov',
    'video/avi',
    'video/x-flv',
    'video/webm',
    'video/wmv',
    'video/3gpp',
  ],
  audio: [
    'audio/wav',
    'audio/mp3',
    'audio/mpeg',
    'audio/aiff',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
  ],
  document: ['application/pdf'],
};

export const ALL_SUPPORTED_MIME_TYPES = Object.values(SUPPORTED_MEDIA_TYPES).flat();

export const MAX_INLINE_SIZE = 20 * 1024 * 1024; // 20MB for inline data
export const MAX_FILE_API_SIZE = 2 * 1024 * 1024 * 1024; // 2GB for File API

export function getMediaType(mimeType: string): MediaAttachment['type'] | null {
  for (const [type, mimes] of Object.entries(SUPPORTED_MEDIA_TYPES)) {
    if (mimes.includes(mimeType)) return type as MediaAttachment['type'];
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
