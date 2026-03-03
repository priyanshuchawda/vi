export interface SubtitleEntry {
  index: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
}

/**
 * Parse SRT time format (00:00:00,000) to seconds
 */
export const parseSRTTime = (timeString: string): number => {
  const match = timeString.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

/**
 * Parse SRT file content into subtitle entries
 */
export const parseSRT = (content: string): SubtitleEntry[] => {
  const subtitles: SubtitleEntry[] = [];

  // Split by double newline to separate entries
  const blocks = content.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // First line: index
    const index = parseInt(lines[0], 10);
    if (isNaN(index)) continue;

    // Second line: timestamps
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    const startTime = parseSRTTime(timeMatch[1]);
    const endTime = parseSRTTime(timeMatch[2]);

    // Remaining lines: text
    const text = lines.slice(2).join('\n');

    subtitles.push({
      index,
      startTime,
      endTime,
      text,
    });
  }

  return subtitles;
};

/**
 * Generate SRT file content from subtitle entries
 */
export const generateSRT = (subtitles: SubtitleEntry[]): string => {
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
  };

  return subtitles
    .map((sub) => {
      return `${sub.index}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${sub.text}\n`;
    })
    .join('\n');
};

/**
 * Get active subtitle at a given time
 */
export const getActiveSubtitle = (
  subtitles: SubtitleEntry[],
  currentTime: number,
): SubtitleEntry | null => {
  return subtitles.find((sub) => currentTime >= sub.startTime && currentTime < sub.endTime) || null;
};
