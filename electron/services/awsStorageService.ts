/**
 * AWS Storage Service
 *
 * Four storage domains:
 *  1. User profiles       — DynamoDB (quickcut-user-profiles)
 *  2. Channel analysis    — DynamoDB (quickcut-channel-analysis) + L1/L2 cache
 *  3. Exported videos     — S3 multipart upload  (videos/{userId}/...)
 *  4. AI context / memory — S3 gzip JSON         (ai-context/... + memory/...)
 *
 * Cost-optimization strategies:
 *  - DynamoDB PAY_PER_REQUEST — zero idle cost
 *  - DynamoDB TTL — free automatic expiry for analysis + user-links
 *  - L1 memory → L2 disk → L3 DynamoDB cache tiers (DDB only on full miss)
 *  - S3 lifecycle: STANDARD → IA at 30d, expire at 365d
 *  - Gzip compression on all S3 text objects (~70% smaller)
 *  - S3 multipart for videos — handles large files without memory pressure
 *  - All writes are fire-and-forget — never blocks the UI
 *  - Graceful fallback — every operation returns null/void on AWS failure
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { log } from '../utils/logger.js';

// ── S3 key prefixes ──────────────────────────────────────────────────────────
const S3_VIDEOS_PREFIX = 'videos';
const S3_MEMORY_PREFIX = 'memory';
const S3_AI_CONTEXT_PREFIX = 'ai-context';

// ── TTLs ─────────────────────────────────────────────────────────────────────
const ANALYSIS_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const USER_LINK_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

// ── Types ────────────────────────────────────────────────────────────────────
export interface UserProfile {
  userId: string;
  userName?: string;
  email?: string;
  youtubeChannelUrl?: string;
  channelAnalysisId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VideoExportRecord {
  s3Key: string;
  s3Url: string;
  fileName: string;
  fileSizeBytes: number;
  exportedAt: string;
  format: string;
}

// ── Service class ────────────────────────────────────────────────────────────
export class AwsStorageService {
  private dynamo: DynamoDBDocumentClient;
  private s3: S3Client;
  private readonly s3Bucket: string;
  private readonly region: string;
  private readonly profilesTable: string;
  private readonly analysisTable: string;
  private readonly userLinksTable: string;

  constructor() {
    // Read env vars here (not at module level) so dotenv has already run.
    // The lazy singleton ensures this constructor is called after main.ts
    // calls config() to load the .env file.
    this.region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-central-1';
    this.s3Bucket = process.env.AWS_S3_BUCKET ?? '';
    this.profilesTable = process.env.AWS_DYNAMODB_PROFILES_TABLE ?? 'quickcut-user-profiles';
    this.analysisTable = process.env.AWS_DYNAMODB_ANALYSIS_TABLE ?? 'quickcut-channel-analysis';
    this.userLinksTable = process.env.AWS_DYNAMODB_USER_LINKS_TABLE ?? 'quickcut-user-links';

    // Use the SDK default credential provider chain — it reads from
    // ~/.aws/credentials and auto-refreshes STS/SSO tokens on every request.
    const cfg = { region: this.region };
    this.dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(cfg), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.s3 = new S3Client(cfg);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. USER PROFILES  (DynamoDB — no TTL, permanent)
  // ══════════════════════════════════════════════════════════════════════════

  /** Load user profile from DynamoDB. Returns null on miss or error. */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const result = await this.dynamo.send(
        new GetCommand({ TableName: this.profilesTable, Key: { userId } }),
      );
      return (result.Item as UserProfile) ?? null;
    } catch (err) {
      log('warn', '[AWS:DDB] getUserProfile failed', { userId, err });
      return null;
    }
  }

  /** Persist (upsert) a user profile to DynamoDB. */
  async setUserProfile(profile: UserProfile): Promise<void> {
    try {
      await this.dynamo.send(
        new PutCommand({
          TableName: this.profilesTable,
          Item: { ...profile, updatedAt: Date.now() },
        }),
      );
      log('info', '[AWS:DDB] Saved user profile', { userId: profile.userId });
    } catch (err) {
      log('warn', '[AWS:DDB] setUserProfile failed', { userId: profile.userId, err });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. CHANNEL ANALYSIS  (DynamoDB — 7-day TTL)
  // ══════════════════════════════════════════════════════════════════════════

  /** Fetch channel analysis from DynamoDB. Returns null on any miss/error. */
  async getChannelAnalysis(channelId: string): Promise<unknown | null> {
    try {
      const result = await this.dynamo.send(
        new GetCommand({
          TableName: this.analysisTable,
          Key: { channelId },
          ProjectionExpression: '#d',
          ExpressionAttributeNames: { '#d': 'data' },
        }),
      );
      return result.Item?.['data'] ?? null;
    } catch (err) {
      log('warn', '[AWS:DDB] getChannelAnalysis failed', { channelId, err });
      return null;
    }
  }

  /** Persist channel analysis to DynamoDB with 7-day TTL. */
  async setChannelAnalysis(channelId: string, data: unknown): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + ANALYSIS_TTL_SECONDS;
    try {
      await this.dynamo.send(
        new PutCommand({ TableName: this.analysisTable, Item: { channelId, data, ttl } }),
      );
      log('info', '[AWS:DDB] Cached channel analysis', { channelId });
    } catch (err) {
      log('warn', '[AWS:DDB] setChannelAnalysis failed', { channelId, err });
    }
  }

  // ── User→channel links (DynamoDB — 30-day TTL) ───────────────────────────

  async getUserLink(userId: string): Promise<string | null> {
    try {
      const result = await this.dynamo.send(
        new GetCommand({
          TableName: this.userLinksTable,
          Key: { userId },
          ProjectionExpression: 'channelId',
        }),
      );
      return (result.Item?.['channelId'] as string) ?? null;
    } catch (err) {
      log('warn', '[AWS:DDB] getUserLink failed', { userId, err });
      return null;
    }
  }

  async setUserLink(userId: string, channelId: string): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + USER_LINK_TTL_SECONDS;
    try {
      await this.dynamo.send(
        new PutCommand({
          TableName: this.userLinksTable,
          Item: { userId, channelId, ttl },
        }),
      );
      log('info', '[AWS:DDB] Linked user to channel', { userId, channelId });
    } catch (err) {
      log('warn', '[AWS:DDB] setUserLink failed', { userId, channelId, err });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. EXPORTED VIDEOS  (S3 multipart — videos/{userId}/{ts}-{name})
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Upload an exported video file to S3 using multipart upload.
   * Large files are automatically streamed in 10 MB chunks.
   * Returns the S3 key on success, null on failure.
   */
  async uploadExportedVideo(
    localPath: string,
    userId: string,
    onProgress?: (percent: number) => void,
  ): Promise<VideoExportRecord | null> {
    if (!this.s3Bucket) return null;
    try {
      const fileName = path.basename(localPath);
      const ext = path.extname(fileName).replace('.', '') || 'mp4';
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const s3Key = `${S3_VIDEOS_PREFIX}/${userId}/${ts}-${fileName}`;
      const { size } = await stat(localPath);

      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: this.s3Bucket,
          Key: s3Key,
          Body: createReadStream(localPath),
          ContentType: `video/${ext}`,
          // Videos stay STANDARD (frequent access for recent exports)
          // Lifecycle rules will transition to IA after 30 days automatically
          StorageClass: 'STANDARD',
          Metadata: {
            userId,
            exportedAt: new Date().toISOString(),
            originalName: fileName,
          },
        },
        // 10 MB parts — good balance of memory use vs. API call count
        partSize: 10 * 1024 * 1024,
        queueSize: 3,
      });

      if (onProgress) {
        upload.on('httpUploadProgress', (progress) => {
          if (progress.loaded && progress.total) {
            onProgress(Math.round((progress.loaded / progress.total) * 100));
          }
        });
      }

      await upload.done();
      const s3Url = `https://${this.s3Bucket}.s3.${this.region}.amazonaws.com/${s3Key}`;
      const record: VideoExportRecord = {
        s3Key,
        s3Url,
        fileName,
        fileSizeBytes: size,
        exportedAt: new Date().toISOString(),
        format: ext,
      };
      log('info', '[AWS:S3] Uploaded exported video', { s3Key, size });
      return record;
    } catch (err) {
      log('warn', '[AWS:S3] uploadExportedVideo failed', { localPath, err });
      return null;
    }
  }

  /**
   * List exported videos for a user.
   * Returns array of S3 keys (most recent first).
   */
  async listExportedVideos(userId: string): Promise<VideoExportRecord[]> {
    if (!this.s3Bucket) return [];
    try {
      const result = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.s3Bucket,
          Prefix: `${S3_VIDEOS_PREFIX}/${userId}/`,
          MaxKeys: 100,
        }),
      );
      const items = (result.Contents ?? [])
        .filter((o) => o.Key)
        .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0))
        .map((o) => {
          const key = o.Key!;
          const fileName = path.basename(key);
          const ext = path.extname(fileName).replace('.', '') || 'mp4';
          return {
            s3Key: key,
            s3Url: `https://${this.s3Bucket}.s3.${this.region}.amazonaws.com/${key}`,
            fileName,
            fileSizeBytes: o.Size ?? 0,
            exportedAt: o.LastModified?.toISOString() ?? '',
            format: ext,
          } satisfies VideoExportRecord;
        });
      return items;
    } catch (err) {
      log('warn', '[AWS:S3] listExportedVideos failed', { userId, err });
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. AI CONTEXT / MEMORY  (S3 gzip JSON)
  // ══════════════════════════════════════════════════════════════════════════

  /** Upload a text/JSON AI context file to S3, gzip-compressed. */
  async uploadAiContext(
    relativeKey: string,
    content: string,
    prefix: 'ai-context' | 'memory' = 'ai-context',
  ): Promise<void> {
    if (!this.s3Bucket) return;
    const fullKey = `${prefix === 'ai-context' ? S3_AI_CONTEXT_PREFIX : S3_MEMORY_PREFIX}/${relativeKey}`;
    try {
      const compressed = gzipSync(Buffer.from(content, 'utf-8'));
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: fullKey,
          Body: compressed,
          ContentEncoding: 'gzip',
          ContentType: 'application/json; charset=utf-8',
          StorageClass: 'STANDARD',
        }),
      );
      log('info', '[AWS:S3] Uploaded AI context', { fullKey });
    } catch (err) {
      log('warn', '[AWS:S3] uploadAiContext failed', { relativeKey, err });
    }
  }

  /** Download and decompress an AI context file from S3. Returns null on miss/error. */
  async downloadAiContext(
    relativeKey: string,
    prefix: 'ai-context' | 'memory' = 'ai-context',
  ): Promise<string | null> {
    if (!this.s3Bucket) return null;
    const fullKey = `${prefix === 'ai-context' ? S3_AI_CONTEXT_PREFIX : S3_MEMORY_PREFIX}/${relativeKey}`;
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: fullKey }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) return null;
      return gunzipSync(Buffer.from(bytes)).toString('utf-8');
    } catch (err) {
      log('warn', '[AWS:S3] downloadAiContext failed', { relativeKey, err });
      return null;
    }
  }

  // ── Legacy memory file helpers (keep existing callers working) ───────────

  async uploadMemoryFile(key: string, content: string): Promise<void> {
    return this.uploadAiContext(key, content, 'memory');
  }

  async downloadMemoryFile(key: string): Promise<string | null> {
    return this.downloadAiContext(key, 'memory');
  }

  async deleteMemoryFile(key: string): Promise<void> {
    if (!this.s3Bucket) return;
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.s3Bucket,
          Key: `${S3_MEMORY_PREFIX}/${key}`,
        }),
      );
      log('info', '[AWS:S3] Deleted memory file', { key });
    } catch (err) {
      log('warn', '[AWS:S3] deleteMemoryFile failed', { key, err });
    }
  }
}

// ── Lazy singleton ────────────────────────────────────────────────────────────
let _instance: AwsStorageService | null = null;

export function getAwsStorageService(): AwsStorageService {
  if (!_instance) {
    _instance = new AwsStorageService();
  }
  return _instance;
}

export function resetAwsStorageService(): void {
  _instance = null;
}
