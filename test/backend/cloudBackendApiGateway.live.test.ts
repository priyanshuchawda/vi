// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeleteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  createCloudBackendService,
  type CloudBackendService,
} from '../../electron/services/cloudBackendService.js';

const RUN_AWS_APIGW_LIVE_TESTS = process.env.RUN_AWS_APIGW_LIVE_TESTS === '1';
const KEEP_AWS_LIVE_TEST_DATA = process.env.AWS_LIVE_TEST_KEEP_DATA === '1';
const describeLive = RUN_AWS_APIGW_LIVE_TESTS ? describe : describe.skip;

const REGION_FALLBACK = 'eu-central-1';
const PROFILES_TABLE = process.env.AWS_DYNAMODB_PROFILES_TABLE ?? 'quickcut-user-profiles';
const ANALYSIS_TABLE = process.env.AWS_DYNAMODB_ANALYSIS_TABLE ?? 'quickcut-channel-analysis';
const USER_LINKS_TABLE = process.env.AWS_DYNAMODB_USER_LINKS_TABLE ?? 'quickcut-user-links';

type CleanupState = {
  profileUserId?: string;
  analysisChannelId?: string;
  userLinkUserId?: string;
  s3Keys: string[];
};

type RunReport = {
  runId: string;
  region: string;
  bucket: string;
  apiUrl: string;
  kept: boolean;
  profileUserId: string;
  analysisChannelId: string;
  aiContextKey: string;
  memoryKey: string;
  createdAt: string;
};

function writeRunReport(report: RunReport): void {
  const reportPath = path.resolve(process.cwd(), 'test-results/aws-storage-apigw-live-last-run.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function ensureBucketEnv(): Promise<string> {
  const bucket = process.env.AWS_S3_BUCKET?.trim() || 'quickcut-279158981022-storage';
  process.env.AWS_S3_BUCKET = bucket;
  return bucket;
}

describeLive('CloudBackendService API Gateway live integration', () => {
  const runId = `apigw-live-${Date.now()}`;
  const userId = `quickcut-live-user-${runId}`;
  const channelId = `quickcut-live-channel-${runId}`;
  const aiContextKey = `live-tests/${runId}/chat-history.json`;
  const memoryKey = `live-tests/${runId}/memory.json`;
  const cleanup: CleanupState = { s3Keys: [] };
  let service: CloudBackendService;
  let region = REGION_FALLBACK;
  let bucket = '';
  let apiUrl = '';

  beforeAll(async () => {
    loadEnv({ path: path.resolve(process.cwd(), '.env') });
    region = process.env.AWS_REGION ?? REGION_FALLBACK;
    process.env.AWS_REGION = region;
    bucket = await ensureBucketEnv();
    apiUrl = process.env.AWS_BACKEND_URL?.trim() || '';
    if (!apiUrl) {
      throw new Error('Set AWS_BACKEND_URL to the deployed HTTP API URL before running API Gateway live tests.');
    }
    const s3 = new S3Client({ region });
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    service = createCloudBackendService({
      env: {
        ...process.env,
        AWS_BACKEND_MODE: 'apigw',
        AWS_BACKEND_URL: apiUrl,
      },
    });
  });

  it('round-trips profile, analysis, user link, ai context, and memory through API Gateway', async () => {
    const profile = {
      userId,
      userName: 'QuickCut API Gateway Live Test',
      email: `${runId}@example.com`,
      youtubeChannelUrl: 'https://www.youtube.com/@quickcut-live',
      channelAnalysisId: channelId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await service.setUserProfile(profile);
    cleanup.profileUserId = userId;

    const storedProfile = await service.getUserProfile(userId);
    expect(storedProfile).toMatchObject({
      userId,
      userName: profile.userName,
      email: profile.email,
      youtubeChannelUrl: profile.youtubeChannelUrl,
      channelAnalysisId: channelId,
    });

    const analysisPayload = {
      channel: { id: channelId, title: `QuickCut API Gateway ${runId}` },
      analysis: { channel_summary: 'API Gateway live test payload' },
      meta: { analyzed_at: new Date().toISOString(), cache_hit: false },
    };

    await service.setChannelAnalysis(channelId, analysisPayload);
    cleanup.analysisChannelId = channelId;
    await service.setUserLink(userId, channelId);
    cleanup.userLinkUserId = userId;

    const storedAnalysis = await service.getChannelAnalysis(channelId);
    expect(storedAnalysis).toMatchObject(analysisPayload);

    const storedUserLink = await service.getUserLink(userId);
    expect(storedUserLink).toBe(channelId);

    const aiContextPayload = JSON.stringify({
      runId,
      messages: [{ id: 'msg-1', role: 'user', content: 'apigw live test' }],
    });
    await service.uploadAiContext(aiContextKey, aiContextPayload);
    cleanup.s3Keys.push(`ai-context/${aiContextKey}`);
    await expect(service.downloadAiContext(aiContextKey)).resolves.toBe(aiContextPayload);

    await service.uploadMemoryFile(memoryKey, '{"memory":"hello"}');
    cleanup.s3Keys.push(`memory/${memoryKey}`);
    await expect(service.downloadMemoryFile(memoryKey)).resolves.toBe('{"memory":"hello"}');
    await service.deleteMemoryFile(memoryKey);
    cleanup.s3Keys = cleanup.s3Keys.filter((key) => key !== `memory/${memoryKey}`);
    await expect(service.downloadMemoryFile(memoryKey)).resolves.toBeNull();

    writeRunReport({
      runId,
      region,
      bucket,
      apiUrl,
      kept: KEEP_AWS_LIVE_TEST_DATA,
      profileUserId: userId,
      analysisChannelId: channelId,
      aiContextKey: `ai-context/${aiContextKey}`,
      memoryKey: `memory/${memoryKey}`,
      createdAt: new Date().toISOString(),
    });
  }, 120_000);

  afterAll(async () => {
    if (!RUN_AWS_APIGW_LIVE_TESTS) return;
    if (KEEP_AWS_LIVE_TEST_DATA) return;

    const dynamo = new DynamoDBClient({ region });
    const s3 = new S3Client({ region });

    if (cleanup.profileUserId) {
      await dynamo.send(
        new DeleteItemCommand({
          TableName: PROFILES_TABLE,
          Key: { userId: { S: cleanup.profileUserId } },
        }),
      );
    }

    if (cleanup.analysisChannelId) {
      await dynamo.send(
        new DeleteItemCommand({
          TableName: ANALYSIS_TABLE,
          Key: { channelId: { S: cleanup.analysisChannelId } },
        }),
      );
    }

    if (cleanup.userLinkUserId) {
      await dynamo.send(
        new DeleteItemCommand({
          TableName: USER_LINKS_TABLE,
          Key: { userId: { S: cleanup.userLinkUserId } },
        }),
      );
    }

    await Promise.all(
      cleanup.s3Keys.map((key) =>
        s3.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        ),
      ),
    );
  });
});
