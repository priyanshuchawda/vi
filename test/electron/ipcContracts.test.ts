import { describe, expect, it } from 'vitest';
import {
  aiConfigSettingsSchema,
  aiConfigStatusSchema,
  bedrockConverseInputSchema,
  exportVideoRequestSchema,
  ipcErrorEnvelopeSchema,
  memoryMarkdownEntrySchema,
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

  it('rejects memory markdown entries without fileName', () => {
    const result = memoryMarkdownEntrySchema.safeParse({
      summary: 'sample',
    });
    expect(result.success).toBe(false);
  });

  it('rejects youtube upload payload with empty title', () => {
    const result = youtubeUploadRequestSchema.safeParse({
      filePath: '/tmp/test.mp4',
      metadata: {
        title: '   ',
        privacyStatus: 'private',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts object-based bedrock input and rejects primitives', () => {
    const ok = bedrockConverseInputSchema.safeParse({ modelId: 'x', payload: { ok: true } });
    const bad = bedrockConverseInputSchema.safeParse('not-an-object');
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it('accepts AI config settings and status payloads', () => {
    const settings = aiConfigSettingsSchema.safeParse({
      awsRegion: 'eu-central-1',
      awsAccessKeyId: 'key',
      awsSecretAccessKey: 'secret',
    });
    const status = aiConfigStatusSchema.safeParse({
      bedrockReady: false,
      youtubeReady: true,
      usingSavedSettings: true,
      usingEnvFallback: false,
      missingBedrockFields: ['AWS Region'],
      missingYouTubeFields: [],
    });

    expect(settings.success).toBe(true);
    expect(status.success).toBe(true);
  });

  it('accepts standardized IPC error envelopes with optional code', () => {
    const withCode = ipcErrorEnvelopeSchema.safeParse({
      success: false,
      error: 'Something failed',
      code: 'TEST_CODE',
    });
    const withoutCode = ipcErrorEnvelopeSchema.safeParse({
      success: false,
      error: 'Something failed',
    });
    const invalid = ipcErrorEnvelopeSchema.safeParse({
      success: false,
      message: 'wrong field',
    });

    expect(withCode.success).toBe(true);
    expect(withoutCode.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
