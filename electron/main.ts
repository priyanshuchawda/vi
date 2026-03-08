import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
  dialog,
  nativeImage,
  protocol,
  net,
  session,
  shell,
} from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { config } from 'dotenv';
import { z } from 'zod';
import { ConverseCommand, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { FfprobeData, FfprobeStream } from 'fluent-ffmpeg';
import {
  aiConfigSettingsSchema,
  IPC_CHANNELS,
  bedrockConverseInputSchema,
  exportVideoRequestSchema,
  filePathSchema,
  memoryMarkdownEntrySchema,
  memoryStateSchema,
  nonEmptyStringSchema,
  projectWriteSchema,
  saveFormatSchema,
  timelineClipSchema,
  youtubeUploadRequestSchema,
} from './ipc/contracts.js';
import ffmpeg, { exportVideo, generateThumbnail, generateWaveform } from './ffmpeg/processor.js';
import { transcribeVideo, transcribeTimeline } from './utils/transcription.js';
import {
  authenticateUser,
  isAuthenticated,
  logout as youtubeLogout,
} from './services/youtubeAuthService.js';
import { uploadVideo } from './services/youtubeUploadService.js';
import { loadYouTubeOAuthCredentials } from './services/youtubeOAuthConfig.js';
import fssync from 'fs';
import { setupAutoUpdates } from './services/updateService.js';
import { captureMainException, initMainObservability } from './services/observabilityService.js';
import { AiConfigService, normalizeBedrockModelIdentifier } from './services/aiConfigService.js';
import { log } from './utils/logger.js';
import { getCloudBackendService } from './services/cloudBackendService.js';
import {
  assertSecureWebPreferences,
  AuthorizedPathRegistry,
  isValidMediaProtocolPath,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  packagedCspPolicy,
  shouldAllowPermissionRequest,
  shouldBlockNavigation,
} from './security/policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_MEDIA_SCHEME = 'app-media';
const DEV_USER_DATA_DIR_NAME = 'QuickCut-dev';

if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), DEV_USER_DATA_DIR_NAME));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Load environment variables from .env file.
// For packaged builds, first look next to the executable so users can drop a
// .env file alongside QuickCut.exe.  Fall back to the dev-time path when
// running from source.
const devEnvPath = path.join(__dirname, '../.env');
const exeEnvPath = path.join(path.dirname(app.getPath('exe')), '.env');
const resolvedEnvPath = app.isPackaged ? exeEnvPath : devEnvPath;
config({ path: resolvedEnvPath });
// Also try the dev path as a secondary fallback for packaged dev builds
if (app.isPackaged) {
  config({ path: devEnvPath, override: false });
}
initMainObservability();

const aiConfigService = new AiConfigService(app.getPath('userData'), {
  envFilePath: resolvedEnvPath,
});
const initialAiSettings = aiConfigService.getSettings();
const initialAiStatus = aiConfigService.getStatus();

log('info', 'AI config loaded', {
  youtubeApiKey: initialAiSettings.youtubeApiKey ? 'Set' : 'Missing',
  awsRegion: initialAiSettings.awsRegion,
  awsAccessKey: initialAiSettings.awsAccessKeyId ? 'Set' : 'Missing',
  awsSecretKey: initialAiSettings.awsSecretAccessKey ? 'Set' : 'Missing',
  usingSavedSettings: initialAiStatus.usingSavedSettings,
  usingEnvFallback: initialAiStatus.usingEnvFallback,
  cloudBackendMode: getCloudBackendService().mode,
});

// Set the application name for the menu bar
app.setName('QuickCut');

let mainWindow: BrowserWindow | null = null;
let updateService: ReturnType<typeof setupAutoUpdates> | null = null;
const authorizedPaths = new AuthorizedPathRegistry();

function ipcFailure(error: unknown, code: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : String(error),
    code,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTrustedRendererDevUrl(): string {
  return process.env.VITE_DEV_SERVER_URL || 'http://localhost:7377';
}

function getTrustedPackagedRendererUrl(): string {
  return pathToFileURL(path.join(__dirname, '../dist/index.html')).toString();
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (
    !isTrustedRendererUrl(senderUrl, {
      packaged: app.isPackaged,
      devServerUrl: getTrustedRendererDevUrl(),
      packagedRendererUrl: app.isPackaged ? getTrustedPackagedRendererUrl() : undefined,
    })
  ) {
    throw new Error(`Blocked IPC from untrusted sender: ${senderUrl || 'unknown'}`);
  }
}

function handleTrustedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event);
    return handler(event, ...(args as TArgs));
  });
}

function authorizeFilePath(rawPath: string): string {
  const parsedPath = filePathSchema.parse(rawPath);
  if (!authorizedPaths.isAllowed(parsedPath)) {
    throw new Error(`Access denied for path outside approved scope: ${parsedPath}`);
  }
  return parsedPath;
}

function authorizeFilePaths(rawPaths: string[]): string[] {
  authorizedPaths.allowFiles(rawPaths);
  return rawPaths;
}

function authorizeProjectPayloadPaths(data: unknown): void {
  if (!data || typeof data !== 'object') return;

  const candidate = data as {
    clips?: Array<{ path?: unknown }>;
    memory?: Array<{ filePath?: unknown }>;
  };

  for (const clip of candidate.clips || []) {
    if (typeof clip?.path === 'string') {
      authorizedPaths.allowFile(clip.path);
    }
  }

  for (const entry of candidate.memory || []) {
    if (typeof entry?.filePath === 'string') {
      authorizedPaths.allowFile(entry.filePath);
    }
  }
}

