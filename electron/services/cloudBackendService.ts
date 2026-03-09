import {
  type PresignedVideoUploadPlan,
  type UserProfile,
  type VideoExportRecord,
  getAwsStorageService,
  resetAwsStorageService,
} from './awsStorageService.js';
import { uploadFileToPresignedUrl } from './presignedHttpUpload.js';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { log } from '../utils/logger.js';

export type CloudBackendMode = 'direct' | 'apigw';

export interface CloudBackendService {
  readonly mode: CloudBackendMode;
  getUserProfile(userId: string): Promise<UserProfile | null>;
  setUserProfile(profile: UserProfile): Promise<void>;
  getChannelAnalysis(channelId: string): Promise<unknown | null>;
  setChannelAnalysis(channelId: string, data: unknown): Promise<void>;
  getUserLink(userId: string): Promise<string | null>;
  setUserLink(userId: string, channelId: string): Promise<void>;
  uploadExportedVideo(
    localPath: string,
    userId: string,
    onProgress?: (percent: number) => void,
  ): Promise<VideoExportRecord | null>;
  listExportedVideos(userId: string): Promise<VideoExportRecord[]>;
  uploadAiContext(
    relativeKey: string,
    content: string,
    prefix?: 'ai-context' | 'memory',
  ): Promise<void>;
  downloadAiContext(relativeKey: string, prefix?: 'ai-context' | 'memory'): Promise<string | null>;
  uploadMemoryFile(key: string, content: string): Promise<void>;
  downloadMemoryFile(key: string): Promise<string | null>;
  deleteMemoryFile(key: string): Promise<void>;
}

type DirectStorageAdapter = {
  getUserProfile(userId: string): Promise<UserProfile | null>;
  setUserProfile(profile: UserProfile): Promise<void>;
  getChannelAnalysis(channelId: string): Promise<unknown | null>;
  setChannelAnalysis(channelId: string, data: unknown): Promise<void>;
  getUserLink(userId: string): Promise<string | null>;
  setUserLink(userId: string, channelId: string): Promise<void>;
  uploadExportedVideo(
    localPath: string,
    userId: string,
    onProgress?: (percent: number) => void,
  ): Promise<VideoExportRecord | null>;
  listExportedVideos(userId: string): Promise<VideoExportRecord[]>;
  uploadAiContext(
    relativeKey: string,
    content: string,
    prefix?: 'ai-context' | 'memory',
  ): Promise<void>;
  downloadAiContext(relativeKey: string, prefix?: 'ai-context' | 'memory'): Promise<string | null>;
  uploadMemoryFile(key: string, content: string): Promise<void>;
  downloadMemoryFile(key: string): Promise<string | null>;
  deleteMemoryFile(key: string): Promise<void>;
};

interface CloudBackendServiceOptions {
  env?: NodeJS.ProcessEnv;
  storage?: DirectStorageAdapter;
}

function inferVideoContentType(localPath: string): string {
  const ext = path.extname(localPath).replace('.', '') || 'mp4';
  return `video/${ext}`;
}

function resolveCloudBackendMode(env: NodeJS.ProcessEnv): CloudBackendMode {
  return String(env.AWS_BACKEND_MODE || 'direct')
    .trim()
    .toLowerCase() === 'apigw'
    ? 'apigw'
    : 'direct';
}

class DirectCloudBackendService implements CloudBackendService {
  readonly mode = 'direct' as const;
  private readonly storage: DirectStorageAdapter;

  constructor(storage: DirectStorageAdapter = getAwsStorageService()) {
    this.storage = storage;
  }

  getUserProfile(userId: string): Promise<UserProfile | null> {
    return this.storage.getUserProfile(userId);
  }

  setUserProfile(profile: UserProfile): Promise<void> {
    return this.storage.setUserProfile(profile);
  }

  getChannelAnalysis(channelId: string): Promise<unknown | null> {
    return this.storage.getChannelAnalysis(channelId);
  }

  setChannelAnalysis(channelId: string, data: unknown): Promise<void> {
    return this.storage.setChannelAnalysis(channelId, data);
  }

  getUserLink(userId: string): Promise<string | null> {
    return this.storage.getUserLink(userId);
  }

  setUserLink(userId: string, channelId: string): Promise<void> {
    return this.storage.setUserLink(userId, channelId);
  }

  uploadExportedVideo(
    localPath: string,
    userId: string,
    onProgress?: (percent: number) => void,
  ): Promise<VideoExportRecord | null> {
    return this.storage.uploadExportedVideo(localPath, userId, onProgress);
  }

  listExportedVideos(userId: string): Promise<VideoExportRecord[]> {
    return this.storage.listExportedVideos(userId);
  }

  uploadAiContext(
    relativeKey: string,
    content: string,
    prefix: 'ai-context' | 'memory' = 'ai-context',
  ): Promise<void> {
    return this.storage.uploadAiContext(relativeKey, content, prefix);
  }

  downloadAiContext(
    relativeKey: string,
    prefix: 'ai-context' | 'memory' = 'ai-context',
  ): Promise<string | null> {
    return this.storage.downloadAiContext(relativeKey, prefix);
  }

  uploadMemoryFile(key: string, content: string): Promise<void> {
    return this.storage.uploadMemoryFile(key, content);
  }

  downloadMemoryFile(key: string): Promise<string | null> {
    return this.storage.downloadMemoryFile(key);
  }

  deleteMemoryFile(key: string): Promise<void> {
    return this.storage.deleteMemoryFile(key);
  }
}

class ApiGatewayCloudBackendService implements CloudBackendService {
  readonly mode = 'apigw' as const;
  private readonly baseUrl: string | undefined;
  private readonly authToken: string | undefined;

