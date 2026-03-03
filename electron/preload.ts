import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS,
  bedrockConverseInputSchema,
  exportVideoRequestSchema,
  filePathSchema,
  type IpcInvokeContract,
  memoryMarkdownEntrySchema,
  memoryStateSchema,
  nonEmptyStringSchema,
  projectWriteSchema,
  saveFormatSchema,
  timelineClipListSchema,
  youtubeUploadMetadataSchema,
  youtubeUploadRequestSchema,
} from './ipc/contracts.js';

type TranscriptionProgress = { status: string; progress?: number; clip?: number };
type YouTubeUploadProgress = {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  videoId?: string;
  error?: string;
};
type UpdateStatus =
  | { status: 'disabled'; reason: string }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes?: string }
  | { status: 'not-available' }
  | {
      status: 'downloading';
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };
type YouTubeUploadMetadata = {
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus: 'public' | 'private' | 'unlisted';
  madeForKids?: boolean;
};

const invokeIpc = <K extends keyof IpcInvokeContract>(
  channel: K,
  ...args: IpcInvokeContract[K]['args']
) => ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeContract[K]['result']>;

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => invokeIpc(IPC_CHANNELS.ping),
  openFile: () => invokeIpc(IPC_CHANNELS.dialog.openFile),
  getMetadata: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.media.getMetadata, filePathSchema.parse(filePath)),
  getThumbnail: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.media.getThumbnail, filePathSchema.parse(filePath)),
  getWaveform: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.media.getWaveform, filePathSchema.parse(filePath)),
  saveFile: (format?: string) =>
    invokeIpc(
      IPC_CHANNELS.dialog.saveFile,
      format === undefined ? undefined : saveFormatSchema.parse(format),
    ),
  exportVideo: (
    clips: unknown[],
    outputPath: string,
    format?: string,
    resolution?: string,
    subtitles?: unknown[],
    subtitleStyle?: unknown,
  ) =>
    invokeIpc(
      IPC_CHANNELS.media.exportVideo,
      exportVideoRequestSchema.parse({
        clips,
        outputPath,
        format,
        resolution,
        subtitles,
        subtitleStyle,
      }),
    ),
  onExportProgress: (callback: (percent: number) => void) => {
    const listener = (_event: IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on(IPC_CHANNELS.media.exportProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.media.exportProgress, listener);
  },
  saveProject: () => invokeIpc(IPC_CHANNELS.project.saveProject),
  loadProject: () => invokeIpc(IPC_CHANNELS.project.loadProject),
  writeProjectFile: (data: { filePath: string; data: unknown }) =>
    invokeIpc(IPC_CHANNELS.project.writeProjectFile, projectWriteSchema.parse(data)),
  readProjectFile: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.project.readProjectFile, filePathSchema.parse(filePath)),
  readTextFile: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.file.readTextFile, filePathSchema.parse(filePath)),
  transcribeVideo: (videoPath: string) =>
    invokeIpc(IPC_CHANNELS.transcription.transcribeVideo, filePathSchema.parse(videoPath)),
  transcribeTimeline: (clips: Array<{ path: string; startTime: number; duration: number }>) =>
    invokeIpc(IPC_CHANNELS.transcription.transcribeTimeline, timelineClipListSchema.parse(clips)),
  onTranscriptionProgress: (callback: (progress: TranscriptionProgress) => void) => {
    const listener = (_event: IpcRendererEvent, progress: TranscriptionProgress) =>
      callback(progress);
    ipcRenderer.on(IPC_CHANNELS.transcription.progress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.transcription.progress, listener);
  },
  analyzeChannel: (channelUrl: string) =>
    invokeIpc(IPC_CHANNELS.analysis.analyzeChannel, nonEmptyStringSchema.parse(channelUrl)),
  getUserAnalysis: (userId: string) =>
    invokeIpc(IPC_CHANNELS.analysis.getUserAnalysis, nonEmptyStringSchema.parse(userId)),
  linkAnalysisToUser: (userId: string, channelUrl: string) =>
    invokeIpc(
      IPC_CHANNELS.analysis.linkToUser,
      nonEmptyStringSchema.parse(userId),
      nonEmptyStringSchema.parse(channelUrl),
    ),
  readFileAsBase64: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.file.readFileAsBase64, filePathSchema.parse(filePath)),
  getFileSize: (filePath: string) =>
    invokeIpc(IPC_CHANNELS.file.getFileSize, filePathSchema.parse(filePath)),
  // AI Memory — file-based persistence (project-specific)
  memorySave: (data: unknown) => invokeIpc(IPC_CHANNELS.memory.save, memoryStateSchema.parse(data)),
  memoryLoad: (projectId?: string) =>
    invokeIpc(
      IPC_CHANNELS.memory.load,
      projectId === undefined ? undefined : nonEmptyStringSchema.parse(projectId),
    ),
  memorySaveMarkdown: (entry: unknown, projectId?: string) =>
    invokeIpc(
      IPC_CHANNELS.memory.saveAnalysisMarkdown,
      memoryMarkdownEntrySchema.parse(entry),
      projectId === undefined ? undefined : nonEmptyStringSchema.parse(projectId),
    ),
  memoryGetDir: () => invokeIpc(IPC_CHANNELS.memory.getDir),
  bedrockConverse: (input: Record<string, unknown>) =>
    invokeIpc(IPC_CHANNELS.bedrock.converse, bedrockConverseInputSchema.parse(input)),
  // YouTube Upload
  youtube: {
    isAuthenticated: () => invokeIpc(IPC_CHANNELS.youtube.isAuthenticated),
    authenticate: () => invokeIpc(IPC_CHANNELS.youtube.authenticate),
    logout: () => invokeIpc(IPC_CHANNELS.youtube.logout),
    uploadVideo: async (
      filePath: string,
      metadata: YouTubeUploadMetadata,
      onProgress?: (progress: YouTubeUploadProgress) => void,
    ) => {
      const listener = (_event: IpcRendererEvent, progress: YouTubeUploadProgress) =>
        onProgress?.(progress);
      if (onProgress) {
        ipcRenderer.on(IPC_CHANNELS.youtube.uploadProgress, listener);
      }
      try {
        return await invokeIpc(
          IPC_CHANNELS.youtube.uploadVideo,
          youtubeUploadRequestSchema.parse({
            filePath,
            metadata: youtubeUploadMetadataSchema.parse(metadata),
          }),
        );
      } finally {
        if (onProgress) {
          ipcRenderer.removeListener(IPC_CHANNELS.youtube.uploadProgress, listener);
        }
      }
    },
  },
  updates: {
    check: () => invokeIpc(IPC_CHANNELS.update.check),
    download: () => invokeIpc(IPC_CHANNELS.update.download),
    install: () => invokeIpc(IPC_CHANNELS.update.install),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.update.status, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.update.status, listener);
    },
  },
});
