export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  conf?: number;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: TranscriptionWord[];
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  words: TranscriptionWord[];
}

export interface AnalysisResult {
  channel_summary: string;
  content_strengths: string[];
  weaknesses: string[];
  growth_suggestions: string[];
  editing_style_recommendations: string[];
  audience_insights: string[];
}

export interface ChannelAnalysisData {
  channel: {
    id: string;
    title: string;
    description: string;
    subscriber_count: number;
    video_count: number;
    view_count: number;
    thumbnail_url?: string;
    published_at: string;
  };
  analysis: AnalysisResult;
  meta: {
    analyzed_at: string;
    videos_analyzed: number;
    freshness: string;
    cache_hit: boolean;
  };
}

export interface AnalysisResponse {
  success: boolean;
  data?: ChannelAnalysisData;
  error?: string;
  error_code?: string;
}

export interface YouTubeVideoMetadata {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus: 'public' | 'private' | 'unlisted';
  madeForKids?: boolean;
}

export interface YouTubeUploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  videoId?: string;
  error?: string;
}

export interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    thumbnails: {
      default: {
        url: string;
      };
    };
  };
  status: {
    privacyStatus: string;
  };
  statistics?: {
    viewCount: string;
  };
}

export interface ElectronAPI {
  ping: () => Promise<string>;
  openFile: () => Promise<string[]>;
  getMetadata: (filePath: string) => Promise<{
    duration: number;
    format: string;
    width: number;
    height: number;
    hasVideo?: boolean;
    hasAudio?: boolean;
    isImage?: boolean;
  }>;
  getThumbnail: (filePath: string) => Promise<string | null>;
  getWaveform: (filePath: string) => Promise<string | null>;
  saveFile: (format?: string) => Promise<string | null>;
  exportVideo: (clips: any[], outputPath: string, format?: string, resolution?: string, subtitles?: any[], subtitleStyle?: any) => Promise<boolean>;
  onExportProgress: (callback: (percent: number) => void) => void;
  saveProject: () => Promise<string | null>;
  loadProject: () => Promise<string | null>;
  writeProjectFile: (data: { filePath: string; data: any }) => Promise<{ success: boolean; error?: string }>;
  readProjectFile: (filePath: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  readTextFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  transcribeVideo: (videoPath: string) => Promise<{ success: boolean; result?: TranscriptionResult; error?: string }>;
  transcribeTimeline: (clips: Array<{ path: string; startTime: number; duration: number }>) => Promise<{ success: boolean; result?: TranscriptionResult; error?: string }>;
  onTranscriptionProgress: (callback: (progress: { status: string; progress?: number; clip?: number }) => void) => void;
  analyzeChannel: (channelUrl: string) => Promise<AnalysisResponse>;
  getUserAnalysis: (userId: string) => Promise<{ success: boolean; data?: ChannelAnalysisData; error?: string }>;
  linkAnalysisToUser: (userId: string, channelUrl: string) => Promise<{ success: boolean }>;
  readFileAsBase64: (filePath: string) => Promise<string>;
  getFileSize: (filePath: string) => Promise<number>;
  // YouTube Upload
  youtube: {
    isAuthenticated: () => Promise<boolean>;
    authenticate: () => Promise<boolean>;
    logout: () => Promise<boolean>;
    uploadVideo: (
      filePath: string,
      metadata: YouTubeVideoMetadata,
      onProgress?: (progress: YouTubeUploadProgress) => void
    ) => Promise<{ success: boolean; videoId?: string; error?: string }>;
  };
  // AI Memory — file-based persistence (project-specific)
  memorySave: (data: any) => Promise<{ success: boolean; path?: string; error?: string }>;
  memoryLoad: (projectId?: string) => Promise<{ success: boolean; data?: any; error?: string }>;
  memorySaveMarkdown: (entry: any, projectId?: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  memoryGetDir: () => Promise<{ dir: string; index: string; analyses: string }>;
  bedrockConverse: (input: Record<string, unknown>) => Promise<any>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
