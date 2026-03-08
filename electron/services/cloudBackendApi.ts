import { z } from 'zod';
import { type UserProfile, getAwsStorageService } from './awsStorageService.js';

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

export interface CloudBackendApiStorage {
  getUserProfile(userId: string): Promise<UserProfile | null>;
  setUserProfile(profile: UserProfile): Promise<void>;
  getChannelAnalysis(channelId: string): Promise<unknown | null>;
  setChannelAnalysis(channelId: string, data: unknown): Promise<void>;
  getUserLink(userId: string): Promise<string | null>;
  setUserLink(userId: string, channelId: string): Promise<void>;
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

export async function handleCloudBackendApiRequest(
  request: CloudBackendApiRequest,
  storage: CloudBackendApiStorage = getAwsStorageService(),
): Promise<CloudBackendApiResponse> {
  try {
    const method = request.method.toUpperCase();
    const segments = splitPath(request.path);

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