function isRetryableBedrockTransportError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase();
  if (!message) return false;

  return (
    message.includes('eai_again') ||
    message.includes('econnrefused') ||
    message.includes('err_http2_stream_cancel') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('request socket did not establish a connection') ||
    message.includes('temporary failure in name resolution')
  );
}

function isExpiredAwsTokenError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase();
  return (
    message.includes('expiredtokenexception') ||
    message.includes('security token included in the request is expired') ||
    message.includes('token has expired')
  );
}

async function sendBedrockConverseWithRetry(
  commandInput: ConstructorParameters<typeof ConverseCommand>[0],
): Promise<ConverseCommandOutput> {
  const bedrockGatewayClient = aiConfigService.getBedrockClient();
  if (!bedrockGatewayClient) {
    throw new Error(
      'Bedrock gateway unavailable: missing AWS credentials. Open Settings and fill your AI configuration first.',
    );
  }

  const maxTransportRetries = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxTransportRetries; attempt++) {
    try {
      return await bedrockGatewayClient.send(new ConverseCommand(commandInput));
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxTransportRetries && isRetryableBedrockTransportError(error);
      if (!shouldRetry) {
        throw error;
      }
      const backoffMs = 400 * Math.pow(2, attempt);
      log('warn', 'Retrying Bedrock converse after transient transport error', {
        attempt: attempt + 1,
        backoffMs,
        error: getErrorMessage(error, 'Unknown Bedrock transport error'),
      });
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown Bedrock transport error');
}

function registerMediaProtocol() {
  protocol.handle(APP_MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'local') {
        return new Response('Invalid host', { status: 400 });
      }

      const encodedPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
      const decodedPath = decodeURIComponent(encodedPath);
      const parsedPath = filePathSchema.parse(decodedPath);

      if (!isValidMediaProtocolPath(parsedPath) || !authorizedPaths.isAllowed(parsedPath)) {
        return new Response('Path is not authorized', { status: 403 });
      }

      // Forward Range header so the video element can seek within the file
      const rangeHeader = request.headers.get('range');
      const fetchOptions: Parameters<typeof net.fetch>[1] = rangeHeader
        ? { headers: { Range: rangeHeader } }
        : undefined;
      return net.fetch(pathToFileURL(parsedPath).toString(), fetchOptions);
    } catch (error) {
      console.error('[MediaProtocol] Failed to serve media:', error);
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow() {
  const secureWebPreferences = {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: true,
    sandbox: true,
  } as const;
  assertSecureWebPreferences(secureWebPreferences, { packaged: app.isPackaged });

  mainWindow = new BrowserWindow({
    title: 'QuickCut',
    icon: path.join(__dirname, app.isPackaged ? '../dist/logo.png' : '../public/logo.png'),
    width: 1200,
    height: 800,
    webPreferences: secureWebPreferences,
  });

  const devUrl = getTrustedRendererDevUrl();
  const packagedUrl = getTrustedPackagedRendererUrl();

  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadURL(packagedUrl);
  }

  // Start maximized (not true fullscreen) so OS title-bar controls remain visible.
  mainWindow.maximize();

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(
      __dirname,
      app.isPackaged ? '../dist/logo.png' : '../public/logo.png',
    );
    app.dock.setIcon(iconPath);
  }

  // Only open DevTools in dev mode when explicitly needed
  // mainWindow.webContents.openDevTools();

  // Force close on Windows — prevents app hanging when X is clicked
  mainWindow.on('close', () => {
    if (mainWindow) {
      mainWindow.destroy();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      log('warn', 'Blocked external window open', { url });
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() || '';
    if (shouldBlockNavigation(currentUrl, url)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
      } else {
        log('warn', 'Blocked navigation attempt', { url });
      }
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    captureMainException(new Error('Renderer process exited unexpectedly'), {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
}

process.on('uncaughtException', (error) => {
  captureMainException(error, { origin: 'process:uncaughtException' });
});

process.on('unhandledRejection', (reason) => {
  captureMainException(reason, { origin: 'process:unhandledRejection' });
});

handleTrustedIpc(IPC_CHANNELS.ping, async () => 'pong');

handleTrustedIpc(IPC_CHANNELS.dialog.openFile, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'All Media',
        extensions: [
          'mp4',
          'mov',
          'avi',
          'mkv',
          'webm',
          'mp3',
          'wav',
          'aac',
          'flac',
          'ogg',
          'm4a',
          'jpg',
          'jpeg',
          'png',
          'gif',
          'webp',
          'bmp',
          'srt',
        ],
      },
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
      {
        name: 'Audio',
        extensions: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'],
      },
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
      },
      { name: 'Subtitles', extensions: ['srt'] },
    ],
  });
  if (canceled) {
    return [];
  } else {
    return authorizeFilePaths(filePaths);
  }
});

