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
  aiConfig: {
    get: vi.fn().mockResolvedValue({
      youtubeApiKey: '',
      awsRegion: 'us-east-1',
      awsAccessKeyId: 'test-key',
      awsSecretAccessKey: 'test-secret',
      awsSessionToken: '',
      bedrockInferenceProfileId: '',
      bedrockModelId: 'amazon.nova-lite-v1:0',
      youtubeOAuthClientId: '',
      youtubeOAuthClientSecret: '',
      youtubeOAuthRedirectUri: '',
    }),
    save: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({
      bedrockReady: true,
      youtubeReady: false,
      usingSavedSettings: false,
      usingEnvFallback: true,
      missingBedrockFields: [],
      missingYouTubeFields: ['YouTube API Key'],
    }),
  },
  storage: {
    saveProfile: vi.fn().mockResolvedValue({ success: true }),
    loadProfile: vi.fn().mockResolvedValue({ success: true, data: null }),
    uploadExportedVideo: vi.fn().mockResolvedValue({ success: true, record: null }),
    listExportedVideos: vi.fn().mockResolvedValue({ success: true, items: [] }),
    syncAiContext: vi.fn().mockResolvedValue({ success: true }),
    loadAiContext: vi.fn().mockResolvedValue({ success: true, data: null }),
  },
};

function createStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
  };
}

const localStorageMock = createStorageMock();

// Make the Electron bridge available in both browser-like and node test environments.
if (typeof globalThis.window === 'undefined') {
  vi.stubGlobal('window', { electronAPI: mockElectronAPI });
} else {
  globalThis.window.electronAPI = mockElectronAPI;
}

if (
  typeof globalThis.localStorage === 'undefined' ||
  typeof globalThis.localStorage?.getItem !== 'function' ||
  typeof globalThis.localStorage?.setItem !== 'function' ||
  typeof globalThis.localStorage?.clear !== 'function'
) {
  vi.stubGlobal('localStorage', localStorageMock);
}

if (typeof globalThis.window !== 'undefined') {
  Object.defineProperty(globalThis.window, 'localStorage', {
    value: globalThis.localStorage,
    configurable: true,
  });
}
