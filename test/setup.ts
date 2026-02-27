import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.electronAPI
global.window.electronAPI = {
  ping: vi.fn().mockResolvedValue('pong'),
  openFile: vi.fn().mockResolvedValue([]),
  getMetadata: vi.fn().mockResolvedValue({
    duration: 10,
    format: 'mp4',
    width: 1920,
    height: 1080,
    hasVideo: true,
    hasAudio: true,
  }),
  getThumbnail: vi.fn().mockResolvedValue('data:image/png;base64,test'),
  getWaveform: vi.fn().mockResolvedValue('data:image/png;base64,test'),
  convertImageToVideo: vi.fn().mockResolvedValue('/tmp/converted.mp4'),
  saveFile: vi.fn().mockResolvedValue('/tmp/output.mp4'),
  exportVideo: vi.fn().mockResolvedValue(true),
  onExportProgress: vi.fn(),
  transcribeVideo: vi.fn().mockResolvedValue({ success: true, result: null }),
  transcribeTimeline: vi.fn().mockResolvedValue({ success: true, result: null }),
  onTranscriptionProgress: vi.fn(),
  saveProject: vi.fn().mockResolvedValue('/tmp/project.quickcut'),
  loadProject: vi.fn().mockResolvedValue('/tmp/project.quickcut'),
  writeProjectFile: vi.fn().mockResolvedValue({ success: true }),
  readProjectFile: vi.fn().mockResolvedValue({ success: true, data: {} }),
  readTextFile: vi.fn().mockResolvedValue({ success: true, data: '' }),
  analyzeChannel: vi.fn().mockResolvedValue({ success: false }),
  getUserAnalysis: vi.fn().mockResolvedValue({ success: false }),
  linkAnalysisToUser: vi.fn().mockResolvedValue({ success: false }),
  youtubeIsAuthenticated: vi.fn().mockResolvedValue(false),
  youtubeAuthenticate: vi.fn().mockResolvedValue({ success: false }),
  youtubeLogout: vi.fn().mockResolvedValue({ success: true }),
  youtubeUploadVideo: vi.fn().mockResolvedValue({ success: false }),
  youtubeGetUserVideos: vi.fn().mockResolvedValue({ success: true, videos: [] }),
  onYoutubeUploadProgress: vi.fn(),
  readFileAsBase64: vi.fn().mockResolvedValue(''),
  getFileSize: vi.fn().mockResolvedValue(0),
  memorySave: vi.fn().mockResolvedValue({ success: true }),
  memoryLoad: vi.fn().mockResolvedValue({ success: true, data: { entries: [] } }),
  memorySaveMarkdown: vi.fn().mockResolvedValue({ success: true }),
  memoryGetDir: vi.fn().mockResolvedValue({ dir: '', index: '', analyses: '' }),
  bedrockConverse: vi.fn().mockResolvedValue({
    output: { message: { content: [{ text: '{}' }] } },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }),
};