handleTrustedIpc(IPC_CHANNELS.media.getMetadata, async (_, rawFilePath) => {
  const filePath = authorizeFilePath(String(rawFilePath));
  // Check if the file is an image
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  const ext = path.extname(filePath).toLowerCase();
  const isImage = imageExtensions.includes(ext);

  if (isImage) {
    // For images, return default duration and get dimensions if possible
    try {
      const img = nativeImage.createFromPath(filePath);
      const size = img.getSize();
      return {
        duration: 5, // Default 5 seconds for images
        format: 'image',
        width: size.width,
        height: size.height,
        isImage: true,
      };
    } catch (error) {
      console.error('Failed to read image:', error);
      return {
        duration: 5,
        format: 'image',
        width: 1920,
        height: 1080,
        isImage: true,
      };
    }
  }

  // For video and audio files, use ffprobe
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | undefined, metadata: FfprobeData) => {
      if (err) {
        console.error('ffprobe error:', err);
        reject(err);
      } else {
        console.log('ffprobe success:', metadata.format.duration);
        const videoStream = metadata.streams.find((s: FfprobeStream) => s.codec_type === 'video');
        const audioStream = metadata.streams.find((s: FfprobeStream) => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration,
          format: metadata.format.format_name,
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          hasVideo: !!videoStream,
          hasAudio: !!audioStream,
        });
      }
    });
  });
});

handleTrustedIpc(IPC_CHANNELS.media.getThumbnail, async (_, rawFilePath, rawSeekTime?: number) => {
  const filePath = authorizeFilePath(String(rawFilePath));
  try {
    const base64 = await generateThumbnail(
      filePath,
      typeof rawSeekTime === 'number' ? rawSeekTime : undefined,
    );
    return base64;
  } catch (error) {
    console.error('Failed to generate thumbnail:', error);
    return null;
  }
});

handleTrustedIpc(IPC_CHANNELS.media.getWaveform, async (_, rawFilePath) => {
  const filePath = authorizeFilePath(String(rawFilePath));
  try {
    const base64 = await generateWaveform(filePath);
    return base64;
  } catch (error) {
    console.error('Failed to generate waveform:', error);
    return null;
  }
});

handleTrustedIpc(IPC_CHANNELS.dialog.saveFile, async (_, rawFormat = 'mp4') => {
  const format = saveFormatSchema.catch('mp4').parse(rawFormat);
  const extensions: { [key: string]: string } = {
    mp4: 'MP4',
    mov: 'MOV',
    avi: 'AVI',
    webm: 'WebM',
  };

  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: extensions[format] || 'Video', extensions: [format] }],
    defaultPath: `output.${format}`,
  });
  if (canceled) {
    return null;
  } else {
    if (filePath) {
      authorizedPaths.allowFile(filePath);
    }
    return filePath;
  }
});

handleTrustedIpc(IPC_CHANNELS.project.saveProject, async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Project',
    defaultPath: 'project.quickcut',
    filters: [{ name: 'QuickCut Project', extensions: ['quickcut'] }],
  });
  if (canceled) {
    return null;
  } else {
    if (filePath) {
      authorizedPaths.allowFile(filePath);
    }
    return filePath;
  }
});

handleTrustedIpc(IPC_CHANNELS.project.writeProjectFile, async (_, rawPayload) => {
  try {
    const { filePath, data } = projectWriteSchema.parse(rawPayload);
    await fs.writeFile(authorizeFilePath(filePath), JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to write project file:', error);
    return ipcFailure(error, 'PROJECT_WRITE_FAILED');
  }
});

handleTrustedIpc(IPC_CHANNELS.project.loadProject, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Load Project',
    properties: ['openFile'],
    filters: [{ name: 'QuickCut Project', extensions: ['quickcut'] }],
  });
  if (canceled || filePaths.length === 0) {
    return null;
  } else {
    return authorizeFilePaths([filePaths[0]])[0];
  }
});

handleTrustedIpc(IPC_CHANNELS.project.readProjectFile, async (_, rawFilePath) => {
  try {
    const filePath = authorizeFilePath(String(rawFilePath));
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    authorizeProjectPayloadPaths(parsed);
    return { success: true, data: parsed };
  } catch (error) {
    console.error('Failed to read project file:', error);
    return ipcFailure(error, 'PROJECT_READ_FAILED');
  }
});

handleTrustedIpc(IPC_CHANNELS.file.readTextFile, async (_, rawFilePath) => {
  try {
    const filePath = authorizeFilePath(String(rawFilePath));
    const data = await fs.readFile(filePath, 'utf-8');
    return { success: true, data };
  } catch (error) {
    console.error('Failed to read text file:', error);
    return ipcFailure(error, 'FILE_READ_TEXT_FAILED');
  }
});

handleTrustedIpc(IPC_CHANNELS.media.exportVideo, async (event, rawPayload) => {
  try {
    const {
      clips,
      outputPath,
      format = 'mp4',
      resolution,
      subtitles,
      subtitleStyle,
    } = exportVideoRequestSchema.parse(rawPayload);
    authorizeFilePath(outputPath);
    for (const clip of clips) {
      if (
        clip &&
        typeof clip === 'object' &&
        'path' in clip &&
        typeof (clip as { path?: unknown }).path === 'string'
      ) {
        authorizeFilePath((clip as { path: string }).path);
      }
    }
    await exportVideo(
      clips as Parameters<typeof exportVideo>[0],
      event.sender,
      outputPath,
      format,
      resolution,
      subtitles as Parameters<typeof exportVideo>[5],
      subtitleStyle as Parameters<typeof exportVideo>[6],
    );
    // Fire-and-forget S3 upload of the exported video.
    // Uses a placeholder userId ('anonymous') when no profile is persisted.
    void (async () => {
      try {
        const record = await getCloudBackendService().uploadExportedVideo(outputPath, 'anonymous');
        if (record) {
          log('info', '[Export] Video uploaded to S3', { s3Key: record.s3Key });
        }
      } catch (uploadErr) {
        log('warn', '[Export] S3 video upload failed (non-fatal)', { uploadErr });
      }
    })();
    return true;
  } catch (error) {
    console.error('Export failed:', error);
    return ipcFailure(error, 'EXPORT_VIDEO_FAILED');
  }
});

