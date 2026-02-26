import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../../src/stores/useProjectStore';
import type { Clip } from '../../src/stores/useProjectStore';

describe('useProjectStore', () => {
  beforeEach(() => {
    // Reset store before each test
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

  describe('addClip', () => {
    it('should add a clip to the store', () => {
      const { addClip, clips } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const state = useProjectStore.getState();
      expect(state.clips).toHaveLength(1);
      expect(state.clips[0].name).toBe('test video');
      expect(state.clips[0].duration).toBe(10);
      expect(state.clips[0].start).toBe(0);
      expect(state.clips[0].end).toBe(10);
    });

    it('should generate unique IDs for clips', () => {
      const { addClip } = useProjectStore.getState();
      
      addClip({
        path: '/test/video1.mp4',
        name: 'video 1',
        duration: 10,
        sourceDuration: 10,
      });
      
      addClip({
        path: '/test/video2.mp4',
        name: 'video 2',
        duration: 5,
        sourceDuration: 5,
      });

      const state = useProjectStore.getState();
      expect(state.clips).toHaveLength(2);
      expect(state.clips[0].id).not.toBe(state.clips[1].id);
    });
  });

  describe('removeClip', () => {
    it('should remove a clip by ID', () => {
      const { addClip, removeClip } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      removeClip(clipId);

      const state = useProjectStore.getState();
      expect(state.clips).toHaveLength(0);
    });

    it('should clear activeClipId if removed clip was active', () => {
      const { addClip, setActiveClip, removeClip } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      setActiveClip(clipId);
      expect(useProjectStore.getState().activeClipId).toBe(clipId);
      
      removeClip(clipId);
      expect(useProjectStore.getState().activeClipId).toBeNull();
    });
  });

  describe('splitClip', () => {
    it('should split a clip at the specified time', () => {
      const { addClip, splitClip } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      splitClip(clipId, 5);

      const state = useProjectStore.getState();
      expect(state.clips).toHaveLength(2);
      expect(state.clips[0].duration).toBe(5);
      expect(state.clips[0].start).toBe(0);
      expect(state.clips[0].end).toBe(5);
      expect(state.clips[1].duration).toBe(5);
      expect(state.clips[1].start).toBe(5);
      expect(state.clips[1].end).toBe(10);
    });

    it('should not split at invalid positions', () => {
      const { addClip, splitClip } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      
      // Try to split at the very start (invalid)
      splitClip(clipId, 0);
      expect(useProjectStore.getState().clips).toHaveLength(1);
      
      // Try to split at the very end (invalid)
      splitClip(clipId, 10);
      expect(useProjectStore.getState().clips).toHaveLength(1);
    });
  });

  describe('updateClip', () => {
    it('should update clip properties', () => {
      const { addClip, updateClip } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      updateClip(clipId, { start: 2, end: 8 });

      const state = useProjectStore.getState();
      expect(state.clips[0].start).toBe(2);
      expect(state.clips[0].end).toBe(8);
      expect(state.clips[0].duration).toBe(6);
    });
  });

  describe('mergeSelectedClips', () => {
    it('should merge multiple selected clips', () => {
      const { addClip, toggleClipSelection, mergeSelectedClips } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'video 1',
        duration: 5,
        sourceDuration: 10,
      });
      
      addClip({
        path: '/test/video.mp4',
        name: 'video 2',
        duration: 3,
        sourceDuration: 10,
      });

      const clips = useProjectStore.getState().clips;
      toggleClipSelection(clips[0].id, false);
      toggleClipSelection(clips[1].id, true);
      
      mergeSelectedClips();

      const state = useProjectStore.getState();
      expect(state.clips).toHaveLength(1);
      expect(state.clips[0].isMerged).toBe(true);
      expect(state.clips[0].duration).toBe(8);
      expect(state.clips[0].segments).toHaveLength(2);
    });

    it('should show error when trying to merge less than 2 clips', () => {
      const { addClip, toggleClipSelection, mergeSelectedClips } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'video 1',
        duration: 5,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      toggleClipSelection(clipId, false);
      
      mergeSelectedClips();

      const state = useProjectStore.getState();
      expect(state.notification?.type).toBe('error');
      expect(state.notification?.message).toContain('at least 2 clips');
    });
  });

  describe('copyClips and pasteClips', () => {
    it('should copy and paste selected clips', () => {
      const { addClip, toggleClipSelection, copyClips, pasteClips } = useProjectStore.getState();
      
      addClip({
        path: '/test/video.mp4',
        name: 'test video',
        duration: 10,
        sourceDuration: 10,
      });

      const clipId = useProjectStore.getState().clips[0].id;
      toggleClipSelection(clipId, false);
      
      copyClips();
      expect(useProjectStore.getState().copiedClips).toHaveLength(1);
      
      pasteClips();
      
      const state = useProjectStore.getState();
      expect(state.clips).toHaveLength(2);
      expect(state.clips[1].name).toContain('Copy');
    });
  });

  describe('reorderClips', () => {
    it('should reorder clips in timeline', () => {
      const { addClip, reorderClips } = useProjectStore.getState();
      
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

      reorderClips(0, 1);

      const state = useProjectStore.getState();
      expect(state.clips[0].name).toBe('video 2');
      expect(state.clips[1].name).toBe('video 1');
    });
  });
});
