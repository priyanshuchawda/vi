import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => ipcRenderer.invoke('ping'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  getMetadata: (filePath: string) => ipcRenderer.invoke('media:getMetadata', filePath),
  getThumbnail: (filePath: string) => ipcRenderer.invoke('media:getThumbnail', filePath),
  getWaveform: (filePath: string) => ipcRenderer.invoke('media:getWaveform', filePath),
  saveFile: (format?: string) => ipcRenderer.invoke('dialog:saveFile', format),
  exportVideo: (clips: any[], outputPath: string, format?: string, resolution?: string, subtitles?: any[], subtitleStyle?: any) =>
    ipcRenderer.invoke('media:exportVideo', { clips, outputPath, format, resolution, subtitles, subtitleStyle }),
  onExportProgress: (callback: (percent: number) => void) => {
    ipcRenderer.on('export:progress', (_, percent) => callback(percent));
  },
  saveProject: () => ipcRenderer.invoke('project:saveProject'),
  loadProject: () => ipcRenderer.invoke('project:loadProject'),
  writeProjectFile: (data: { filePath: string; data: any }) => ipcRenderer.invoke('project:writeProjectFile', data),
  readProjectFile: (filePath: string) => ipcRenderer.invoke('project:readProjectFile', filePath),
  readTextFile: (filePath: string) => ipcRenderer.invoke('file:readTextFile', filePath),
  transcribeVideo: (videoPath: string) => ipcRenderer.invoke('transcription:transcribeVideo', videoPath),
  transcribeTimeline: (clips: Array<{ path: string; startTime: number; duration: number }>) =>
    ipcRenderer.invoke('transcription:transcribeTimeline', clips),
  onTranscriptionProgress: (callback: (progress: { status: string; progress?: number; clip?: number }) => void) => {
    ipcRenderer.on('transcription:progress', (_, progress) => callback(progress));
  },
  analyzeChannel: (channelUrl: string) => ipcRenderer.invoke('analysis:analyzeChannel', channelUrl),
  getUserAnalysis: (userId: string) => ipcRenderer.invoke('analysis:getUserAnalysis', userId),
  linkAnalysisToUser: (userId: string, channelUrl: string) => ipcRenderer.invoke('analysis:linkToUser', userId, channelUrl),
  readFileAsBase64: (filePath: string) => ipcRenderer.invoke('file:readFileAsBase64', filePath),
  getFileSize: (filePath: string) => ipcRenderer.invoke('file:getFileSize', filePath),
  // AI Memory — file-based persistence (project-specific)
  memorySave: (data: any) => ipcRenderer.invoke('memory:save', data),
  memoryLoad: (projectId?: string) => ipcRenderer.invoke('memory:load', projectId),
  memorySaveMarkdown: (entry: any, projectId?: string) => ipcRenderer.invoke('memory:saveAnalysisMarkdown', entry, projectId),
  memoryGetDir: () => ipcRenderer.invoke('memory:getDir'),
  //  Generic invoke for testing mode
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
});
