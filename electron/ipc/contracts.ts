import { z } from 'zod';

export const IPC_CHANNELS = {
  ping: 'ping',
  dialog: {
    openFile: 'dialog:openFile',
    saveFile: 'dialog:saveFile',
  },
  media: {
    getMetadata: 'media:getMetadata',
    getThumbnail: 'media:getThumbnail',
    getWaveform: 'media:getWaveform',
    exportVideo: 'media:exportVideo',
    exportProgress: 'export:progress',
  },
  project: {
    saveProject: 'project:saveProject',
    writeProjectFile: 'project:writeProjectFile',
    loadProject: 'project:loadProject',
    readProjectFile: 'project:readProjectFile',
  },
  file: {
    readTextFile: 'file:readTextFile',
    readFileAsBase64: 'file:readFileAsBase64',
    getFileSize: 'file:getFileSize',
  },
  transcription: {
    transcribeVideo: 'transcription:transcribeVideo',
    transcribeTimeline: 'transcription:transcribeTimeline',
    progress: 'transcription:progress',
  },
  analysis: {
    analyzeChannel: 'analysis:analyzeChannel',
    getUserAnalysis: 'analysis:getUserAnalysis',
    linkToUser: 'analysis:linkToUser',
  },
  memory: {
    save: 'memory:save',
    load: 'memory:load',
    saveAnalysisMarkdown: 'memory:saveAnalysisMarkdown',
    getDir: 'memory:getDir',
    readMemoryFiles: 'read-memory-files',
  },
  bedrock: {
    converse: 'bedrock:converse',
  },
  youtube: {
    isAuthenticated: 'youtube:isAuthenticated',
    authenticate: 'youtube:authenticate',
    logout: 'youtube:logout',
    uploadVideo: 'youtube:uploadVideo',
    uploadProgress: 'youtube:uploadProgress',
  },
  window: {
    close: 'window:close',
  },
  update: {
    check: 'update:check',
    download: 'update:download',
    install: 'update:install',
    status: 'update:status',
  },
} as const;

export const nonEmptyStringSchema = z.string().trim().min(1);
export const filePathSchema = nonEmptyStringSchema;
export const saveFormatSchema = z.enum(['mp4', 'mov', 'avi', 'webm']);

export const projectWriteSchema = z.object({
  filePath: filePathSchema,
  data: z.unknown(),
});

export const exportVideoRequestSchema = z.object({
  clips: z.array(z.unknown()),
  outputPath: filePathSchema,
  format: saveFormatSchema.optional(),
  resolution: z.string().optional(),
  subtitles: z.array(z.unknown()).optional(),
  subtitleStyle: z.unknown().optional(),
});

export const timelineClipSchema = z.object({
  path: filePathSchema,
  startTime: z.number(),
  duration: z.number(),
});
export const timelineClipListSchema = z.array(timelineClipSchema);

export const memoryStateSchema = z.object({
  projectId: z.string().optional(),
  entries: z.array(z.unknown()).optional(),
});

export const memoryMarkdownEntrySchema = z.object({
  fileName: z.string().min(1),
  mediaType: z.string().optional(),
  filePath: z.string().optional(),
  mimeType: z.string().optional(),
  duration: z.number().optional(),
  status: z.string().optional(),
  updatedAt: z.union([z.string(), z.number()]).optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  analysis: z.string().optional(),
  visualInfo: z
    .object({
      subjects: z.array(z.string()).optional(),
      style: z.string().optional(),
      dominantColors: z.array(z.string()).optional(),
      composition: z.string().optional(),
      quality: z.string().optional(),
    })
    .optional(),
  audioInfo: z
    .object({
      hasSpeech: z.boolean().optional(),
      hasMusic: z.boolean().optional(),
      languages: z.array(z.string()).optional(),
      mood: z.string().optional(),
      transcriptSummary: z.string().optional(),
    })
    .optional(),
  scenes: z
    .array(
      z.object({
        startTime: z.number(),
        endTime: z.number(),
        description: z.string(),
      }),
    )
    .optional(),
});

