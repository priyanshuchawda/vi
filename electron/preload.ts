import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type TranscriptionProgress = { status: string; progress?: number; clip?: number };
type YouTubeUploadProgress = {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  videoId?: string;
  error?: string;
};
type YouTubeUploadMetadata = {
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus: 'public' | 'private' | 'unlisted';
  madeForKids?: boolean;
};

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  getMetadata: (filePath: string) => ipcRenderer.invoke('media:getMetadata', filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke('media:getThumbnail', filePath),
  getWaveform: (filePath: string) => ipcRenderer.invoke('media:getWaveform', filePath),
  saveFile: (format?: string) => ipcRenderer.invoke('dialog:saveFile', format),
  exportVideo: (clips: unknown[], outputPath: string, format?: string, resolution?: string, subtitles?: unknown[], subtitleStyle?: unknown) =>
    ipcRenderer.invoke('media:exportVideo', { clips, outputPath, format, resolution, subtitles, subtitleStyle }),
  onExportProgress: (callback: (percent: number) => void) => {
    const listener = (_event: IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.removeListener('export:progress', listener);
  },
  saveProject: () => ipcRenderer.invoke('project:saveProject'),
  loadProject: () => ipcRenderer.invoke('project:loadProject'),
  writeProjectFile: (data: { filePath: string; data: unknown }) => ipcRenderer.invoke('project:writeProjectFile', data),
  readProjectFile: (filePath: string) => ipcRenderer.invoke('project:readProjectFile', filePath),
  readTextFile: (filePath: string) => ipcRenderer.invoke('file:readTextFile', filePath),
  transcribeVideo: (videoPath: string) => ipcRenderer.invoke('transcription:transcribeVideo', videoPath),
  transcribeTimeline: (clips: Array<{ path: string; startTime: number; duration: number }>) =>
    ipcRenderer.invoke('transcription:transcribeTimeline', clips),
  onTranscriptionProgress: (callback: (progress: TranscriptionProgress) => void) => {
    const listener = (_event: IpcRendererEvent, progress: TranscriptionProgress) => callback(progress);
    ipcRenderer.on('transcription:progress', listener);
    return () => ipcRenderer.removeListener('transcription:progress', listener);
  },
  analyzeChannel: (channelUrl: string) => ipcRenderer.invoke('analysis:analyzeChannel', channelUrl),
  getUserAnalysis: (userId: string) => ipcRenderer.invoke('analysis:getUserAnalysis', userId),
  linkAnalysisToUser: (userId: string, channelUrl: string) => ipcRenderer.invoke('analysis:linkToUser', userId, channelUrl),
  readFileAsBase64: (filePath: string) => ipcRenderer.invoke('file:readFileAsBase64', filePath),
  getFileSize: (filePath: string) => ipcRenderer.invoke('file:getFileSize', filePath),
  // AI Memory — file-based persistence (project-specific)
  memorySave: (data: unknown) => ipcRenderer.invoke('memory:save', data),
  memoryLoad: (projectId?: string) => ipcRenderer.invoke('memory:load', projectId),
  memorySaveMarkdown: (entry: unknown, projectId?: string) => ipcRenderer.invoke('memory:saveAnalysisMarkdown', entry, projectId),
  memoryGetDir: () => ipcRenderer.invoke('memory:getDir'),
  bedrockConverse: (input: Record<string, unknown>) => ipcRenderer.invoke('bedrock:converse', input),
  // YouTube Upload
  youtube: {
    isAuthenticated: () => ipcRenderer.invoke('youtube:isAuthenticated'),
    authenticate: () => ipcRenderer.invoke('youtube:authenticate'),
    logout: () => ipcRenderer.invoke('youtube:logout'),
    uploadVideo: async (filePath: string, metadata: YouTubeUploadMetadata, onProgress?: (progress: YouTubeUploadProgress) => void) => {
      const listener = (_event: IpcRendererEvent, progress: YouTubeUploadProgress) => onProgress?.(progress);
      if (onProgress) {
        ipcRenderer.on('youtube:uploadProgress', listener);
      }
      try {
        return await ipcRenderer.invoke('youtube:uploadVideo', { filePath, metadata });
      } finally {
        if (onProgress) {
          ipcRenderer.removeListener('youtube:uploadProgress', listener);
        }
      }
    },
  },
});
