import { v4 as uuidv4 } from 'uuid';

export interface ClipSegment {
  id: string;
  path: string;
  name: string;
  duration: number;
  sourceDuration: number;
  start: number;
  end: number;
  trackId: string;
  trackType: 'video' | 'audio' | 'linked';
  linkedClipId?: string;
  thumbnail?: string;
  waveform?: string;
}

export interface Track {
  id: string;
  type: 'video' | 'audio';
  clips: ClipSegment[];
  locked: boolean;
  muted: boolean;
}

export interface SplitResult {
  before: ClipSegment;
  after: ClipSegment;
}

export interface MergeResult {
  merged: ClipSegment;
  gaps: Array<{ start: number; end: number }>;
}

export interface RenderSegment {
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  outputStart: number;
  outputEnd: number;
  duration: number;
  trackType: 'video' | 'audio';
}

export interface TimelineExportData {
  segments: RenderSegment[];
  totalDuration: number;
  videoTracks: Track[];
  audioTracks: Track[];
}

const EPSILON = 0.001;

export const validateSplitPosition = (clip: ClipSegment, splitTime: number): boolean => {
  return splitTime > clip.start + EPSILON && splitTime < clip.end - EPSILON;
};

export const splitClipAtTime = (clip: ClipSegment, splitTime: number): SplitResult | null => {
  if (!validateSplitPosition(clip, splitTime)) {
    return null;
  }

  const before: ClipSegment = {
    ...clip,
    id: uuidv4(),
    end: splitTime,
    duration: splitTime - clip.start,
  };

  const after: ClipSegment = {
    ...clip,
    id: uuidv4(),
    start: splitTime,
    duration: clip.end - splitTime,
  };

  return { before, after };
};

export const splitLinkedClips = (
  videoClip: ClipSegment,
  audioClip: ClipSegment,
  splitTime: number,
): { video: SplitResult; audio: SplitResult } | null => {
  const videoResult = splitClipAtTime(videoClip, splitTime);
  const audioResult = splitClipAtTime(audioClip, splitTime);

  if (!videoResult || !audioResult) {
    return null;
  }

  videoResult.before.linkedClipId = audioResult.before.id;
  videoResult.after.linkedClipId = audioResult.after.id;
  audioResult.before.linkedClipId = videoResult.before.id;
  audioResult.after.linkedClipId = videoResult.after.id;

  return { video: videoResult, audio: audioResult };
};

export const validateClipsAdjacent = (
  clips: ClipSegment[],
  gapTolerance: number = 0.1,
): boolean => {
  if (clips.length < 2) return true;

  const sorted = [...clips].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].start - sorted[i].end;
    if (Math.abs(gap) > gapTolerance) {
      return false;
    }
  }

  return true;
};

export const detectGaps = (clips: ClipSegment[]): Array<{ start: number; end: number }> => {
  if (clips.length < 2) return [];

  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].end;
    const gapEnd = sorted[i + 1].start;
    if (gapEnd - gapStart > EPSILON) {
      gaps.push({ start: gapStart, end: gapEnd });
    }
  }

  return gaps;
};

export const mergeSameSourceClips = (clips: ClipSegment[]): MergeResult | null => {
  if (clips.length < 2) return null;

  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const firstClip = sorted[0];
  const sameSource = sorted.every((c) => c.path === firstClip.path);

  if (!sameSource) return null;

  const minStart = Math.min(...sorted.map((c) => c.start));
  const maxEnd = Math.max(...sorted.map((c) => c.end));
  const gaps = detectGaps(sorted);

  const merged: ClipSegment = {
    id: uuidv4(),
    path: firstClip.path,
    name: firstClip.name,
    start: minStart,
    end: maxEnd,
    duration: maxEnd - minStart,
    sourceDuration: firstClip.sourceDuration,
    trackId: firstClip.trackId,
    trackType: firstClip.trackType,
    thumbnail: firstClip.thumbnail,
    waveform: firstClip.waveform,
  };

  return { merged, gaps };
};

export const mergeDifferentSourceClips = (clips: ClipSegment[]): ClipSegment[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  let outputTime = 0;

  return sorted.map((clip) => {
    const start = outputTime;
    outputTime += clip.duration;
    return {
      ...clip,
      id: uuidv4(),
      start,
      end: outputTime,
      duration: clip.duration,
    };
  });
};