// Transcription handlers
handleTrustedIpc(
  IPC_CHANNELS.transcription.transcribeVideo,
  async (event, rawVideoPath: string) => {
    try {
      const videoPath = authorizeFilePath(rawVideoPath);
      const result = await transcribeVideo(videoPath, (progress) => {
        event.sender.send(IPC_CHANNELS.transcription.progress, progress);
      });
      return { success: true, result };
    } catch (error) {
      console.error('Transcription failed:', error);
      return ipcFailure(error, 'TRANSCRIBE_VIDEO_FAILED');
    }
  },
);

handleTrustedIpc(IPC_CHANNELS.transcription.transcribeTimeline, async (event, rawClips) => {
  try {
    const clips = z.array(timelineClipSchema).parse(rawClips);
    clips.forEach((clip) => authorizeFilePath(clip.path));
    const result = await transcribeTimeline(clips, (progress) => {
      event.sender.send(IPC_CHANNELS.transcription.progress, progress);
    });
    return { success: true, result };
  } catch (error) {
    console.error('Timeline transcription failed:', error);
    return ipcFailure(error, 'TRANSCRIBE_TIMELINE_FAILED');
  }
});

// Channel Analysis handlers
handleTrustedIpc(IPC_CHANNELS.analysis.analyzeChannel, async (_event, rawChannelUrl: string) => {
  const analysisService = aiConfigService.getAnalysisService();
  if (!analysisService) {
    return {
      success: false,
      error: 'Analysis service not initialized - missing API keys',
      error_code: 'SERVICE_NOT_AVAILABLE',
    };
  }

  try {
    const channelUrl = nonEmptyStringSchema.parse(rawChannelUrl);
    console.log(`[IPC] Analyzing channel: ${channelUrl}`);
    const result = await analysisService.analyzeChannel(channelUrl);
    return result;
  } catch (error) {
    console.error('[IPC] Channel analysis error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      error_code: 'ANALYSIS_ERROR',
    };
  }
});

handleTrustedIpc(IPC_CHANNELS.analysis.getUserAnalysis, async (_event, rawUserId: string) => {
  const analysisService = aiConfigService.getAnalysisService();
  if (!analysisService) {
    return ipcFailure('Analysis service not initialized', 'ANALYSIS_SERVICE_UNAVAILABLE');
  }

  try {
    const userId = nonEmptyStringSchema.parse(rawUserId);
    const analysis = await analysisService.getUserAnalysis(userId);
    if (analysis) {
      return { success: true, data: analysis };
    } else {
      return ipcFailure('No analysis found for user', 'ANALYSIS_NOT_FOUND');
    }
  } catch (error) {
    console.error('[IPC] Get user analysis error:', error);
    return ipcFailure(error, 'ANALYSIS_GET_USER_FAILED');
  }
});

handleTrustedIpc(
  IPC_CHANNELS.analysis.linkToUser,
  async (_event, rawUserId: string, rawChannelUrl: string) => {
    const analysisService = aiConfigService.getAnalysisService();
    if (!analysisService) {
      return ipcFailure('Analysis service not initialized', 'ANALYSIS_SERVICE_UNAVAILABLE');
    }

    try {
      const userId = nonEmptyStringSchema.parse(rawUserId);
      const channelUrl = nonEmptyStringSchema.parse(rawChannelUrl);
      const linked = await analysisService.linkAnalysisToUser(userId, channelUrl);
      return linked
        ? { success: true }
        : ipcFailure('Failed to link analysis', 'ANALYSIS_LINK_FAILED');
    } catch (error) {
      console.error('[IPC] Link analysis error:', error);
      return ipcFailure(error, 'ANALYSIS_LINK_FAILED');
    }
  },
);

