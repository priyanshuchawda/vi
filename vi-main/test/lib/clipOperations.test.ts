import { describe, it, expect } from 'vitest';
import {
  validateSplitPosition,
  splitClipAtTime,
  validateClipsAdjacent,
  detectGaps,
  type ClipSegment,
} from '../../src/lib/clipOperations';

describe('clipOperations', () => {
  const createMockClip = (overrides?: Partial<ClipSegment>): ClipSegment => ({
    id: 'test-id',
    path: '/test/video.mp4',
    name: 'test',
    duration: 10,
    sourceDuration: 10,
    start: 0,
    end: 10,
    trackId: 'track-1',
    trackType: 'video',
    ...overrides,
  });

  describe('validateSplitPosition', () => {
    it('should validate correct split positions', () => {
      const clip = createMockClip({ start: 0, end: 10 });
      
      expect(validateSplitPosition(clip, 5)).toBe(true);
      expect(validateSplitPosition(clip, 2.5)).toBe(true);
      expect(validateSplitPosition(clip, 7.8)).toBe(true);
    });

    it('should reject split at boundaries', () => {
      const clip = createMockClip({ start: 0, end: 10 });
      
      expect(validateSplitPosition(clip, 0)).toBe(false);
      expect(validateSplitPosition(clip, 10)).toBe(false);
    });

    it('should reject split outside clip bounds', () => {
      const clip = createMockClip({ start: 0, end: 10 });
      
      expect(validateSplitPosition(clip, -1)).toBe(false);
      expect(validateSplitPosition(clip, 11)).toBe(false);
    });
  });

  describe('splitClipAtTime', () => {
    it('should split clip into two parts', () => {
      const clip = createMockClip({ start: 0, end: 10 });
      const result = splitClipAtTime(clip, 5);

      expect(result).not.toBeNull();
      expect(result?.before.start).toBe(0);
      expect(result?.before.end).toBe(5);
      expect(result?.before.duration).toBe(5);
      expect(result?.after.start).toBe(5);
      expect(result?.after.end).toBe(10);
      expect(result?.after.duration).toBe(5);
    });

    it('should return null for invalid split positions', () => {
      const clip = createMockClip({ start: 0, end: 10 });
      
      expect(splitClipAtTime(clip, 0)).toBeNull();
      expect(splitClipAtTime(clip, 10)).toBeNull();
      expect(splitClipAtTime(clip, -1)).toBeNull();
    });

    it('should generate unique IDs for split clips', () => {
      const clip = createMockClip({ start: 0, end: 10 });
      const result = splitClipAtTime(clip, 5);

      expect(result?.before.id).not.toBe(clip.id);
      expect(result?.after.id).not.toBe(clip.id);
      expect(result?.before.id).not.toBe(result?.after.id);
    });
  });

  describe('validateClipsAdjacent', () => {
    it('should validate adjacent clips', () => {
      const clips = [
        createMockClip({ start: 0, end: 5 }),
        createMockClip({ start: 5, end: 10 }),
        createMockClip({ start: 10, end: 15 }),
      ];

      expect(validateClipsAdjacent(clips)).toBe(true);
    });

    it('should detect gaps between clips', () => {
      const clips = [
        createMockClip({ start: 0, end: 5 }),
        createMockClip({ start: 7, end: 10 }), // Gap of 2 seconds
      ];

      expect(validateClipsAdjacent(clips)).toBe(false);
    });

    it('should handle single clip', () => {
      const clips = [createMockClip({ start: 0, end: 5 })];
      expect(validateClipsAdjacent(clips)).toBe(true);
    });

    it('should handle empty array', () => {
      expect(validateClipsAdjacent([])).toBe(true);
    });
  });

  describe('detectGaps', () => {
    it('should detect gaps between clips', () => {
      const clips = [
        createMockClip({ start: 0, end: 5 }),
        createMockClip({ start: 7, end: 10 }),
        createMockClip({ start: 15, end: 20 }),
      ];

      const gaps = detectGaps(clips);
      expect(gaps).toHaveLength(2);
      expect(gaps[0]).toEqual({ start: 5, end: 7 });
      expect(gaps[1]).toEqual({ start: 10, end: 15 });
    });

    it('should return empty array for adjacent clips', () => {
      const clips = [
        createMockClip({ start: 0, end: 5 }),
        createMockClip({ start: 5, end: 10 }),
      ];

      const gaps = detectGaps(clips);
      expect(gaps).toHaveLength(0);
    });

    it('should handle unsorted clips', () => {
      const clips = [
        createMockClip({ start: 10, end: 15 }),
        createMockClip({ start: 0, end: 5 }),
        createMockClip({ start: 7, end: 10 }),
      ];

      const gaps = detectGaps(clips);
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).toEqual({ start: 5, end: 7 });
    });
  });
});
