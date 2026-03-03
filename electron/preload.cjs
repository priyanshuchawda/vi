const { contextBridge, ipcRenderer } = require('electron');

const IPC_CHANNELS = {
  ping: 'ping',
  dialog: {
    openFile: 'dialog:openFile',
    saveFile: 'dialog:saveFile',
  },
  media: {
    getMetadata: 'media:getMetadata',
    getThumbnail: 'media:getThumbnail',
    getWaveform: 'media:getWaveform',
    exportVideo: 'media:exportVideo',
    exportProgress: 'export:progress',
  },
  project: {
    saveProject: 'project:saveProject',
    writeProjectFile: 'project:writeProjectFile',
    loadProject: 'project:loadProject',
    readProjectFile: 'project:readProjectFile',
  },
  file: {
    readTextFile: 'file:readTextFile',
    readFileAsBase64: 'file:readFileAsBase64',
    getFileSize: 'file:getFileSize',
  },
  transcription: {
    transcribeVideo: 'transcription:transcribeVideo',
    transcribeTimeline: 'transcription:transcribeTimeline',
    progress: 'transcription:progress',
  },
  analysis: {
    analyzeChannel: 'analysis:analyzeChannel',
    getUserAnalysis: 'analysis:getUserAnalysis',
    linkToUser: 'analysis:linkToUser',
  },
  memory: {
    save: 'memory:save',
    load: 'memory:load',
    saveAnalysisMarkdown: 'memory:saveAnalysisMarkdown',
    getDir: 'memory:getDir',
  },
  bedrock: {
    converse: 'bedrock:converse',
  },
  youtube: {
    isAuthenticated: 'youtube:isAuthenticated',
    authenticate: 'youtube:authenticate',
    logout: 'youtube:logout',
    uploadVideo: 'youtube:uploadVideo',
    uploadProgress: 'youtube:uploadProgress',
  },
  update: {
    check: 'update:check',
    download: 'update:download',
    install: 'update:install',
    status: 'update:status',
  },
};

const invokeIpc = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const ensureString = (value) => (typeof value === 'string' ? value : String(value ?? ''));
const ensureNonEmptyString = (value) => {
  const next = ensureString(value).trim();
  if (!next) throw new Error('Expected non-empty string');
  return next;
};

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => invokeIpc(IPC_CHANNELS.ping),
  openFile: () => invokeIpc(IPC_CHANNELS.dialog.openFile),
  getMetadata: (filePath) =>
    invokeIpc(IPC_CHANNELS.media.getMetadata, ensureNonEmptyString(filePath)),
  getThumbnail: (filePath) =>
    invokeIpc(IPC_CHANNELS.media.getThumbnail, ensureNonEmptyString(filePath)),
  getWaveform: (filePath) =>
    invokeIpc(IPC_CHANNELS.media.getWaveform, ensureNonEmptyString(filePath)),
  saveFile: (format) => invokeIpc(IPC_CHANNELS.dialog.saveFile, format),
  exportVideo: (clips, outputPath, format, resolution, subtitles, subtitleStyle) =>
    invokeIpc(IPC_CHANNELS.media.exportVideo, {
      clips,
      outputPath: ensureNonEmptyString(outputPath),
      format,
      resolution,
      subtitles,
      subtitleStyle,
    }),
  onExportProgress: (callback) => {
    const listener = (_event, percent) => callback(percent);
    ipcRenderer.on(IPC_CHANNELS.media.exportProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.media.exportProgress, listener);
  },
  saveProject: () => invokeIpc(IPC_CHANNELS.project.saveProject),
  loadProject: () => invokeIpc(IPC_CHANNELS.project.loadProject),
  writeProjectFile: (data) => invokeIpc(IPC_CHANNELS.project.writeProjectFile, data),
  readProjectFile: (filePath) =>
    invokeIpc(IPC_CHANNELS.project.readProjectFile, ensureNonEmptyString(filePath)),
  readTextFile: (filePath) => invokeIpc(IPC_CHANNELS.file.readTextFile, ensureNonEmptyString(filePath)),
  transcribeVideo: (videoPath) =>
    invokeIpc(IPC_CHANNELS.transcription.transcribeVideo, ensureNonEmptyString(videoPath)),
  transcribeTimeline: (clips) => invokeIpc(IPC_CHANNELS.transcription.transcribeTimeline, clips),
  onTranscriptionProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.transcription.progress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.transcription.progress, listener);
  },
  analyzeChannel: (channelUrl) =>
    invokeIpc(IPC_CHANNELS.analysis.analyzeChannel, ensureNonEmptyString(channelUrl)),
  getUserAnalysis: (userId) =>
    invokeIpc(IPC_CHANNELS.analysis.getUserAnalysis, ensureNonEmptyString(userId)),
  linkAnalysisToUser: (userId, channelUrl) =>
    invokeIpc(
      IPC_CHANNELS.analysis.linkToUser,
      ensureNonEmptyString(userId),
      ensureNonEmptyString(channelUrl),
    ),
  readFileAsBase64: (filePath) =>
    invokeIpc(IPC_CHANNELS.file.readFileAsBase64, ensureNonEmptyString(filePath)),
  getFileSize: (filePath) => invokeIpc(IPC_CHANNELS.file.getFileSize, ensureNonEmptyString(filePath)),
  memorySave: (data) => invokeIpc(IPC_CHANNELS.memory.save, data),
  memoryLoad: (projectId) => invokeIpc(IPC_CHANNELS.memory.load, projectId),
  memorySaveMarkdown: (entry, projectId) =>
    invokeIpc(IPC_CHANNELS.memory.saveAnalysisMarkdown, entry, projectId),
  memoryGetDir: () => invokeIpc(IPC_CHANNELS.memory.getDir),
  bedrockConverse: (input) => invokeIpc(IPC_CHANNELS.bedrock.converse, input),
  youtube: {
    isAuthenticated: () => invokeIpc(IPC_CHANNELS.youtube.isAuthenticated),
    authenticate: () => invokeIpc(IPC_CHANNELS.youtube.authenticate),
    logout: () => invokeIpc(IPC_CHANNELS.youtube.logout),
    uploadVideo: async (filePath, metadata, onProgress) => {
      const listener = (_event, progress) => onProgress?.(progress);
      if (onProgress) {
        ipcRenderer.on(IPC_CHANNELS.youtube.uploadProgress, listener);
      }
      try {
        return await invokeIpc(IPC_CHANNELS.youtube.uploadVideo, {
          filePath: ensureNonEmptyString(filePath),
          metadata,
        });
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
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on(IPC_CHANNELS.update.status, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.update.status, listener);
    },
  },
});