export const youtubeUploadMetadataSchema = z.object({
  title: nonEmptyStringSchema,
  description: z.string().optional().default(''),
  tags: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  privacyStatus: z.enum(['public', 'private', 'unlisted']),
  madeForKids: z.boolean().optional(),
});

export const youtubeUploadRequestSchema = z.object({
  filePath: filePathSchema,
  metadata: youtubeUploadMetadataSchema,
});

export const bedrockConverseInputSchema = z.record(z.string(), z.unknown());

export type IpcInvokeContract = {
  ping: { args: []; result: string };
  'dialog:openFile': { args: []; result: string[] };
  'media:getMetadata': {
    args: [filePath: string];
    result: {
      duration: number;
      format: string;
      width: number;
      height: number;
      hasVideo?: boolean;
      hasAudio?: boolean;
      isImage?: boolean;
    };
  };
  'media:getThumbnail': { args: [filePath: string]; result: string | null };
  'media:getWaveform': { args: [filePath: string]; result: string | null };
  'dialog:saveFile': { args: [format?: string]; result: string | null };
  'media:exportVideo': {
    args: [payload: z.infer<typeof exportVideoRequestSchema>];
    result: boolean;
  };
  'project:saveProject': { args: []; result: string | null };
  'project:loadProject': { args: []; result: string | null };
  'project:writeProjectFile': {
    args: [payload: z.infer<typeof projectWriteSchema>];
    result: { success: boolean; error?: string };
  };
  'project:readProjectFile': {
    args: [filePath: string];
    result: { success: boolean; data?: unknown; error?: string };
  };
  'file:readTextFile': {
    args: [filePath: string];
    result: { success: boolean; data?: string; error?: string };
  };
  'transcription:transcribeVideo': {
    args: [videoPath: string];
    result: { success: boolean; result?: unknown; error?: string };
  };
  'transcription:transcribeTimeline': {
    args: [clips: Array<z.infer<typeof timelineClipSchema>>];
    result: { success: boolean; result?: unknown; error?: string };
  };
  'analysis:analyzeChannel': { args: [channelUrl: string]; result: unknown };
  'analysis:getUserAnalysis': {
    args: [userId: string];
    result: { success: boolean; data?: unknown; error?: string };
  };
  'analysis:linkToUser': {
    args: [userId: string, channelUrl: string];
    result: { success: boolean };
  };
  'file:readFileAsBase64': { args: [filePath: string]; result: string };
  'file:getFileSize': { args: [filePath: string]; result: number };
  'memory:save': {
    args: [payload: z.infer<typeof memoryStateSchema>];
    result: { success: boolean; path?: string; error?: string };
  };
  'memory:load': {
    args: [projectId?: string];
    result: { success: boolean; data?: unknown; error?: string };
  };
  'memory:saveAnalysisMarkdown': {
    args: [entry: z.infer<typeof memoryMarkdownEntrySchema>, projectId?: string];
    result: { success: boolean; path?: string; error?: string };
  };
  'memory:getDir': { args: []; result: { dir: string; index: string; analyses: string } };
  'bedrock:converse': { args: [input: Record<string, unknown>]; result: unknown };
  'youtube:isAuthenticated': { args: []; result: boolean };
  'youtube:authenticate': { args: []; result: boolean };
  'youtube:logout': { args: []; result: boolean };
  'youtube:uploadVideo': {
    args: [payload: z.infer<typeof youtubeUploadRequestSchema>];
    result: { success: boolean; videoId?: string; error?: string };
  };
  'window:close': { args: []; result: void };
  'update:check': {
    args: [];
    result: { enabled: boolean; started: boolean; error?: string };
  };
  'update:download': {
    args: [];
    result: { enabled: boolean; started: boolean; error?: string };
  };
  'update:install': { args: []; result: { enabled: boolean; started: boolean } };
};
