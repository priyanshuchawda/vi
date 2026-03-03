import { describe, expect, it } from 'vitest';
import {
  exportVideoRequestSchema,
  memoryStateSchema,
  projectWriteSchema,
  timelineClipListSchema,
  youtubeUploadRequestSchema,
} from '../../electron/ipc/contracts';

describe('IPC contract schemas', () => {
  it('rejects empty project file path for project write payload', () => {
    const result = projectWriteSchema.safeParse({ filePath: '', data: {} });
    expect(result.success).toBe(false);
  });

  it('rejects invalid export video payload', () => {
    const result = exportVideoRequestSchema.safeParse({
      clips: [],
      outputPath: '',
      format: 'mp4',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed timeline clips payload', () => {
    const result = timelineClipListSchema.safeParse([
      { path: '/tmp/file.mp4', startTime: '0', duration: 5 },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects invalid youtube upload privacy value', () => {
    const result = youtubeUploadRequestSchema.safeParse({
      filePath: '/tmp/test.mp4',
      metadata: {
        title: 'Demo',
        privacyStatus: 'friends-only',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object memory state payload', () => {
    const result = memoryStateSchema.safeParse('bad');
    expect(result.success).toBe(false);
  });
});