  constructor(baseUrl: string | undefined, authToken?: string) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
  }

  private getConfiguredBaseUrl(): string {
    const baseUrl = this.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error('Set AWS_BACKEND_URL before enabling AWS_BACKEND_MODE=apigw.');
    }
    return baseUrl;
  }

  private createHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (hasBody) {
      headers['content-type'] = 'application/json; charset=utf-8';
    }
    if (this.authToken?.trim()) {
      headers.authorization = `Bearer ${this.authToken.trim()}`;
    }
    return headers;
  }

  private async request<T>(
    method: 'GET' | 'PUT' | 'DELETE' | 'POST',
    routePath: string,
    body?: unknown,
  ): Promise<T> {
    const baseUrl = this.getConfiguredBaseUrl();
    const url = new URL(routePath.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`);
    const hasBody = body !== undefined;
    const response = await fetch(url, {
      method,
      headers: this.createHeaders(hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { error?: string } & T) : undefined;

    if (!response.ok) {
      const apiMessage =
        payload && typeof payload === 'object' && 'error' in payload && payload.error
          ? ` ${payload.error}`
          : '';
      throw new Error(`Cloud backend request failed (${response.status}).${apiMessage}`);
    }

    return (payload ?? (undefined as T)) as T;
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const response = await this.request<{ data: UserProfile | null }>(
      'GET',
      `/profiles/${encodeURIComponent(userId)}`,
    );
    return response.data;
  }

  async setUserProfile(profile: UserProfile): Promise<void> {
    await this.request<void>('PUT', `/profiles/${encodeURIComponent(profile.userId)}`, profile);
  }

  async getChannelAnalysis(channelId: string): Promise<unknown | null> {
    const response = await this.request<{ data: unknown | null }>(
      'GET',
      `/analysis/channels/${encodeURIComponent(channelId)}`,
    );
    return response.data;
  }

  async setChannelAnalysis(channelId: string, data: unknown): Promise<void> {
    await this.request<void>('PUT', `/analysis/channels/${encodeURIComponent(channelId)}`, {
      data,
    });
  }

  async getUserLink(userId: string): Promise<string | null> {
    const response = await this.request<{ channelId: string | null }>(
      'GET',
      `/analysis/users/${encodeURIComponent(userId)}/link`,
    );
    return response.channelId;
  }

  async setUserLink(userId: string, channelId: string): Promise<void> {
    await this.request<void>('PUT', `/analysis/users/${encodeURIComponent(userId)}/link`, {
      channelId,
    });
  }

  uploadExportedVideo(
    localPath: string,
    userId: string,
    onProgress?: (percent: number) => void,
  ): Promise<VideoExportRecord | null> {
    return (async () => {
      const fileName = path.basename(localPath);
      const fileStats = await stat(localPath);
      const plan = await this.request<PresignedVideoUploadPlan>('POST', '/videos/uploads/presign', {
        userId,
        fileName,
        fileSizeBytes: fileStats.size,
        contentType: inferVideoContentType(localPath),
      });

      await uploadFileToPresignedUrl(localPath, plan.uploadUrl, plan.requiredHeaders, onProgress);

      return plan.record;
    })();
  }

  async listExportedVideos(userId: string): Promise<VideoExportRecord[]> {
    const response = await this.request<{ items: VideoExportRecord[] }>(
      'GET',
      `/videos/users/${encodeURIComponent(userId)}`,
    );
    return response.items ?? [];
  }

  async uploadAiContext(
    relativeKey: string,
    content: string,
    prefix: 'ai-context' | 'memory' = 'ai-context',
  ): Promise<void> {
    const encodedKey = encodeURIComponent(relativeKey);
    const routePath = prefix === 'memory' ? `/memory/${encodedKey}` : `/ai-context/${encodedKey}`;
    await this.request<void>('PUT', routePath, { content });
  }

  async downloadAiContext(
    relativeKey: string,
    prefix: 'ai-context' | 'memory' = 'ai-context',
  ): Promise<string | null> {
    const encodedKey = encodeURIComponent(relativeKey);
    const routePath = prefix === 'memory' ? `/memory/${encodedKey}` : `/ai-context/${encodedKey}`;
    const response = await this.request<{ data: string | null }>('GET', routePath);
    return response.data;
  }

  uploadMemoryFile(key: string, content: string): Promise<void> {
    return this.uploadAiContext(key, content, 'memory');
  }

  downloadMemoryFile(key: string): Promise<string | null> {
    return this.downloadAiContext(key, 'memory');
  }

  async deleteMemoryFile(key: string): Promise<void> {
    await this.request<void>('DELETE', `/memory/${encodeURIComponent(key)}`);
  }
}

export function createCloudBackendService(
  options: CloudBackendServiceOptions = {},
): CloudBackendService {
  const env = options.env ?? process.env;
  const mode = resolveCloudBackendMode(env);

  if (mode === 'apigw') {
    log('info', '[CloudBackend] API Gateway mode enabled', {
      baseUrl: env.AWS_BACKEND_URL ? '[configured]' : '[missing]',
    });
    return new ApiGatewayCloudBackendService(env.AWS_BACKEND_URL, env.AWS_BACKEND_AUTH_TOKEN);
  }

  return new DirectCloudBackendService(options.storage);
}

let _instance: CloudBackendService | null = null;

export function getCloudBackendService(): CloudBackendService {
  if (!_instance) {
    _instance = createCloudBackendService();
  }
  return _instance;
}

export function resetCloudBackendService(): void {
  _instance = null;
  resetAwsStorageService();
}
