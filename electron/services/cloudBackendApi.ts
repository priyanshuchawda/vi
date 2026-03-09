import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  type InstallationRegistration,
  type PresignedVideoUploadPlan,
  type UserProfile,
  type VideoExportRecord,
  getAwsStorageService,
} from './awsStorageService.js';
import {
  CLOUD_BACKEND_INSTALLATION_ID_HEADER,
  CLOUD_BACKEND_INSTALLATION_SECRET_HEADER,
} from './cloudBackendInstallationAuth.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' } as const;

const userProfileSchema = z.object({
  userId: z.string().trim().min(1),
  userName: z.string().optional(),
  email: z.string().optional(),
  youtubeChannelUrl: z.string().optional(),
  channelAnalysisId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const channelAnalysisWriteSchema = z.object({
  data: z.unknown(),
});

const userLinkWriteSchema = z.object({
  channelId: z.string().trim().min(1),
});

const textObjectWriteSchema = z.object({
  content: z.string(),
});

const videoUploadPresignSchema = z.object({
  userId: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  fileSizeBytes: z.number().int().positive(),
  contentType: z.string().trim().min(1).optional(),
});

export interface CloudBackendApiStorage {
  getUserProfile(userId: string): Promise<UserProfile | null>;
  setUserProfile(profile: UserProfile): Promise<void>;
  getChannelAnalysis(channelId: string): Promise<unknown | null>;
  setChannelAnalysis(channelId: string, data: unknown): Promise<void>;
  getUserLink(userId: string): Promise<string | null>;
  setUserLink(userId: string, channelId: string): Promise<void>;
  registerInstallation(): Promise<InstallationRegistration | null>;
  validateInstallationCredentials(
    installationId: string,
    installationSecret: string,
  ): Promise<boolean>;
  createPresignedVideoUploadPlan(
    userId: string,
    fileName: string,
    fileSizeBytes: number,
    contentType?: string,
  ): Promise<PresignedVideoUploadPlan | null>;
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

export interface CloudBackendApiRequest {
  method: string;
  path: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
}

export interface CloudBackendApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function jsonResponse(statusCode: number, payload: unknown): CloudBackendApiResponse {
  return {
    statusCode,
    headers: { ...jsonHeaders },
    body: JSON.stringify(payload),
  };
}

function noContentResponse(): CloudBackendApiResponse {
  return {
    statusCode: 204,
    headers: {},
    body: '',
  };
}

function parseRequestBody(body: string | null | undefined): unknown {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function splitPath(path: string): string[] {
  return path
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
}

function decodeObjectKey(segments: string[], startIndex: number): string {
  return segments.slice(startIndex).join('/').trim();
}

function getConfiguredApiAuthToken(env: NodeJS.ProcessEnv): string | null {
  const configured = env.AWS_BACKEND_AUTH_TOKEN?.trim();
  return configured ? configured : null;
}

function requiresInstallationAuth(env: NodeJS.ProcessEnv): boolean {
  return env.AWS_BACKEND_REQUIRE_INSTALLATION_AUTH?.trim() === '1';
}

function getHeaderValue(request: CloudBackendApiRequest, headerName: string): string | null {
  const expectedName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === expectedName && typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
  }
  return null;
}

function isBearerTokenAuthorized(request: CloudBackendApiRequest, env: NodeJS.ProcessEnv): boolean {
  const configuredToken = getConfiguredApiAuthToken(env);
  if (!configuredToken) {
    return false;
  }

  const authorizationHeader =
    getHeaderValue(request, 'authorization') ??
    request.headers?.authorization ??
    request.headers?.Authorization ??
    '';
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }

  const receivedToken = match[1].trim();
  const expectedBuffer = Buffer.from(configuredToken, 'utf8');
  const receivedBuffer = Buffer.from(receivedToken, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function isInstallationAuthorized(
  request: CloudBackendApiRequest,
  storage: CloudBackendApiStorage,
): Promise<boolean> {
  const installationId = getHeaderValue(request, CLOUD_BACKEND_INSTALLATION_ID_HEADER);
  const installationSecret = getHeaderValue(request, CLOUD_BACKEND_INSTALLATION_SECRET_HEADER);
  if (!installationId || !installationSecret) {
    return false;
  }

  return storage.validateInstallationCredentials(installationId, installationSecret);
}

export async function handleCloudBackendApiRequest(
  request: CloudBackendApiRequest,
  storage: CloudBackendApiStorage = getAwsStorageService(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CloudBackendApiResponse> {
  try {
    const method = request.method.toUpperCase();
    const segments = splitPath(request.path);
    const isInstallationRegistrationRoute =
      method === 'POST' &&
      segments[0] === 'auth' &&
      segments[1] === 'installations' &&
      segments[2] === 'register' &&
      segments.length === 3;

    const isAuthorized =
      isBearerTokenAuthorized(request, env) || (await isInstallationAuthorized(request, storage));
    const authIsRequired = requiresInstallationAuth(env) || Boolean(getConfiguredApiAuthToken(env));

    if (!isInstallationRegistrationRoute && !isAuthorized && authIsRequired) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    if (isInstallationRegistrationRoute) {
      const credentials = await storage.registerInstallation();
      if (!credentials) {
        return jsonResponse(503, { error: 'Installation registration is unavailable.' });
      }
      return jsonResponse(200, credentials);
    }

    if (segments[0] === 'profiles' && segments.length === 2) {
      const userId = z.string().trim().min(1).parse(segments[1]);
      if (method === 'GET') {
        return jsonResponse(200, { data: await storage.getUserProfile(userId) });
      }
      if (method === 'PUT') {
        const profile = userProfileSchema.parse(parseRequestBody(request.body));
        if (profile.userId !== userId) {
          return jsonResponse(400, { error: 'Profile userId must match route userId.' });
        }
        await storage.setUserProfile(profile);
        return noContentResponse();
      }
    }

    if (segments[0] === 'analysis' && segments[1] === 'channels' && segments.length === 3) {
      const channelId = z.string().trim().min(1).parse(segments[2]);
      if (method === 'GET') {
        return jsonResponse(200, { data: await storage.getChannelAnalysis(channelId) });
      }
      if (method === 'PUT') {
        const payload = channelAnalysisWriteSchema.parse(parseRequestBody(request.body));
        await storage.setChannelAnalysis(channelId, payload.data);
        return noContentResponse();
      }
    }

    if (
      segments[0] === 'analysis' &&
      segments[1] === 'users' &&
      segments[3] === 'link' &&
      segments.length === 4
    ) {
      const userId = z.string().trim().min(1).parse(segments[2]);
      if (method === 'GET') {
        return jsonResponse(200, { channelId: await storage.getUserLink(userId) });
      }
      if (method === 'PUT') {
        const payload = userLinkWriteSchema.parse(parseRequestBody(request.body));
        await storage.setUserLink(userId, payload.channelId);
        return noContentResponse();
      }
    }

    if (segments[0] === 'videos' && segments[1] === 'users' && segments.length === 3) {
      const userId = z.string().trim().min(1).parse(segments[2]);
      if (method === 'GET') {
        return jsonResponse(200, { items: await storage.listExportedVideos(userId) });
      }
    }

    if (segments[0] === 'videos' && segments[1] === 'uploads' && segments[2] === 'presign') {
      if (method === 'POST') {
        const payload = videoUploadPresignSchema.parse(parseRequestBody(request.body));
        const plan = await storage.createPresignedVideoUploadPlan(
          payload.userId,
          payload.fileName,
          payload.fileSizeBytes,
          payload.contentType,
        );
        if (!plan) {
          return jsonResponse(503, { error: 'Video upload plan could not be created.' });
        }
        return jsonResponse(200, plan);
      }
    }

    if (segments[0] === 'ai-context' && segments.length >= 2) {
      const key = z.string().trim().min(1).parse(decodeObjectKey(segments, 1));
      if (method === 'GET') {
        return jsonResponse(200, { data: await storage.downloadAiContext(key, 'ai-context') });
      }
      if (method === 'PUT') {
        const payload = textObjectWriteSchema.parse(parseRequestBody(request.body));
        await storage.uploadAiContext(key, payload.content, 'ai-context');
        return noContentResponse();
      }
    }

    if (segments[0] === 'memory' && segments.length >= 2) {
      const key = z.string().trim().min(1).parse(decodeObjectKey(segments, 1));
      if (method === 'GET') {
        return jsonResponse(200, { data: await storage.downloadMemoryFile(key) });
      }
      if (method === 'PUT') {
        const payload = textObjectWriteSchema.parse(parseRequestBody(request.body));
        await storage.uploadMemoryFile(key, payload.content);
        return noContentResponse();
      }
      if (method === 'DELETE') {
        await storage.deleteMemoryFile(key);
        return noContentResponse();
      }
    }

    return jsonResponse(404, { error: 'Route not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown backend error';
    return jsonResponse(400, { error: message });
  }
}