export const generateRenderSegments = (
  clips: ClipSegment[],
  startTime?: number,
  endTime?: number,
): RenderSegment[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  let outputTime = 0;
  const segments: RenderSegment[] = [];

  for (const clip of sorted) {
    if (startTime !== undefined && clip.end < startTime) continue;
    if (endTime !== undefined && clip.start > endTime) break;

    const segmentStart = startTime !== undefined ? Math.max(clip.start, startTime) : clip.start;
    const segmentEnd = endTime !== undefined ? Math.min(clip.end, endTime) : clip.end;
    const segmentDuration = segmentEnd - segmentStart;

    if (segmentDuration > EPSILON) {
      segments.push({
        sourcePath: clip.path,
        sourceStart: clip.start,
        sourceEnd: clip.end,
        outputStart: outputTime,
        outputEnd: outputTime + segmentDuration,
        duration: segmentDuration,
        trackType: clip.trackType === 'linked' ? 'video' : clip.trackType,
      });

      outputTime += segmentDuration;
    }
  }

  return segments;
};

export const prepareTimelineExport = (
  videoTracks: Track[],
  audioTracks: Track[],
  startTime?: number,
  endTime?: number,
): TimelineExportData => {
  const allVideoClips = videoTracks.flatMap((t) => t.clips);
  const allAudioClips = audioTracks.flatMap((t) => t.clips);

  const videoSegments = generateRenderSegments(allVideoClips, startTime, endTime);
  const audioSegments = generateRenderSegments(allAudioClips, startTime, endTime);

  const allSegments = [...videoSegments, ...audioSegments].sort(
    (a, b) => a.outputStart - b.outputStart,
  );

  const totalDuration = Math.max(...allSegments.map((s) => s.outputEnd), 0);

  return {
    segments: allSegments,
    totalDuration,
    videoTracks,
    audioTracks,
  };
};

export const buildRenderList = (
  segments: RenderSegment[],
): Array<{ sourcePath: string; sourceIn: number; sourceOut: number }> => {
  return segments.map((seg) => ({
    sourcePath: seg.sourcePath,
    sourceIn: seg.sourceStart,
    sourceOut: seg.sourceEnd,
  }));
};

export const mergeAdjacentClips = (clips: ClipSegment[]): ClipSegment[] => {
  if (clips.length < 2) return clips;

  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const merged: ClipSegment[] = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    if (
      current.path === next.path &&
      Math.abs(current.end - next.start) < EPSILON &&
      current.end === next.start
    ) {
      current = {
        ...current,
        end: next.end,
        duration: next.end - current.start,
      };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
};

export const splitClipsByTrack = (clips: ClipSegment[]): Map<string, ClipSegment[]> => {
  const trackMap = new Map<string, ClipSegment[]>();

  for (const clip of clips) {
    const trackClips = trackMap.get(clip.trackId) || [];
    trackClips.push(clip);
    trackMap.set(clip.trackId, trackClips);
  }

  return trackMap;
};

export const rippleDelete = (clips: ClipSegment[], deletedClip: ClipSegment): ClipSegment[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const deleteIndex = sorted.findIndex((c) => c.id === deletedClip.id);

  if (deleteIndex === -1) return clips;

  const beforeDelete = sorted.slice(0, deleteIndex);
  const afterDelete = sorted.slice(deleteIndex + 1);

  const rippled = afterDelete.map((clip) => ({
    ...clip,
    start: clip.start - deletedClip.duration,
    end: clip.end - deletedClip.duration,
  }));

  return [...beforeDelete, ...rippled];
};

export const rippleInsert = (
  clips: ClipSegment[],
  insertClip: ClipSegment,
  insertTime: number,
): ClipSegment[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start);

  const before = sorted.filter((c) => c.end <= insertTime);
  const after = sorted.filter((c) => c.start > insertTime);

  const rippled = after.map((clip) => ({
    ...clip,
    start: clip.start + insertClip.duration,
    end: clip.end + insertClip.duration,
  }));

  const positioned = {
    ...insertClip,
    start: insertTime,
    end: insertTime + insertClip.duration,
  };

  return [...before, positioned, ...rippled];
};