handleTrustedIpc(IPC_CHANNELS.bedrock.converse, async (_, rawInput: unknown) => {
  const input = bedrockConverseInputSchema.parse(rawInput);
  const aiSettings = aiConfigService.getSettings();

  const reviveBytes = (value: unknown): unknown => {
    // TypedArrays (e.g. Uint8Array) travel through Electron IPC via structured clone
    // and arrive as proper TypedArrays. Guard them BEFORE the generic object branch,
    // which would iterate numeric indices and corrupt the buffer into a plain object.
    if (ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) {
      return value.map(reviveBytes);
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(obj)) {
        // Handle bytes arriving as a regular Array of numbers (older Electron serialization)
        if (key === 'bytes' && Array.isArray(v) && v.every((n) => typeof n === 'number')) {
          out[key] = Uint8Array.from(v as number[]);
          // Handle bytes arriving as a TypedArray (structured clone path)
        } else if (key === 'bytes' && ArrayBuffer.isView(v)) {
          out[key] =
            v instanceof Uint8Array
              ? v
              : new Uint8Array(
                  (v as ArrayBufferView).buffer,
                  (v as ArrayBufferView).byteOffset,
                  (v as ArrayBufferView).byteLength,
                );
        } else {
          out[key] = reviveBytes(v);
        }
      }
      return out;
    }
    return value;
  };

  const commandInput = reviveBytes(input);
  if (
    commandInput &&
    typeof commandInput === 'object' &&
    'modelId' in commandInput &&
    typeof (commandInput as { modelId?: unknown }).modelId === 'string'
  ) {
    (commandInput as { modelId: string }).modelId = normalizeBedrockModelIdentifier(
      (commandInput as { modelId: string }).modelId,
      aiSettings.awsRegion,
      aiSettings.bedrockInferenceProfileId,
    );
  }
  try {
    const response = await sendBedrockConverseWithRetry(
      commandInput as ConstructorParameters<typeof ConverseCommand>[0],
    );
    return response;
  } catch (error) {
    if (isExpiredAwsTokenError(error)) {
      throw new Error(
        'AWS credentials expired for Bedrock access. Refresh them in Settings or .env and retry.',
      );
    }
    if (isRetryableBedrockTransportError(error)) {
      const endpoint = `bedrock-runtime.${aiSettings.awsRegion}.amazonaws.com`;
      throw new Error(
        `Bedrock endpoint unreachable (${endpoint}). Check internet/firewall/VPN/proxy settings, then retry. Root cause: ${getErrorMessage(
          error,
          'Unknown transport error',
        )}`,
      );
    }
    throw error;
  }
});

handleTrustedIpc(IPC_CHANNELS.aiConfig.get, async () => {
  return aiConfigService.getSettings();
});

handleTrustedIpc(IPC_CHANNELS.aiConfig.status, async () => {
  return aiConfigService.getStatus();
});

handleTrustedIpc(IPC_CHANNELS.aiConfig.save, async (_event, rawSettings: unknown) => {
  try {
    const settings = aiConfigSettingsSchema.parse(rawSettings);
    aiConfigService.saveSettings(settings);
    const status = aiConfigService.getStatus();
    const effective = aiConfigService.getSettings();
    log('info', 'AI config updated', {
      youtubeApiKey: effective.youtubeApiKey ? 'Set' : 'Missing',
      awsRegion: effective.awsRegion,
      bedrockReady: status.bedrockReady,
      youtubeReady: status.youtubeReady,
      usingSavedSettings: status.usingSavedSettings,
    });
    return { success: true };
  } catch (error) {
    return ipcFailure(error, 'AI_CONFIG_SAVE_FAILED');
  }
});

// File reading for AI Memory analysis
handleTrustedIpc(IPC_CHANNELS.file.readFileAsBase64, async (_, rawFilePath: string) => {
  try {
    const filePath = authorizeFilePath(rawFilePath);
    const MAX_SIZE_FOR_INLINE = 20 * 1024 * 1024; // 20MB limit for inline data
    const stat = await fs.stat(filePath);

    if (stat.size > MAX_SIZE_FOR_INLINE) {
      throw new Error(
        `File too large for inline analysis (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: 20MB`,
      );
    }

    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
  } catch (error) {
    console.error('Failed to read file as base64:', error);
    return ipcFailure(error, 'FILE_READ_BASE64_FAILED');
  }
});

