/**
 * Helper functions for professional-quality transcript-based video editing
 */

/**
 * Snap a time value to the nearest frame boundary
 */
export function snapToFrame(time: number, frameRate: number): number {
  const frameDuration = 1 / frameRate;
  return Math.round(time / frameDuration) * frameDuration;
}

/**
 * Check if a time range likely contains silence
 * Uses heuristics based on word boundaries and gaps
 */
export function detectSilenceRegion(
  time: number,
  words: Array<{ start: number; end: number; word: string }>,
  threshold: number = 0.1,
): { start: number; end: number } | null {
  // Find words around this time
  const beforeWord = words.filter((w) => w.end <= time).pop();
  const afterWord = words.find((w) => w.start >= time);

  if (!beforeWord || !afterWord) return null;

  const gap = afterWord.start - beforeWord.end;

  // If there's a significant gap, return it as silence region
  if (gap >= threshold) {
    return {
      start: beforeWord.end,
      end: afterWord.start,
    };
  }

  return null;
}

/**
 * Align a cut time to the nearest silence region
 */
export function alignToSilence(
  cutTime: number,
  words: Array<{ start: number; end: number; word: string }>,
  maxDistance: number = 0.2,
): number {
  const silenceRegion = detectSilenceRegion(cutTime, words);

  if (!silenceRegion) return cutTime;

  const silenceCenter = (silenceRegion.start + silenceRegion.end) / 2;
  const distance = Math.abs(silenceCenter - cutTime);

  // Only snap if within max distance
  if (distance <= maxDistance) {
    return silenceCenter;
  }

  return cutTime;
}

/**
 * Merge deletion ranges that are close together
 */
export function mergeCloseRanges(
  ranges: Array<{ start: number; end: number }>,
  tolerance: number = 0.3,
): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastMerged = merged[merged.length - 1];

    // Check if current range is close enough to merge
    const gap = current.start - lastMerged.end;

    if (gap <= tolerance) {
      // Merge by extending the end time
      lastMerged.end = Math.max(lastMerged.end, current.end);
    } else {
      // Add as new range
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Apply padding to cut ranges and snap to frames/silence
 */
export function prepareCutRanges(
  ranges: Array<{ start: number; end: number }>,
  settings: {
    cutPadding: number;
    mergeTolerance: number;
    snapToSilence: boolean;
    snapToFrames: boolean;
    frameRate: number;
  },
  words?: Array<{ start: number; end: number; word: string }>,
): Array<{ start: number; end: number }> {
  // Apply padding
  let paddedRanges = ranges.map((range) => ({
    start: Math.max(0, range.start - settings.cutPadding),
    end: range.end + settings.cutPadding,
  }));

  // Merge close ranges
  paddedRanges = mergeCloseRanges(paddedRanges, settings.mergeTolerance);

  // Align to silence if enabled and words available
  if (settings.snapToSilence && words) {
    paddedRanges = paddedRanges.map((range) => {
      const newStart = alignToSilence(range.start, words, 0.15);
      const newEnd = alignToSilence(range.end, words, 0.15);
      return { start: newStart, end: newEnd };
    });
  }

  // Snap to frame boundaries if enabled
  if (settings.snapToFrames) {
    paddedRanges = paddedRanges.map((range) => ({
      start: snapToFrame(range.start, settings.frameRate),
      end: snapToFrame(range.end, settings.frameRate),
    }));
  }

  return paddedRanges;
}

/**
 * Calculate optimal crossfade duration based on cut context
 */
export function calculateCrossfadeDuration(baseDuration: number, cutDuration: number): number {
  // For very short segments after cut, use shorter crossfade
  if (cutDuration < 0.1) {
    return Math.min(baseDuration, cutDuration * 0.3);
  }

  return baseDuration;
}
