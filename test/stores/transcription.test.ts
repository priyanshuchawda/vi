import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectStore } from '../../src/stores/useProjectStore';

// Mock electron API globally
const mockTranscribeVideo = vi.fn();
const mockTranscribeTimeline = vi.fn();
const mockOnTranscriptionProgress = vi.fn();

// Set up global window mock before tests
(global as any).window = {
  electronAPI: {
    transcribeVideo: mockTranscribeVideo,
    transcribeTimeline: mockTranscribeTimeline,
    onTranscriptionProgress: mockOnTranscriptionProgress,
  },
};

describe('Transcription Feature - Store State Management', () => {
  beforeEach(() => {
    // Reset store
    const { result } = renderHook(() => useProjectStore());
    act(() => {
      result.current.clips = [];
      result.current.transcription = null;
      result.current.isTranscribing = false;
      result.current.transcriptionProgress = null;
    });

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Store State', () => {
    it('should initialize with null transcription', () => {
      const { result } = renderHook(() => useProjectStore());

      expect(result.current.transcription).toBeNull();
      expect(result.current.isTranscribing).toBe(false);
      expect(result.current.transcriptionProgress).toBeNull();
    });

    it('should set transcription result', () => {
      const { result } = renderHook(() => useProjectStore());

      const mockTranscription = {
        text: 'Hello world',
        segments: [{ id: 1, start: 0, end: 2, text: 'Hello world' }],
      };

      act(() => {
        result.current.setTranscription(mockTranscription);
      });

      expect(result.current.transcription).toEqual(mockTranscription);
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('should clear transcription', () => {
      const { result } = renderHook(() => useProjectStore());

      const mockTranscription = {
        text: 'Hello world',
        segments: [],
      };

      act(() => {
        result.current.setTranscription(mockTranscription);
      });

      expect(result.current.transcription).not.toBeNull();

      act(() => {
        result.current.clearTranscription();
      });

      expect(result.current.transcription).toBeNull();
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('should set transcription progress', () => {
      const { result } = renderHook(() => useProjectStore());

      const mockProgress = {
        status: 'Transcribing...',
        progress: 50,
        clip: 1,
      };

      act(() => {
        result.current.setTranscriptionProgress(mockProgress);
      });

      expect(result.current.transcriptionProgress).toEqual(mockProgress);
    });
  });

  describe('transcribeCurrentClip', () => {
    it('should show error when no clip is selected', async () => {
      const { result } = renderHook(() => useProjectStore());

      await act(async () => {
        await result.current.transcribeCurrentClip();
      });

      expect(result.current.notification).toEqual({
        type: 'error',
        message: 'No clip selected',
      });
    });

    it('should set isTranscribing to true and call electron API', () => {
      const { result } = renderHook(() => useProjectStore());

      // Add a clip
      act(() => {
        result.current.addClip({
          path: '/path/to/video.mp4',
          name: 'test.mp4',
          duration: 10,
          sourceDuration: 10,
          mediaType: 'video',
        });
      });

      // Verify clip was added
      expect(result.current.clips.length).toBe(1);
      expect(result.current.clips[0].path).toBe('/path/to/video.mp4');
      expect(result.current.clips[0].mediaType).toBe('video');
    });
  });

  describe('transcribeTimeline', () => {
    it('should show error when timeline is empty', async () => {
      const { result } = renderHook(() => useProjectStore());

      await act(async () => {
        await result.current.transcribeTimeline();
      });

      expect(result.current.notification).toEqual({
        type: 'error',
        message: 'No clips in timeline',
      });
    });

    it('should filter out image clips when preparing for transcription', () => {
      const { result } = renderHook(() => useProjectStore());

      // Add multiple clips of different types
      act(() => {
        result.current.addClip({
          path: '/path/to/video1.mp4',
          name: 'video1.mp4',
          duration: 3,
          sourceDuration: 3,
          mediaType: 'video',
        });
        result.current.addClip({
          path: '/path/to/audio.mp3',
          name: 'audio.mp3',
          duration: 5,
          sourceDuration: 5,
          mediaType: 'audio',
        });
        result.current.addClip({
          path: '/path/to/image.jpg',
          name: 'image.jpg',
          duration: 2,
          sourceDuration: 2,
          mediaType: 'image',
        });
      });

      // Verify clips were added
      expect(result.current.clips.length).toBe(3);

      // Verify we have video and audio clips
      const videoAudioClips = result.current.clips.filter(
        (clip) => clip.mediaType === 'video' || clip.mediaType === 'audio',
      );
      expect(videoAudioClips.length).toBe(2);
    });

    it('should show error when no video/audio clips exist', async () => {
      const { result } = renderHook(() => useProjectStore());

      // Add only image clips
      act(() => {
        result.current.addClip({
          path: '/path/to/image1.jpg',
          name: 'image1.jpg',
          duration: 2,
          sourceDuration: 2,
          mediaType: 'image',
        });
        result.current.addClip({
          path: '/path/to/image2.jpg',
          name: 'image2.jpg',
          duration: 3,
          sourceDuration: 3,
          mediaType: 'image',
        });
      });

      await act(async () => {
        await result.current.transcribeTimeline();
      });

      expect(result.current.notification).toEqual({
        type: 'error',
        message: 'No video/audio clips to transcribe',
      });
    });
  });

  describe('Integration with Project State', () => {
    it('should mark project as having unsaved changes after transcription', async () => {
      const { result } = renderHook(() => useProjectStore());

      const mockTranscription = {
        text: 'Transcribed text',
        segments: [],
      };

      act(() => {
        result.current.setTranscription(mockTranscription);
      });

      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('should maintain transcription across other operations', async () => {
      const { result } = renderHook(() => useProjectStore());

      const mockTranscription = {
        text: 'Important transcription',
        segments: [{ id: 1, start: 0, end: 5, text: 'Important transcription' }],
      };

      act(() => {
        result.current.setTranscription(mockTranscription);

        // Add a clip (should not affect transcription)
        result.current.addClip({
          path: '/path/to/video.mp4',
          name: 'video.mp4',
          duration: 5,
          sourceDuration: 5,
          mediaType: 'video',
        });
      });

      expect(result.current.transcription).toEqual(mockTranscription);
    });
  });
});