// Get file size (for determining upload strategy)
handleTrustedIpc(IPC_CHANNELS.file.getFileSize, async (_, rawFilePath: string) => {
  try {
    const filePath = authorizeFilePath(rawFilePath);
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (error) {
    console.error('Failed to get file size:', error);
    return 0;
  }
});

// =============================================
// AI Memory — File-based persistence (project-specific)
// =============================================
const MEMORY_BASE_DIR = path.join(app.getPath('userData'), 'ai_memory');

function getProjectMemoryPaths(projectId?: string) {
  const projectDir = projectId
    ? path.join(MEMORY_BASE_DIR, 'projects', projectId)
    : path.join(MEMORY_BASE_DIR, 'default');

  return {
    dir: projectDir,
    index: path.join(projectDir, 'memory.json'),
    analyses: path.join(projectDir, 'analyses'),
  };
}

async function ensureMemoryDirs(projectId?: string) {
  const paths = getProjectMemoryPaths(projectId);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.mkdir(paths.analyses, { recursive: true });
}

// Save full memory state to disk + S3 backup (fire-and-forget)
handleTrustedIpc(IPC_CHANNELS.memory.save, async (_, rawData) => {
  try {
    const data = memoryStateSchema.parse(rawData);
    const projectId = data.projectId;
    const paths = getProjectMemoryPaths(projectId);
    await ensureMemoryDirs(projectId);
    const serialized = JSON.stringify(data, null, 2);
    await fs.writeFile(paths.index, serialized, 'utf-8');
    console.log(
      `[Memory] Saved ${data.entries?.length || 0} entries to ${paths.index} (Project: ${projectId || 'default'})`,
    );
    // Async S3 backup — errors logged inside service, does not block the response
    const s3Key = `${projectId ?? 'default'}/memory.json`;
    void getCloudBackendService().uploadMemoryFile(s3Key, serialized);
    return { success: true, path: paths.index };
  } catch (error) {
    console.error('[Memory] Failed to save:', error);
    return ipcFailure(error, 'MEMORY_SAVE_FAILED');
  }
});

// Load memory state: local disk first, S3 fallback when file absent
handleTrustedIpc(IPC_CHANNELS.memory.load, async (_, projectId?: string) => {
  try {
    const safeProjectId = projectId ? nonEmptyStringSchema.parse(projectId) : undefined;
    const paths = getProjectMemoryPaths(safeProjectId);
    await ensureMemoryDirs(safeProjectId);
    try {
      const data = await fs.readFile(paths.index, 'utf-8');
      const parsed = JSON.parse(data);
      console.log(
        `[Memory] Loaded ${parsed.entries?.length || 0} entries from disk (Project: ${projectId || 'default'})`,
      );
      return { success: true, data: parsed };
    } catch (diskError: unknown) {
      if (!isErrnoException(diskError) || diskError.code !== 'ENOENT') throw diskError;
      // Local file missing — try S3 restore
      console.log(
        `[Memory] Local file absent for project ${projectId || 'default'}, checking S3...`,
      );
      const s3Key = `${safeProjectId ?? 'default'}/memory.json`;
      const remote = await getCloudBackendService().downloadMemoryFile(s3Key);
      if (remote) {
        const parsed = JSON.parse(remote);
        // Restore to disk for subsequent fast reads
        await fs.writeFile(paths.index, remote, 'utf-8');
        console.log(
          `[Memory] Restored ${parsed.entries?.length || 0} entries from S3 (Project: ${projectId || 'default'})`,
        );
        return { success: true, data: parsed };
      }
      console.log(
        `[Memory] No memory found anywhere for project ${projectId || 'default'}, starting fresh`,
      );
      return { success: true, data: { entries: [] } };
    }
  } catch (error) {
    console.error('[Memory] Failed to load:', error);
    return ipcFailure(error, 'MEMORY_LOAD_FAILED');
  }
});

//  TESTING MODE - Read all memory files from a directory
handleTrustedIpc(IPC_CHANNELS.memory.readMemoryFiles, async (_, rawMemoryDir: string) => {
  try {
    const memoryDir = filePathSchema.parse(rawMemoryDir);
    console.log(` [TESTING MODE] Reading memory from ${memoryDir}...`);

    // Try to read the default project memory first
    const defaultPath = path.join(memoryDir, 'default', 'memory.json');

    try {
      const data = await fs.readFile(defaultPath, 'utf-8');
      const parsed = JSON.parse(data);
      console.log(
        ` [TESTING MODE] Loaded ${parsed.entries?.length || 0} entries from ${defaultPath}`,
      );
      return { success: true, entries: parsed.entries || [] };
    } catch (err: unknown) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        console.log(` [TESTING MODE] No memory.json found in ${defaultPath}`);
        return { success: true, entries: [] };
      }
      throw err;
    }
  } catch (error) {
    console.error('[TESTING MODE] Failed to read memory files:', error);
    return { ...ipcFailure(error, 'MEMORY_READ_FILES_FAILED'), entries: [] };
  }
});

// Save an individual analysis as a human-readable Markdown file
handleTrustedIpc(
  IPC_CHANNELS.memory.saveAnalysisMarkdown,
  async (_, rawEntry, projectId?: string) => {
    try {
      const entry = memoryMarkdownEntrySchema.parse(rawEntry);
      const safeProjectId = projectId ? nonEmptyStringSchema.parse(projectId) : undefined;
      const paths = getProjectMemoryPaths(safeProjectId);
      await ensureMemoryDirs(safeProjectId);

      // Sanitize filename
      const safeName = entry.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const mdPath = path.join(paths.analyses, `${safeName}.md`);

      let md = `# Media Analysis: ${entry.fileName}\n\n`;
      md += `- **Type:** ${entry.mediaType}\n`;
      md += `- **File:** ${entry.filePath}\n`;
      md += `- **MIME:** ${entry.mimeType}\n`;
      if (entry.duration) md += `- **Duration:** ${entry.duration.toFixed(1)}s\n`;
      md += `- **Status:** ${entry.status}\n`;
      md += `- **Analyzed:** ${entry.updatedAt}\n\n`;

      md += `## Summary\n${entry.summary}\n\n`;

      if (entry.tags && entry.tags.length > 0) {
        md += `## Tags\n${entry.tags.map((t: string) => `\`${t}\``).join(', ')}\n\n`;
      }

      md += `## Detailed Analysis\n${entry.analysis}\n\n`;

      if (entry.visualInfo) {
        md += `## Visual Information\n`;
        if (entry.visualInfo.subjects?.length)
          md += `- **Subjects:** ${entry.visualInfo.subjects.join(', ')}\n`;
        if (entry.visualInfo.style) md += `- **Style:** ${entry.visualInfo.style}\n`;
        if (entry.visualInfo.dominantColors?.length)
          md += `- **Colors:** ${entry.visualInfo.dominantColors.join(', ')}\n`;
        if (entry.visualInfo.composition)
          md += `- **Composition:** ${entry.visualInfo.composition}\n`;
        if (entry.visualInfo.quality) md += `- **Quality:** ${entry.visualInfo.quality}\n`;
        md += '\n';
      }

      if (entry.audioInfo) {
        md += `## Audio Information\n`;
        md += `- **Speech:** ${entry.audioInfo.hasSpeech ? 'Yes' : 'No'}\n`;
        md += `- **Music:** ${entry.audioInfo.hasMusic ? 'Yes' : 'No'}\n`;
        if (entry.audioInfo.languages?.length)
          md += `- **Languages:** ${entry.audioInfo.languages.join(', ')}\n`;
        if (entry.audioInfo.mood) md += `- **Mood:** ${entry.audioInfo.mood}\n`;
        if (entry.audioInfo.transcriptSummary)
          md += `- **Transcript Summary:** ${entry.audioInfo.transcriptSummary}\n`;
        md += '\n';
      }

      if (entry.scenes && entry.scenes.length > 0) {
        md += `## Scenes\n`;
        for (const scene of entry.scenes) {
          md += `- **[${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s]** ${scene.description}\n`;
        }
        md += '\n';
      }

      await fs.writeFile(mdPath, md, 'utf-8');
      console.log(`[Memory] Saved analysis markdown: ${mdPath}`);
      // Async S3 backup of the markdown file
      const s3Key = `${safeProjectId ?? 'default'}/analyses/${safeName}.md`;
      void getCloudBackendService().uploadMemoryFile(s3Key, md);
      return { success: true, path: mdPath };
    } catch (error) {
      console.error('[Memory] Failed to save markdown:', error);
      return ipcFailure(error, 'MEMORY_SAVE_MARKDOWN_FAILED');
    }
  },
);

