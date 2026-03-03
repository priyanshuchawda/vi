import type { Clip } from '../stores/useProjectStore';

interface ExportSegment {
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
  fadeIn?: number;
  fadeOut?: number;
}

export const generateExportSegments = (clips: Clip[]): ExportSegment[] => {
  const segments: ExportSegment[] = [];
  let outputTime = 0;

  for (const clip of clips) {
    if (clip.segments && clip.isMerged) {
      for (const segment of clip.segments) {
        segments.push({
          sourcePath: segment.sourcePath,
          sourceStart: segment.sourceStart,
          sourceEnd: segment.sourceEnd,
          outputStart: outputTime,
          outputEnd: outputTime + segment.duration,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
        });
        outputTime += segment.duration;
      }
    } else {
      segments.push({
        sourcePath: clip.path,
        sourceStart: clip.start,
        sourceEnd: clip.end,
        outputStart: outputTime,
        outputEnd: outputTime + clip.duration,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
      });
      outputTime += clip.duration;
    }
  }

  return segments;
};

export const buildFFmpegConcatList = (segments: ExportSegment[]): string[] => {
  return segments.map(
    (seg) =>
      `file '${seg.sourcePath.replace(/'/g, "'\\''")}'
inpoint ${seg.sourceStart.toFixed(6)}
outpoint ${seg.sourceEnd.toFixed(6)}`,
  );
};

export const validateTimelineContinuity = (clips: Clip[]): boolean => {
  const EPSILON = 0.001;

  for (let i = 0; i < clips.length - 1; i++) {
    const currentEnd = clips[i].duration;
    const nextStart = 0;
    const gap = Math.abs(nextStart - currentEnd);

    if (gap > EPSILON) {
      return false;
    }
  }

  return true;
};

export const detectOverlaps = (clips: Array<{ start: number; end: number }>): boolean => {
  const sorted = [...clips].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].end > sorted[i + 1].start) {
      return true;
    }
  }

  return false;
};

export const canMergeClips = (clips: Clip[]): { valid: boolean; reason?: string } => {
  if (clips.length < 2) {
    return { valid: false, reason: 'Need at least 2 clips' };
  }

  if (clips.some((c) => c.locked)) {
    return { valid: false, reason: 'Cannot merge locked clips' };
  }

  const tracks = new Set(clips.map((c) => c.trackId || 'default'));
  if (tracks.size > 1) {
    return { valid: false, reason: 'Clips must be on same track' };
  }

  const hasOverlaps = detectOverlaps(
    clips.map((c, i) => ({
      start: i * 100,
      end: i * 100 + c.duration,
    })),
  );

  if (hasOverlaps) {
    return { valid: false, reason: 'Cannot merge overlapping clips' };
  }

  return { valid: true };
};
