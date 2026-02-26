import { expect, afterEach, vi } from 'vitest';
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
  saveProject: vi.fn().mockResolvedValue('/tmp/project.quickcut'),
  loadProject: vi.fn().mockResolvedValue('/tmp/project.quickcut'),
  writeProjectFile: vi.fn().mockResolvedValue({ success: true }),
  readProjectFile: vi.fn().mockResolvedValue({ success: true, data: {} }),
};