// Get memory directory path (returns base directory)
handleTrustedIpc(IPC_CHANNELS.memory.getDir, async () => {
  const paths = getProjectMemoryPaths(); // Default project
  await ensureMemoryDirs();
  return { dir: MEMORY_BASE_DIR, index: paths.index, analyses: paths.analyses };
});

// ===========================
// Channel Rules Handlers
// ===========================

const RULES_PATH = path.join(app.getPath('userData'), 'rules.md');

// Write rules.md to userData directory
handleTrustedIpc(IPC_CHANNELS.rules.write, async (_, rawContent: string) => {
  try {
    const content = nonEmptyStringSchema.parse(rawContent);
    await fs.writeFile(RULES_PATH, content, 'utf-8');
    console.log(`[Rules] Saved rules.md to ${RULES_PATH}`);
    return { success: true, path: RULES_PATH };
  } catch (error) {
    console.error('[Rules] Failed to write rules.md:', error);
    return ipcFailure(error, 'RULES_WRITE_FAILED');
  }
});

// Read rules.md from userData directory
handleTrustedIpc(IPC_CHANNELS.rules.read, async () => {
  try {
    const content = await fs.readFile(RULES_PATH, 'utf-8');
    return { success: true, content };
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return { success: true, content: null };
    }
    console.error('[Rules] Failed to read rules.md:', error);
    return ipcFailure(error, 'RULES_READ_FAILED');
  }
});

// ===========================
// Cloud Storage Handlers (DynamoDB + S3)
// ===========================

// Save user profile to DynamoDB
handleTrustedIpc(
  IPC_CHANNELS.storage.saveProfile,
  async (_, rawProfile: Record<string, unknown>) => {
    try {
      const userId = nonEmptyStringSchema.parse(rawProfile['userId']);
      await getCloudBackendService().setUserProfile({
        userId,
        userName: typeof rawProfile['userName'] === 'string' ? rawProfile['userName'] : undefined,
        email: typeof rawProfile['email'] === 'string' ? rawProfile['email'] : undefined,
        youtubeChannelUrl:
          typeof rawProfile['youtubeChannelUrl'] === 'string'
            ? rawProfile['youtubeChannelUrl']
            : undefined,
        channelAnalysisId:
          typeof rawProfile['channelAnalysisId'] === 'string'
            ? rawProfile['channelAnalysisId']
            : undefined,
        createdAt:
          typeof rawProfile['createdAt'] === 'number' ? rawProfile['createdAt'] : Date.now(),
        updatedAt: Date.now(),
      });
      return { success: true };
    } catch (error) {
      log('warn', '[Storage] saveProfile failed', { error });
      return ipcFailure(error, 'STORAGE_SAVE_PROFILE_FAILED');
    }
  },
);

// Load user profile from DynamoDB
handleTrustedIpc(IPC_CHANNELS.storage.loadProfile, async (_, rawUserId: string) => {
  try {
    const userId = nonEmptyStringSchema.parse(rawUserId);
    const data = await getCloudBackendService().getUserProfile(userId);
    return { success: true, data: data as Record<string, unknown> | null };
  } catch (error) {
    log('warn', '[Storage] loadProfile failed', { error });
    return ipcFailure(error, 'STORAGE_LOAD_PROFILE_FAILED');
  }
});

// Upload an exported video to S3 (called explicitly by renderer after export)
handleTrustedIpc(
  IPC_CHANNELS.storage.uploadExportedVideo,
  async (_, rawLocalPath: string, rawUserId: string) => {
    try {
      const localPath = authorizeFilePath(rawLocalPath);
      const userId = nonEmptyStringSchema.parse(rawUserId);
      const record = await getCloudBackendService().uploadExportedVideo(localPath, userId);
      return { success: true, record };
    } catch (error) {
      log('warn', '[Storage] uploadExportedVideo failed', { error });
      return ipcFailure(error, 'STORAGE_UPLOAD_VIDEO_FAILED');
    }
  },
);

