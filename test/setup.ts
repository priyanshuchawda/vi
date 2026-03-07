import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ElectronAPI } from '../src/types/electron';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

const mockElectronAPI: ElectronAPI = {
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
  saveFile: vi.fn().mockResolvedValue('/tmp/output.mp4'),
  exportVideo: vi.fn().mockResolvedValue(true),
  onExportProgress: vi.fn(() => () => {}),
  transcribeVideo: vi.fn().mockResolvedValue({ success: true }),
  transcribeTimeline: vi.fn().mockResolvedValue({ success: true }),
  onTranscriptionProgress: vi.fn(() => () => {}),
  saveProject: vi.fn().mockResolvedValue('/tmp/project.quickcut'),
  loadProject: vi.fn().mockResolvedValue('/tmp/project.quickcut'),
  writeProjectFile: vi.fn().mockResolvedValue({ success: true }),
  readProjectFile: vi.fn().mockResolvedValue({ success: true, data: {} }),
  readTextFile: vi.fn().mockResolvedValue({ success: true, data: '' }),
  analyzeChannel: vi.fn().mockResolvedValue({ success: false }),
  getUserAnalysis: vi.fn().mockResolvedValue({ success: false }),
  linkAnalysisToUser: vi.fn().mockResolvedValue({ success: false }),
  youtube: {
    isAuthenticated: vi.fn().mockResolvedValue(false),
    authenticate: vi.fn().mockResolvedValue(false),
    logout: vi.fn().mockResolvedValue(true),
    uploadVideo: vi.fn().mockResolvedValue({ success: false, error: 'Not configured' }),
  },
  updates: {
    check: vi.fn().mockResolvedValue({ enabled: false, started: false }),
    download: vi.fn().mockResolvedValue({ enabled: false, started: false }),
    install: vi.fn().mockResolvedValue({ enabled: false, started: false }),
    onStatus: vi.fn(() => () => {}),
  },
  readFileAsBase64: vi.fn().mockResolvedValue(''),
  getFileSize: vi.fn().mockResolvedValue(0),
  memorySave: vi.fn().mockResolvedValue({ success: true }),
  memoryLoad: vi.fn().mockResolvedValue({ success: true, data: { entries: [] } }),
  memorySaveMarkdown: vi.fn().mockResolvedValue({ success: true }),
  memoryGetDir: vi.fn().mockResolvedValue({ dir: '', index: '', analyses: '' }),
  rulesWrite: vi.fn().mockResolvedValue({ success: true }),
  rulesRead: vi.fn().mockResolvedValue({ success: true, content: null }),
  bedrockConverse: vi.fn().mockResolvedValue({
    output: { message: { content: [{ text: '{}' }] } },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }),
};

// Mock window.electronAPI
global.window.electronAPI = mockElectronAPI;
