import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../../src/stores/useProjectStore';

describe('Video Editor Integration Tests', () => {
  beforeEach(() => {
    // Reset store
    useProjectStore.setState({
      clips: [],
      activeClipId: null,
      selectedClipIds: [],
      currentTime: 0,
      isPlaying: false,
      notification: null,
      copiedClips: [],
      projectPath: null,
    });
  });

  describe('Complete editing workflow', () => {
    it('should handle import -> split -> merge -> export workflow', () => {
      const { addClip, setActiveClip, splitClip, toggleClipSelection, mergeSelectedClips } =
        useProjectStore.getState();

      // Step 1: Import video
      addClip({
        path: '/test/video.mp4',
        name: 'main video',
        duration: 20,
        sourceDuration: 20,
      });

      expect(useProjectStore.getState().clips).toHaveLength(1);

      // Step 2: Select and split at 10 seconds
      const clipId = useProjectStore.getState().clips[0].id;
      setActiveClip(clipId);
      splitClip(clipId, 10);

      const clips = useProjectStore.getState().clips;
      expect(clips).toHaveLength(2);
      expect(clips[0].duration).toBe(10);
      expect(clips[1].duration).toBe(10);

      // Step 3: Select both clips
      toggleClipSelection(clips[0].id, false);
      toggleClipSelection(clips[1].id, true);

      expect(useProjectStore.getState().selectedClipIds).toHaveLength(2);

      // Step 4: Merge selected clips
      mergeSelectedClips();

      const mergedClips = useProjectStore.getState().clips;
      expect(mergedClips).toHaveLength(1);
      expect(mergedClips[0].isMerged).toBe(true);
      expect(mergedClips[0].duration).toBe(20);
    });

    it('should handle multiple imports and reordering', () => {
      const { addClip, reorderClips } = useProjectStore.getState();

      // Import multiple videos
      addClip({
        path: '/test/video1.mp4',
        name: 'video 1',
        duration: 5,
        sourceDuration: 5,
      });

      addClip({
        path: '/test/video2.mp4',
        name: 'video 2',
        duration: 3,
        sourceDuration: 3,
      });

      addClip({
        path: '/test/video3.mp4',
        name: 'video 3',
        duration: 7,
        sourceDuration: 7,
      });

      let clips = useProjectStore.getState().clips;
      expect(clips).toHaveLength(3);

      // Reorder: move first to last
      reorderClips(0, 2);

      clips = useProjectStore.getState().clips;
      expect(clips[0].name).toBe('video 2');
      expect(clips[1].name).toBe('video 3');
      expect(clips[2].name).toBe('video 1');
    });

    it('should handle trimming and preserve clip data', () => {
      const { addClip, updateClip } = useProjectStore.getState();

      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 20,
        sourceDuration: 20,
        thumbnail: 'thumb.jpg',
        waveform: 'wave.png',
      });

      const clipId = useProjectStore.getState().clips[0].id;

      // Trim clip: keep only 5-15 seconds
      updateClip(clipId, { start: 5, end: 15 });

      const clip = useProjectStore.getState().clips[0];
      expect(clip.start).toBe(5);
      expect(clip.end).toBe(15);
      expect(clip.duration).toBe(10);
      expect(clip.thumbnail).toBe('thumb.jpg');
      expect(clip.waveform).toBe('wave.png');
    });

    it('should handle copy-paste workflow', () => {
      const { addClip, toggleClipSelection, copyClips, pasteClips, setCurrentTime } =
        useProjectStore.getState();

      // Add clip
      addClip({
        path: '/test/video.mp4',
        name: 'original',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;

      // Select and copy
      toggleClipSelection(clipId, false);
      copyClips();

      expect(useProjectStore.getState().copiedClips).toHaveLength(1);

      // Paste
      setCurrentTime(10);
      pasteClips();

      const clips = useProjectStore.getState().clips;
      expect(clips).toHaveLength(2);
      expect(clips[1].name).toContain('Copy');
      expect(clips[1].startTime).toBe(10);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid split positions gracefully', () => {
      const { addClip, splitClip } = useProjectStore.getState();

      addClip({
        path: '/test/video.mp4',
        name: 'test',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;

      // Try invalid splits
      splitClip(clipId, -1);
      splitClip(clipId, 0);
      splitClip(clipId, 10);
      splitClip(clipId, 100);

      // Should still have only 1 clip
      expect(useProjectStore.getState().clips).toHaveLength(1);
    });

    it('should handle removing non-existent clip', () => {
      const { addClip, removeClip } = useProjectStore.getState();

      addClip({
        path: '/test/video.mp4',
        name: 'test',
        duration: 10,
        sourceDuration: 10,
      });

      expect(useProjectStore.getState().clips).toHaveLength(1);

      // Try to remove non-existent clip
      removeClip('non-existent-id');

      // Should still have 1 clip
      expect(useProjectStore.getState().clips).toHaveLength(1);
    });
  });

  describe('Timeline calculations', () => {
    it('should calculate total duration correctly', () => {
      const { addClip } = useProjectStore.getState();

      addClip({
        path: '/test/video1.mp4',
        name: 'video 1',
        duration: 5.5,
        sourceDuration: 10,
      });

      addClip({
        path: '/test/video2.mp4',
        name: 'video 2',
        duration: 3.2,
        sourceDuration: 5,
      });

      addClip({
        path: '/test/video3.mp4',
        name: 'video 3',
        duration: 7.8,
        sourceDuration: 15,
      });

      const clips = useProjectStore.getState().clips;
      const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);

      expect(totalDuration).toBeCloseTo(16.5, 1);
    });
  });
});