// List exported videos for a user from S3
handleTrustedIpc(IPC_CHANNELS.storage.listExportedVideos, async (_, rawUserId: string) => {
  try {
    const userId = nonEmptyStringSchema.parse(rawUserId);
    const items = await getCloudBackendService().listExportedVideos(userId);
    return { success: true, items };
  } catch (error) {
    log('warn', '[Storage] listExportedVideos failed', { error });
    return ipcFailure(error, 'STORAGE_LIST_VIDEOS_FAILED');
  }
});

// Backup AI context / chat history to S3
handleTrustedIpc(
  IPC_CHANNELS.storage.syncAiContext,
  async (_, rawKey: string, rawContent: string) => {
    try {
      const key = nonEmptyStringSchema.parse(rawKey);
      const content = nonEmptyStringSchema.parse(rawContent);
      await getCloudBackendService().uploadAiContext(key, content, 'ai-context');
      return { success: true };
    } catch (error) {
      log('warn', '[Storage] syncAiContext failed', { error });
      return ipcFailure(error, 'STORAGE_SYNC_CONTEXT_FAILED');
    }
  },
);

// Restore AI context from S3
handleTrustedIpc(IPC_CHANNELS.storage.loadAiContext, async (_, rawKey: string) => {
  try {
    const key = nonEmptyStringSchema.parse(rawKey);
    const data = await getCloudBackendService().downloadAiContext(key, 'ai-context');
    return { success: true, data };
  } catch (error) {
    log('warn', '[Storage] loadAiContext failed', { error });
    return ipcFailure(error, 'STORAGE_LOAD_CONTEXT_FAILED');
  }
});

// ===========================
// YouTube Upload Handlers
// ===========================

// Check if user is authenticated with YouTube
handleTrustedIpc(IPC_CHANNELS.youtube.isAuthenticated, async () => {
  try {
    return isAuthenticated();
  } catch (error) {
    console.error('[YouTube] Error checking authentication:', error);
    return false;
  }
});

// Authenticate user with YouTube
handleTrustedIpc(IPC_CHANNELS.youtube.authenticate, async () => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }
    const success = await authenticateUser(mainWindow);
    return success;
  } catch (error) {
    console.error('[YouTube] Authentication error:', error);
    return false;
  }
});

// Logout from YouTube
handleTrustedIpc(IPC_CHANNELS.youtube.logout, async () => {
  try {
    return youtubeLogout();
  } catch (error) {
    console.error('[YouTube] Logout error:', error);
    return false;
  }
});

// Check YouTube OAuth credentials and API reachability
handleTrustedIpc(IPC_CHANNELS.youtube.checkCredentials, async () => {
  let credentialsFound = false;
  let apiReachable = false;
  try {
    loadYouTubeOAuthCredentials(process.env, fssync, process.cwd());
    credentialsFound = true;
  } catch (credErr) {
    const msg = credErr instanceof Error ? credErr.message : String(credErr);
    console.error('[YouTube] Credentials check failed:', msg);
    return { ok: false, credentialsFound: false, apiReachable: false, error: msg };
  }

  try {
    // Probe Google's OAuth discovery endpoint to confirm internet + API reachability
    const resp = await net.fetch('https://accounts.google.com/.well-known/openid-configuration', {
      method: 'HEAD',
    });
    apiReachable = resp.ok || resp.status < 500;
  } catch {
    apiReachable = false;
  }

  return {
    ok: credentialsFound && apiReachable,
    credentialsFound,
    apiReachable,
    error: apiReachable
      ? undefined
      : 'Cannot reach Google OAuth servers — check your internet connection.',
  };
});

// Upload video to YouTube
handleTrustedIpc(IPC_CHANNELS.youtube.uploadVideo, async (_event, rawPayload) => {
  try {
    const { filePath, metadata } = youtubeUploadRequestSchema.parse(rawPayload);
    authorizeFilePath(filePath);
    console.log('[YouTube] Starting upload:', filePath);

    const videoId = await uploadVideo(filePath, metadata, (progress) => {
      // Send progress updates to renderer
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.youtube.uploadProgress, progress);
      }
    });

    console.log('[YouTube] Upload completed:', videoId);
    return { success: true, videoId };
  } catch (error: unknown) {
    console.error('[YouTube] Upload error:', error);
    return { success: false, error: getErrorMessage(error, 'Upload failed') };
  }
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(shouldAllowPermissionRequest(webContents, permission));
  });
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [packagedCspPolicy()],
        },
      });
    });
  }

  registerMediaProtocol();
  createWindow();
  if (mainWindow) {
    updateService = setupAutoUpdates(mainWindow);
  }

  // Handle window:close IPC from renderer (custom close button)
  handleTrustedIpc(IPC_CHANNELS.window.close, () => {
    if (mainWindow) mainWindow.close();
  });

  handleTrustedIpc(IPC_CHANNELS.update.check, async () => {
    if (!updateService) {
      return { enabled: false, started: false, error: 'Update service not initialized' };
    }
    return updateService.checkForUpdates();
  });

  handleTrustedIpc(IPC_CHANNELS.update.download, async () => {
    if (!updateService) {
      return { enabled: false, started: false, error: 'Update service not initialized' };
    }
    return updateService.downloadUpdate();
  });

  handleTrustedIpc(IPC_CHANNELS.update.install, () => {
    if (!updateService) {
      return { enabled: false, started: false };
    }
    return updateService.installUpdate();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
